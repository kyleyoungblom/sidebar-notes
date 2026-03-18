use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// ─── Data types ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NoteMetadata {
    pub path: String,
    pub title: String,
    pub modified: u64,
    pub preview: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub notes_dir: String,
    pub hotkey: String,
    pub theme: String,
}

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub config_path: PathBuf,
}

// ─── Config helpers ────────────────────────────────────────────────────────────

fn load_config(path: &PathBuf) -> AppConfig {
    if path.exists() {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                return config;
            }
        }
    }
    AppConfig {
        notes_dir: String::new(),
        hotkey: "ctrl+shift+space".to_string(),
        theme: "dark".to_string(),
    }
}

fn save_config(path: &PathBuf, config: &AppConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Window helpers ─────────────────────────────────────────────────────────

fn position_window_right(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let screen = monitor.size();
        let win_w = window.outer_size().map(|s| s.width).unwrap_or(380);
        let x = screen.width.saturating_sub(win_w) as i32;
        let _ = window.set_position(PhysicalPosition::new(x, 0));
        let _ = window.set_size(PhysicalSize::new(win_w, screen.height));
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            position_window_right(&window);
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
async fn list_notes(notes_dir: String) -> Result<Vec<NoteMetadata>, String> {
    let dir = PathBuf::from(&notes_dir);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        return Ok(vec![]);
    }

    let mut notes = vec![];
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }

        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let content = fs::read_to_string(&path).unwrap_or_default();

        let title = content
            .lines()
            .next()
            .map(|l| l.trim_start_matches('#').trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                path.file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string()
            });

        let preview = content
            .lines()
            .skip_while(|l| l.starts_with('#') || l.trim().is_empty())
            .next()
            .unwrap_or("")
            .chars()
            .take(120)
            .collect::<String>();

        let modified = meta
            .modified()
            .map(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
            })
            .unwrap_or(0);

        notes.push(NoteMetadata {
            path: path.to_string_lossy().to_string(),
            title,
            modified,
            preview,
        });
    }

    notes.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(notes)
}

#[tauri::command]
async fn read_note(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_note(path: String, content: String) -> Result<(), String> {
    let tmp = format!("{}.tmp", path);
    fs::write(&tmp, &content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_note(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn new_note(notes_dir: String) -> Result<String, String> {
    let dir = PathBuf::from(&notes_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let path = dir.join(format!("note-{ts}.md"));
    fs::write(&path, "# New Note\n\n").map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_config(state: tauri::State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.lock().unwrap().clone())
}

#[tauri::command]
async fn set_config(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    config: AppConfig,
) -> Result<(), String> {
    let mut current = state.config.lock().unwrap();

    // Re-register hotkey if it changed
    if current.hotkey != config.hotkey {
        let old_hotkey = current.hotkey.clone();
        let new_hotkey = config.hotkey.clone();

        let _ = app.global_shortcut().unregister(old_hotkey.as_str());

        let app_clone = app.clone();
        if let Err(e) = app.global_shortcut().on_shortcut(
            new_hotkey.as_str(),
            move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    toggle_window(app);
                }
            },
        ) {
            return Err(format!("Failed to register hotkey '{}': {}", new_hotkey, e));
        }
        let _ = app_clone; // keep alive
    }

    save_config(&state.config_path, &config)?;
    *current = config;
    Ok(())
}

#[tauri::command]
async fn show_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── App entry point ─────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Resolve config path and load config
            let config_path = app
                .path()
                .app_config_dir()
                .expect("no app config dir")
                .join("config.json");

            let mut config = load_config(&config_path);

            // Set default notes dir if not configured
            if config.notes_dir.is_empty() {
                let base = app
                    .path()
                    .document_dir()
                    .unwrap_or_else(|_| PathBuf::from("."));
                config.notes_dir = base
                    .join("SidebarNotes")
                    .to_string_lossy()
                    .to_string();
            }

            // Ensure notes dir exists
            let _ = fs::create_dir_all(&config.notes_dir);

            // Register global shortcut
            let hotkey = config.hotkey.clone();
            if let Err(e) = app.global_shortcut().on_shortcut(
                hotkey.as_str(),
                |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                },
            ) {
                eprintln!("Warning: failed to register hotkey '{}': {}", hotkey, e);
            }

            // Manage state
            app.manage(AppState {
                config: Mutex::new(config),
                config_path,
            });

            // Build tray menu
            let toggle_item = MenuItemBuilder::new("Show / Hide")
                .id("toggle")
                .build(app)?;
            let open_folder_item = MenuItemBuilder::new("Open Notes Folder")
                .id("open_folder")
                .build(app)?;
            let quit_item = MenuItemBuilder::new("Quit").id("quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&toggle_item)
                .item(&open_folder_item)
                .separator()
                .item(&quit_item)
                .build()?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Sidebar Notes")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_window(app),
                    "open_folder" => {
                        let state = app.state::<AppState>();
                        let dir = state.config.lock().unwrap().notes_dir.clone();
                        let _ = std::process::Command::new(if cfg!(windows) {
                            "explorer"
                        } else {
                            "open"
                        })
                        .arg(&dir)
                        .spawn();
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Pre-position window (still hidden)
            if let Some(window) = app.get_webview_window("main") {
                position_window_right(&window);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            read_note,
            write_note,
            delete_note,
            new_note,
            get_config,
            set_config,
            show_in_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
