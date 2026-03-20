# Sidebar Notes

A lightweight macOS menu bar notes app that slides in from the right side of your screen. Works over fullscreen apps.

Built with [Tauri](https://tauri.app/), React, and CodeMirror 6.

## Features

- **Menu bar app** — lives in the system tray, no dock icon
- **Fullscreen overlay** — works over fullscreen apps via NSPanel
- **Global hotkey** — toggle with `Alt+.` (configurable)
- **Live markdown** — inline rendering of headings, bold, italic, links, code blocks, checkboxes, images
- **Task management** — `Cmd+Enter` to toggle checkboxes, auto-continue lists
- **Hide completed tasks** — dim or completely hide checked-off tasks (`Cmd+Shift+H`)
- **Move completed to bottom** — checked tasks automatically sort to the end of their list
- **Collapsible dividers** — click `---` to collapse content below; `===` super dividers collapse everything to end of note
- **Toggle markdown rendering** — switch between live preview and raw text (`Cmd+Alt+P`)
- **Quick switcher** — `Cmd+P` to jump to any note
- **Pin mode** — keep the sidebar visible when clicking away
- **File-based** — plain `.md` files, works with Dropbox/iCloud/Syncthing
- **Auto-reload** — detects external edits and reloads content automatically
- **Sync conflict detection** — surfaces Dropbox and Syncthing conflicts

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+.` | Toggle sidebar |
| `Escape` | Back to note list |
| `Cmd+N` | New note |
| `Cmd+P` | Quick switcher |
| `Cmd+F` | Focus search |
| `Cmd+R` | Rename note |
| `Cmd+D` | Duplicate note |
| `Cmd+Backspace` | Delete note |
| `Cmd+Shift+P` | Toggle pin |
| `Cmd+W` | Hide sidebar |
| `Cmd+Z` | Undo close (on list) |
| `Cmd+B` | Bold |
| `Cmd+I` | Italic |
| `Cmd+Enter` | Toggle task checkbox |
| `Cmd+Shift+H` | Toggle hide completed tasks |
| `Cmd+Alt+P` | Toggle markdown rendering |
| `Cmd+/` | Help overlay |
| `Cmd+Alt+Up/Down` | Cycle through notes |
| `Alt+Up/Down` | Move line(s) up/down |
| `Shift+Alt+Up/Down` | Move line(s) up/down |
| `Tab / Shift+Tab` | Indent/outdent lists |
| `Cmd+,` | Settings |

## Development

Requires Node.js and Rust.

```
git clone https://github.com/kyleyoungblom/sidebar-notes
cd sidebar-notes
npm install
npm run tauri dev
```

## Build

```
npm run tauri build
```

The release binary will be in `src-tauri/target/release/bundle/`.
