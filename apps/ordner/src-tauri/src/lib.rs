//! Desktop-Hülle für das Projektordner-Tool. Die allgemeinen Befehle (Speichern-Dialoge, Protokoll) stehen
//! in packages/core/tauri/commands.rs; hier kommen die Dateisystem-Befehle dieses Tools dazu.
//!
//! Grundsatz: Es werden nur neue Ordner und Dateien angelegt. Nichts wird überschrieben, verschoben oder
//! gelöscht, und jeder Pfad bleibt innerhalb des vom Benutzer gewählten Ordners.

include!("../../../../packages/core/tauri/commands.rs");

use std::io::Write;
use std::path::{Component, Path, PathBuf};

/// größte Datei, die als Vorlage gelesen wird
const MAX_LESEN: u64 = 64 * 1024 * 1024;
/// Obergrenze der Einträge beim Auflisten (Schutz vor versehentlich gewählten Laufwerken)
const MAX_EINTRAEGE: usize = 50_000;

#[derive(serde::Serialize)]
struct Eintrag {
    /// Pfad relativ zum aufgelisteten Ordner, mit „/“ getrennt
    pfad: String,
    ordner: bool,
    groesse: u64,
}

/// Setzt `rel` unter `root` – nur gewöhnliche Namen, kein „..“, kein absoluter Pfad.
fn unterhalb(root: &str, rel: &str) -> Result<PathBuf, String> {
    let root = Path::new(root);
    if !root.is_absolute() {
        return Err(format!("Kein vollständiger Pfad: {}", root.display()));
    }
    let mut out = root.to_path_buf();
    let mut teile = 0;
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(n) => {
                out.push(n);
                teile += 1;
            }
            Component::CurDir => {}
            _ => return Err(format!("Unzulässiger Pfad: {rel}")),
        }
    }
    if teile == 0 {
        return Err("Leerer Pfad".into());
    }
    Ok(out)
}

/// Öffnet den Dialog zur Ordnerwahl. `None`, wenn der Benutzer abgebrochen hat.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle, title: String) -> Result<Option<String>, String> {
    let picked = app.dialog().file().set_title(title).blocking_pick_folder();
    match picked {
        Some(p) => Ok(Some(p.into_path().map_err(|e| e.to_string())?.display().to_string())),
        None => Ok(None),
    }
}

fn sammle(dir: &Path, prefix: &str, tiefe: u32, out: &mut Vec<Eintrag>) -> Result<(), String> {
    let lesen = std::fs::read_dir(dir).map_err(|e| format!("{}: {}", dir.display(), e))?;
    for e in lesen {
        let e = e.map_err(|e| format!("{}: {}", dir.display(), e))?;
        let typ = e.file_type().map_err(|e| e.to_string())?;
        if typ.is_symlink() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        let pfad = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
        if out.len() >= MAX_EINTRAEGE {
            return Err(format!("Mehr als {MAX_EINTRAEGE} Einträge – bitte einen kleineren Ordner wählen."));
        }
        if typ.is_dir() {
            out.push(Eintrag { pfad: pfad.clone(), ordner: true, groesse: 0 });
            if tiefe > 1 {
                sammle(&e.path(), &pfad, tiefe - 1, out)?;
            }
        } else {
            let groesse = e.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(Eintrag { pfad, ordner: false, groesse });
        }
    }
    Ok(())
}

/// Listet Ordner und Dateien unter `root` bis zur Tiefe `tiefe` (1 = nur der Ordner selbst).
#[tauri::command]
async fn fs_list(root: String, tiefe: u32) -> Result<Vec<Eintrag>, String> {
    let dir = Path::new(&root);
    if !dir.is_absolute() {
        return Err(format!("Kein vollständiger Pfad: {root}"));
    }
    let mut out = Vec::new();
    sammle(dir, "", tiefe.max(1), &mut out)?;
    out.sort_by(|a, b| a.pfad.to_lowercase().cmp(&b.pfad.to_lowercase()));
    Ok(out)
}

/// Liest eine Datei unter `root` (Base64).
#[tauri::command]
async fn fs_read(root: String, pfad: String) -> Result<String, String> {
    let p = unterhalb(&root, &pfad)?;
    let groesse = std::fs::metadata(&p).map_err(|e| format!("{}: {}", p.display(), e))?.len();
    if groesse > MAX_LESEN {
        return Err(format!("{}: Datei ist größer als {} MB", p.display(), MAX_LESEN / 1024 / 1024));
    }
    let bytes = std::fs::read(&p).map_err(|e| format!("{}: {}", p.display(), e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Legt einen Ordner (mit allen Zwischenordnern) an. `true`, wenn er neu ist; `false`, wenn es ihn schon gab.
#[tauri::command]
async fn fs_create_dir(root: String, pfad: String) -> Result<bool, String> {
    let p = unterhalb(&root, &pfad)?;
    if p.is_dir() {
        return Ok(false);
    }
    if p.exists() {
        return Err(format!("{}: Es gibt bereits eine Datei mit diesem Namen", p.display()));
    }
    std::fs::create_dir_all(&p).map_err(|e| format!("{}: {}", p.display(), e))?;
    log::info!("Ordner angelegt: {}", p.display());
    Ok(true)
}

/// Schreibt eine neue Datei. Eine vorhandene Datei bleibt unverändert – dann `false`.
#[tauri::command]
async fn fs_write_new(root: String, pfad: String, contents_base64: String) -> Result<bool, String> {
    let p = unterhalb(&root, &pfad)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_base64.as_bytes())
        .map_err(|e| format!("Ungültige Daten: {e}"))?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {}", parent.display(), e))?;
    }
    // create_new: schlägt fehl, wenn die Datei existiert – nie überschreiben
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&p) {
        Ok(mut f) => {
            f.write_all(&bytes).map_err(|e| format!("{}: {}", p.display(), e))?;
            log::info!("Datei angelegt: {} ({} Bytes)", p.display(), bytes.len());
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(format!("{}: {}", p.display(), e)),
    }
}

/// Zeigt einen Ordner im Dateimanager.
#[tauri::command]
async fn open_folder(pfad: String) -> Result<(), String> {
    let p = Path::new(&pfad);
    if !p.is_absolute() || !p.is_dir() {
        return Err(format!("Ordner nicht gefunden: {pfad}"));
    }
    #[cfg(target_os = "windows")]
    let programm = "explorer";
    #[cfg(target_os = "macos")]
    let programm = "open";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let programm = "xdg-open";
    std::process::Command::new(programm).arg(p).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(log_plugin("projektordner"))
        .plugin(tauri_plugin_dialog::init())
        // automatische Updates: signiertes Manifest je App (tauri.conf.json → plugins.updater)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            save_file,
            save_binary_file,
            pick_save_path,
            read_binary_file,
            write_binary_file,
            pick_folder,
            fs_list,
            fs_read,
            fs_create_dir,
            fs_write_new,
            open_folder
        ])
        .setup(|app| {
            log::info!("Projektordner {} gestartet", app.package_info().version);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Anwendung");
}
