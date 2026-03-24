use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicI32, AtomicU32, Ordering};

// Cached at drag-start by begin_resize; used by resize_panel to avoid
// reading intermediate window state when concurrent IPC calls are in-flight.
static RESIZE_RIGHT_EDGE: AtomicI32 = AtomicI32::new(0);
static RESIZE_WIN_Y:      AtomicI32 = AtomicI32::new(0);
static RESIZE_WIN_H:      AtomicU32 = AtomicU32::new(0);

// Layout constants
const CENTER_MODE_WIDTH: u32 = 1100;
const CENTER_MODE_HEIGHT_RATIO: f64 = 0.80;
const DEFAULT_WINDOW_WIDTH: u32 = 380;

use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, PanelLevel, CollectionBehavior, StyleMask, ManagerExt as NSPanelManagerExt, WebviewWindowExt, objc2_foundation};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(SidebarPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true,
            works_when_modal: true,
        }
    })

    panel_event!(SidebarPanelEvent {
        window_did_resign_key(notification: &objc2_foundation::NSNotification) -> ()
    })
}

// ─── Data types ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NoteMetadata {
    pub path: String,
    pub title: String,
    pub modified: u64,
    pub preview: String,
    /// If this file is a sync conflict copy, contains the path of the canonical note it conflicts with.
    pub conflict_of: Option<String>,
    /// Pop color identity parsed from YAML frontmatter.
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub notes_dir: String,
    pub hotkey: String,
    pub theme: String,
    #[serde(default = "default_panel_position")]
    pub panel_position: String,
    #[serde(default = "default_window_width")]
    pub window_width: u32,
    #[serde(default = "default_sort_completed")]
    pub sort_completed: bool,
    #[serde(default)]
    pub hide_completed_full: bool,
    /// "dim" or "hide" — controls collapsed divider content visibility
    #[serde(default = "default_collapse_mode")]
    pub collapse_mode: String,
    /// 0 = follow cursor, 1/2/3… = fixed monitor (1-based, sorted left→right)
    #[serde(default)]
    pub preferred_monitor: u32,
    /// User-customized hotkey overrides (action ID → partial key combo).
    #[serde(default)]
    pub hotkey_overrides: std::collections::HashMap<String, serde_json::Value>,
}

fn default_panel_position() -> String {
    "right".to_string()
}

fn default_window_width() -> u32 {
    380
}

fn default_sort_completed() -> bool {
    true
}

fn default_collapse_mode() -> String {
    "dim".to_string()
}

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub config_path: PathBuf,
    pub pinned: std::sync::atomic::AtomicBool,
}

// ─── Config helpers ────────────────────────────────────────────────────────────

const VALID_POSITIONS: &[&str] = &["left", "center", "right"];

