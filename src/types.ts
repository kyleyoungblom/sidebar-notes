export interface Note {
  path: string;
  title: string;
  modified: number; // unix seconds
  preview: string;
}

export interface AppConfig {
  notes_dir: string;
  hotkey: string;
  theme: 'dark' | 'light';
}

export type View = 'list' | 'editor' | 'settings';
export type SaveState = 'saved' | 'saving' | 'error';
