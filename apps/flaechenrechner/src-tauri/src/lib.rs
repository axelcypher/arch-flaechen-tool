//! Desktop-Hülle für den Flächenrechner. Die Befehle (Speichern-Dialoge, Protokoll) sind allen Apps
//! gemeinsam und stehen in packages/core/tauri/commands.rs.

include!("../../../../packages/core/tauri/commands.rs");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(log_plugin("flaechenrechner"))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_file, save_binary_file])
        .setup(|app| {
            log::info!("Flächenrechner {} gestartet", app.package_info().version);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Anwendung");
}
