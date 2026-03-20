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
  theme: string;
  panel_position: 'left' | 'center' | 'right';
  window_width: number;
  sort_completed: boolean;
  hide_completed_full: boolean;
  /** 0 = follow cursor, 1/2/3… = fixed monitor (1-based, sorted left→right) */
  preferred_monitor: number;
}

export interface MonitorInfo {
  index: number;
  name: string;
  primary: boolean;
  width: number;
  height: number;
}

export type View = 'list' | 'editor' | 'settings';
export type SaveState = 'saved' | 'saving' | 'error';