fn load_config(path: &PathBuf) -> AppConfig {
    if path.exists() {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(mut config) = serde_json::from_str::<AppConfig>(&content) {
                // Validate panel_position
                if !VALID_POSITIONS.contains(&config.panel_position.as_str()) {
                    config.panel_position = "right".to_string();
                }
                // Clamp window width to reasonable bounds
                if config.window_width < 200 || config.window_width > 2000 {
                    config.window_width = DEFAULT_WINDOW_WIDTH;
                }
                return config;
            }
        }
    }
    AppConfig {
        notes_dir: String::new(),
        hotkey: "alt+.".to_string(),
        theme: "dark".to_string(),
        panel_position: "right".to_string(),
        window_width: default_window_width(),
        sort_completed: default_sort_completed(),
        hide_completed_full: false,
        collapse_mode: default_collapse_mode(),
        preferred_monitor: 0,
        hotkey_overrides: std::collections::HashMap::new(),
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

// ─── Conflict detection ──────────────────────────────────────────────────────
//
// Given a filename stem (no extension), returns the stem of the canonical note
// it is a conflict copy of, or None if it's not a conflict file.
//
// Patterns supported:
//   Dropbox:    "My Note (Bob's conflicted copy 2024-01-01)"
//               "My Note (conflicted copy 2024-01-01)"
//   Syncthing:  "My Note.sync-conflict-20240101-123456-ABCDEF"
//               (the .sync-conflict part is IN the stem when extension is .md)
//   Generic:    "My Note (1)", "My Note (2)"  — conservative: only match
//               if the canonical name also exists as a .md file.

fn conflict_source_stem(stem: &str, all_stems: &[String]) -> Option<String> {
    // Dropbox: ends with " (... conflicted copy ...)"
    if let Some(pos) = stem.rfind(" (") {
        let suffix = &stem[pos + 2..];
        if suffix.contains("conflicted copy") || suffix.contains("conflicted") {
            let canonical = stem[..pos].to_string();
            return Some(canonical);
        }
    }

    // Syncthing: contains ".sync-conflict-"
    if let Some(pos) = stem.find(".sync-conflict-") {
        let canonical = stem[..pos].to_string();
        return Some(canonical);
    }

    // Generic numeric suffix " (N)" — only flag if canonical exists
    if stem.ends_with(')') {
        if let Some(open) = stem.rfind(" (") {
            let inner = &stem[open + 2..stem.len() - 1];
            if inner.chars().all(|c| c.is_ascii_digit()) && !inner.is_empty() {
                let canonical = stem[..open].to_string();
                if all_stems.contains(&canonical) {
                    return Some(canonical);
                }
            }
        }
    }

    None
}

// ─── Window helpers ─────────────────────────────────────────────────────────

/// Returns monitors sorted left→right (ties broken top→bottom).
fn sorted_monitors(window: &tauri::WebviewWindow) -> Vec<tauri::Monitor> {
    let mut monitors = window.available_monitors().unwrap_or_default();
    monitors.sort_by_key(|m| (m.position().x, m.position().y));
    monitors
}

/// Returns (vis_x, vis_y, vis_w, vis_h, scale, margin).
/// `preferred_monitor`: 0 = follow cursor, N = 1-based index into left→right sorted monitors.
fn get_visible_frame(window: &tauri::WebviewWindow, preferred_monitor: u32) -> Option<(i32, i32, u32, u32, f64, u32)> {
    // When a specific monitor is requested, find it by sorted index.
    let pinned_mon: Option<tauri::Monitor> = if preferred_monitor > 0 {
        let mut monitors = sorted_monitors(window);
        let idx = (preferred_monitor - 1) as usize;
        if idx < monitors.len() { Some(monitors.swap_remove(idx)) } else { None }
    } else {
        None
    };

    // Fallback values from current monitor (used when native API fails).
    let cur = window.current_monitor().ok()??;
    let fallback_pos   = cur.position();
    let fallback_size  = cur.size();
    let scale = pinned_mon.as_ref().map(|m| m.scale_factor()).unwrap_or_else(|| cur.scale_factor());
    let margin = (10.0 * scale) as u32;

    let (vis_x, vis_y, vis_w, vis_h) = {
        #[cfg(target_os = "macos")]
        {
            unsafe {
                use tauri_nspanel::objc2;
                use tauri_nspanel::objc2_foundation::{NSPoint, NSRect};

                let ns_screen_cls = objc2::class!(NSScreen);
                let primary: *const objc2::runtime::AnyObject =
                    objc2::msg_send![ns_screen_cls, mainScreen];
                let pf: NSRect = objc2::msg_send![primary, frame];

                // Pick the target NSScreen: either the one matching pinned_mon's
                // physical origin, or the one containing the cursor.
                let screens: *const objc2::runtime::AnyObject =
                    objc2::msg_send![ns_screen_cls, screens];
                let count: usize = objc2::msg_send![screens, count];

                let mut target: *const objc2::runtime::AnyObject = std::ptr::null();

                if let Some(ref mon) = pinned_mon {
                    // Match by physical top-left position.
                    let want_x = mon.position().x;
                    let want_y = mon.position().y;
                    for i in 0..count {
                        let s: *const objc2::runtime::AnyObject =
                            objc2::msg_send![screens, objectAtIndex: i];
                        let f: NSRect = objc2::msg_send![s, frame];
                        let sc: f64   = objc2::msg_send![s, backingScaleFactor];
                        let phys_x = (f.origin.x * sc) as i32;
                        let phys_y = ((pf.size.height - f.origin.y - f.size.height) * sc) as i32;
                        if phys_x == want_x && phys_y == want_y {
                            target = s;
                            break;
                        }
                    }
                    if target.is_null() {
                        target = primary; // fallback to main screen
                    }
                } else {
                    // Cursor-based selection.
                    let ns_event = objc2::class!(NSEvent);
                    let cursor: NSPoint = objc2::msg_send![ns_event, mouseLocation];
                    for i in 0..count {
                        let s: *const objc2::runtime::AnyObject =
                            objc2::msg_send![screens, objectAtIndex: i];
                        let f: NSRect = objc2::msg_send![s, frame];
                        if cursor.x >= f.origin.x && cursor.x < f.origin.x + f.size.width
                            && cursor.y >= f.origin.y && cursor.y < f.origin.y + f.size.height
                        {
                            target = s;
                            break;
                        }
                    }
                    if target.is_null() {
                        target = primary;
                    }
                }

                if !target.is_null() {
                    let vf: NSRect = objc2::msg_send![target, visibleFrame];
                    let sc: f64    = objc2::msg_send![target, backingScaleFactor];
                    (
                        (vf.origin.x * sc) as i32,
                        ((pf.size.height - vf.origin.y - vf.size.height) * sc) as i32,
                        (vf.size.width  * sc) as u32,
                        (vf.size.height * sc) as u32,
                    )
                } else {
                    (fallback_pos.x, fallback_pos.y, fallback_size.width, fallback_size.height)
                }
            }
        }
        #[cfg(target_os = "windows")]
        {
            #[repr(C)] struct POINT { x: i32, y: i32 }
            #[repr(C)] struct RECT  { left: i32, top: i32, right: i32, bottom: i32 }
            #[repr(C)] struct MONITORINFO {
                cb_size: u32, rc_monitor: RECT, rc_work: RECT, dw_flags: u32
            }
            #[link(name = "user32")]
            extern "system" {
                fn GetCursorPos(lp_point: *mut POINT) -> i32;
                fn MonitorFromPoint(pt: POINT, dw_flags: u32) -> isize;
                fn GetMonitorInfoW(h_monitor: isize, lpmi: *mut MONITORINFO) -> i32;
            }

            // Pick a point guaranteed to be on the target monitor:
            // either the centre of the pinned monitor, or the cursor.
            let pt = if let Some(ref mon) = pinned_mon {
                let cx = mon.position().x + (mon.size().width  / 2) as i32;
                let cy = mon.position().y + (mon.size().height / 2) as i32;
                POINT { x: cx, y: cy }
            } else {
                let mut p = POINT { x: 0, y: 0 };
                unsafe { GetCursorPos(&mut p); }
                p
            };

            let hmon = unsafe { MonitorFromPoint(pt, 2) }; // MONITOR_DEFAULTTONEAREST
            let mut mi = MONITORINFO {
                cb_size: std::mem::size_of::<MONITORINFO>() as u32,
                rc_monitor: RECT { left: 0, top: 0, right: 0, bottom: 0 },
                rc_work:    RECT { left: 0, top: 0, right: 0, bottom: 0 },
                dw_flags: 0,
            };
            if hmon != 0 && unsafe { GetMonitorInfoW(hmon, &mut mi) } != 0 {
                let w = (mi.rc_work.right  - mi.rc_work.left) as u32;
                let h = (mi.rc_work.bottom - mi.rc_work.top)  as u32;
                (mi.rc_work.left, mi.rc_work.top, w, h)
            } else {
                (fallback_pos.x, fallback_pos.y, fallback_size.width, fallback_size.height)
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            (fallback_pos.x, fallback_pos.y, fallback_size.width, fallback_size.height)
        }
    };

    Some((vis_x, vis_y, vis_w, vis_h, scale, margin))
}

fn position_window_right(window: &tauri::WebviewWindow, width: u32, preferred_monitor: u32) {
    if let Some((vis_x, vis_y, vis_w, vis_h, scale, margin)) = get_visible_frame(window, preferred_monitor) {
        let win_w = (width as f64 * scale).round() as u32;
        let x = vis_x + (vis_w.saturating_sub(win_w).saturating_sub(margin)) as i32;
        let y = vis_y + margin as i32;
        let h = vis_h.saturating_sub(margin * 2);
        let _ = window.set_size(PhysicalSize::new(win_w, h));
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

fn position_window_left(window: &tauri::WebviewWindow, width: u32, preferred_monitor: u32) {
    if let Some((vis_x, vis_y, _vis_w, vis_h, scale, margin)) = get_visible_frame(window, preferred_monitor) {
        let win_w = (width as f64 * scale).round() as u32;
        let x = vis_x + margin as i32;
        let y = vis_y + margin as i32;
        let h = vis_h.saturating_sub(margin * 2);
        let _ = window.set_size(PhysicalSize::new(win_w, h));
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

fn position_window_center(window: &tauri::WebviewWindow, preferred_monitor: u32) {
    if let Some((vis_x, vis_y, vis_w, vis_h, _scale, _margin)) = get_visible_frame(window, preferred_monitor) {
        let win_w = CENTER_MODE_WIDTH;
        let h = (vis_h as f64 * CENTER_MODE_HEIGHT_RATIO) as u32;
        let x = vis_x + ((vis_w.saturating_sub(win_w)) / 2) as i32;
        let y = vis_y + ((vis_h.saturating_sub(h)) / 2) as i32; // vertically centered
        let _ = window.set_position(PhysicalPosition::new(x, y));
        let _ = window.set_size(PhysicalSize::new(win_w, h));
    }
}

fn position_window(window: &tauri::WebviewWindow, position: &str, width: u32, preferred_monitor: u32) {
    match position {
        "left"   => position_window_left(window, width, preferred_monitor),
        "center" => position_window_center(window, preferred_monitor),
        _        => position_window_right(window, width, preferred_monitor),
    }
}

static PANEL_HAS_BEEN_SHOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// When false, the global shortcut handler ignores presses (used by settings
/// hotkey-capture mode instead of unregister/re-register which stacks handlers).
static HOTKEY_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

#[cfg(target_os = "macos")]
fn toggle_panel(app: &AppHandle) {
    if let Ok(panel) = app.get_webview_panel("main") {
        if panel.is_visible() {
            panel.hide();
        } else {
            if let Some(window) = app.get_webview_window("main") {
                let (pos, win_w, pref_mon) = app
                    .try_state::<AppState>()
                    .map(|s| {
                        let cfg = s.config.lock().unwrap();
                        (cfg.panel_position.clone(), cfg.window_width, cfg.preferred_monitor)
                    })
                    .unwrap_or_else(|| ("right".to_string(), DEFAULT_WINDOW_WIDTH, 0));
                position_window(&window, &pos, win_w, pref_mon);
            }
            panel.show_and_make_key();
            PANEL_HAS_BEEN_SHOWN.store(true, std::sync::atomic::Ordering::Relaxed);
            let _ = app.emit("panel-did-show", ());
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn toggle_panel(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let state = app.try_state::<AppState>();
            let (pos, win_w, pref_mon) = state.as_ref()
                .map(|s| {
                    let cfg = s.config.lock().unwrap();
                    (cfg.panel_position.clone(), cfg.window_width, cfg.preferred_monitor)
                })
                .unwrap_or_else(|| ("right".to_string(), DEFAULT_WINDOW_WIDTH, 0));
            position_window(&window, &pos, win_w, pref_mon);
            // Restore always-on-top from pin state so a pinned window stays on
            // top of other windows after being re-shown (Windows has no floating
            // panel type like macOS NSPanel).
            let is_pinned = state
                .map(|s| s.pinned.load(std::sync::atomic::Ordering::Relaxed))
                .unwrap_or(false);
            let _ = window.set_always_on_top(is_pinned);
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit("panel-did-show", ());
        }
    }
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
/// Extract `color` value from YAML frontmatter (---\ncolor: X\n---).
fn extract_frontmatter_color(path: &std::path::Path) -> Option<String> {
    // Read only first 512 bytes for efficiency
    let content = fs::read_to_string(path).ok()?;
    if !content.starts_with("---\n") && !content.starts_with("---\r\n") {
        return None;
    }
    let rest = if content.starts_with("---\r\n") { &content[5..] } else { &content[4..] };
    let end = rest.find("\n---")?;
    let fm = &rest[..end];
    for line in fm.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("color:") {
            let color = val.trim();
            if !color.is_empty() {
                return Some(color.to_string());
            }
        }
    }
    None
}

#[tauri::command]
async fn list_notes(notes_dir: String) -> Result<Vec<NoteMetadata>, String> {
    let dir = PathBuf::from(&notes_dir);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        return Ok(vec![]);
    }

    let mut notes = vec![];
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;

    // First pass: collect all .md stems for generic conflict heuristic
    let all_stems: Vec<String> = fs::read_dir(&dir)
        .unwrap_or_else(|_| fs::read_dir(".").unwrap())
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) == Some("md") {
                p.file_stem().map(|s| s.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }

        let meta = entry.metadata().map_err(|e| e.to_string())?;

        let title = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let preview = String::new();

        let modified = meta
            .modified()
            .map(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64
            })
            .unwrap_or(0);

        // Conflict detection
        let stem = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let conflict_of = conflict_source_stem(&stem, &all_stems).map(|canonical_stem| {
            dir.join(format!("{}.md", canonical_stem))
                .to_string_lossy()
                .to_string()
        });

        let color = extract_frontmatter_color(&path);

        let canonical_path = path.canonicalize().unwrap_or(path.clone());
        notes.push(NoteMetadata {
            path: canonical_path.to_string_lossy().to_string(),
            title,
            modified,
            preview,
            conflict_of,
            color,
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
    // Move to macOS Trash instead of permanent delete
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("osascript")
            .args([
                "-e",
                &format!(
                    "tell application \"Finder\" to delete POSIX file \"{}\"",
                    path.replace('"', "\\\"")
                ),
            ])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            // Fallback to rm if AppleScript fails
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn duplicate_note(path: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    let parent = src.parent().ok_or("No parent directory")?;
    let stem = src.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let content = fs::read_to_string(&src).map_err(|e| e.to_string())?;

    // Find a unique name: "name copy", "name copy 2", etc.
    let mut new_path = parent.join(format!("{} copy.md", stem));
    let mut n = 2;
    while new_path.exists() {
        new_path = parent.join(format!("{} copy {}.md", stem, n));
        n += 1;
    }
    fs::write(&new_path, &content).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn new_note(notes_dir: String) -> Result<String, String> {
    let dir = PathBuf::from(&notes_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let path = dir.join(format!("Untitled-{ts}.md"));
    fs::write(&path, "").map_err(|e| e.to_string())?;
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

    if current.hotkey != config.hotkey {
        let new_hotkey = config.hotkey.clone();
        // Unregister ALL and re-register with the new key (single handler)
        let _ = app.global_shortcut().unregister_all();
        if let Err(e) = app.global_shortcut().on_shortcut(
            new_hotkey.as_str(),
            |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed
                    && HOTKEY_ENABLED.load(std::sync::atomic::Ordering::Relaxed)
                {
                    toggle_panel(app);
                }
            },
        ) {
            return Err(format!("Failed to register hotkey '{}': {}", new_hotkey, e));
        }
    }

    save_config(&state.config_path, &config)?;
    *current = config;
    Ok(())
}

#[tauri::command]
async fn suspend_hotkey() -> Result<(), String> {
    HOTKEY_ENABLED.store(false, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn resume_hotkey() -> Result<(), String> {
    HOTKEY_ENABLED.store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn set_pinned(app: AppHandle, pinned: bool) -> Result<(), String> {
    if let Some(state) = app.try_state::<AppState>() {
        state.pinned.store(pinned, std::sync::atomic::Ordering::Relaxed);
    }
    // On Windows there is no floating panel type; set always-on-top so a
    // pinned window stays visible above other windows when focus moves away.
    #[cfg(not(target_os = "macos"))]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(pinned);
    }
    Ok(())
}

#[tauri::command]
async fn hide_panel(app: AppHandle) -> Result<(), String> {
    // UI operations MUST run on the main thread (AppKit requirement on macOS).
    let app_clone = app.clone();
    app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        if let Some(window) = app_clone.get_webview_window("main") {
            if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
            }
        }
        #[cfg(not(target_os = "macos"))]
        if let Some(window) = app_clone.get_webview_window("main") {
            let _ = window.hide();
        }
    }).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
struct MonitorInfo {
    index: u32,
    name: String,
    primary: bool,
    width: u32,
    height: u32,
}

/// Returns all connected monitors sorted left→right (ties: top→bottom).
/// `index` is 1-based and matches the `preferred_monitor` config value.
#[tauri::command]
async fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None    => return Ok(vec![]),
    };
    let mut monitors = sorted_monitors(&window);
    let primary_pos = window.primary_monitor()
        .ok().flatten()
        .map(|m| m.position().clone());
    Ok(monitors.drain(..).enumerate().map(|(i, m)| {
        let is_primary = primary_pos.as_ref()
            .map(|p| p.x == m.position().x && p.y == m.position().y)
            .unwrap_or(false);
        MonitorInfo {
            index:   (i + 1) as u32,
            name:    m.name().cloned().unwrap_or_else(|| format!("Monitor {}", i + 1)),
            primary: is_primary,
            width:   m.size().width,
            height:  m.size().height,
        }
    }).collect())
}

#[tauri::command]
async fn set_panel_position(app: AppHandle, state: tauri::State<'_, AppState>, position: String) -> Result<(), String> {
    let (window_width, pref_mon) = {
        let mut config = state.config.lock().unwrap();
        config.panel_position = position.clone();
        save_config(&state.config_path, &config)?;
        (config.window_width, config.preferred_monitor)
    };
    // Window positioning (NSWindow setPosition/setSize) MUST run on the main thread.
    let app_clone = app.clone();
    app.run_on_main_thread(move || {
        if let Some(window) = app_clone.get_webview_window("main") {
            position_window(&window, &position, window_width, pref_mon);
        }
    }).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn rename_note(old_path: String, new_name: String) -> Result<String, String> {
    let old = PathBuf::from(&old_path);
    let parent = old.parent().ok_or("No parent directory")?;
    // Ensure new name ends with .md
    let sanitized = new_name.trim().trim_end_matches(".md");
    if sanitized.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    let new_path = parent.join(format!("{}.md", sanitized));
    if new_path.exists() && new_path != old {
        return Err("A note with that name already exists".to_string());
    }
    fs::rename(&old, &new_path).map_err(|e| e.to_string())?;
    // Return the canonicalized path to match what the filesystem actually stores
    // (macOS APFS may use different Unicode normalization than what we constructed)
    let canonical = new_path.canonicalize().unwrap_or(new_path);
    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_launch_at_login() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .args(["-e", "tell application \"System Events\" to get the name of every login item"])
            .output()
            .map_err(|e| e.to_string())?;
        let list = String::from_utf8_lossy(&output.stdout);
        Ok(list.contains("Sidebar Notes"))
    }
    #[cfg(not(target_os = "macos"))]
    Ok(false)
}

#[tauri::command]
async fn set_launch_at_login(app: AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let app_path = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf())
            .ok_or("Cannot find app bundle")?;

        let path_str = app_path.to_string_lossy();

        if enabled {
            std::process::Command::new("osascript")
                .args([
                    "-e",
                    &format!(
                        "tell application \"System Events\" to make login item at end with properties {{path:\"{}\", hidden:true}}",
                        path_str
                    ),
                ])
                .status()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("osascript")
                .args([
                    "-e",
                    "tell application \"System Events\" to delete login item \"Sidebar Notes\"",
                ])
                .status()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Called once on pointer-down to snapshot the window's right edge and height.
/// Returns the actual logical width so JS uses the real window width as the
/// drag baseline (not the potentially-stale config value).
/// resize_panel reads these statics instead of current window state, so
/// concurrent IPC calls can't compound a drifting right edge.
#[tauri::command]
async fn begin_resize(app: AppHandle) -> Result<f64, String> {
    if let Some(window) = app.get_webview_window("main") {
        let pos = window.outer_position().map_err(|e| e.to_string())?;
        let sz  = window.outer_size().map_err(|e| e.to_string())?;
        let sf  = window.scale_factor().map_err(|e| e.to_string())?;
        RESIZE_RIGHT_EDGE.store(pos.x + sz.width as i32, Ordering::Relaxed);
        RESIZE_WIN_Y.store(pos.y, Ordering::Relaxed);
        RESIZE_WIN_H.store(sz.height, Ordering::Relaxed);
        // Return actual logical width — JS must use this, not config.window_width
        return Ok((sz.width as f64) / sf);
    }
    Ok(DEFAULT_WINDOW_WIDTH as f64)
}

#[tauri::command]
async fn resize_panel(app: AppHandle, anchor_right: bool, width: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let sf     = window.scale_factor().map_err(|e| e.to_string())?;
        let phys_w = (width * sf).round() as u32;

        if anchor_right {
            // Use the snapshot taken at drag-start — immune to intermediate state
            let mut right_edge = RESIZE_RIGHT_EDGE.load(Ordering::Relaxed);
            let mut win_y      = RESIZE_WIN_Y.load(Ordering::Relaxed);
            if right_edge == 0 {
                // begin_resize hasn't completed yet — read live (safe: no resize yet)
                let pos = window.outer_position().map_err(|e| e.to_string())?;
                let sz  = window.outer_size().map_err(|e| e.to_string())?;
                right_edge = pos.x + sz.width as i32;
                win_y = pos.y;
            }
            let phys_x = right_edge - phys_w as i32;
            window.set_position(tauri::PhysicalPosition::new(phys_x, win_y))
                  .map_err(|e| e.to_string())?;
        }

        // Height preserved from snapshot (or live fallback)
        let mut height = RESIZE_WIN_H.load(Ordering::Relaxed);
        if height == 0 {
            height = window.outer_size().map(|s| s.height).unwrap_or(800);
        }
        window.set_size(tauri::PhysicalSize::new(phys_w, height))
              .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/c", "start", "", &url])
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Dev-only: git pull, npm install, then restart via `npm run tauri dev`.
#[tauri::command]
async fn dev_pull_and_rebuild(app: AppHandle) -> Result<String, String> {
    let project_dir = std::env::current_dir()
        .or_else(|_| {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            exe.parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .map(|p| p.to_path_buf())
                .ok_or_else(|| "Cannot find project dir".to_string())
        })
        .map_err(|e| e.to_string())?;

    eprintln!("[dev-rebuild] project_dir={}", project_dir.display());
    let _ = app.emit("dev-rebuild-status", "Pulling from git...");

    // git pull
    let pull = std::process::Command::new("git")
        .arg("pull")
        .current_dir(&project_dir)
        .output()
        .map_err(|e| format!("git pull failed: {}", e))?;
    let pull_out = String::from_utf8_lossy(&pull.stdout).trim().to_string();
    let pull_err = String::from_utf8_lossy(&pull.stderr).trim().to_string();
    eprintln!("[dev-rebuild] git pull stdout={} stderr={}", pull_out, pull_err);
    if !pull.status.success() {
        return Err(format!("git pull failed: {}", pull_err));
    }
    let _ = app.emit("dev-rebuild-status", format!("git pull: {}", pull_out));

    // npm install
    let _ = app.emit("dev-rebuild-status", "Running npm install...");
    let install = std::process::Command::new("npm")
        .args(["install", "--prefer-offline"])
        .current_dir(&project_dir)
        .output()
        .map_err(|e| format!("npm install failed: {}", e))?;
    eprintln!("[dev-rebuild] npm install status={}", install.status);
    let _ = app.emit("dev-rebuild-status", format!("npm install: {}", if install.status.success() { "ok" } else { "failed" }));

    let _ = app.emit("dev-rebuild-status", "✅ Done. HMR will pick up TS changes. Restart manually for Rust changes.");

    Ok(format!("git pull: {}\nnpm install: {}", pull_out, if install.status.success() { "ok" } else { "failed" }))
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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .setup(|app| {
            let config_path = app
                .path()
                .app_config_dir()
                .expect("no app config dir")
                .join("config.json");

            let mut config = load_config(&config_path);

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

            let _ = fs::create_dir_all(&config.notes_dir);

            let hotkey = config.hotkey.clone();
            // Register the shortcut ONCE. Never re-register (on_shortcut stacks
            // handlers). Use HOTKEY_ENABLED flag for suspend/resume instead.
            let _ = app.global_shortcut().unregister_all();
            if let Err(e) = app.global_shortcut().on_shortcut(
                hotkey.as_str(),
                |app, _shortcut, event| {

                    if event.state == ShortcutState::Pressed
                        && HOTKEY_ENABLED.load(std::sync::atomic::Ordering::Relaxed)
                    {
                        toggle_panel(app);
                    }
                },
            ) {
                eprintln!("Warning: failed to register hotkey '{}': {}", hotkey, e);
            }

            let saved_width = config.window_width;
            app.manage(AppState {
                config: Mutex::new(config),
                config_path,
                pinned: std::sync::atomic::AtomicBool::new(false),
            });

            // Restore saved window width (logical → physical pixels)
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(sf) = window.scale_factor() {
                    let phys_w = (saved_width as f64 * sf).round() as u32;
                    let _ = window.set_size(tauri::PhysicalSize::new(phys_w, 800));
                }
            }

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

            let tray_icon = {
                let png_data = include_bytes!("../icons/tray-icon.png");
                let decoder = png::Decoder::new(std::io::Cursor::new(png_data));
                let mut reader = decoder.read_info().unwrap();
                let mut buf = vec![0u8; reader.output_buffer_size().unwrap()];
                let info = reader.next_frame(&mut buf).unwrap();
                buf.truncate(info.buffer_size());
                tauri::image::Image::new_owned(buf, info.width, info.height)
            };

            TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(true)
                .tooltip("Sidebar Notes")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_panel(app),
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
                        toggle_panel(tray.app_handle());
                    }
                })
                .build(app)?;

            #[cfg(target_os = "macos")]
            {
                // Hide from dock, only show in menu bar — must be set BEFORE converting to panel
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);

                // Convert the window to an NSPanel and configure it for fullscreen overlay
                let window = app.get_webview_window("main").unwrap();
                let panel = window.to_panel::<SidebarPanel>()?;

                // Nonactivating panel — can receive key events without activating the app
                panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());

                // Float above other windows
                panel.set_level(PanelLevel::Floating.value());

                // Move to whichever space is active when shown; don't auto-appear on all spaces.
                // This avoids the flash-close-reopen on space switch that canJoinAllSpaces causes.
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .full_screen_auxiliary()
                        .move_to_active_space()
                        .ignores_cycle()
                        .into(),
                );

                // Must be false for nonactivating panels (they never "activate")
                panel.set_hides_on_deactivate(false);


                // Transparent background with rounded corners
                {
                    use tauri_nspanel::objc2;
                    unsafe {
                        let ns_win = window.ns_window().unwrap() as *const objc2::runtime::AnyObject;
                        let ns_win_ref = &*ns_win;

                        // Clear the NSWindow/NSPanel background
                        let clear_color: *const objc2::runtime::AnyObject =
                            objc2::msg_send![objc2::class!(NSColor), clearColor];
                        let _: () = objc2::msg_send![ns_win_ref, setBackgroundColor: clear_color];
                        let _: () = objc2::msg_send![ns_win_ref, setOpaque: false];
                        let _: () = objc2::msg_send![ns_win_ref, setHasShadow: true];

                        // Make the content view and ALL subviews non-opaque with clear backgrounds
                        fn make_transparent(view: *const objc2::runtime::AnyObject) {
                            unsafe {
                                use tauri_nspanel::objc2;
                                // Set non-opaque
                                let sel_opaque = objc2::sel!(setOpaque:);
                                let responds: bool = objc2::msg_send![&*view, respondsToSelector: sel_opaque];
                                if responds {
                                    let _: () = objc2::msg_send![&*view, setOpaque: false];
                                }

                                // Set background color to clear (for NSView subclasses)
                                let sel_bg = objc2::sel!(setBackgroundColor:);
                                let responds_bg: bool = objc2::msg_send![&*view, respondsToSelector: sel_bg];
                                if responds_bg {
                                    let clear: *const objc2::runtime::AnyObject =
                                        objc2::msg_send![objc2::class!(NSColor), clearColor];
                                    let _: () = objc2::msg_send![&*view, setBackgroundColor: clear];
                                }

                                // Enable layer-backed and set layer background to clear
                                let _: () = objc2::msg_send![&*view, setWantsLayer: true];
                                let layer: *const objc2::runtime::AnyObject = objc2::msg_send![&*view, layer];
                                if !layer.is_null() {
                                    // CGColorGetConstantColor(kCGColorClear) or just nil
                                    let _: () = objc2::msg_send![&*layer, setBackgroundColor: std::ptr::null::<objc2::runtime::AnyObject>()];
                                    let _: () = objc2::msg_send![&*layer, setOpaque: false];
                                }

                                // Recurse
                                let subviews: *const objc2::runtime::AnyObject = objc2::msg_send![&*view, subviews];
                                if !subviews.is_null() {
                                    let count: usize = objc2::msg_send![&*subviews, count];
                                    for i in 0..count {
                                        let child: *const objc2::runtime::AnyObject =
                                            objc2::msg_send![&*subviews, objectAtIndex: i];
                                        make_transparent(child);
                                    }
                                }
                            }
                        }

                        let content_view: *const objc2::runtime::AnyObject =
                            objc2::msg_send![ns_win_ref, contentView];
                        if !content_view.is_null() {
                            make_transparent(content_view);
                        }
                    }
                }

                // Also set drawsBackground:NO on the WKWebView via KVC (same as wry does)
                window.with_webview(move |webview| {
                    #[cfg(target_os = "macos")]
                    unsafe {
                        use tauri_nspanel::objc2;
                        let wk = webview.inner() as *const objc2::runtime::AnyObject;
                        let no = objc2_foundation::NSNumber::numberWithBool(false);
                        let key = objc2_foundation::NSString::from_str("drawsBackground");
                        let _: () = objc2::msg_send![&*wk, setValue: &*no, forKey: &*key];
                    }
                }).expect("with_webview failed");

                // Emit event to frontend when panel loses key status (user clicked away)
                let handler = SidebarPanelEvent::new();
                let app_handle = app.handle().clone();
                handler.window_did_resign_key(move |_notification| {
                    if !PANEL_HAS_BEEN_SHOWN.load(std::sync::atomic::Ordering::Relaxed) {
                        return;
                    }
                    // Check pinned state — if pinned, keep panel visible
                    let is_pinned = app_handle
                        .try_state::<AppState>()
                        .map(|s| s.pinned.load(std::sync::atomic::Ordering::Relaxed))
                        .unwrap_or(false);
                    if is_pinned {
                        return;
                    }
                    if let Ok(p) = app_handle.get_webview_panel("main") {
                        if p.is_visible() {
                            p.hide();
                        }
                    }
                    // Also emit for debug drawer logging
                    let _ = app_handle.emit("panel-did-resign-key", ());
                });
                panel.set_event_handler(Some(handler.as_ref()));
            }

            if let Some(window) = app.get_webview_window("main") {
                let app_state = app.state::<AppState>();
                let cfg = app_state.config.lock().unwrap();
                let pos       = cfg.panel_position.clone();
                let win_w     = cfg.window_width;
                let pref_mon  = cfg.preferred_monitor;
                drop(cfg);
                position_window(&window, &pos, win_w, pref_mon);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    #[cfg(target_os = "macos")]
                    if let Ok(panel) = window.app_handle().get_webview_panel("main") {
                        panel.hide();
                    }
                    #[cfg(not(target_os = "macos"))]
                    { let _ = window.hide(); }
                }
                #[cfg(not(target_os = "macos"))]
                tauri::WindowEvent::Focused(false) => {
                    let is_pinned = window.app_handle()
                        .try_state::<AppState>()
                        .map(|s| s.pinned.load(std::sync::atomic::Ordering::Relaxed))
                        .unwrap_or(false);
                    if !is_pinned {
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            read_note,
            write_note,
            delete_note,
            duplicate_note,
            new_note,
            get_config,
            set_config,
            suspend_hotkey,
            resume_hotkey,
            set_pinned,
            hide_panel,
            rename_note,
            get_launch_at_login,
            set_launch_at_login,
            show_in_folder,
            open_url,
            set_panel_position,
            list_monitors,
            begin_resize,
            resize_panel,
            dev_pull_and_rebuild,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            match event {
                tauri::RunEvent::ExitRequested { api, .. } => {
                    // Prevent exit when all windows are hidden — this is a tray app
                    eprintln!("[sidebar-notes] ExitRequested intercepted, preventing exit");
                    api.prevent_exit();
                }
                tauri::RunEvent::Exit => {
                    eprintln!("[sidebar-notes] App exiting!");
                }
                _ => {}
            }
        });
}
