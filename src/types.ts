export const NOTE_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface Note {
  path: string;
  title: string;
  modified: number; // unix seconds
  preview: string;
  /** Path of the canonical note this file conflicts with, if any */
  conflict_of: string | null;
  /** Pop color identity for visual distinction */
  color: string | null;
}

export interface AppConfig {
  notes_dir: string;
  hotkey: string;
  theme: string;
  panel_position: 'left' | 'center' | 'right';
  window_width: number;
  sort_completed: boolean;
  hide_completed_full: boolean;
  /** 'dim' = nearly transparent, 'hide' = display:none for collapsed divider content */
  collapse_mode?: 'dim' | 'hide';
  /** 0 = follow cursor, 1/2/3… = fixed monitor (1-based, sorted left→right) */
  preferred_monitor: number;
  /** Automatically switch theme dark/light variant to match system appearance */
  match_system_theme?: boolean;
  /** User-customized hotkey overrides (action ID → partial key combo). */
  hotkey_overrides?: Record<string, { key?: string; meta?: boolean; shift?: boolean; alt?: boolean }>;
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
