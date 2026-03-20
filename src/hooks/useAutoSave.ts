import { useEffect } from 'react';
import { useStore } from '../store';
import { useNotes } from './useNotes';

const DEBOUNCE_MS = 800;

export function useAutoSave(path: string | null, content: string) {
  const { saveNote } = useNotes();

  useEffect(() => {
    if (!path) return;

    // Only save if the content was changed by the user (not by external reload
    // or note switching). This prevents SBN from writing files back to disk
    // when it detects an external edit, which would cause sync conflicts with
    // editors like Obsidian.
    const { contentDirty } = useStore.getState();
    if (!contentDirty) return;

    const timer = setTimeout(() => {
      saveNote(path, content);
      useStore.getState().setContentDirty(false);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [content]); // intentionally only depends on content
}
