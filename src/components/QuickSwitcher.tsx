import { useState, useEffect, useMemo, useRef } from 'react';
import Fuse from 'fuse.js';
import { useStore } from '../store';
import { useNotes } from '../hooks/useNotes';

const fuse_opts = {
  keys: ['title'],
  threshold: 0.4,
};

export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const { notes } = useStore();
  const { openNote } = useNotes();
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter out conflict copies
  const canonical = useMemo(
    () => notes.filter((n) => !n.conflict_of),
    [notes]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return canonical;
    const fuse = new Fuse(canonical, fuse_opts);
    return fuse.search(query).map((r) => r.item);
  }, [canonical, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [filtered.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const select = (path: string) => {
    onClose();
    openNote(path);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      select(filtered[selectedIdx].path);
    }
  };

  return (
    <div className="quick-switcher-overlay" onClick={onClose}>
      <div
        className="quick-switcher"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          className="quick-switcher-input"
          type="text"
          placeholder="Jump to note..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="quick-switcher-results">
          {filtered.slice(0, 10).map((note, i) => (
            <button
              key={note.path}
              className={`quick-switcher-item ${i === selectedIdx ? 'selected' : ''}`}
              onClick={() => select(note.path)}
            >
              {note.title || 'Untitled'}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="quick-switcher-empty">No notes found</div>
          )}
        </div>
      </div>
    </div>
  );
}
