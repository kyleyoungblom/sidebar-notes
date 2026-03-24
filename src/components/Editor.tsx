import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactCodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';
import { EditorView, keymap } from '@codemirror/view';
import { Compartment, Prec, EditorSelection } from '@codemirror/state';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { useAutoSave } from '../hooks/useAutoSave';
import { useNotes } from '../hooks/useNotes';
import { markdownLivePreview, toggleTask, toggleHideCompleted, setHideCompletedState, continueList, indentList, outdentList, noteDirectoryField } from '../extensions/markdownStyle';
import { imagePasteHandler } from '../extensions/imagePaste';
import { IconBack, IconCheckSquare, IconClose, IconCode, IconPaintbrush, IconPin, IconTrash, IconWarning } from './Icons';
import { ConfirmModal } from './ConfirmModal';
import { formatHotkey, getHotkey } from '../hotkeys';
import { NOTE_COLORS } from '../types';

// Timing constants (ms) — small delays for DOM readiness after mount/visibility
const DELAY_HIDE_COMPLETED_SYNC = 50;
const DELAY_CHECKBOX_SNAP = 60;
const DELAY_FOCUS_AFTER_SHOW = 50;

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
const COMPLETED_TASK_RE = /^\s*[-*+]\s\[[xX\-]\]/;

/** Check if a line is a hidden completed task */
function isHiddenLine(lineText: string): boolean {
  if (localStorage.getItem('hideCompleted') !== 'true') return false;
  return COMPLETED_TASK_RE.test(lineText);
}

/** Find the next visible line in the given direction, skipping hidden completed tasks */
function findVisibleLine(doc: { lines: number; line: (n: number) => { text: string } }, lineNum: number, dir: 1 | -1): number | null {
  let n = lineNum + dir;
  while (n >= 1 && n <= doc.lines) {
    if (!isHiddenLine(doc.line(n).text)) return n;
    n += dir;
  }
  return null;
}

/** Move selected lines (or current line) up or down, skipping hidden lines */
function moveLines(view: EditorView, direction: 'up' | 'down'): boolean {
  const { state } = view;
  const { doc } = state;
  const sel = state.selection.main;
  const startLine = doc.lineAt(sel.from);
  const endLine = (sel.to > sel.from && sel.to === doc.lineAt(sel.to).from)
    ? doc.line(doc.lineAt(sel.to).number - 1)
    : doc.lineAt(sel.to);

  if (direction === 'up') {
    const targetNum = findVisibleLine(doc, startLine.number, -1);
    if (targetNum === null) return true;
    const targetLine = doc.line(targetNum);
    // Collect all lines from target through endLine (including hidden ones between)
    const movingText = state.sliceDoc(startLine.from, endLine.to);
    const skippedText = state.sliceDoc(targetLine.from, startLine.from - 1);
    const offset = startLine.from - targetLine.from;
    view.dispatch({
      changes: { from: targetLine.from, to: endLine.to, insert: movingText + '\n' + skippedText },
      selection: { anchor: sel.anchor - offset, head: sel.head - offset },
    });
  } else {
    const targetNum = findVisibleLine(doc, endLine.number, 1);
    if (targetNum === null) return true;
    const targetLine = doc.line(targetNum);
    // Collect all lines from startLine through target (including hidden ones between)
    const movingText = state.sliceDoc(startLine.from, endLine.to);
    const skippedText = state.sliceDoc(endLine.to + 1, targetLine.to);
    const offset = targetLine.to - endLine.to;
    view.dispatch({
      changes: { from: startLine.from, to: targetLine.to, insert: skippedText + '\n' + movingText },
      selection: { anchor: sel.anchor + offset, head: sel.head + offset },
    });
  }
  return true;
}

const markdownKeymap = Prec.highest(keymap.of([
  { key: 'Mod-b', run: (view) => toggleMarkdownWrap(view, '**') },
  { key: 'Mod-i', run: (view) => toggleMarkdownWrap(view, '*') },
  { key: 'Mod-Enter', run: toggleTask },
  // Mod-Shift-h handled in Editor component keydown listener for localStorage sync
  { key: 'Enter', run: continueList },
  { key: 'Tab', run: indentList },
  { key: 'Shift-Tab', run: outdentList },
  { key: 'Alt-ArrowUp', run: (view) => moveLines(view, 'up') },
  { key: 'Alt-ArrowDown', run: (view) => moveLines(view, 'down') },
  { key: 'Shift-Alt-ArrowUp', run: (view) => moveLines(view, 'up') },
  { key: 'Shift-Alt-ArrowDown', run: (view) => moveLines(view, 'down') },
  // Consume Mod-Alt-Arrow so CM6 doesn't move cursor when cycling notes
  { key: 'Mod-Alt-ArrowUp', run: () => true },
  { key: 'Mod-Alt-ArrowDown', run: () => true },
]));

