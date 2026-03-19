import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import { useStore } from '../store';
import type { Note, AppConfig } from '../types';

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

      // Check if the active note was modified externally before updating store
      const activeId = useStore.getState().activeNoteId;
      if (activeId) {
        const prev = useStore.getState().notes.find((n) => n.path === activeId);
        const next = fresh.find((n) => n.path === activeId);
        if (prev && next && next.modified > prev.modified) {
          setActiveNoteStale(true);
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
        const content = await invoke<string>('read_note', { path });
        setActiveNote(path, content);
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
      const content = await invoke<string>('read_note', { path });
      setActiveNoteContent(content);
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

  const saveNote = useCallback(
    async (path: string, content: string) => {
      setSaveState('saving');
      try {
        await invoke('write_note', { path, content });
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
    saveNote,
    loadConfig,
    saveConfig,
  };
}
