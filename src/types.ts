export interface Note {
  path: string;
  title: string;
  modified: number; // unix seconds
  preview: string;
  /** Path of the canonical note this file conflicts with, if any */
  conflict_of: string | null;
}

export interface AppConfig {
  notes_dir: string;
  hotkey: string;
  theme: 'dark' | 'light';
  panel_position: 'left' | 'center' | 'right';
  window_width: number;
  sort_completed: boolean;
  hide_completed_full: boolean;
}

export type View = 'list' | 'editor' | 'settings';
export type SaveState = 'saved' | 'saving' | 'error';
