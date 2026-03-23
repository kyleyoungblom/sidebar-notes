import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Fuse from 'fuse.js';
import { useStore } from '../store';
import { useNotes } from '../hooks/useNotes';

const SCHEMES = [
  { id: 'dark',             name: 'Flexoki Dark',     bg: '#100F0F', accent: '#3AA99F', text: '#CECDC3' },
  { id: 'light',            name: 'Flexoki Light',    bg: '#FFFCF0', accent: '#24837B', text: '#100F0F' },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', bg: '#1e1e2e', accent: '#89b4fa', text: '#cdd6f4' },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', bg: '#eff1f5', accent: '#1e66f5', text: '#4c4f69' },
  { id: 'nord',             name: 'Nord',             bg: '#2e3440', accent: '#88c0d0', text: '#eceff4' },
  { id: 'dracula',          name: 'Dracula',          bg: '#282a36', accent: '#bd93f9', text: '#f8f8f2' },
  { id: 'solarized-dark',   name: 'Solarized Dark',   bg: '#002b36', accent: '#268bd2', text: '#839496' },
  { id: 'solarized-light',  name: 'Solarized Light',  bg: '#fdf6e3', accent: '#268bd2', text: '#657b83' },
  { id: 'gruvbox-dark',     name: 'Gruvbox Dark',     bg: '#282828', accent: '#83a598', text: '#ebdbb2' },
  { id: 'gruvbox-light',    name: 'Gruvbox Light',    bg: '#fbf1c7', accent: '#076678', text: '#282828' },
  { id: 'one-dark',         name: 'One Dark',         bg: '#282c34', accent: '#61afef', text: '#abb2bf' },
  { id: 'tokyo-night',      name: 'Tokyo Night',      bg: '#1a1b26', accent: '#7aa2f7', text: '#c0caf5' },
  { id: 'rose-pine',        name: 'Rosé Pine',        bg: '#191724', accent: '#c4a7e7', text: '#e0def4' },
  { id: 'rose-pine-dawn',   name: 'Rosé Pine Dawn',   bg: '#faf4ed', accent: '#907aa9', text: '#575279' },
];

const fuse_opts = {
  keys: ['name'],
  threshold: 0.4,
};

export function SchemeSwitcher({ onClose }: { onClose: () => void }) {
  const { config } = useStore();
  const { saveConfig } = useNotes();
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(() =>
    Math.max(0, SCHEMES.findIndex((s) => s.id === config.theme))
  );
  const [usingKeyboard, setUsingKeyboard] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const originalTheme = useRef(config.theme);

  const fuse = useMemo(() => new Fuse(SCHEMES, fuse_opts), []);
  const filtered = useMemo(() => {
    if (!query.trim()) return SCHEMES;
    return fuse.search(query).map((r) => r.item);
  }, [query, fuse]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [filtered.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const item = container.children[selectedIdx] as HTMLElement | undefined;
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx]);

  // Live preview: apply theme as user navigates
  useEffect(() => {
    if (filtered.length > 0 && selectedIdx < filtered.length) {
      document.documentElement.setAttribute('data-theme', filtered[selectedIdx].id);
    }
  }, [selectedIdx, filtered]);

  // Re-enable hover when mouse moves
  useEffect(() => {
    const onMouseMove = () => {
      if (usingKeyboard) setUsingKeyboard(false);
    };
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, [usingKeyboard]);

  const revert = useCallback(() => {
    document.documentElement.setAttribute('data-theme', originalTheme.current);
    onClose();
  }, [onClose]);

  // Capture Escape at the window level to prevent the global handler from firing
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        revert();
      }
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [revert]);

  const select = (schemeId: string) => {
    document.documentElement.setAttribute('data-theme', schemeId);
    saveConfig({ ...config, theme: schemeId });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      revert();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setUsingKeyboard(true);
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setUsingKeyboard(true);
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      select(filtered[selectedIdx].id);
    }
  };

  return (
    <div className="scheme-switcher-overlay" onClick={revert}>
      <div
        className={`quick-switcher scheme-switcher-panel${usingKeyboard ? ' keyboard-nav' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          className="quick-switcher-input"
          type="text"
          placeholder="Switch color scheme..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="quick-switcher-results" ref={resultsRef}>
          {filtered.map((scheme, i) => (
            <button
              key={scheme.id}
              className={`quick-switcher-item scheme-switcher-item ${i === selectedIdx ? 'selected' : ''}`}
              onClick={() => select(scheme.id)}
            >
              <span className="scheme-switcher-colors">
                <span style={{ background: scheme.bg }} />
                <span style={{ background: scheme.accent }} />
                <span style={{ background: scheme.text }} />
              </span>
              <span>{scheme.name}</span>
              {scheme.id === originalTheme.current && (
                <span className="scheme-switcher-current">current</span>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="quick-switcher-empty">No schemes found</div>
          )}
        </div>
      </div>
    </div>
  );
}
