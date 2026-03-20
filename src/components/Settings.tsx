import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useStore } from '../store';
import { useNotes } from '../hooks/useNotes';
import type { AppConfig, MonitorInfo } from '../types';
import { IconBack, IconFolder } from './Icons';

const SCHEMES = [
  { id: 'dark',             name: 'Dark',             bg: '#1e1e20', accent: '#6e9eff', text: '#e8e8ed' },
  { id: 'light',            name: 'Light',            bg: '#f4f4f8', accent: '#4a7fd8', text: '#1e1e20' },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', bg: '#1e1e2e', accent: '#89b4fa', text: '#cdd6f4' },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', bg: '#eff1f5', accent: '#1e66f5', text: '#4c4f69' },
  { id: 'nord',             name: 'Nord',             bg: '#2e3440', accent: '#88c0d0', text: '#eceff4' },
  { id: 'dracula',          name: 'Dracula',          bg: '#282a36', accent: '#bd93f9', text: '#f8f8f2' },
  { id: 'solarized-dark',   name: 'Solarized Dark',   bg: '#002b36', accent: '#268bd2', text: '#839496' },
  { id: 'solarized-light',  name: 'Solarized Light',  bg: '#fdf6e3', accent: '#268bd2', text: '#657b83' },
  { id: 'gruvbox-dark',     name: 'Gruvbox Dark',     bg: '#282828', accent: '#83a598', text: '#ebdbb2' },
  { id: 'gruvbox-light',    name: 'Gruvbox Light',    bg: '#fbf1c7', accent: '#076678', text: '#282828' },
  { id: 'one-dark',         name: 'One Dark',         bg: '#282c34', accent: '#61afef', text: '#abb2bf' },
  { id: 'tokyo-night',      name: 'Tokyo Night',      bg: '#1a1b26', accent: '#7aa2f7', text: '#c0caf5' },
  { id: 'rose-pine',        name: 'Rosé Pine',        bg: '#191724', accent: '#c4a7e7', text: '#e0def4' },
  { id: 'rose-pine-dawn',   name: 'Rosé Pine Dawn',   bg: '#faf4ed', accent: '#907aa9', text: '#575279' },
];

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
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);

  useEffect(() => {
    invoke<boolean>('get_launch_at_login').then(setLaunchAtLogin).catch(() => {});
    getVersion().then(setAppVersion).catch(() => {});
    invoke<MonitorInfo[]>('list_monitors').then(setMonitors).catch(() => {});
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
          <span className="setting-label">Color Scheme</span>
          <div className="scheme-grid">
            {SCHEMES.map((s) => (
              <button
                key={s.id}
                className={`scheme-swatch${draft.theme === s.id ? ' scheme-swatch--active' : ''}`}
                onClick={() => autoSave({ ...draft, theme: s.id })}
                title={s.name}
              >
                <span className="scheme-swatch-colors">
                  <span style={{ background: s.bg }} />
                  <span style={{ background: s.accent }} />
                  <span style={{ background: s.text }} />
                </span>
                <span className="scheme-swatch-label">{s.name}</span>
              </button>
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
          <span className="setting-label">Move completed tasks to bottom</span>
          <input
            type="checkbox"
            checked={draft.sort_completed ?? true}
            onChange={(e) => autoSave({ ...draft, sort_completed: e.target.checked })}
            className="setting-toggle"
          />
        </label>

        <label className="setting-row setting-row--toggle">
          <span className="setting-label">Completely hide completed tasks</span>
          <input
            type="checkbox"
            checked={draft.hide_completed_full ?? false}
            onChange={(e) => autoSave({ ...draft, hide_completed_full: e.target.checked })}
            className="setting-toggle"
          />
        </label>

        {monitors.length > 1 && (
          <label className="setting-row">
            <span className="setting-label">Open on Monitor</span>
            <select
              className="setting-select"
              value={draft.preferred_monitor ?? 0}
              onChange={(e) => autoSave({ ...draft, preferred_monitor: Number(e.target.value) })}
            >
              <option value={0}>Follow cursor</option>
              {monitors.map((m) => (
                <option key={m.index} value={m.index}>
                  Monitor {m.index}{m.primary ? ' (Primary)' : ''} — {m.width}×{m.height}
                </option>
              ))}
            </select>
          </label>
        )}

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
