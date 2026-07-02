import { useState, useEffect, useMemo, useRef } from 'react';
import Fuse from 'fuse.js';
import { useStore } from '../store';
import { useNotes } from '../hooks/useNotes';

const fuse_opts = {
  keys: ['name'],
  threshold: 0.4,
};

export function QuickProfileSwitcher({ onClose }: { onClose: () => void }) {
  const config = useStore((s) => s.config);
  const profiles = config.profiles;
  const activeId = config.active_profile_id;
  const { saveConfig } = useNotes();
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const fuse = useMemo(() => new Fuse(profiles, fuse_opts), [profiles]);
  const filtered = useMemo(() => {
    if (!query.trim()) return profiles;
    return fuse.search(query).map((r) => r.item);
  }, [profiles, query, fuse]);

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

  const select = (id: string) => {
    onClose();
    if (id === activeId) return;
    saveConfig({ ...config, active_profile_id: id }).catch(() => {});
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
      select(filtered[selectedIdx].id);
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
          placeholder="Switch profile..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="quick-switcher-results">
          {filtered.slice(0, 10).map((p, i) => (
            <button
              key={p.id}
              className={`quick-switcher-item ${i === selectedIdx ? 'selected' : ''}`}
              onClick={() => select(p.id)}
            >
              <span>{p.name}</span>
              {p.id === activeId && <span className="profile-switcher-check">current</span>}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="quick-switcher-empty">No profiles found</div>
          )}
        </div>
      </div>
    </div>
  );
}
