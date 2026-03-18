import { useEffect, useRef } from 'react';
import { useNotes } from './useNotes';

const DEBOUNCE_MS = 800;

export function useAutoSave(path: string | null, content: string) {
  const { saveNote } = useNotes();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip the initial mount (don't save immediately on open)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!path) return;

    const timer = setTimeout(() => {
      saveNote(path, content);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [content]); // intentionally only depends on content
}
