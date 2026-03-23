/**
 * Centralized hotkey registry for Sidebar Notes.
 *
 * Every keyboard shortcut in the app is defined here. The `matches()` helper
 * enforces exact modifier matching so Cmd+N never accidentally fires Cmd+Shift+N.
 * `formatHotkey()` produces the Unicode display string (⌘N, ⇧⌘P, etc.) used in
 * tooltips, context menus, and the help overlay.
 */

export interface HotkeyDef {
  key: string;            // KeyboardEvent.key value, case-insensitive match
  meta?: boolean;         // Cmd (Mac) / Ctrl (Win) required — default true
  shift?: boolean;        // Shift required — default false
  alt?: boolean;          // Alt/Option required — default false
  scope: 'global' | 'editor' | 'list';
  label: string;          // Human-readable action name
  group: 'Navigation' | 'Editor' | 'Notes' | 'App';
}

// ─── Default mappings ────────────────────────────────────────────────────────

export const DEFAULT_HOTKEYS: Record<string, HotkeyDef> = {
  // Navigation
  'back':              { key: '[',         scope: 'global',  label: 'Back to list',       group: 'Navigation' },
  'quick-switcher':    { key: 'p',         scope: 'global',  label: 'Quick switcher',     group: 'Navigation' },
  'search':            { key: 'f',         scope: 'list',    label: 'Search notes',       group: 'Navigation' },
  'undo-close':        { key: 'z',         scope: 'list',    label: 'Undo close',         group: 'Navigation' },

  // Notes
  'new-note':          { key: 'n',         scope: 'global',  label: 'New note',           group: 'Notes' },
  'duplicate-note':    { key: 'd',         scope: 'editor',  label: 'Duplicate note',     group: 'Notes' },
  'delete-note':       { key: 'Backspace', scope: 'editor',  label: 'Delete note',        group: 'Notes' },
  'rename-note':       { key: 'r',         scope: 'editor',  label: 'Rename note',        group: 'Notes' },

  // Editor
  'toggle-bold':       { key: 'b',         scope: 'editor',  label: 'Bold',               group: 'Editor', meta: true },
  'toggle-italic':     { key: 'i',         scope: 'editor',  label: 'Italic',             group: 'Editor', meta: true },
  'toggle-checkbox':   { key: 'Enter',     scope: 'editor',  label: 'Toggle checkbox',    group: 'Editor', meta: true },
  'move-line-up':      { key: 'ArrowUp',   scope: 'editor',  label: 'Move line up',       group: 'Editor', meta: false, alt: true },
  'move-line-down':    { key: 'ArrowDown', scope: 'editor',  label: 'Move line down',     group: 'Editor', meta: false, alt: true },
  'cycle-note-up':     { key: 'ArrowUp',   scope: 'editor',  label: 'Previous note',      group: 'Editor', alt: true },
  'cycle-note-down':   { key: 'ArrowDown', scope: 'editor',  label: 'Next note',          group: 'Editor', alt: true },
  'font-increase':     { key: '=',         scope: 'editor',  label: 'Increase font',      group: 'Editor' },
  'font-decrease':     { key: '-',         scope: 'editor',  label: 'Decrease font',      group: 'Editor' },
  'font-reset':        { key: '0',         scope: 'editor',  label: 'Reset font size',    group: 'Editor' },
  'toggle-preview':    { key: 'p',         scope: 'editor',  label: 'Toggle preview',     group: 'Editor', alt: true },
  'lint-note':         { key: 'l',         scope: 'editor',  label: 'Lint note',          group: 'Editor' },
  'hide-completed':    { key: 'h', shift: true, scope: 'editor', label: 'Hide completed', group: 'Editor' },

  // App
  'toggle-pin':        { key: 'p', shift: true, scope: 'global',  label: 'Toggle pin',         group: 'App' },
  'settings':          { key: ',',         scope: 'global',  label: 'Settings',           group: 'App' },
  'help':              { key: '/',         scope: 'global',  label: 'Help',               group: 'App' },
  'hide-panel':        { key: 'w',         scope: 'global',  label: 'Hide panel',         group: 'App' },
  'scheme-switcher':   { key: 'k',         scope: 'global',  label: 'Color scheme',       group: 'App' },
  'focus-mode':        { key: 'f', shift: true, scope: 'editor', label: 'Focus mode',     group: 'App' },
  'open-in-obsidian':  { key: 'o', shift: true, scope: 'editor', label: 'Open in Obsidian', group: 'App' },
  'debug-drawer':      { key: 'd', shift: true, scope: 'global', label: 'Debug drawer',   group: 'App' },
};

