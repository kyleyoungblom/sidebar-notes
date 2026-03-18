import { useEffect, useRef } from 'react';
import { watch } from '@tauri-apps/plugin-fs';
import { useStore } from './store';
import { useNotes } from './hooks/useNotes';
import { NoteList } from './components/NoteList';
import { Editor } from './components/Editor';
import { Settings } from './components/Settings';

export default function App() {
  const { view, config, setView } = useStore();
  const { loadConfig, loadNotes, createNote } = useNotes();
  const stopWatchRef = useRef<(() => void) | undefined>(undefined);
  // Debounce timer ref so rapid file-system events collapse into one reload
  const watchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Bootstrap: load config then notes
  useEffect(() => {
    (async () => {
      const cfg = await loadConfig();
      if (cfg) await loadNotes();
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

  return (
    <div className="app">
      {view === 'list' && (
        <div className="app-header">
          <span className="app-title">Notes</span>
          <div className="app-header-actions">
            <button
              className="btn-icon btn-new"
              onClick={createNote}
              title="New note"
            >
              +
            </button>
            <button
              className="btn-icon"
              onClick={() => setView('settings')}
              title="Settings"
            >
              ⚙
            </button>
          </div>
        </div>
      )}

      <div className="app-body">
        {view === 'list' && <NoteList />}
        {view === 'editor' && <Editor />}
        {view === 'settings' && <Settings />}
      </div>
    </div>
  );
}