const mdPreviewCompartment = new Compartment();
const fontSizeCompartment = new Compartment();

const makeFontSizeTheme = (size: number) =>
  EditorView.theme({ '.cm-content': { fontSize: `${size}px` } });

// ── Right-click selection suppression ────────────────────────────────────────
// Problem: WebKit/WKWebView changes the native DOM selection on right-click at
// the OS level AND fires `selectionchange` BEFORE `mousedown`. So by the time
// any mousedown handler runs, CM6's selection is already corrupted.
//
// Strategy: continuously track the "stable" selection — the selection as it was
// before any right-click burst. We use rAF debouncing: on every CM6 selection
// update, we schedule a rAF to commit the new selection as "stable". During a
// right-click burst (selectionchange×N + mousedown all in one frame), the rAF
// never fires, so _stableSelection retains the pre-burst value.
//
// On mousedown button 2, we grab _stableSelection. Then an updateListener
// detects the next CM6 selection change and restores it via queueMicrotask
// (runs before paint, so no flash).
//
// CSS: native ::selection is always transparent in the editor (CM6's
// drawSelection handles visible selection). This hides WebKit's forced native
// selection change entirely.
let _stableSelection: EditorSelection | null = null;
let _cycleOrder: string[] = [];
export function resetEditorState() {
  _cycleOrder = [];
  _stableSelection = null;
  _restoreSelection = null;
}
/** @deprecated Use resetEditorState instead */
export function resetCycleOrder() { resetEditorState(); }
let _restoreSelection: EditorSelection | null = null;
let _stableRaf = 0;

/** Check if the editor has a non-empty text selection (uses the stable
 *  pre-right-click selection so context menus get the correct state). */
let _editorView: import('@codemirror/view').EditorView | null = null;
export function getEditorView() {
  if (_editorView) return _editorView;
  // Fallback: try to get view from the DOM
  const cmEl = document.querySelector('.cm-editor') as any;
  return cmEl?.cmView?.view ?? null;
}

export function editorHasSelection(): boolean {
  const sel = _stableSelection;
  if (!sel) return false;
  return sel.ranges.some((r) => !r.empty);
}

// Track stable selection — commits only when a full frame passes without changes
const selectionTracker = EditorView.updateListener.of((update) => {
  if (update.selectionSet) {
    cancelAnimationFrame(_stableRaf);
    _stableRaf = requestAnimationFrame(() => {
      _stableSelection = update.state.selection;
    });
  }
});

// On right-click: grab the stable (pre-burst) selection
const rightClickHandler = EditorView.domEventHandlers({
  mousedown(event, _view) {
    if (event.button === 2) {
      _restoreSelection = _stableSelection;
      return true; // preventDefault + skip CM6's mousedown handler
    }
    return false;
  },
});

// Detect selection corruption from DOMObserver and restore
const rightClickRestore = EditorView.updateListener.of((update) => {
  if (_restoreSelection && update.selectionSet) {
    const sel = _restoreSelection;
    _restoreSelection = null;
    // queueMicrotask runs before paint — no visual flash
    queueMicrotask(() => {
      update.view.dispatch({ selection: sel });
    });
  }
});

// Font size: directly reconfigures the CM6 compartment from the handler.
const fontSizeHandler = EditorView.domEventHandlers({
  keydown(event, view) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
    let delta: number | null = null;
    if (event.code === 'Equal' || event.key === '=' || event.key === '+') delta = 1;
    else if (event.code === 'Minus' || event.key === '-') delta = -1;
    else if (event.code === 'Digit0' && !event.shiftKey) delta = 0;
    if (delta !== null) {
      event.preventDefault();
      const prev = Number(localStorage.getItem('editorFontSize')) || 14;
      const next = delta === 0 ? 14 : Math.max(10, Math.min(24, prev + delta));
      localStorage.setItem('editorFontSize', String(next));
      view.dispatch({
        effects: fontSizeCompartment.reconfigure(makeFontSizeTheme(next)),
      });
      return true;
    }
    return false;
  },
});

// Note: noteDirectoryField is added dynamically in the Editor component
// via noteDirectoryField.init() so each note gets its own directory.
const baseExtensions = [
  markdownKeymap,
  fontSizeHandler,
  selectionTracker,
  rightClickHandler,
  rightClickRestore,
  imagePasteHandler,
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  EditorView.lineWrapping,
  mdPreviewCompartment.of(markdownLivePreview),
  fontSizeCompartment.of(makeFontSizeTheme(Number(localStorage.getItem('editorFontSize')) || 14)),
];

