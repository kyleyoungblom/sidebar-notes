import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { useNotes } from '../hooks/useNotes';
import type { AppConfig } from '../types';

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
          <input
            type="text"
            value={draft.hotkey}
            onChange={(e) =>
              setDraft((d) => ({ ...d, hotkey: e.target.value }))
            }
            className="setting-input"
            placeholder="e.g. ctrl+shift+space"
          />
          <span className="setting-hint">
            Modifiers: ctrl, shift, alt, meta. Keys: a–z, space, f1–f12, etc.
          </span>
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