// Fill in defaults: meta=true unless explicitly set
for (const def of Object.values(DEFAULT_HOTKEYS)) {
  if (def.meta === undefined) def.meta = true;
  if (def.shift === undefined) def.shift = false;
  if (def.alt === undefined) def.alt = false;
}

// ─── Runtime helpers ─────────────────────────────────────────────────────────

export type HotkeyOverrides = Record<string, Partial<Pick<HotkeyDef, 'key' | 'meta' | 'shift' | 'alt'>>>;

/** Merge user overrides on top of defaults. */
export function getMergedHotkeys(overrides?: HotkeyOverrides): Record<string, HotkeyDef> {
  if (!overrides) return DEFAULT_HOTKEYS;
  const merged = { ...DEFAULT_HOTKEYS };
  for (const [id, patch] of Object.entries(overrides)) {
    if (merged[id]) {
      merged[id] = { ...merged[id], ...patch };
    }
  }
  return merged;
}

/** Check if a KeyboardEvent matches a HotkeyDef (exact modifier matching). */
export function matches(e: KeyboardEvent, def: HotkeyDef): boolean {
  const wantMeta = def.meta ?? true;
  const wantShift = def.shift ?? false;
  const wantAlt = def.alt ?? false;

  if (wantMeta !== (e.metaKey || e.ctrlKey)) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;

  return e.key.toLowerCase() === def.key.toLowerCase();
}

/** Format a HotkeyDef as a display string: ⇧⌘P, ⌥↑, etc. */
export function formatHotkey(def: HotkeyDef): string {
  const parts: string[] = [];
  if (def.alt)   parts.push('⌥');
  if (def.shift) parts.push('⇧');
  if (def.meta)  parts.push('⌘');

  // Pretty-print special keys
  const keyMap: Record<string, string> = {
    'arrowup': '↑', 'arrowdown': '↓', 'arrowleft': '←', 'arrowright': '→',
    'backspace': '⌫', 'enter': '↩', 'escape': 'Esc', 'tab': 'Tab',
    ' ': 'Space', ',': ',', '.': '.', '/': '/', '[': '[', ']': ']',
    '-': '-', '=': '+',
  };
  const display = keyMap[def.key.toLowerCase()] ?? def.key.toUpperCase();
  parts.push(display);

  return parts.join('');
}

/** Get hotkey def by action ID, with overrides applied. */
export function getHotkey(id: string, overrides?: HotkeyOverrides): HotkeyDef {
  const merged = getMergedHotkeys(overrides);
  return merged[id] ?? DEFAULT_HOTKEYS[id];
}

/** Detect conflicts: two actions with the same key combo + overlapping scope. */
export function findConflicts(hotkeys: Record<string, HotkeyDef>): Array<[string, string]> {
  const conflicts: Array<[string, string]> = [];
  const entries = Object.entries(hotkeys);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, a] = entries[i];
      const [idB, b] = entries[j];
      if (
        a.key.toLowerCase() === b.key.toLowerCase() &&
        a.meta === b.meta && a.shift === b.shift && a.alt === b.alt &&
        (a.scope === b.scope || a.scope === 'global' || b.scope === 'global')
      ) {
        conflicts.push([idA, idB]);
      }
    }
  }
  return conflicts;
}
