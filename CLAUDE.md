# Sidebar Notes - Claude Development Guidelines

## Debugging Protocol (MANDATORY)

When a bug is reported, follow this exact sequence. Do NOT skip steps.

1. **STOP. Do not write a fix yet.** Your first instinct will be to guess the cause and patch it. Resist this. You are wrong more often than you think.
2. **Inject debug logging.** Add console.log/eprintln at every relevant code path. Log timestamps, variable values, call counts, and execution order.
3. **Have the user reproduce the bug and read the logs.** The logs will tell you what's actually happening vs what you assumed.
4. **Identify the root cause from the evidence.** If logs show N duplicate calls, the fix is "prevent N registrations," not "debounce N calls." If logs show events in unexpected order, the fix addresses the ordering, not the symptoms.
5. **`git diff` against the last working commit** before writing any fix. Understand exactly what changed. The bug is in the diff.
6. **Write ONE minimal fix** that addresses the root cause. Do not add timestamps, debounce logic, grace periods, or defensive code unless the root cause specifically requires it.
7. **If your fix doesn't work on first try, go back to step 2.** Do not iterate on a broken fix. The failed fix means your mental model is wrong. Get more evidence.

### Anti-patterns to avoid:
- Layering speculative fixes (each adds complexity that obscures the real bug)
- Cycling through CSS property guesses instead of inspecting computed values
- Adding debounce/setTimeout as a substitute for understanding timing
- Assuming API bugs before checking your own code
- Trying 6+ approaches to the same problem without injecting debug instrumentation

## Tauri-Specific Knowledge

- **`global_shortcut.on_shortcut()` STACKS handlers** — it does NOT replace the previous callback. Always `unregister_all()` before re-registering, or use an AtomicBool flag to gate a single handler.
- **WKWebView `selectionchange` fires BEFORE `mousedown`** on right-click. This is opposite to Chrome/Firefox behavior.
- **CM6 DOMObserver bypasses `transactionFilter` and `dispatch()`** — selection changes from native events go through `applyDOMChange()`, not the normal dispatch path.
- **`window.confirm()` is blocked in WKWebView** — use custom UI for confirmations (two-step button, inline dialog, etc.).
- **WebKit button focus rings** require `outline: none; box-shadow: none; -webkit-tap-highlight-color: transparent; -webkit-appearance: none` to fully suppress.
- **Panel `hide()` behavior**: Use the panel's own `hide()` method. If visibility issues arise, check for stacked handlers before assuming API bugs.

## Architecture Notes

- **Timestamps from Rust backend are in milliseconds** (`.as_millis()`). Frontend `relativeTime()` and `dateGroup()` expect milliseconds — do NOT multiply by 1000.
- **CM6 `.cm-line` elements** are only as wide as their text content inside `.cm-content`. For full-width pseudo-elements on specific lines, set `width: calc(100vw - 32px)` on the `.cm-line` itself.
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
