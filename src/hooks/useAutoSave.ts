import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useNotes } from './useNotes';

const DEBOUNCE_MS = 800;

export function useAutoSave(path: string | null, content: string) {
  const { saveNote } = useNotes();
  const activeNoteColor = useStore((s) => s.activeNoteColor);
  const prevColorRef = useRef(activeNoteColor);

  // Always track the latest content for this note via ref.
  // CRITICAL: Do NOT read from useStore.getState().activeNoteContent in cleanup —
  // openNote() is async and may have already overwritten it with the NEW note's content.
  const contentRef = useRef(content);
  contentRef.current = content;

  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!path) return;

    const { contentDirty } = useStore.getState();
    if (!contentDirty) return;
    dirtyRef.current = true;

    const capturedPath = path;
    const timer = setTimeout(() => {
      saveNote(capturedPath, contentRef.current);
      useStore.getState().setContentDirty(false);
      dirtyRef.current = false;
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      // Flush on cleanup (note switch): use contentRef which holds the
      // last content rendered for THIS note, not the store (which may
      // already contain the new note's content due to async openNote)
      if (dirtyRef.current) {
        saveNote(capturedPath, contentRef.current);
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
