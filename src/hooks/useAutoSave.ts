import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useNotes } from './useNotes';

const DEBOUNCE_MS = 800;

export function useAutoSave(path: string | null, content: string) {
  const { saveNote } = useNotes();
  const activeNoteColor = useStore((s) => s.activeNoteColor);
  const prevColorRef = useRef(activeNoteColor);

  // Debounced save for content changes
  useEffect(() => {
    if (!path) return;

    const { contentDirty } = useStore.getState();
    if (!contentDirty) return;

    const timer = setTimeout(() => {
      saveNote(path, content);
      useStore.getState().setContentDirty(false);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [content]);

  // Immediate save for color changes (no debounce — metadata only)
  useEffect(() => {
    if (!path) return;
    if (activeNoteColor === prevColorRef.current) return;
    prevColorRef.current = activeNoteColor;

    saveNote(path, content);
    useStore.getState().setContentDirty(false);
  }, [activeNoteColor]);
}
