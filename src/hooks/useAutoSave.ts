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

  // Track the current path via ref (also updated in render body, before cleanup).
  // Used in cleanup to detect whether the user switched notes.
  const activePathRef = useRef(path);
  activePathRef.current = path;

  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!path) return;

    const capturedPath = path;
    // Capture content in the closure at effect-registration time.
    // This is what cleanup must use — `content` here is the value from
    // the last render that triggered this effect, i.e. the correct content
    // for this note. contentRef.current would be wrong because the render
    // body updates it before cleanup runs.
    const capturedContent = content;

    const { contentDirty } = useStore.getState();
    if (contentDirty) {
      dirtyRef.current = true;
    }

    // Only arm the debounce timer when content is dirty (avoids spurious
    // writes on note load). The timer uses contentRef.current to capture
    // the most recent content at the moment it fires.
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (contentDirty) {
      timer = setTimeout(() => {
        saveNote(capturedPath, contentRef.current);
        useStore.getState().setContentDirty(false);
        dirtyRef.current = false;
      }, DEBOUNCE_MS);
    }

    return () => {
      if (timer !== null) clearTimeout(timer);

      // activePathRef.current is updated in the render body before this
      // cleanup runs. A mismatch means the user just switched notes.
      const switching = activePathRef.current !== capturedPath;

      if (dirtyRef.current) {
        // Save using capturedContent (closure snapshot from effect registration
        // time) — NOT contentRef.current, which the render body has already
        // updated to the new note's content before this cleanup runs.
        saveNote(capturedPath, capturedContent);
        dirtyRef.current = false;
        if (switching) {
          useStore.getState().setContentDirty(false);
        }
        // When not switching (same-note content change), intentionally do NOT
        // reset contentDirty — the onChange handler already set it true for the
        // new keystroke, and the next effect needs to see it to arm a fresh
        // debounce timer.
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
