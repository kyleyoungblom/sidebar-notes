import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useNotes } from '../hooks/useNotes';
import { IconSort } from './Icons';
import { NOTE_SORT_LABELS, type NoteSort } from '../types';

const ORDER: NoteSort[] = ['modified_desc', 'modified_asc', 'title_asc', 'title_desc'];

/** Compact icon-button + dropdown for note-list sort mode. */
export function SortMenu() {
  const config = useStore((s) => s.config);
  const { saveConfig } = useNotes();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current: NoteSort = (config.note_sort as NoteSort) ?? 'modified_desc';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const pick = (mode: NoteSort) => {
    setOpen(false);
    if (mode === current) return;
    saveConfig({ ...config, note_sort: mode }).catch(() => {});
  };

  return (
    <div className="sort-menu" ref={ref}>
      <button
        className="btn-icon"
        onClick={() => setOpen((v) => !v)}
        title="Sort notes"
      >
        <IconSort size={16} />
      </button>
      {open && (
        <div className="sort-menu-dropdown" role="menu">
          {ORDER.map((mode) => (
            <button
              key={mode}
              className={`sort-menu-item${mode === current ? ' sort-menu-item--active' : ''}`}
              onClick={() => pick(mode)}
              role="menuitem"
            >
              <span>{NOTE_SORT_LABELS[mode]}</span>
              {mode === current && <span className="sort-menu-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
