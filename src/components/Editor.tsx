import { useState, useEffect, useRef, useCallback } from 'react';
import ReactCodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';
import { EditorView, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { useAutoSave } from '../hooks/useAutoSave';
import { useNotes } from '../hooks/useNotes';
import { markdownLivePreview, toggleTask, continueList, indentList, outdentList } from '../extensions/markdownStyle';
import { IconBack, IconClose, IconPin, IconTrash, IconWarning } from './Icons';

/** Toggle markdown wrapper (e.g. ** for bold, * for italic) around selection */
function toggleMarkdownWrap(view: EditorView, mark: string): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);

  // Check if selection is already wrapped
  const before = state.sliceDoc(Math.max(0, from - mark.length), from);
  const after = state.sliceDoc(to, Math.min(state.doc.length, to + mark.length));

  if (before === mark && after === mark) {
    // Unwrap: remove marks around selection
    view.dispatch({
      changes: [
        { from: from - mark.length, to: from, insert: '' },
        { from: to, to: to + mark.length, insert: '' },
      ],
      selection: { anchor: from - mark.length, head: to - mark.length },
    });
  } else if (selected.startsWith(mark) && selected.endsWith(mark) && selected.length >= mark.length * 2) {
    // Selection includes the marks — unwrap
    view.dispatch({
      changes: { from, to, insert: selected.slice(mark.length, -mark.length) },
      selection: { anchor: from, head: to - mark.length * 2 },
    });
  } else if (from === to) {
    // No selection — insert marks and place cursor between them
    view.dispatch({
      changes: { from, to, insert: mark + mark },
      selection: { anchor: from + mark.length },
    });
  } else {
    // Wrap selection
    view.dispatch({
      changes: { from, to, insert: mark + selected + mark },
      selection: { anchor: from + mark.length, head: to + mark.length },
    });
  }
  return true;
}

/** Move selected lines (or current line) up or down */
function moveLines(view: EditorView, direction: 'up' | 'down'): boolean {
  const { state } = view;
  const sel = state.selection.main;
  const startLine = state.doc.lineAt(sel.from);
  // If `to` is right at the start of a line and there's a real selection,
  // the user probably selected up to the end of the previous line.
  const endLine = (sel.to > sel.from && sel.to === state.doc.lineAt(sel.to).from)
    ? state.doc.line(state.doc.lineAt(sel.to).number - 1)
    : state.doc.lineAt(sel.to);

  if (direction === 'up' && startLine.number === 1) return true;
  if (direction === 'down' && endLine.number === state.doc.lines) return true;

  const linesFrom = startLine.from;
  const linesTo = endLine.to;
  const linesText = state.sliceDoc(linesFrom, linesTo);

  if (direction === 'up') {
    const prevLine = state.doc.line(startLine.number - 1);
    view.dispatch({
      changes: { from: prevLine.from, to: linesTo, insert: linesText + '\n' + prevLine.text },
      selection: {
        anchor: sel.anchor - (prevLine.text.length + 1),
        head: sel.head - (prevLine.text.length + 1),
      },
    });
  } else {
    const nextLine = state.doc.line(endLine.number + 1);
    view.dispatch({
      changes: { from: linesFrom, to: nextLine.to, insert: nextLine.text + '\n' + linesText },
      selection: {
        anchor: sel.anchor + (nextLine.text.length + 1),
        head: sel.head + (nextLine.text.length + 1),
      },
    });
  }
  return true;
}

const markdownKeymap = Prec.highest(keymap.of([
  { key: 'Mod-b', run: (view) => toggleMarkdownWrap(view, '**') },
  { key: 'Mod-i', run: (view) => toggleMarkdownWrap(view, '*') },
  { key: 'Mod-Enter', run: toggleTask },
  { key: 'Enter', run: continueList },
  { key: 'Tab', run: indentList },
  { key: 'Shift-Tab', run: outdentList },
  { key: 'Alt-ArrowUp', run: (view) => moveLines(view, 'up') },
  { key: 'Alt-ArrowDown', run: (view) => moveLines(view, 'down') },
  { key: 'Shift-Alt-ArrowUp', run: (view) => moveLines(view, 'up') },
  { key: 'Shift-Alt-ArrowDown', run: (view) => moveLines(view, 'down') },
]));

const extensions = [
  markdownKeymap,
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  EditorView.lineWrapping,
  markdownLivePreview,
];

export function Editor({ pinned, togglePin }: { pinned: boolean; togglePin: () => void }) {
  const {
    activeNoteId,
    activeNoteContent,
    activeNoteStale,
    config,
    notes,
    isNewNote,
    setActiveNoteContent,
    setView,
  } = useStore();
  const { deleteNote, reloadActiveNote, loadNotes, openNote } = useNotes();
  const [compareContent, setCompareContent] = useState<string | null>(null);
  const [comparePath, setComparePath] = useState<string | null>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

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

  // When a new note is created, auto-enter rename mode with title selected
  useEffect(() => {
    if (isNewNote) {
      useStore.getState().setIsNewNote(false);
      setDraftName(currentFilename);
      setEditingName(true);
      // Select all text in the rename input after it mounts
      requestAnimationFrame(() => {
        renameInputRef.current?.select();
      });
    }
  }, [isNewNote, currentFilename]);

  const startRename = () => {
    setDraftName(currentFilename);
    setEditingName(true);
  };

  const commitRename = async () => {
    setEditingName(false);
    requestAnimationFrame(() => {
      editorRef.current?.view?.focus();
    });
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
            <IconBack size={16} />
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
          <IconBack size={16} />
        </button>
        {editingName ? (
          <input
            ref={renameInputRef}
            className="editor-title-input"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setDraftName(currentFilename);
                setEditingName(false);
                renameInputRef.current?.blur();
                requestAnimationFrame(() => {
                  editorRef.current?.view?.focus();
                });
              }
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
          <button
            className={`btn-icon btn-pin ${pinned ? 'active' : ''}`}
            onClick={togglePin}
            title={pinned ? 'Unpin (hide on click away)' : 'Pin (stay visible)'}
          >
            <IconPin size={16} />
          </button>
          <button className="btn-icon btn-danger" onClick={handleDelete} title="Delete note">
            <IconTrash size={16} />
          </button>
        </div>
      </div>

      {activeNoteStale && (
        <div className="editor-banner editor-banner--stale">
          <span>Updated externally</span>
          <button className="banner-btn" onClick={reloadActiveNote}>Reload</button>
          <button className="banner-dismiss" onClick={() => useStore.getState().setActiveNoteStale(false)}><IconClose size={14} /></button>
        </div>
      )}

      {conflictSibling && !activeNoteStale && (
        <div className="editor-banner editor-banner--conflict">
          <span><IconWarning size={14} /> Sync conflict exists</span>
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

      <div className="editor-footer">
        <span>{activeNoteContent.trim().split(/\s+/).filter(Boolean).length} words</span>
        <span>{activeNoteContent.length} chars</span>
        {import.meta.env.DEV && <span className="dev-badge">DEV</span>}
      </div>
    </div>
  );
}
