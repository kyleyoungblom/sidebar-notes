import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useNotes } from './useNotes';

const DEBOUNCE_MS = 800;

export function useAutoSave(path: string | null, content: string) {
  const { saveNote } = useNotes();
  const activeNoteColor = useStore((s) => s.activeNoteColor);
  const prevColorRef = useRef(activeNoteColor);

  // Debounced save for content changes.
  // When path changes (note switch), flush immediately instead of discarding.
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!path) return;

    const { contentDirty } = useStore.getState();
    if (!contentDirty) return;
    dirtyRef.current = true;

    const capturedPath = path;
    const capturedContent = content;
    const timer = setTimeout(() => {
      saveNote(capturedPath, capturedContent);
      useStore.getState().setContentDirty(false);
      dirtyRef.current = false;
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      // Flush: if we're cleaning up because path changed (note switch),
      // save immediately with the LATEST content from the store
      // (capturedContent may be stale by 1 keystroke)
      if (dirtyRef.current) {
        const latest = useStore.getState().activeNoteContent;
        saveNote(capturedPath, latest);
        useStore.getState().setContentDirty(false);
        dirtyRef.current = false;
      }
    };
  }, [content, path]);

  // Immediate save for color changes (no debounce — metadata only)
  useEffect(() => {
    if (!path) return;
    if (activeNoteColor === prevColorRef.current) return;
    prevColorRef.current = activeNoteColor;

    const currentContent = useStore.getState().activeNoteContent;
    saveNote(path, currentContent);
    useStore.getState().setContentDirty(false);
  }, [activeNoteColor, path]);
}
