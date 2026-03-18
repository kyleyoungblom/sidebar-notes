import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { useNotes } from '../hooks/useNotes';
import type { AppConfig } from '../types';

// Maps KeyboardEvent.code to Tauri shortcut key name
function codeToKey(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('F') && /^F\d+$/.test(code)) return code.toLowerCase();
  const map: Record<string, string> = {
    Space: 'space', Enter: 'enter', Escape: 'escape',
    Backspace: 'backspace', Tab: 'tab', Delete: 'delete',
    Insert: 'insert', Home: 'home', End: 'end',
    PageUp: 'pageup', PageDown: 'pagedown',
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Backquote: '`', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  };
  return map[code] ?? null;
}

function HotkeyCapture({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (capturing) ref.current?.focus();
  }, [capturing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const MODIFIER_CODES = ['ControlLeft','ControlRight','AltLeft','AltRight','ShiftLeft','ShiftRight','MetaLeft','MetaRight'];
    if (MODIFIER_CODES.includes(e.code)) return;

    const mods: string[] = [];
    if (e.ctrlKey) mods.push('ctrl');
    if (e.altKey) mods.push('alt');
    if (e.shiftKey) mods.push('shift');
    if (e.metaKey) mods.push('meta');

    // Require at least one modifier for a global shortcut
    if (mods.length === 0) return;

    const key = codeToKey(e.code);
    if (!key) return;

    onChange([...mods, key].join('+'));
    setCapturing(false);
  };

  return (
    <div
      ref={ref}
      className={`hotkey-capture ${capturing ? 'hotkey-capture--active' : ''}`}
      tabIndex={0}
      onClick={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      onKeyDown={capturing ? handleKeyDown : undefined}
    >
      {capturing
        ? <span className="hotkey-capture-hint">Press key combination…</span>
        : <span className="hotkey-capture-value">{value || 'Click to set'}</span>
      }
    </div>
  );
}

function syncHint(dir: string): string {
  const d = dir.toLowerCase().replace(/\\/g, '/');
  if (d.includes('dropbox')) return '✓ Dropbox syncs automatically in the background. Conflict files will be detected by Sidebar Notes.';
  if (d.includes('onedrive')) return '✓ OneDrive syncs automatically. Conflict files may appear as "(1)" copies.';
  if (d.includes('icloud') || d.includes('mobile documents')) return '✓ iCloud Drive syncs automatically. Note: iCloud uses last-write-wins — no conflict files are created.';
  if (d.includes('syncthing')) return '✓ Syncthing handles sync and conflict detection. Conflict files will be surfaced by Sidebar Notes.';
  if (d.includes('obsidian') || d.includes('vault')) return 'Obsidian vault detected. Obsidian Sync runs while Obsidian is open. For background sync, also point this folder to Dropbox or Syncthing.';
  return 'Point your notes folder inside a Dropbox, iCloud, or Syncthing directory for automatic background sync.';
}

export function Settings() {
  const { config, setView } = useStore();
  const { saveConfig, loadNotes } = useNotes();

  const [draft, setDraft] = useState<AppConfig>({ ...config });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await saveConfig(draft);
      await loadNotes();
      setView('list');
    } catch (e: any) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const openFolder = async () => {
    await invoke('show_in_folder', { path: draft.notes_dir });
  };

  return (
    <div className="settings-view">
      <div className="settings-header">
        <button className="btn-icon" onClick={() => setView('list')}>←</button>
        <span className="settings-title">Settings</span>
      </div>

      <div className="settings-body">
        <label className="setting-row">
          <span className="setting-label">Notes Folder</span>
          <div className="setting-dir-row">
            <input
              type="text"
              value={draft.notes_dir}
              onChange={(e) =>
                setDraft((d) => ({ ...d, notes_dir: e.target.value }))
              }
              className="setting-input"
              placeholder="e.g. C:\Dropbox\Notes"
            />
            <button className="btn-small" onClick={openFolder} title="Open folder">
              📂
            </button>
          </div>
        </label>

        <label className="setting-row">
          <span className="setting-label">Hotkey</span>
          <HotkeyCapture
            value={draft.hotkey}
            onChange={(v) => setDraft((d) => ({ ...d, hotkey: v }))}
          />
          <span className="setting-hint">Click to capture a new key combination.</span>
        </label>

        <label className="setting-row">
          <span className="setting-label">Theme</span>
          <div className="setting-radio-group">
            {(['dark', 'light'] as const).map((t) => (
              <label key={t} className="radio-label">
                <input
                  type="radio"
                  name="theme"
                  value={t}
                  checked={draft.theme === t}
                  onChange={() => setDraft((d) => ({ ...d, theme: t }))}
                />
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </label>
            ))}
          </div>
        </label>

        {draft.notes_dir && (
          <div className="setting-row">
            <span className="setting-label">Sync</span>
            <p className="setting-hint sync-hint">{syncHint(draft.notes_dir)}</p>
          </div>
        )}

        {error && <div className="setting-error">{error}</div>}

        <div className="setting-actions">
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn-secondary" onClick={() => setView('list')}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
