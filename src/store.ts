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
  activeNoteStale: boolean;
  pinned: boolean;
  lastClosedNoteId: string | null;
  isNewNote: boolean;
  lastSaveTs: number;
  contentDirty: boolean;
  activeNoteColor: string | null;
  debugDrawerOpen: boolean;
  errorMessage: string | null;

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
  setActiveNoteStale: (v: boolean) => void;
  setPinned: (v: boolean) => void;
  setLastClosedNoteId: (id: string | null) => void;
  setIsNewNote: (v: boolean) => void;
  setLastSaveTs: (ts: number) => void;
  setContentDirty: (v: boolean) => void;
  setActiveNoteColor: (color: string | null) => void;
  setDebugDrawerOpen: (v: boolean) => void;
  setErrorMessage: (msg: string | null) => void;
  flashError: (msg: string) => void;
}

export const useStore = create<Store>((set) => ({
  view: 'list',
  searchQuery: '',
  notes: [],
  activeNoteId: null,
  activeNoteContent: '',
  saveState: 'saved',
  isLoading: false,
  activeNoteStale: false,
  pinned: false,
  lastClosedNoteId: null,
  isNewNote: false,
  lastSaveTs: 0,
  contentDirty: false,
  activeNoteColor: null,
  debugDrawerOpen: false,
  errorMessage: null,
  config: {
    notes_dir: '',
    hotkey: 'alt+.',
    theme: 'dark',
    panel_position: 'right',
    window_width: 380,
    sort_completed: true,
    hide_completed_full: false,
    preferred_monitor: 0,
  },

  setView: (view) => set({ view }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setNotes: (notes) => set({ notes }),
  setActiveNote: (id, content = '') => {
    if (id) localStorage.setItem('lastNoteId', id);
    else localStorage.removeItem('lastNoteId');
    set({ activeNoteId: id, activeNoteContent: content, contentDirty: false });
  },
  setActiveNoteContent: (activeNoteContent) => set({ activeNoteContent }),
  setSaveState: (saveState) => set({ saveState }),
  setLoading: (isLoading) => set({ isLoading }),
  setConfig: (config) => set({ config }),
  setActiveNoteStale: (activeNoteStale) => set({ activeNoteStale }),
  setPinned: (pinned) => set({ pinned }),
  setLastClosedNoteId: (lastClosedNoteId) => set({ lastClosedNoteId }),
  setIsNewNote: (isNewNote) => set({ isNewNote }),
  setLastSaveTs: (lastSaveTs) => set({ lastSaveTs }),
  setContentDirty: (contentDirty) => set({ contentDirty }),
  setActiveNoteColor: (activeNoteColor) => set({ activeNoteColor }),
  setDebugDrawerOpen: (debugDrawerOpen) => set({ debugDrawerOpen }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  flashError: (msg) => {
    set({ errorMessage: msg });
    setTimeout(() => set({ errorMessage: null }), 4000);
  },
}));
