import { useEffect, useRef, useCallback, useState } from 'react';
import { watch } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from './store';
import type { Note } from './types';
import { useNotes } from './hooks/useNotes';
import { NoteList } from './components/NoteList';
import { Editor, editorHasSelection, resetCycleOrder } from './components/Editor';
import { Settings } from './components/Settings';
import { QuickSwitcher } from './components/QuickSwitcher';
import { SchemeSwitcher } from './components/SchemeSwitcher';
import { HelpOverlay } from './components/HelpOverlay';
import { IconPin, IconPlus, IconGear } from './components/Icons';
import { ContextMenuProvider, showContextMenu, type MenuEntry } from './components/ContextMenu';
import { DebugDrawer } from './components/DebugDrawer';

export default function App() {
  const { view, config, pinned, notes, debugDrawerOpen, setView, setPinned } = useStore();
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showSchemeSwitcher, setShowSchemeSwitcher] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Suppress hover/focus flash on app open — pointer events disabled until first real mouse move
  const [pointerReady, setPointerReady] = useState(false);
  useEffect(() => {
    const enable = () => { setPointerReady(true); window.removeEventListener('mousemove', enable); };
    window.addEventListener('mousemove', enable);
    return () => window.removeEventListener('mousemove', enable);
  }, []);
  const dragRef = useRef<{ mouseX: number; w: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const showSwitcherRef = useRef(showSwitcher);
  const showSchemeSwitcherRef = useRef(showSchemeSwitcher);
  const showHelpRef = useRef(showHelp);
  useEffect(() => { showSwitcherRef.current = showSwitcher; }, [showSwitcher]);
  useEffect(() => { showSchemeSwitcherRef.current = showSchemeSwitcher; }, [showSchemeSwitcher]);
  useEffect(() => { showHelpRef.current = showHelp; }, [showHelp]);
  const noteListSnapshotRef = useRef<Note[]>([]);
  const { loadConfig, loadNotes, createNote, openNote, deleteNote, duplicateNote, saveConfig } = useNotes();

  const togglePin = useCallback(() => {
    const next = !pinned;
    setPinned(next);
    invoke('set_pinned', { pinned: next });
  }, [pinned, setPinned]);

  const toggleDebugDrawer = useCallback(() => {
    const next = !useStore.getState().debugDrawerOpen;
    useStore.getState().setDebugDrawerOpen(next);
  }, []);

  // ─── Edge resize ────────────────────────────────────────────────────────────
  // begin_resize returns the ACTUAL logical width from Rust so we always use the
  // real window width as the drag baseline, not a potentially-stale config value.
  const handleResizePointerDown = useCallback(async (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const mouseX = e.screenX;
    dragRef.current = null; // clear while IPC round-trip is in flight
    const actualW = await invoke<number>('begin_resize').catch(() => null);
    if (actualW !== null) {
      dragRef.current = { mouseX, w: actualW };
    }
  }, []);

  useEffect(() => {
    const MIN_W = 220, MAX_W = 700;

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.buttons === 0) return; // buttons===0 guard: ignore stale dragRef
      const delta    = e.screenX - d.mouseX;
      const isLeft   = config.panel_position === 'left';
      const newW     = Math.max(MIN_W, Math.min(MAX_W, isLeft ? d.w + delta : d.w - delta));
      // Throttle to one IPC call per animation frame
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        invoke('resize_panel', { anchorRight: !isLeft, width: newW }).catch(console.error);
      });
    };

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      if (frameRef.current) { cancelAnimationFrame(frameRef.current); frameRef.current = null; }
      const delta  = e.screenX - d.mouseX;
      const isLeft = config.panel_position === 'left';
      const newW   = Math.max(MIN_W, Math.min(700, isLeft ? d.w + delta : d.w - delta));
      invoke('resize_panel', { anchorRight: !isLeft, width: newW }).catch(console.error);
      void saveConfig({ ...config, window_width: Math.round(newW) });
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [config, saveConfig]);
  const stopWatchRef = useRef<(() => void) | undefined>(undefined);
  // Debounce timer ref so rapid file-system events collapse into one reload
  const watchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Load config from Rust on mount, and re-load if store was reset (e.g. HMR)
  const configLoaded = useRef(false);
  useEffect(() => {
    if (configLoaded.current && config.notes_dir) return;
    (async () => {
      const cfg = await loadConfig();
      if (cfg) {
        configLoaded.current = true;
        await loadNotes();
        const lastId = localStorage.getItem('lastNoteId');
        if (lastId) {
          openNote(lastId).catch(() => {});
        }
      }
    })();
  }, [config.notes_dir]);

  // File watcher: restart whenever notes_dir changes
  useEffect(() => {
    if (!config.notes_dir) return;

    // Load notes immediately when dir changes
    loadNotes();

    // Tear down previous watcher
    stopWatchRef.current?.();
    stopWatchRef.current = undefined;

    watch(
      config.notes_dir,
      () => {
        // Debounce: wait 600ms of quiet before reloading
        clearTimeout(watchDebounceRef.current);
        watchDebounceRef.current = setTimeout(() => {
          loadNotes();
        }, 600);
      },
      { recursive: true }
    )
      .then((stop) => {
        stopWatchRef.current = stop;
      })
      .catch((e) => {
        console.warn('File watcher unavailable:', e);
      });

    return () => {
      clearTimeout(watchDebounceRef.current);
      stopWatchRef.current?.();
      stopWatchRef.current = undefined;
    };
  }, [config.notes_dir]);

  // Poll for external changes to the active note every 2 seconds.
  // The directory watcher doesn't reliably detect file content edits.
  useEffect(() => {
    const interval = setInterval(() => {
      const { activeNoteId, activeNoteStale, lastSaveTs, saveState } = useStore.getState();
      if (!activeNoteId || activeNoteStale) return;
      // Skip if there are unsaved changes (user is actively editing)
      if (saveState !== 'saved') return;
      // Skip if we saved recently (our own save bumps mtime)
      if (Date.now() - lastSaveTs < 2000) return;
      loadNotes();
    }, 2000);
    return () => clearInterval(interval);
  }, [loadNotes]);

  // Snapshot the note list order for Cmd+1-6 shortcuts.
  // Update on list view so the order stays stable while editing.
  // Also seed the snapshot whenever notes load (so Cmd+1-6 works even if
  // the user never visits list view, e.g. auto-open last note on startup).
  useEffect(() => {
    if (view === 'list' || noteListSnapshotRef.current.length === 0) {
      noteListSnapshotRef.current = notes.filter((n) => !n.conflict_of);
    }
  }, [view, notes]);

  // Apply theme and panel position to root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', config.theme);
  }, [config.theme]);
  useEffect(() => {
    document.documentElement.setAttribute('data-panel-position', config.panel_position);
  }, [config.panel_position]);

  // Hide panel when it loses key status (click away / space switch), unless pinned
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('panel-did-resign-key', () => {
        if (!useStore.getState().pinned) {
          invoke('hide_panel');
        }
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, []);


  // Global keyboard shortcuts
  useEffect(() => {
    /** Exact modifier match — prevents ⌘D from firing on ⇧⌘D, etc. */
    const mods = (e: KeyboardEvent, { shift = false, alt = false } = {}) =>
      (e.metaKey || e.ctrlKey) && e.shiftKey === shift && e.altKey === alt;

    const onKeyDown = (e: KeyboardEvent) => {
      const { view } = useStore.getState();
      const key = e.key.toLowerCase();

      // ⌘/ or ⌘?: toggle help overlay
      if (mods(e) && (key === '/' || e.key === '?')) {
        e.preventDefault();
        setShowHelp((s) => !s);
        return;
      }

      // ⌘[: go back from editor/settings to list
      if (mods(e) && key === '[') {
        if (view === 'editor' || view === 'settings') {
          e.preventDefault();
          const { activeNoteId } = useStore.getState();
          if (view === 'editor' && activeNoteId) {
            useStore.getState().setLastClosedNoteId(activeNoteId);
          }
          resetCycleOrder();
          useStore.getState().setView('list');
        }
      }

      // ⌘N: new note
      if (mods(e) && key === 'n') {
        e.preventDefault();
        createNote();
      }

      // ⇧⌘P: toggle pin
      if (mods(e, { shift: true }) && key === 'p') {
        e.preventDefault();
        const { pinned, setPinned } = useStore.getState();
        const next = !pinned;
        setPinned(next);
        invoke('set_pinned', { pinned: next });
      }

      // ⇧⌘D: toggle debug drawer (dev only)
      if (import.meta.env.DEV && mods(e, { shift: true }) && key === 'd') {
        e.preventDefault();
        const next = !useStore.getState().debugDrawerOpen;
        useStore.getState().setDebugDrawerOpen(next);
      }

      // ⇧⌘O: open current note in Obsidian
      if (mods(e, { shift: true }) && key === 'o') {
        e.preventDefault();
        const { activeNoteId } = useStore.getState();
        if (view === 'editor' && activeNoteId) {
          invoke('open_url', { url: `obsidian://open?path=${encodeURIComponent(activeNoteId)}` });
        }
      }

      // ⌘,: settings
      if (mods(e) && key === ',') {
        e.preventDefault();
        useStore.getState().setView('settings');
      }

      // ⌘F: focus search bar (on list view)
      if (mods(e) && key === 'f' && view === 'list') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      }

      // ⌘R: rename note (in editor view)
      if (mods(e) && key === 'r' && view === 'editor') {
        e.preventDefault();
        document.querySelector<HTMLElement>('.editor-title--editable')?.click();
      }

      // ⌘D: duplicate note (in editor view)
      if (mods(e) && key === 'd' && view === 'editor') {
        e.preventDefault();
        const { activeNoteId } = useStore.getState();
        if (activeNoteId) duplicateNote(activeNoteId);
      }

      // ⌘⌫: delete note (in editor view)
      if (mods(e) && e.key === 'Backspace' && view === 'editor') {
        e.preventDefault();
        document.querySelector<HTMLElement>('.btn-danger')?.click();
      }

      // ⌘P: quick switcher
      if (mods(e) && key === 'p') {
        e.preventDefault();
        setShowSwitcher((s) => !s);
      }

      // ⌘K: color scheme switcher
      if (mods(e) && key === 'k') {
        e.preventDefault();
        setShowSchemeSwitcher((s) => !s);
      }

      // ⌘W: hide panel
      if (mods(e) && key === 'w') {
        e.preventDefault();
        invoke('hide_panel');
      }

      // ⌘1-6: open note by position
      if (mods(e) && key >= '1' && key <= '6') {
        e.preventDefault();
        const idx = parseInt(key, 10) - 1;
        const list = noteListSnapshotRef.current;
        if (idx < list.length) {
          openNote(list[idx].path);
        }
        return;
      }

      // ⌘Z: undo close (list view only)
      if (mods(e) && key === 'z' && view === 'list') {
        const lastId = useStore.getState().lastClosedNoteId;
        if (lastId) {
          e.preventDefault();
          useStore.getState().setLastClosedNoteId(null);
          openNote(lastId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createNote]);

  // ─── Context menus ───────────────────────────────────────────────────────
  useEffect(() => {
    const isMac = navigator.userAgent.includes('Mac');
    const mod = isMac ? '\u2318' : 'Ctrl+';

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const target = e.target as HTMLElement;
      const { view } = useStore.getState();

      // ── Note list item context menu ──
      const noteItem = target.closest('.note-item[data-note-path]') as HTMLElement | null;
      if (noteItem && view === 'list') {
        const notePath = noteItem.getAttribute('data-note-path');
        if (!notePath) return;

        const items: MenuEntry[] = [
          { id: 'open', label: 'Open Note', shortcut: 'Enter' },
          { separator: true },
          { id: 'rename', label: 'Rename', shortcut: `${mod}R` },
          { id: 'duplicate', label: 'Duplicate', shortcut: `${mod}D` },
          { separator: true },
          { id: 'delete', label: 'Delete', shortcut: `${mod}\u232B`, danger: true },
        ];
        showContextMenu(e.clientX, e.clientY, items, (id) => {
          if (id === 'open') openNote(notePath);
          else if (id === 'rename') {
            openNote(notePath).then(() => {
              setTimeout(() => {
                document.querySelector<HTMLElement>('.editor-title--editable')?.click();
              }, 100);
            });
          }
          else if (id === 'duplicate') duplicateNote(notePath);
          else if (id === 'delete') {
            if (confirm('Delete this note?')) deleteNote(notePath);
          }
        });
        return;
      }

      // ── Note list background context menu ──
      if (view === 'list' && (target.closest('.note-list') || target.closest('.app-header'))) {
        const items: MenuEntry[] = [
          { id: 'new', label: 'New Note', shortcut: `${mod}N` },
        ];
        showContextMenu(e.clientX, e.clientY, items, (id) => {
          if (id === 'new') createNote();
        });
        return;
      }

      // ── Editor context menu ──
      if (view === 'editor' && (target.closest('.cm-content') || target.closest('.cm-editor'))) {
        const hasSelection = editorHasSelection();
        const items: MenuEntry[] = [
          { id: 'cut', label: 'Cut', shortcut: `${mod}X`, disabled: !hasSelection },
          { id: 'copy', label: 'Copy', shortcut: `${mod}C`, disabled: !hasSelection },
          { id: 'paste', label: 'Paste', shortcut: `${mod}V` },
          { id: 'select-all', label: 'Select All', shortcut: `${mod}A` },
          { separator: true },
          { id: 'bold', label: 'Bold', shortcut: `${mod}B` },
          { id: 'italic', label: 'Italic', shortcut: `${mod}I` },
          { id: 'toggle-task', label: 'Toggle Checkbox', shortcut: `${mod}\u23CE` },
          { separator: true },
          { id: 'lint', label: 'Lint Note', shortcut: `${mod}L` },
        ];
        showContextMenu(e.clientX, e.clientY, items, (id) => {
          if (id === 'cut') document.execCommand('cut');
          else if (id === 'copy') document.execCommand('copy');
          else if (id === 'paste') navigator.clipboard.readText().then((text) => {
            document.execCommand('insertText', false, text);
          }).catch(() => document.execCommand('paste'));
          else if (id === 'select-all') document.execCommand('selectAll');
          else if (id === 'bold') {
            // Simulate Cmd+B keypress for CM6
            document.querySelector('.cm-content')?.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: isMac, ctrlKey: !isMac, bubbles: true })
            );
          }
          else if (id === 'italic') {
            document.querySelector('.cm-content')?.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'i', code: 'KeyI', metaKey: isMac, ctrlKey: !isMac, bubbles: true })
            );
          }
          else if (id === 'toggle-task') {
            document.querySelector('.cm-content')?.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', metaKey: isMac, ctrlKey: !isMac, bubbles: true })
            );
          }
          else if (id === 'lint') {
            document.querySelector('.cm-content')?.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', metaKey: isMac, ctrlKey: !isMac, bubbles: true })
            );
          }
        });
        return;
      }

      // ── Fallback: basic text context menu ──
      const hasSelection = !!window.getSelection()?.toString();
      const items: MenuEntry[] = [
        { id: 'cut', label: 'Cut', shortcut: `${mod}X`, disabled: !hasSelection },
        { id: 'copy', label: 'Copy', shortcut: `${mod}C`, disabled: !hasSelection },
        { id: 'paste', label: 'Paste', shortcut: `${mod}V` },
        { id: 'select-all', label: 'Select All', shortcut: `${mod}A` },
      ];
      showContextMenu(e.clientX, e.clientY, items, (id) => {
        if (id === 'cut') document.execCommand('cut');
        else if (id === 'copy') document.execCommand('copy');
        else if (id === 'paste') navigator.clipboard.readText().then((text) => {
          document.execCommand('insertText', false, text);
        }).catch(() => document.execCommand('paste'));
        else if (id === 'select-all') document.execCommand('selectAll');
      });
    };

    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, [createNote, openNote, deleteNote, duplicateNote]);

  const resizeEdge = config.panel_position === 'left' ? 'right' : 'left';

  return (
    <div className="app" style={pointerReady ? undefined : { pointerEvents: 'none' }}>
        <div
          className={`resize-handle resize-handle--${resizeEdge}`}
          onPointerDown={handleResizePointerDown}
        />
        {view === 'list' && (
        <div className="app-header">
          <span className="app-title">Notes</span>
          <div className="app-header-actions">
            <button
              className={`btn-icon btn-pin ${pinned ? 'active' : ''}`}
              onClick={togglePin}
              title={pinned ? 'Unpin (⇧⌘P)' : 'Pin (⇧⌘P)'}
            >
              <IconPin size={16} />
            </button>
            <button
              className="btn-icon"
              onClick={createNote}
              title="New note (⌘N)"
            >
              <IconPlus size={16} />
            </button>
            <button
              className="btn-icon"
              onClick={() => setView('settings')}
              title="Settings (⌘,)"
            >
              <IconGear size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="app-body">
        {view === 'list' && <NoteList />}
        {view === 'editor' && <Editor pinned={pinned} togglePin={togglePin} onToggleDebugDrawer={toggleDebugDrawer} />}
        {view === 'settings' && <Settings />}
      </div>

      {showSwitcher && <QuickSwitcher onClose={() => setShowSwitcher(false)} />}
      {showSchemeSwitcher && <SchemeSwitcher onClose={() => setShowSchemeSwitcher(false)} />}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      <ContextMenuProvider />
      {import.meta.env.DEV && debugDrawerOpen && <DebugDrawer />}
    </div>
  );
}
