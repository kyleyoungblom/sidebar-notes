import { useEffect, useRef, useCallback, useState } from 'react';
import { watch } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from './store';
import { useNotes } from './hooks/useNotes';
import { NoteList } from './components/NoteList';
import { Editor } from './components/Editor';
import { Settings } from './components/Settings';
import { QuickSwitcher } from './components/QuickSwitcher';
import { HelpOverlay } from './components/HelpOverlay';
import { IconPin, IconPlus, IconGear } from './components/Icons';

export default function App() {
  const { view, config, pinned, setView, setPinned } = useStore();
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const showSwitcherRef = useRef(showSwitcher);
  const showHelpRef = useRef(showHelp);
  useEffect(() => { showSwitcherRef.current = showSwitcher; }, [showSwitcher]);
  useEffect(() => { showHelpRef.current = showHelp; }, [showHelp]);
  const { loadConfig, loadNotes, createNote, openNote, deleteNote, duplicateNote } = useNotes();

  const togglePin = useCallback(() => {
    const next = !pinned;
    setPinned(next);
    invoke('set_pinned', { pinned: next });
  }, [pinned, setPinned]);
  const stopWatchRef = useRef<(() => void) | undefined>(undefined);
  // Debounce timer ref so rapid file-system events collapse into one reload
  const watchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    (async () => {
      const cfg = await loadConfig();
      if (cfg) {
        await loadNotes();
        const lastId = localStorage.getItem('lastNoteId');
        if (lastId) {
          openNote(lastId).catch(() => {});
        }
      }
    })();
  }, []);

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
      { recursive: false }
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

  // Apply theme to root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', config.theme);
  }, [config.theme]);

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
    const onKeyDown = (e: KeyboardEvent) => {
      const { view } = useStore.getState();

      // Cmd+/ or Cmd+Shift+/: toggle help overlay
      if ((e.metaKey || e.ctrlKey) && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        setShowHelp((s) => !s);
        return;
      }

      // Escape: go back from editor/settings to list (skip if quick switcher or help is open)
      if (e.key === 'Escape') {
        if (showSwitcherRef.current || showHelpRef.current) return;
        if (view === 'editor' || view === 'settings') {
          e.preventDefault();
          const { activeNoteId } = useStore.getState();
          if (view === 'editor' && activeNoteId) {
            useStore.getState().setLastClosedNoteId(activeNoteId);
          }
          useStore.getState().setView('list');
        }
      }

      // Cmd/Ctrl+N: new note
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        createNote();
      }

      // Cmd/Ctrl+,: settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        useStore.getState().setView('settings');
      }

      // Cmd/Ctrl+F: focus search bar (on list view)
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && view === 'list') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      }

      // Cmd/Ctrl+R: rename note (in editor view)
      if ((e.metaKey || e.ctrlKey) && e.key === 'r' && view === 'editor') {
        e.preventDefault();
        document.querySelector<HTMLElement>('.editor-title--editable')?.click();
      }

      // Cmd/Ctrl+D: duplicate note (in editor view)
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && view === 'editor') {
        e.preventDefault();
        const { activeNoteId } = useStore.getState();
        if (activeNoteId) duplicateNote(activeNoteId);
      }

      // Cmd/Ctrl+Backspace: delete note (in editor view)
      if ((e.metaKey || e.ctrlKey) && e.key === 'Backspace' && view === 'editor') {
        e.preventDefault();
        const { activeNoteId } = useStore.getState();
        if (activeNoteId && confirm('Delete this note?')) {
          deleteNote(activeNoteId);
        }
      }

      // Cmd/Ctrl+P: quick switcher
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setShowSwitcher((s) => !s);
      }

      // Cmd/Ctrl+W: hide panel
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        invoke('hide_panel');
      }

      // Cmd/Ctrl+Z: undo close (reopen last note, only on list view)
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && view === 'list') {
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

  return (
    <div className="app">
      {view === 'list' && (
        <div className="app-header">
          <span className="app-title">Notes</span>
          <div className="app-header-actions">
            <button
              className={`btn-icon btn-pin ${pinned ? 'active' : ''}`}
              onClick={togglePin}
              title={pinned ? 'Unpin (hide on click away)' : 'Pin (stay visible)'}
            >
              <IconPin size={16} />
            </button>
            <button
              className="btn-icon btn-new"
              onClick={createNote}
              title="New note"
            >
              <IconPlus size={16} />
            </button>
            <button
              className="btn-icon"
              onClick={() => setView('settings')}
              title="Settings"
            >
              <IconGear size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="app-body">
        {view === 'list' && <NoteList />}
        {view === 'editor' && <Editor pinned={pinned} togglePin={togglePin} />}
        {view === 'settings' && <Settings />}
      </div>

      {showSwitcher && <QuickSwitcher onClose={() => setShowSwitcher(false)} />}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}
