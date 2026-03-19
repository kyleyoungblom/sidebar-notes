import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useStore } from '../store';
import { useNotes } from '../hooks/useNotes';
import type { AppConfig } from '../types';
import { IconBack, IconFolder } from './Icons';

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
    if (capturing) {
      ref.current?.focus();
      invoke('suspend_hotkey').catch(() => {});
    } else {
      invoke('resume_hotkey').catch(() => {});
    }
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
        ? <span className="hotkey-capture-hint">Press key combination...</span>
        : <span className="hotkey-capture-value">{value || 'Click to set'}</span>
      }
    </div>
  );
}

function syncHint(dir: string): string {
  const d = dir.toLowerCase().replace(/\\/g, '/');
  if (d.includes('dropbox')) return 'Dropbox sync active';
  if (d.includes('onedrive')) return 'OneDrive sync active';
  if (d.includes('icloud') || d.includes('mobile documents')) return 'iCloud sync active';
  if (d.includes('syncthing')) return 'Syncthing sync active';
  return '';
}

type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'installing' | 'up-to-date' | 'error' | 'opening';

export function Settings() {
  const { config, setView } = useStore();
  const { saveConfig, loadNotes } = useNotes();

  const [draft, setDraft] = useState<AppConfig>({ ...config });
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    invoke<boolean>('get_launch_at_login').then(setLaunchAtLogin).catch(() => {});
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  // Auto-save when draft changes (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const autoSave = useCallback((newDraft: AppConfig) => {
    setDraft(newDraft);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveConfig(newDraft);
        await loadNotes();
      } catch (e) {
        console.error('Settings save failed:', e);
      }
    }, 500);
  }, [saveConfig, loadNotes]);

  const [updateError, setUpdateError] = useState('');
  const isWindows = navigator.userAgent.includes('Windows');

  const checkForUpdates = async () => {
    if (!isWindows) {
      // macOS: no code signing, just open releases page
      setUpdateStatus('opening');
      try {
        await invoke('open_url', { url: 'https://github.com/kyleyoungblom/sidebar-notes/releases' });
      } catch {
        // ignore
      }
      setTimeout(() => setUpdateStatus('idle'), 2000);
      return;
    }

    // Windows: use Tauri updater for seamless update
    setUpdateStatus('checking');
    setUpdateError('');
    try {
      const update = await check();
      if (!update) {
        setUpdateStatus('up-to-date');
        setTimeout(() => setUpdateStatus('idle'), 3000);
        return;
      }

      setUpdateStatus('downloading');
      await update.downloadAndInstall();
      setUpdateStatus('installing');
      await relaunch();
    } catch (e) {
      console.error('Update failed:', e);
      setUpdateError(String(e));
      setUpdateStatus('error');
      setTimeout(() => setUpdateStatus('idle'), 5000);
    }
  };

  const openFolder = async () => {
    await invoke('show_in_folder', { path: draft.notes_dir });
  };

  const hint = syncHint(draft.notes_dir);

  return (
    <div className="settings-view">
      <div className="settings-header">
        <button className="btn-icon" onClick={() => setView('list')}><IconBack size={16} /></button>
        <span className="settings-title">Settings</span>
      </div>

      <div className="settings-body">
        <label className="setting-row">
          <span className="setting-label">Notes Folder</span>
          <div className="setting-dir-row">
            <input
              type="text"
              value={draft.notes_dir}
              onChange={(e) => autoSave({ ...draft, notes_dir: e.target.value })}
              className="setting-input"
              placeholder="/path/to/notes"
            />
            <button className="btn-small" onClick={openFolder} title="Open folder">
              <IconFolder size={16} />
            </button>
          </div>
          {hint && <span className="setting-hint sync-hint-inline">{hint}</span>}
        </label>

        <label className="setting-row">
          <span className="setting-label">Hotkey</span>
          <HotkeyCapture
            value={draft.hotkey}
            onChange={(v) => autoSave({ ...draft, hotkey: v })}
          />
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
                  onChange={() => autoSave({ ...draft, theme: t })}
                />
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </label>
            ))}
          </div>
        </label>

        <label className="setting-row">
          <span className="setting-label">Panel Position</span>
          <div className="setting-radio-group">
            {(['left', 'center', 'right'] as const).map((p) => (
              <label key={p} className="radio-label">
                <input
                  type="radio"
                  name="panel_position"
                  value={p}
                  checked={draft.panel_position === p}
                  onChange={() => {
                    autoSave({ ...draft, panel_position: p });
                    invoke('set_panel_position', { position: p }).catch(() => {});
                  }}
                />
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </label>
            ))}
          </div>
        </label>

        <label className="setting-row setting-row--toggle">
          <span className="setting-label">Open at Login</span>
          <input
            type="checkbox"
            checked={launchAtLogin}
            onChange={(e) => {
              const val = e.target.checked;
              setLaunchAtLogin(val);
              invoke('set_launch_at_login', { enabled: val }).catch(() => setLaunchAtLogin(!val));
            }}
            className="setting-toggle"
          />
        </label>

        <div className="setting-row">
          <div className="update-check-row">
            <button
              className="btn-small"
              onClick={checkForUpdates}
              disabled={updateStatus !== 'idle' && updateStatus !== 'up-to-date' && updateStatus !== 'error'}
            >
              {updateStatus === 'checking' ? 'Checking...' :
               updateStatus === 'downloading' ? 'Downloading...' :
               updateStatus === 'installing' ? 'Installing...' :
               updateStatus === 'opening' ? 'Opening releases page...' :
               'Check for updates'}
            </button>
            {updateStatus === 'up-to-date' && <span className="update-status update-status--ok">You're up to date!</span>}
            {updateStatus === 'error' && <span className="update-status update-status--error">{updateError || 'Update failed'}</span>}
            {updateStatus === 'downloading' && <span className="update-status">Downloading update...</span>}
            {updateStatus === 'installing' && <span className="update-status">Installing — app will restart...</span>}
          </div>
        </div>

        {appVersion && (
          <div className="settings-version">
            Sidebar Notes v{appVersion}
          </div>
        )}
      </div>
    </div>
  );
}
