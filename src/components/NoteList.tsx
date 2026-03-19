import Fuse from 'fuse.js';
import { useMemo, useState, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { useNotes } from '../hooks/useNotes';
import { relativeTime, dateGroup } from '../utils';
import type { Note } from '../types';

const fuse_opts = {
  keys: ['title', 'preview'],
  threshold: 0.4,
};

export function NoteList() {
  const { notes, searchQuery, activeNoteId, setSearchQuery, config } = useStore();
  const { openNote } = useNotes();
  const [focusIdx, setFocusIdx] = useState(0);

  // Paths of conflict copies, and set of canonical paths that have a conflict sibling
  const conflictPaths = useMemo(() => new Set(notes.filter((n) => n.conflict_of).map((n) => n.path)), [notes]);
  const conflictedCanonicals = useMemo(() => new Set(notes.filter((n) => n.conflict_of).map((n) => n.conflict_of as string)), [notes]);

  // Hide conflict copies from the main list
  const canonical = useMemo(() => notes.filter((n) => !conflictPaths.has(n.path)), [notes, conflictPaths]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return canonical;
    const fuse = new Fuse(canonical, fuse_opts);
    return fuse.search(searchQuery).map((r) => r.item);
  }, [canonical, searchQuery]);

  // Reset focus index when filtered list changes
  useEffect(() => { setFocusIdx(0); }, [filtered.length]);

  // Arrow key navigation + Enter to open
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        openNote(filtered[focusIdx]?.path);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filtered, focusIdx, openNote]);

  return (
    <div className="note-list">
      <div className="note-list-search">
        <span className="search-icon">⌕</span>
        <input
          id="search-input"
          type="text"
          placeholder="Search notes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="clear-btn" onClick={() => setSearchQuery('')}>
            ✕
          </button>
        )}
      </div>

      <div className="note-items">
        {filtered.length === 0 && (
          <div className="empty-state">
            {searchQuery ? 'No notes match.' : 'No notes yet. Press + to create one.'}
          </div>
        )}
        {filtered.map((note, i) => {
          const group = dateGroup(note.modified);
          const prevGroup = i > 0 ? dateGroup(filtered[i - 1].modified) : null;
          const showGroup = !searchQuery && group !== prevGroup;
          return (
            <div key={note.path}>
              {showGroup && <div className="note-group-label">{group}</div>}
              <NoteItem
                note={note}
                active={note.path === activeNoteId}
                focused={i === focusIdx}
                hasConflict={conflictedCanonicals.has(note.path)}
                onClick={() => openNote(note.path)}
              />
            </div>
          );
        })}
      </div>

      <div className="note-list-footer">
        <span className="notes-count">{canonical.length} note{canonical.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}

function NoteItem({
  note,
  active,
  focused,
  hasConflict,
  onClick,
}: {
  note: Note;
  active: boolean;
  focused: boolean;
  hasConflict: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`note-item ${active ? 'active' : ''} ${focused ? 'focused' : ''}`}
      onClick={onClick}
    >
      <div className="note-item-title">
        {note.title || 'Untitled'}
        {hasConflict && <span className="conflict-badge" title="Sync conflict">⚠</span>}
      </div>
      <div className="note-item-meta">
        <span className="note-item-time">{relativeTime(note.modified)}</span>
      </div>
    </button>
  );
}
