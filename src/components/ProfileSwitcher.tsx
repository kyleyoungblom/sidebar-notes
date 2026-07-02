import { useEffect, useRef, useState } from 'react';
import { useStore, selectActiveProfile } from '../store';
import { useNotes } from '../hooks/useNotes';
import { IconFolder } from './Icons';

/**
 * Clickable app title showing the current profile name. Click → dropdown of
 * all profiles, plus a "Manage…" link that jumps to Settings.
 * Rendered inside the app header, replacing the static "Notes" label.
 */
export function ProfileSwitcher() {
  const config = useStore((s) => s.config);
  const activeProfile = useStore((s) => selectActiveProfile(s.config));
  const setView = useStore((s) => s.setView);
  const { saveConfig } = useNotes();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!activeProfile) return null;

  const switchTo = (id: string) => {
    setOpen(false);
    if (id === config.active_profile_id) return;
    saveConfig({ ...config, active_profile_id: id }).catch(() => {});
  };

  return (
    <div className="profile-switcher" ref={ref}>
      <button
        className="profile-switcher-title"
        onClick={() => setOpen((v) => !v)}
        title="Switch profile"
      >
        <IconFolder size={14} />
        <span className="profile-switcher-name">{activeProfile.name}</span>
      </button>
      {open && (
        <div className="profile-switcher-menu" role="menu">
          {config.profiles.map((p) => (
            <button
              key={p.id}
              className={`profile-switcher-item${p.id === config.active_profile_id ? ' profile-switcher-item--active' : ''}`}
              onClick={() => switchTo(p.id)}
              role="menuitem"
            >
              <span>{p.name}</span>
              {p.id === config.active_profile_id && <span className="profile-switcher-check">✓</span>}
            </button>
          ))}
          <div className="profile-switcher-separator" />
          <button
            className="profile-switcher-item profile-switcher-item--manage"
            onClick={() => { setOpen(false); setView('settings'); }}
            role="menuitem"
          >
            Manage profiles…
          </button>
        </div>
      )}
    </div>
  );
}