export function Editor({ pinned, togglePin, onToggleDebugDrawer }: { pinned: boolean; togglePin: () => void; onToggleDebugDrawer?: () => void }) {
  const {
    activeNoteId,
    activeNoteContent,
    activeNoteStale,
    activeNoteColor,
    config,
    notes,
    isNewNote,
    setActiveNoteContent,
    setContentDirty,
    setView,
    focusMode,
  } = useStore();
  const { deleteNote, reloadActiveNote, loadNotes, openNote } = useNotes();
  const [compareContent, setCompareContent] = useState<string | null>(null);
  const [comparePath, setComparePath] = useState<string | null>(null);
  const [hideCompleted, setHideCompleted] = useState(() => localStorage.getItem('hideCompleted') === 'true');
  const [mdPreview, setMdPreview] = useState(true);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showNoteIndicator, setShowNoteIndicator] = useState(false);
  const indicatorTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useAutoSave(activeNoteId, activeNoteContent);

  // Focus mode hover zones
  const [focusHoverTop, setFocusHoverTop] = useState(false);
  const [focusHoverBottom, setFocusHoverBottom] = useState(false);
  const hoverTopTimer = useRef<ReturnType<typeof setTimeout>>();
  const hoverBottomTimer = useRef<ReturnType<typeof setTimeout>>();

  const onTopEnter = useCallback(() => {
    clearTimeout(hoverTopTimer.current);
    setFocusHoverTop(true);
  }, []);
  const onTopLeave = useCallback(() => {
    hoverTopTimer.current = setTimeout(() => setFocusHoverTop(false), 300);
  }, []);
  const onBottomEnter = useCallback(() => {
    clearTimeout(hoverBottomTimer.current);
    setFocusHoverBottom(true);
  }, []);
  const onBottomLeave = useCallback(() => {
    hoverBottomTimer.current = setTimeout(() => setFocusHoverBottom(false), 300);
  }, []);

  // Close color picker on click outside
  useEffect(() => {
    if (!showColorPicker) return;
    const handler = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showColorPicker]);


  // Sync CM6 hideCompleted field from localStorage on editor mount
  useEffect(() => {
    if (!hideCompleted) return;
    const timer = setTimeout(() => {
      const view = editorRef.current?.view;
      if (view) setHideCompletedState(view, true);
    }, DELAY_HIDE_COMPLETED_SYNC);
    return () => clearTimeout(timer);
  }, [activeNoteId]); // re-sync when switching notes

  // Compute initial cursor position so CM6 mounts with the right selection
  // (avoids the flash of cursor at 0 then snap).
  const initialSelection = useMemo(() => {
    const content = activeNoteContent;
    // If first line is a checkbox, place cursor after the prefix
    const firstLineEnd = content.indexOf('\n');
    const firstLine = firstLineEnd >= 0 ? content.slice(0, firstLineEnd) : content;
    const match = firstLine.match(/^(\s*)([-*+]\s\[[ xX\-]\]\s)/);
    if (match) {
      const pos = match[1].length + match[2].length;
      return EditorSelection.cursor(pos);
    }
    return EditorSelection.cursor(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId]);

  // Build extensions with the note directory field for image path resolution
  const extensions = useMemo(() => {
    const noteId = activeNoteId ?? '';
    const lastSlash = Math.max(noteId.lastIndexOf('/'), noteId.lastIndexOf('\\'));
    const noteDir = lastSlash >= 0 ? noteId.slice(0, lastSlash) : '';
    return [
      ...baseExtensions,
      noteDirectoryField.init(() => noteDir),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId]);

  // Lint: collapse consecutive blank lines into one
  const lintNote = useCallback(() => {
    const view = editorRef.current?.view;
    if (!view) return;
    const doc = view.state.doc;
    const text = doc.toString();
    const linted = text.replace(/\n{3,}/g, '\n\n');
    if (linted !== text) {
      const cursor = view.state.selection.main.head;
      view.dispatch({
        changes: { from: 0, to: doc.length, insert: linted },
        selection: { anchor: Math.min(cursor, linted.length) },
      });
    }
  }, []);

  // Toggle markdown preview with Cmd/Ctrl+Alt+P
  const toggleMdPreview = useCallback(() => {
    const view = editorRef.current?.view;
    if (!view) return;
    const next = !mdPreview;
    setMdPreview(next);
    view.dispatch({
      effects: mdPreviewCompartment.reconfigure(next ? markdownLivePreview : []),
    });
  }, [mdPreview]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        toggleMdPreview();
      }
      // Cmd/Ctrl+L: lint note
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyL') {
        e.preventDefault();
        lintNote();
      }
      // Cmd/Ctrl+Shift+H: toggle hide completed
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === 'KeyH') {
        e.preventDefault();
        const view = editorRef.current?.view;
        if (view) {
          toggleHideCompleted(view);
          setHideCompleted((prev) => {
            const next = !prev;
            localStorage.setItem('hideCompleted', String(next));
            return next;
          });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleMdPreview, lintNote]);

  // Cycle through notes with Cmd/Ctrl+Alt + Up/Down
  // Snapshot the note order on first press so that re-sorting by modified
  // Cycle through notes with Cmd+Alt+Up/Down. Always reads fresh from store
  // Module-level so it survives Editor remounts when switching notes.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.altKey) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      e.preventDefault();
      const { notes, activeNoteId } = useStore.getState();
      const visible = notes.filter((n) => !n.conflict_of);
      if (visible.length < 2) return;

      // Snapshot the cycle order on first press. Rebuild if the number of
      // notes changed (create/delete/rename) but keep stable otherwise
      // so that autosave reordering doesn't cause ping-pong.
      if (_cycleOrder.length !== visible.length) {
        _cycleOrder = visible.map((n) => n.path);
      }

      let idx = _cycleOrder.indexOf(activeNoteId ?? '');
      if (idx < 0 && activeNoteId) {
        const name = activeNoteId.split('/').pop();
        idx = _cycleOrder.findIndex((p) => p.split('/').pop() === name);
      }
      if (idx < 0) idx = 0;

      const next = e.key === 'ArrowDown'
        ? (idx + 1) % _cycleOrder.length
        : (idx - 1 + _cycleOrder.length) % _cycleOrder.length;

      openNote(_cycleOrder[next]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openNote]);

  // Expose editor view for context menu image deletion
  useEffect(() => {
    const timer = setTimeout(() => { _editorView = editorRef.current?.view ?? null; }, 50);
    return () => { clearTimeout(timer); _editorView = null; };
  }, [activeNoteId]);

  // Show note position indicator briefly on note change
  useEffect(() => {
    if (!activeNoteId) return;
    setShowNoteIndicator(true);
    clearTimeout(indicatorTimerRef.current);
    indicatorTimerRef.current = setTimeout(() => setShowNoteIndicator(false), 1500);
    return () => clearTimeout(indicatorTimerRef.current);
  }, [activeNoteId]);

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
        setTimeout(focusEditor, DELAY_FOCUS_AFTER_SHOW);
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

  // Right-click selection restore is fully handled by CM6 extensions:
  // selectionTracker, rightClickHandler, rightClickRestore (see above).
  // No useEffect needed — avoids ref timing issues with ReactCodeMirror.

  const LIGHT_SCHEMES = new Set(['light', 'catppuccin-latte', 'solarized-light', 'gruvbox-light', 'rose-pine-dawn']);
  const theme = LIGHT_SCHEMES.has(config.theme) ? githubLight : githubDark;

  const handleDelete = () => {
    if (!activeNoteId) return;
    if (localStorage.getItem('skipDeleteConfirm') === 'true') {
      deleteNote(activeNoteId);
    } else {
      setShowDeleteModal(true);
    }
  };

  const confirmDelete = (dontAskAgain: boolean) => {
    if (dontAskAgain) localStorage.setItem('skipDeleteConfirm', 'true');
    setShowDeleteModal(false);
    if (activeNoteId) deleteNote(activeNoteId);
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
      // Double-rAF to ensure React has rendered the input
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
            renameMountedRef.current = true;
          }
        });
      });
    }
  }, [isNewNote, currentFilename]);

  const startRename = () => {
    setDraftName(currentFilename);
    setEditingName(true);
    renameMountedRef.current = true;
  };

  const renameMountedRef = useRef(false);
  const commitRename = async () => {
    // Guard: ignore the initial blur when CM6 steals focus before rename input is ready
    if (!renameMountedRef.current) return;
    renameMountedRef.current = false;
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

  const fmt = (id: string) => formatHotkey(getHotkey(id, config.hotkey_overrides));

  return (
    <div className={`editor-view ${focusMode ? 'focus-mode' : ''} ${focusMode && focusHoverTop ? 'focus-hover-top' : ''} ${focusMode && focusHoverBottom ? 'focus-hover-bottom' : ''}`}>
      {focusMode && <div className="focus-zone focus-zone--top" onMouseEnter={onTopEnter} onMouseLeave={onTopLeave} />}
      {focusMode && <div className="focus-zone focus-zone--bottom" onMouseEnter={onBottomEnter} onMouseLeave={onBottomLeave} />}
      <div className="editor-header" data-pop-color={activeNoteColor || undefined}>
        <button className="btn-icon" tabIndex={-1} onClick={() => setView('list')} title={`Back to list (${fmt('back')})`}>
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
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                commitRename();
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                renameMountedRef.current = false;
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
            tabIndex={-1}
            onClick={togglePin}
            title={`${pinned ? 'Unpin' : 'Pin'} (${fmt('toggle-pin')})`}
          >
            <IconPin size={16} />
          </button>
          <button
            className="btn-icon btn-danger"
            tabIndex={-1}
            onClick={handleDelete}
            title={`Delete note (${fmt('delete-note')})`}
          >
            <IconTrash size={16} />
          </button>
        </div>
      </div>
      {/* Note position indicator — always 2px, segments briefly on note switch */}
      {(() => {
        const visible = notes.filter((n) => !n.conflict_of);
        const idx = visible.findIndex((n) => n.path === activeNoteId);
        if (!showNoteIndicator || visible.length <= 1) {
          // Default: single solid bar in current note's color
          return (
            <div className="note-indicator">
              <div className="note-indicator-seg note-indicator-seg--active" data-pop-color={activeNoteColor || undefined} />
            </div>
          );
        }
        // Segmented view during note switch
        return (
          <div className="note-indicator note-indicator--segmented">
            {visible.map((n, i) => (
              <div
                key={n.path}
                className={`note-indicator-seg ${i === idx ? 'note-indicator-seg--active' : ''}`}
                data-pop-color={n.color || undefined}
              />
            ))}
          </div>
        );
      })()}

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
          selection={initialSelection}
          onChange={(val) => { setContentDirty(true); setActiveNoteContent(val); }}
          extensions={extensions}
          theme={theme}
          autoFocus
          height="100%"
          style={{ height: '100%' }}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightSelectionMatches: false,
          }}
        />
      </div>

      <div className="editor-footer">
        <button
          className={`btn-icon btn-footer-toggle ${hideCompleted ? 'active' : ''}`}
          onClick={() => {
            const view = editorRef.current?.view;
            if (view) {
              const next = !hideCompleted;
              toggleHideCompleted(view);
              setHideCompleted(next);
              localStorage.setItem('hideCompleted', String(next));
            }
          }}
          title={`${hideCompleted ? 'Show' : 'Hide'} completed tasks (${fmt('hide-completed')})`}
        >
          <IconCheckSquare size={14} />
        </button>
        <button
          className={`btn-icon btn-footer-toggle ${!mdPreview ? 'active' : ''}`}
          onClick={toggleMdPreview}
          title={`${mdPreview ? 'Show raw markdown' : 'Show rendered preview'} (${fmt('toggle-preview')})`}
        >
          <IconCode size={14} />
        </button>
        <div className="color-picker-wrap" ref={colorPickerRef}>
          <button
            className="btn-icon btn-footer-toggle color-picker-btn"
            onClick={() => setShowColorPicker((v) => !v)}
            title="Note color"
          >
            <IconPaintbrush size={14} />
          </button>
          {showColorPicker && (
            <div className="color-picker-popover">
              <button
                className="color-swatch-clear"
                onClick={() => {
                  useStore.getState().setActiveNoteColor(null);
                  setContentDirty(true);
                  setShowColorPicker(false);
                }}
                title="Clear color"
              />
              {NOTE_COLORS.map((c) => (
                <button
                  key={c}
                  className={`color-swatch ${activeNoteColor === c ? 'selected' : ''}`}
                  data-color={c}
                  onClick={() => {
                    useStore.getState().setActiveNoteColor(c);
                    setContentDirty(true);
                    setShowColorPicker(false);
                  }}
                  title={c}
                />
              ))}
            </div>
          )}
        </div>
        <span className="editor-footer-spacer" />
        <span>{activeNoteContent.trim().split(/\s+/).filter(Boolean).length} words</span>
        <span>{activeNoteContent.length} chars</span>
        {import.meta.env.DEV && <button className="dev-badge" onClick={onToggleDebugDrawer} tabIndex={-1} title={`Toggle debug drawer (${fmt('debug-drawer')})`}>DEV</button>}
      </div>
      {showDeleteModal && (
        <ConfirmModal
          message="Delete this note?"
          onConfirm={confirmDelete}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}
    </div>
  );
}
