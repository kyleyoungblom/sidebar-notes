import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useNotes } from './useNotes';

const DEBOUNCE_MS = 800;

export function useAutoSave(path: string | null, content: string) {
  const { saveNote } = useNotes();
  const activeNoteColor = useStore((s) => s.activeNoteColor);
  const prevColorRef = useRef(activeNoteColor);

  // Track latest content via ref for the debounce timer (which fires 800ms later
  // and needs the most recent value). DO NOT use this ref in cleanup — by the
  // time cleanup runs, the render has already updated contentRef.current to the
  // NEW note's content, causing cross-note overwrites.
  const contentRef = useRef(content);
  contentRef.current = content;

  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!path) return;

    const { contentDirty } = useStore.getState();
    if (!contentDirty) return;
    dirtyRef.current = true;

    const capturedPath = path;
    // Capture content in the closure at effect-registration time.
    // This is what the cleanup must use — `content` here is the value from
    // the last render that triggered this effect, i.e. the correct old note
    // content. contentRef.current would be wrong because the render body
    // updates it before cleanup runs.
    const capturedContent = content;
    const timer = setTimeout(() => {
      // Timer fires 800ms later: use ref to get the most recent typed content.
      saveNote(capturedPath, contentRef.current);
      useStore.getState().setContentDirty(false);
      dirtyRef.current = false;
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      if (dirtyRef.current) {
        // Use capturedContent (closure), NOT contentRef.current (would be new note's content).
        saveNote(capturedPath, capturedContent);
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
