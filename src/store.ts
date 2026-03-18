import { create } from 'zustand';
import type { Note, AppConfig, View, SaveState } from './types';

interface Store {
  // UI state
  view: View;
  searchQuery: string;

  // Notes
  notes: Note[];
  activeNoteId: string | null;
  activeNoteContent: string;

  // Status
  saveState: SaveState;
  isLoading: boolean;

  // Config
  config: AppConfig;

  // Actions
  setView: (view: View) => void;
  setSearchQuery: (q: string) => void;
  setNotes: (notes: Note[]) => void;
  setActiveNote: (id: string | null, content?: string) => void;
  setActiveNoteContent: (content: string) => void;
  setSaveState: (s: SaveState) => void;
  setLoading: (v: boolean) => void;
  setConfig: (c: AppConfig) => void;
}

export const useStore = create<Store>((set) => ({
  view: 'list',
  searchQuery: '',
  notes: [],
  activeNoteId: null,
  activeNoteContent: '',
  saveState: 'saved',
  isLoading: false,
  config: {
    notes_dir: '',
    hotkey: 'ctrl+shift+space',
    theme: 'dark',
  },

  setView: (view) => set({ view }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setNotes: (notes) => set({ notes }),
  setActiveNote: (id, content = '') =>
    set({ activeNoteId: id, activeNoteContent: content }),
  setActiveNoteContent: (activeNoteContent) => set({ activeNoteContent }),
  setSaveState: (saveState) => set({ saveState }),
  setLoading: (isLoading) => set({ isLoading }),
  setConfig: (config) => set({ config }),
}));
