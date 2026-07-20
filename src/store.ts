import { create } from 'zustand';
import type { Note, AppConfig, Profile, View, SaveState } from './types';

/** localStorage key for per-profile last-opened-note. Keyed by profile id. */
const LAST_NOTE_KEY = 'lastNoteIdByProfile';

export function getLastNoteForProfile(profileId: string): string | null {
  try {
    const raw = localStorage.getItem(LAST_NOTE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[profileId] ?? null;
  } catch {
    return null;
  }
}

export function setLastNoteForProfile(profileId: string, noteId: string | null) {
  try {
    const raw = localStorage.getItem(LAST_NOTE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    if (noteId) map[profileId] = noteId;
    else delete map[profileId];
    localStorage.setItem(LAST_NOTE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

/** Pick the active profile out of config — returns null if none defined yet. */
export function selectActiveProfile(config: AppConfig): Profile | null {
  return config.profiles?.find((p) => p.id === config.active_profile_id) ?? config.profiles?.[0] ?? null;
}

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
  focusMode: boolean;

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
  setFocusMode: (v: boolean) => void;
  setErrorMessage: (msg: string | null) => void;
  flashError: (msg: string) => void;

  // Profiles
  setActiveProfileId: (id: string) => void;
  addProfile: (p: Profile) => void;
  updateProfile: (id: string, patch: Partial<Omit<Profile, 'id'>>) => void;
  removeProfile: (id: string) => void;
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
  focusMode: false,
  config: {
    profiles: [],
    active_profile_id: '',
    hotkey: 'alt+.',
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
    const profileId = useStore.getState().config.active_profile_id;
    if (profileId) setLastNoteForProfile(profileId, id);
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
  setFocusMode: (focusMode) => set({ focusMode }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  flashError: (msg) => {
    set({ errorMessage: msg });
    setTimeout(() => set({ errorMessage: null }), 4000);
  },

  setActiveProfileId: (id) =>
    set((s) => ({ config: { ...s.config, active_profile_id: id } })),

  addProfile: (p) =>
    set((s) => ({ config: { ...s.config, profiles: [...s.config.profiles, p] } })),

  updateProfile: (id, patch) =>
    set((s) => ({
      config: {
        ...s.config,
        profiles: s.config.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      },
    })),

  removeProfile: (id) =>
    set((s) => {
      // Disallow removing the last profile — the UI should guard against this,
      // but defend in depth.
      if (s.config.profiles.length <= 1) return s;
      const next = s.config.profiles.filter((p) => p.id !== id);
      const nextActive =
        s.config.active_profile_id === id ? next[0].id : s.config.active_profile_id;
      return {
        config: { ...s.config, profiles: next, active_profile_id: nextActive },
      };
    }),
}));
