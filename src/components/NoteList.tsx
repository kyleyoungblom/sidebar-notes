import Fuse from 'fuse.js';
import { useMemo } from 'react';
import { useStore } from '../store';
import { useNotes } from '../hooks/useNotes';
import { relativeTime } from '../utils';
import type { Note } from '../types';

const fuse_opts = {
  keys: ['title', 'preview'],
  threshold: 0.4,
};

export function NoteList() {
  const { notes, searchQuery, activeNoteId, setSearchQuery, config } = useStore();
  const { openNote } = useNotes();

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

  return (
    <div className="note-list">
      <div className="note-list-search">
        <span className="search-icon">⌕</span>
        <input
          type="text"
          placeholder="Search notes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
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
        {filtered.map((note) => (
          <NoteItem
            key={note.path}
            note={note}
            active={note.path === activeNoteId}
            hasConflict={conflictedCanonicals.has(note.path)}
            onClick={() => openNote(note.path)}
          />
        ))}
      </div>

      <div className="note-list-footer">
        <span className="notes-count">{canonical.length} note{canonical.length !== 1 ? 's' : ''}</span>
        <span className="footer-dir" title={config.notes_dir}>
          {config.notes_dir.split(/[\\/]/).pop()}
        </span>
      </div>
    </div>
  );
}

function NoteItem({
  note,
  active,
  hasConflict,
  onClick,
}: {
  note: Note;
  active: boolean;
  hasConflict: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`note-item ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      <div className="note-item-title">
        {note.title || 'Untitled'}
        {hasConflict && <span className="conflict-badge" title="Sync conflict">⚠</span>}
      </div>
      <div className="note-item-meta">
        <span className="note-item-time">{relativeTime(note.modified)}</span>
        {note.preview && (
          <span className="note-item-preview">{note.preview}</span>
        )}
      </div>
    </button>
  );
}
