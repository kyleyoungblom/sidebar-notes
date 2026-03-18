import { useEffect } from 'react';
import { useStore } from './store';
import { useNotes } from './hooks/useNotes';
import { NoteList } from './components/NoteList';
import { Editor } from './components/Editor';
import { Settings } from './components/Settings';

export default function App() {
  const { view, config, setView } = useStore();
  const { loadConfig, loadNotes, createNote } = useNotes();

  // Bootstrap: load config then notes
  useEffect(() => {
    (async () => {
      const cfg = await loadConfig();
      if (cfg) await loadNotes();
    })();
  }, []);

  // Re-load notes when notes_dir changes
  useEffect(() => {
    if (config.notes_dir) loadNotes();
  }, [config.notes_dir]);

  // Apply theme class to root
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
              title="New note (Ctrl+N)"
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
