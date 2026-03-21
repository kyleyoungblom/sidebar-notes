import Fuse from 'fuse.js';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { useNotes } from '../hooks/useNotes';
import { relativeTime, dateGroup } from '../utils';
import type { Note } from '../types';
import { IconSearch, IconClose, IconWarning } from './Icons';

const fuse_opts = {
  keys: ['title', 'preview'],
  threshold: 0.4,
};

export function NoteList() {
  const { notes, searchQuery, activeNoteId, setSearchQuery } = useStore();
  const { openNote } = useNotes();
  const [focusIdx, setFocusIdx] = useState(0);
  const [usingKeyboard, setUsingKeyboard] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const didInitScroll = useRef(false);

  // Helper: scroll just past the search bar to hide it
  const hideSearch = useCallback(() => {
    if (scrollRef.current && searchRef.current) {
      scrollRef.current.scrollTop = searchRef.current.offsetHeight + 8;
    }
  }, []);

  // On mount, scroll past search bar to hide it. Use rAF to ensure DOM is laid out.
  useEffect(() => {
    if (didInitScroll.current) return;
    requestAnimationFrame(() => {
      hideSearch();
      didInitScroll.current = true;
    });
  }, [hideSearch]);

  // Reveal search on Cmd+F
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => searchInputRef.current?.focus(), 150);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // When clearing search, hide the bar again
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    searchInputRef.current?.blur();
    requestAnimationFrame(hideSearch);
  }, [setSearchQuery, hideSearch]);

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
        setUsingKeyboard(true);
        setFocusIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setUsingKeyboard(true);
        setFocusIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        openNote(filtered[focusIdx]?.path);
      }
    };
    // Mouse movement switches back to hover mode
    const onMouseMove = () => {
      if (usingKeyboard) setUsingKeyboard(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [filtered, focusIdx, openNote, usingKeyboard]);

  return (
    <div className="note-list">
      <div className={`note-items ${usingKeyboard ? 'keyboard-nav' : ''}`} ref={scrollRef}>
        <div className="note-list-search" ref={searchRef}>
          <span className="search-icon"><IconSearch size={15} /></span>
          <input
            ref={searchInputRef}
            id="search-input"
            type="text"
            placeholder="Search notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                clearSearch();
              }
            }}
            onBlur={() => {
              if (!searchQuery) {
                setTimeout(() => {
                  scrollRef.current?.scrollTo({ top: (searchRef.current?.offsetHeight ?? 0) + 8, behavior: 'smooth' });
                }, 150);
              }
            }}
          />
          {searchQuery && (
            <button className="clear-btn" onClick={clearSearch}>
              <IconClose size={14} />
            </button>
          )}
        </div>
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
                focused={usingKeyboard && i === focusIdx}
                hasConflict={conflictedCanonicals.has(note.path)}
                onClick={() => openNote(note.path)}
                onMouseEnter={() => { if (!usingKeyboard) setFocusIdx(i); }}
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
  onMouseEnter,
}: {
  note: Note;
  active: boolean;
  focused: boolean;
  hasConflict: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <button
      className={`note-item ${active ? 'active' : ''} ${focused ? 'focused' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      data-note-path={note.path}
    >
      <div className="note-item-title" data-pop-color={note.color || undefined}>
        {note.title || 'Untitled'}
        {hasConflict && <span className="conflict-badge" title="Sync conflict"><IconWarning size={14} /></span>}
      </div>
      <div className="note-item-meta">
        <span className="note-item-time">{relativeTime(note.modified)}</span>
      </div>
    </button>
  );
}
