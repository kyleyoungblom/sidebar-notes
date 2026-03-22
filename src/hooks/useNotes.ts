import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import { useStore } from '../store';
import type { Note, AppConfig } from '../types';
import { stripFrontmatter, parseFrontmatterColor, setFrontmatterColor } from '../utils';

export function useNotes() {
  const {
    config,
    setNotes,
    setLoading,
    setActiveNote,
    setActiveNoteContent,
    setView,
    setSaveState,
    setActiveNoteStale,
  } = useStore();

  const loadNotes = useCallback(async () => {
    if (!config.notes_dir) return;
    setLoading(true);
    try {
      const fresh = await invoke<Note[]>('list_notes', {
        notesDir: config.notes_dir,
      });

      // Auto-reload active note if modified externally.
      // Skip if we saved within the last 2s (our own save bumps modified time too).
      const { activeNoteId: activeId, lastSaveTs } = useStore.getState();
      const recentlySaved = Date.now() - lastSaveTs < 2000;
      if (activeId && !recentlySaved) {
        const prev = useStore.getState().notes.find((n) => n.path === activeId);
        const next = fresh.find((n) => n.path === activeId);
        if (prev && next && next.modified > prev.modified) {
          // Silently reload the note content
          try {
            const raw = await invoke<string>('read_note', { path: activeId });
            const color = parseFrontmatterColor(raw);
            const clean = stripFrontmatter(raw);
            useStore.getState().setActiveNoteColor(color);
            setActiveNoteContent(clean);
          } catch (_) { /* ignore */ }
        }
      }

      setNotes(fresh);
    } catch (e) {
      console.error('Failed to load notes:', e);
    } finally {
      setLoading(false);
    }
  }, [config.notes_dir, setNotes, setLoading, setActiveNoteStale]);

  const openNote = useCallback(
    async (path: string) => {
      try {
        const raw = await invoke<string>('read_note', { path });
        const color = parseFrontmatterColor(raw);
        const clean = stripFrontmatter(raw);
        useStore.getState().setActiveNoteColor(color);
        setActiveNote(path, clean);
        setActiveNoteStale(false);
        setView('editor');
      } catch (e) {
        console.error('Failed to read note:', e);
      }
    },
    [setActiveNote, setActiveNoteStale, setView]
  );

  const reloadActiveNote = useCallback(async () => {
    const path = useStore.getState().activeNoteId;
    if (!path) return;
    try {
      const raw = await invoke<string>('read_note', { path });
      const color = parseFrontmatterColor(raw);
      const clean = stripFrontmatter(raw);
      useStore.getState().setActiveNoteColor(color);
      setActiveNoteContent(clean);
      setActiveNoteStale(false);
    } catch (e) {
      console.error('Failed to reload note:', e);
    }
  }, [setActiveNoteContent, setActiveNoteStale]);

  const createNote = useCallback(async () => {
    if (!config.notes_dir) return;
    try {
      const path = await invoke<string>('new_note', {
        notesDir: config.notes_dir,
      });
      await loadNotes();
      await openNote(path);
      useStore.getState().setIsNewNote(true);
    } catch (e) {
      console.error('Failed to create note:', e);
    }
  }, [config.notes_dir, loadNotes, openNote]);

  const deleteNote = useCallback(
    async (path: string) => {
      try {
        await invoke('delete_note', { path });
        setActiveNote(null);
        setView('list');
        await loadNotes();
      } catch (e) {
        console.error('Failed to delete note:', e);
      }
    },
    [setActiveNote, setView, loadNotes]
  );

  const duplicateNote = useCallback(
    async (path: string) => {
      try {
        const newPath = await invoke<string>('duplicate_note', { path });
        await loadNotes();
        await openNote(newPath);
      } catch (e) {
        console.error('Failed to duplicate note:', e);
      }
    },
    [loadNotes, openNote]
  );

  const saveNote = useCallback(
    async (path: string, content: string) => {
      setSaveState('saving');
      try {
        const color = useStore.getState().activeNoteColor;
        const full = setFrontmatterColor(content, color);
        await invoke('write_note', { path, content: full });
        useStore.getState().setLastSaveTs(Date.now());
        setSaveState('saved');
        await loadNotes();
        // Our own save triggers a modified-time bump; don't flag it as external
        setActiveNoteStale(false);
      } catch (e) {
        console.error('Failed to save note:', e);
        setSaveState('error');
      }
    },
    [setSaveState, loadNotes]
  );

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await invoke<AppConfig>('get_config');
      useStore.getState().setConfig(cfg);
      return cfg;
    } catch (e) {
      console.error('Failed to load config:', e);
      return null;
    }
  }, []);

  const saveConfig = useCallback(async (cfg: AppConfig) => {
    try {
      await invoke('set_config', { config: cfg });
      useStore.getState().setConfig(cfg);
    } catch (e) {
      console.error('Failed to save config:', e);
      throw e;
    }
  }, []);

  return {
    loadNotes,
    openNote,
    reloadActiveNote,
    createNote,
    deleteNote,
    duplicateNote,
    saveNote,
    loadConfig,
    saveConfig,
  };
}
