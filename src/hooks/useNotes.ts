import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import { useStore } from '../store';
import type { Note, AppConfig } from '../types';

export function useNotes() {
  const { config, setNotes, setLoading, setActiveNote, setView, setSaveState } =
    useStore();

  const loadNotes = useCallback(async () => {
    if (!config.notes_dir) return;
    setLoading(true);
    try {
      const notes = await invoke<Note[]>('list_notes', {
        notesDir: config.notes_dir,
      });
      setNotes(notes);
    } catch (e) {
      console.error('Failed to load notes:', e);
    } finally {
      setLoading(false);
    }
  }, [config.notes_dir, setNotes, setLoading]);

  const openNote = useCallback(
    async (path: string) => {
      try {
        const content = await invoke<string>('read_note', { path });
        setActiveNote(path, content);
        setView('editor');
      } catch (e) {
        console.error('Failed to read note:', e);
      }
    },
    [setActiveNote, setView]
  );

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
        // Refresh the title/preview in the list
        await loadNotes();
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

  return { loadNotes, openNote, createNote, deleteNote, saveNote, loadConfig, saveConfig };
}
