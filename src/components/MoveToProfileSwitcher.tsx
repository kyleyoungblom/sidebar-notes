import { useState, useEffect, useMemo, useRef } from 'react';
import Fuse from 'fuse.js';
import { useStore } from '../store';
import { useNotes } from '../hooks/useNotes';

const fuse_opts = {
  keys: ['name'],
  threshold: 0.4,
};

/**
 * Overlay picker for "move current note to another profile". Filters out the
 * currently-active profile from the list. Nothing happens if there's no
 * active note or if the user has only one profile.
 */
export function MoveToProfileSwitcher({ onClose }: { onClose: () => void }) {
  const config = useStore((s) => s.config);
  const activeNoteId = useStore((s) => s.activeNoteId);
  const activeProfileId = config.active_profile_id;
  const { moveNote } = useNotes();

  // Destinations = all profiles except the current one.
  const destinations = useMemo(
    () => config.profiles.filter((p) => p.id !== activeProfileId),
    [config.profiles, activeProfileId]
  );

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const fuse = useMemo(() => new Fuse(destinations, fuse_opts), [destinations]);
  const filtered = useMemo(() => {
    if (!query.trim()) return destinations;
    return fuse.search(query).map((r) => r.item);
  }, [destinations, query, fuse]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [filtered.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Capture Escape at the window level to prevent the global handler from firing
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [onClose]);

  const commit = async (dest: (typeof destinations)[number]) => {
    onClose();
    if (!activeNoteId) return;
    await moveNote(activeNoteId, dest.notes_dir);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      commit(filtered[selectedIdx]);
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
          placeholder="Move note to profile…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="quick-switcher-results">
          {filtered.slice(0, 10).map((p, i) => (
            <button
              key={p.id}
              className={`quick-switcher-item ${i === selectedIdx ? 'selected' : ''}`}
              onClick={() => commit(p)}
            >
              {p.name}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="quick-switcher-empty">
              {destinations.length === 0 ? 'No other profiles' : 'No profiles found'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
