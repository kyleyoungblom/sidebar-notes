# Sidebar Notes — Claude Development Guidelines

**Shared protocols are not duplicated here.** The canonical Debugging Protocol and
Memory Protocol live once in the central Claude-docs folder (synced via the Obsidian
vault) and are referenced from this project's `MEMORY.md` under "Protocols" — read
them at session start. This file holds only Sidebar-Notes-specific knowledge.

## Tauri-Specific Knowledge

- **`global_shortcut.on_shortcut()` STACKS handlers** — it does NOT replace the previous callback. Always `unregister_all()` before re-registering, or use an AtomicBool flag to gate a single handler.
- **WKWebView `selectionchange` fires BEFORE `mousedown`** on right-click. This is opposite to Chrome/Firefox behavior.
- **CM6 DOMObserver bypasses `transactionFilter` and `dispatch()`** — selection changes from native events go through `applyDOMChange()`, not the normal dispatch path.
- **`window.confirm()` is blocked in WKWebView** — use custom UI for confirmations (two-step button, inline dialog, etc.).
- **WebKit button focus rings** require `outline: none; box-shadow: none; -webkit-tap-highlight-color: transparent; -webkit-appearance: none` to fully suppress.
- **Panel `hide()` behavior**: Use the panel's own `hide()` method. If visibility issues arise, check for stacked handlers before assuming API bugs.

## Architecture Notes

- **Timestamps from Rust backend are in milliseconds** (`.as_millis()`). Frontend `relativeTime()` and `dateGroup()` expect milliseconds — do NOT multiply by 1000.
- **CM6 `.cm-line` elements are already full-width here** because the editor enables `EditorView.lineWrapping` — full-width pseudo-elements (e.g. divider lines) just work with `left: 0; right: 0`. Do NOT force `width: calc(100vw - 32px)` on a `.cm-line`: 100vw ignores the vertical scrollbar's width, creating permanent horizontal overflow that flashes the OS scrollbar whenever scroll geometry changes (removed from `---` dividers in v0.6.12). The shrink-wrap caveat (lines only as wide as their text) applies only if line wrapping is ever disabled.
- **`.cm-scroller`** is `display: flex` by default. `.cm-content` shrink-wraps to content width. This cannot be easily overridden with CSS alone.
- **CM6 theming**: Currently using CSS `!important` overrides for markdown styles (bold, italic, headings). Future goal: migrate to `EditorView.theme()` for proper CM6 integration and compatibility with community themes.
- **Note colors** are stored as YAML frontmatter (`color: red`) in .md files.
- **Zustand `useStore.getState()`** provides current state for event handlers inside `useEffect` closures that would otherwise have stale references.

## Build & Dev

- `npm run tauri dev` — runs Vite + Cargo in dev mode
- Port 1420 for Vite dev server — kill stale processes with `lsof -ti :1420 | xargs kill -9` before restart
- Global hotkey default: `Alt+.` (Option+Period)
- **After editing Rust files**: Always do a full kill + restart (`pkill -9 -f "sidebar-notes"` then `npm run tauri dev`). HMR cannot hot-reload Rust; Cargo must recompile.
- **After HMR invalidation warnings** (e.g., `editorHasSelection export is incompatible`): The panel state may desync. Do a full restart to recover.
- **Before asking the user to test**: Always verify the app process is running and responsive. Check `pgrep -lf sidebar-notes` and `tail /tmp/sbn-debug.log`.

### Windows (PowerShell)

The mac commands above (`pkill`, `lsof`, `pgrep`) don't exist here. Windows equivalents:

- **Full kill + restart** (after editing Rust, HMR desync, or a blank/transparent "xray" window):
  ```powershell
  Get-Process sidebar-notes -EA 0 | Stop-Process -Force
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*vite*' } | % { Stop-Process -Id $_.ProcessId -Force }
  Get-NetTCPConnection -LocalPort 1420 -State Listen -EA 0   # confirm empty (port free) BEFORE relaunching
  npm run tauri dev
  ```
- **Kill BOTH the app AND the vite node, then confirm 1420 is free.** On Windows, killing the `npm run tauri dev` wrapper can orphan the `sidebar-notes.exe` process against a dead Vite (→ blank/transparent window, only the OS drop shadow visible), and/or leave a Vite squatting on port 1420 (→ next launch dies with `Port 1420 is already in use`). Half-cleanup is the usual cause of a launch that "renders as an invisible xray box."
- **Identify what's really running** (spares unrelated node processes like MCP servers): `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select ProcessId, CommandLine`.
- **The blank-window symptom is almost always a dev-process mismatch, not a rendering bug** — a fresh frontend served to a stale Rust binary (HMR can't reload Rust), or an app pointing at a dead/absent Vite. Do a full clean restart before suspecting the code.
