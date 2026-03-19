import { useState, useEffect, useRef, useCallback } from 'react';
import ReactCodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';
import { EditorView } from '@codemirror/view';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { useAutoSave } from '../hooks/useAutoSave';
import { useNotes } from '../hooks/useNotes';
import { markdownLivePreview } from '../extensions/markdownStyle';

const extensions = [
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  EditorView.lineWrapping,
  markdownLivePreview,
];

export function Editor({ pinned, togglePin }: { pinned: boolean; togglePin: () => void }) {
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
  const { deleteNote, reloadActiveNote, loadNotes, openNote } = useNotes();
  const [compareContent, setCompareContent] = useState<string | null>(null);
  const [comparePath, setComparePath] = useState<string | null>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  useAutoSave(activeNoteId, activeNoteContent);

  // Cycle through notes with Cmd/Ctrl + Up/Down
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.altKey) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      e.preventDefault();
      const { notes: allNotes, activeNoteId: currentId } = useStore.getState();
      // Filter out conflict copies
      const visible = allNotes.filter((n) => !n.conflict_of);
      if (visible.length < 2) return;

      const idx = visible.findIndex((n) => n.path === currentId);
      const next = e.key === 'ArrowDown'
        ? (idx + 1) % visible.length
        : (idx - 1 + visible.length) % visible.length;

      openNote(visible[next].path);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openNote]);

  // Focus editor when panel becomes visible (e.g. hotkey toggle)
  const focusEditor = useCallback(() => {
    const view = editorRef.current?.view;
    if (view) {
      view.focus();
    }
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Small delay to let the panel finish appearing
        setTimeout(focusEditor, 50);
      }
    };
    const onFocus = () => setTimeout(focusEditor, 50);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [focusEditor]);

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

  // Editable filename (stem without .md)
  const currentFilename = activeNoteId
    ? activeNoteId.split(/[\\/]/).pop()?.replace(/\.md$/, '') ?? ''
    : '';
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(currentFilename);

  const startRename = () => {
    setDraftName(currentFilename);
    setEditingName(true);
  };

  const commitRename = async () => {
    setEditingName(false);
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === currentFilename || !activeNoteId) return;
    try {
      const newPath = await invoke<string>('rename_note', {
        oldPath: activeNoteId,
        newName: trimmed,
      });
      // Update store with new path
      useStore.getState().setActiveNote(newPath, activeNoteContent);
      localStorage.setItem('lastNoteId', newPath);
      loadNotes();
    } catch (e) {
      console.error('Rename failed:', e);
    }
  };

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
        {editingName ? (
          <input
            className="editor-title-input"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditingName(false);
            }}
            autoFocus
          />
        ) : (
          <span
            className="editor-title editor-title--editable"
            onClick={startRename}
            title="Click to rename"
          >
            {currentFilename}
          </span>
        )}
        <div className="editor-actions">
          <span className={`save-state save-state--${saveState}`}>
            {saveState === 'saving' ? '●' : saveState === 'error' ? '!' : '✓'}
          </span>
          <button
            className={`btn-icon btn-pin ${pinned ? 'active' : ''}`}
            onClick={togglePin}
            title={pinned ? 'Unpin (hide on click away)' : 'Pin (stay visible)'}
          >
            📌
          </button>
          <button className="btn-icon btn-danger" onClick={handleDelete} title="Delete note">
            ✕
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
          key={activeNoteId}
          ref={editorRef}
          value={activeNoteContent}
          onChange={setActiveNoteContent}
          extensions={extensions}
          theme={theme}
          autoFocus
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
