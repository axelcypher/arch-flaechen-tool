//! Desktop-Hülle für den Flächenrechner.
//!
//! Die gesamte Fachlogik liegt im Web-Frontend (TypeScript), damit dieselbe Anwendung
//! auch als reine Webanwendung betrieben werden kann. Rust stellt hier nur das bereit,
//! was der Browser nicht kann: einen nativen Speichern-Dialog mit Schreibzugriff.

use base64::Engine;
use tauri_plugin_dialog::DialogExt;

/// Öffnet einen nativen Speichern-Dialog und schreibt `contents` in die gewählte Datei.
/// Gibt den Pfad zurück oder `None`, wenn der Benutzer abgebrochen hat.
#[tauri::command]
async fn save_file(
    app: tauri::AppHandle,
    default_name: String,
    contents: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    save_bytes(&app, &default_name, contents.as_bytes(), &filter_name, &extensions)
}

/// Wie `save_file`, aber für Binärdaten (z. B. Excel), Base64-kodiert übertragen.
#[tauri::command]
async fn save_binary_file(
    app: tauri::AppHandle,
    default_name: String,
    contents_base64: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_base64.as_bytes())
        .map_err(|e| format!("Ungültige Daten: {e}"))?;
    save_bytes(&app, &default_name, &bytes, &filter_name, &extensions)
}

fn save_bytes(
    app: &tauri::AppHandle,
    default_name: &str,
    contents: &[u8],
    filter_name: &str,
    extensions: &[String],
) -> Result<Option<String>, String> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let picked = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter(filter_name, &exts)
        .blocking_save_file();

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, contents).map_err(|e| format!("{}: {}", path.display(), e))?;
    Ok(Some(path.display().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_file, save_binary_file])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Anwendung");
}
