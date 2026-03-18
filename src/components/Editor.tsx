import { useState } from 'react';
import ReactCodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';
import { EditorView } from '@codemirror/view';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { useAutoSave } from '../hooks/useAutoSave';
import { useNotes } from '../hooks/useNotes';

const extensions = [
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  EditorView.lineWrapping,
];

export function Editor() {
  const {
    activeNoteId,
    activeNoteContent,
    activeNoteStale,
    saveState,
    config,
    notes,
    setActiveNoteContent,
    setView,
  } = useStore();
  const { deleteNote, reloadActiveNote, loadNotes } = useNotes();
  const [compareContent, setCompareContent] = useState<string | null>(null);
  const [comparePath, setComparePath] = useState<string | null>(null);

  useAutoSave(activeNoteId, activeNoteContent);

  const theme = config.theme === 'light' ? githubLight : githubDark;

  const handleDelete = () => {
    if (activeNoteId && confirm('Delete this note?')) {
      deleteNote(activeNoteId);
    }
  };

  // Find if there's a conflict sibling pointing at the active note
  const conflictSibling = notes.find((n) => n.conflict_of === activeNoteId);

  const openCompare = async () => {
    if (!conflictSibling) return;
    try {
      const content = await invoke<string>('read_note', { path: conflictSibling.path });
      setCompareContent(content);
      setComparePath(conflictSibling.path);
    } catch (e) {
      console.error('Failed to read conflict file:', e);
    }
  };

  const keepThis = async () => {
    if (!comparePath) return;
    await invoke('delete_note', { path: comparePath });
    await loadNotes();
    setCompareContent(null);
    setComparePath(null);
  };

  const keepOther = async () => {
    if (!comparePath || !activeNoteId) return;
    // Copy conflict content to canonical path, delete conflict file
    if (compareContent !== null) {
      await invoke('write_note', { path: activeNoteId, content: compareContent });
    }
    await invoke('delete_note', { path: comparePath });
    await loadNotes();
    await reloadActiveNote();
    setCompareContent(null);
    setComparePath(null);
  };

  const keepBoth = async () => {
    // Rename the conflict file to a dated note — no data lost
    setCompareContent(null);
    setComparePath(null);
    await loadNotes();
  };

  const noteTitle =
    activeNoteContent.split('\n')[0]?.replace(/^#+\s*/, '').trim() || 'Untitled';

  if (compareContent !== null) {
    return (
      <div className="editor-view">
        <div className="editor-header">
          <button className="btn-icon" onClick={() => { setCompareContent(null); setComparePath(null); }}>
            ←
          </button>
          <span className="editor-title">Conflict — {noteTitle}</span>
        </div>

        <div className="compare-view">
          <div className="compare-pane">
            <div className="compare-pane-label">Current version</div>
            <pre className="compare-pane-content">{activeNoteContent}</pre>
          </div>
          <div className="compare-pane">
            <div className="compare-pane-label compare-pane-label--conflict">Conflict copy</div>
            <pre className="compare-pane-content">{compareContent}</pre>
          </div>
        </div>

        <div className="compare-actions">
          <button className="btn-primary" onClick={keepThis}>Keep current</button>
          <button className="btn-secondary" onClick={keepOther}>Keep conflict</button>
          <button className="btn-secondary" onClick={keepBoth}>Keep both</button>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-view">
      <div className="editor-header">
        <button className="btn-icon" onClick={() => setView('list')} title="Back to list">
          ←
        </button>
        <span className="editor-title" title={noteTitle}>
          {noteTitle}
        </span>
        <div className="editor-actions">
          <span className={`save-state save-state--${saveState}`}>
            {saveState === 'saving' ? '●' : saveState === 'error' ? '!' : '✓'}
          </span>
          <button className="btn-icon btn-danger" onClick={handleDelete} title="Delete note">
            🗑
          </button>
        </div>
      </div>

      {activeNoteStale && (
        <div className="editor-banner editor-banner--stale">
          <span>Updated externally</span>
          <button className="banner-btn" onClick={reloadActiveNote}>Reload</button>
          <button className="banner-dismiss" onClick={() => useStore.getState().setActiveNoteStale(false)}>✕</button>
        </div>
      )}

      {conflictSibling && !activeNoteStale && (
        <div className="editor-banner editor-banner--conflict">
          <span>⚠ Sync conflict exists</span>
          <button className="banner-btn" onClick={openCompare}>Compare</button>
        </div>
      )}

      <div className="editor-body">
        <ReactCodeMirror
          value={activeNoteContent}
          onChange={setActiveNoteContent}
          extensions={extensions}
          theme={theme}
          height="100%"
          style={{ height: '100%', fontSize: '14px' }}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightSelectionMatches: true,
          }}
        />
      </div>
    </div>
  );
}
