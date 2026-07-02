import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useStore, selectActiveProfile } from '../store';
import { useNotes } from '../hooks/useNotes';
import type { AppConfig, MonitorInfo, Profile } from '../types';
import { IconBack, IconFolder } from './Icons';
import { SchemeSwitcher } from './SchemeSwitcher';
import { getMergedHotkeys, formatHotkey, findConflicts, type HotkeyOverrides } from '../hotkeys';

const SCHEMES = [
  { id: 'dark',             name: 'Flexoki Dark',     bg: '#100F0F', accent: '#3AA99F', text: '#CECDC3' },
  { id: 'light',            name: 'Flexoki Light',    bg: '#FFFCF0', accent: '#24837B', text: '#100F0F' },
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

function ShortcutRow({ actionId, label, currentCombo, onCapture, conflict }: {
  actionId: string;
  label: string;
  currentCombo: string;
  onCapture: (actionId: string, key: string, meta: boolean, shift: boolean, alt: boolean) => void;
  conflict?: string;
}) {
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
    // Escape cancels capture
    if (e.key === 'Escape') { setCapturing(false); return; }
    onCapture(actionId, e.key, e.metaKey || e.ctrlKey, e.shiftKey, e.altKey);
    setCapturing(false);
  };

  return (
    <div className={`shortcut-row ${conflict ? 'shortcut-row--conflict' : ''}`}>
      <span className="shortcut-label">{label}</span>
      <div
        ref={ref}
        className={`shortcut-key ${capturing ? 'shortcut-key--capturing' : ''}`}
        tabIndex={0}
        onClick={() => setCapturing(true)}
        onBlur={() => setCapturing(false)}
        onKeyDown={capturing ? handleKeyDown : undefined}
      >
        {capturing ? 'Press keys...' : currentCombo}
      </div>
      {conflict && <span className="shortcut-conflict">Conflicts with {conflict}</span>}
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
  // Per-field selectors (avoid bare useStore() destructure — see perf fix).
  const config = useStore((s) => s.config);
  const setView = useStore((s) => s.setView);
  const activeProfile = useStore((s) => selectActiveProfile(s.config));
  const { saveConfig, loadNotes } = useNotes();

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [showSchemePicker, setShowSchemePicker] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);

  useEffect(() => {
    invoke<boolean>('get_launch_at_login').then(setLaunchAtLogin).catch(() => {});
    getVersion().then(setAppVersion).catch(() => {});
    invoke<MonitorInfo[]>('list_monitors').then(setMonitors).catch(() => {});
  }, []);

  // Debounced save — writes to disk after 500ms of quiet
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const autoSave = useCallback((newConfig: AppConfig) => {
    // Immediately update the store so UI reflects the change
    useStore.getState().setConfig(newConfig);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveConfig(newConfig);
        await loadNotes();
      } catch (e) {
        console.error('Settings save failed:', e);
      }
    }, 500);
  }, [saveConfig, loadNotes]);

  const [, setUpdateError] = useState('');
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
      console.error('Update check failed:', e);
      // latest.json may not exist yet — fall back to releases page
      try { await invoke('open_url', { url: 'https://github.com/kyleyoungblom/sidebar-notes/releases' }); } catch { /* ignore */ }
      setUpdateStatus('opening');
      setTimeout(() => setUpdateStatus('idle'), 2000);
    }
  };

  // Auto-check for updates on settings open (Windows only — macOS has no updater)
  const [updateAvailable, setUpdateAvailable] = useState<null | { version: string }>(null);
  useEffect(() => {
    if (!isWindows) return;
    (async () => {
      try {
        const update = await check();
        if (update) setUpdateAvailable({ version: update.version ?? 'new' });
      } catch {
        // silent — don't show errors for background check
      }
    })();
  }, [isWindows]);

  const openFolderFor = async (dir: string) => {
    if (!dir) return;
    await invoke('show_in_folder', { path: dir });
  };

  /** Native folder picker → writes the chosen path into the profile's notes_dir. */
  const browseFolderFor = async (id: string) => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: 'Choose notes folder',
      });
      if (typeof selected === 'string' && selected.length > 0) {
        updateProfileField(id, { notes_dir: selected });
      }
    } catch (e) {
      console.error('Folder picker failed:', e);
    }
  };

  // ── Drag-and-drop: drop a folder from Finder onto a profile row ───────────
  // Tauri intercepts file drops; HTML5 drop events do not fire. Subscribe to
  // Tauri's drag-drop event and use position hit-testing to figure out which
  // profile row the drop landed on.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let hoverEl: HTMLElement | null = null;

    const rowAtPoint = (px: number, py: number): HTMLElement | null => {
      const dpr = window.devicePixelRatio || 1;
      const el = document.elementFromPoint(px / dpr, py / dpr);
      return el ? (el.closest('.profile-row') as HTMLElement | null) : null;
    };

    const setHover = (el: HTMLElement | null) => {
      if (hoverEl === el) return;
      hoverEl?.classList.remove('profile-row--dragover');
      hoverEl = el;
      hoverEl?.classList.add('profile-row--dragover');
    };

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === 'over') {
          setHover(rowAtPoint(p.position.x, p.position.y));
        } else if (p.type === 'leave') {
          setHover(null);
        } else if (p.type === 'drop') {
          const row = rowAtPoint(p.position.x, p.position.y);
          setHover(null);
          const id = row?.dataset.profileId;
          const path = p.paths?.[0];
          if (!id || !path) return;
          const cfg = useStore.getState().config;
          const newCfg = {
            ...cfg,
            profiles: cfg.profiles.map((prof) =>
              prof.id === id ? { ...prof, notes_dir: path } : prof
            ),
          };
          saveConfig(newCfg).catch(() => {});
        }
      })
      .then((fn) => { unlisten = fn; })
      .catch((e) => console.error('drag-drop listener failed:', e));

    return () => {
      setHover(null);
      unlisten?.();
    };
  }, [saveConfig]);

  // ── Profile helpers ─────────────────────────────────────────────────────
  const updateProfileField = (id: string, patch: Partial<Omit<Profile, 'id'>>) => {
    autoSave({
      ...config,
      profiles: config.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  };

  const addProfile = () => {
    const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const newProfile: Profile = {
      id,
      name: 'New profile',
      notes_dir: '',
      theme: activeProfile?.theme ?? 'dark',
    };
    // Do NOT auto-switch to the new profile — keep the user in Settings so
    // they can name it and pick a folder before activating. The profile-switch
    // effect in App.tsx would otherwise force a jump back to the list view.
    autoSave({
      ...config,
      profiles: [...config.profiles, newProfile],
    });
  };

  const removeProfile = (id: string) => {
    if (config.profiles.length <= 1) return;
    const remaining = config.profiles.filter((p) => p.id !== id);
    const nextActive = config.active_profile_id === id ? remaining[0].id : config.active_profile_id;
    autoSave({
      ...config,
      profiles: remaining,
      active_profile_id: nextActive,
    });
  };

  const setActiveProfile = (id: string) => {
    if (id === config.active_profile_id) return;
    autoSave({ ...config, active_profile_id: id });
  };

  return (
    <div className="settings-view">
      <div className="settings-header">
        <button className="btn-icon" onClick={() => setView('list')}><IconBack size={16} /></button>
        <span className="settings-title">Settings</span>
      </div>

      <div className="settings-body">
        <div className="setting-group-label">General</div>

        <label className="setting-row">
          <span className="setting-label">Show/Hide Shortcut</span>
          <HotkeyCapture
            value={config.hotkey}
            onChange={(v) => autoSave({ ...config, hotkey: v })}
          />
        </label>

        <div className="setting-row setting-row--hint">
          <span className="setting-hint">Notes folder and theme are configured per profile, below.</span>
        </div>

        {showSchemePicker && (
          <SchemeSwitcher onClose={() => setShowSchemePicker(false)} />
        )}

        {/* ── Profiles ── */}
        <div className="setting-group-label">Profiles</div>
        {config.profiles.map((p) => {
          const isActive = p.id === config.active_profile_id;
          const scheme = SCHEMES.find((s) => s.id === p.theme) ?? SCHEMES[0];
          const phint = syncHint(p.notes_dir);
          return (
            <div key={p.id} data-profile-id={p.id} className={`profile-row${isActive ? ' profile-row--active' : ''}`}>
              <div className="profile-row-header">
                <input
                  type="text"
                  className="profile-name-input"
                  value={p.name}
                  onChange={(e) => updateProfileField(p.id, { name: e.target.value })}
                  placeholder="Profile name"
                />
                {isActive ? (
                  <span className="profile-active-badge">Active</span>
                ) : (
                  <button className="btn-small" onClick={() => setActiveProfile(p.id)} title="Switch to this profile">
                    Switch to
                  </button>
                )}
                <button
                  className="btn-small btn-small--danger"
                  onClick={() => removeProfile(p.id)}
                  disabled={config.profiles.length <= 1}
                  title={config.profiles.length <= 1 ? 'Cannot delete the only profile' : 'Delete profile'}
                >
                  Delete
                </button>
              </div>
              <div className="setting-dir-row">
                <input
                  type="text"
                  value={p.notes_dir}
                  onChange={(e) => updateProfileField(p.id, { notes_dir: e.target.value })}
                  className="setting-input"
                  placeholder="/path/to/notes"
                />
                <button
                  className="btn-small"
                  onClick={() => browseFolderFor(p.id)}
                  title="Choose folder"
                >
                  Browse…
                </button>
                <button
                  className="btn-small"
                  onClick={() => openFolderFor(p.notes_dir)}
                  title="Show in Finder"
                  disabled={!p.notes_dir}
                >
                  <IconFolder size={16} />
                </button>
              </div>
              {phint && <span className="setting-hint sync-hint-inline">{phint}</span>}
              <div className="profile-theme-row">
                <span className="setting-hint">Theme</span>
                <select
                  className="setting-select"
                  value={p.theme}
                  onChange={(e) => updateProfileField(p.id, { theme: e.target.value })}
                >
                  {SCHEMES.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <span className="scheme-preview-colors">
                  <span style={{ background: scheme.bg }} />
                  <span style={{ background: scheme.accent }} />
                  <span style={{ background: scheme.text }} />
                </span>
              </div>
            </div>
          );
        })}
        <div className="setting-row">
          <button className="btn-small" onClick={addProfile}>+ Add profile</button>
        </div>

        <label className="setting-row">
          <span className="setting-label">Panel Position</span>
          <div className="setting-radio-group">
            {(['left', 'center', 'right'] as const).map((p) => (
              <label key={p} className="radio-label">
                <input
                  type="radio"
                  name="panel_position"
                  value={p}
                  checked={config.panel_position === p}
                  onChange={() => {
                    autoSave({ ...config, panel_position: p });
                    invoke('set_panel_position', { position: p }).catch(() => {});
                  }}
                />
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </label>
            ))}
          </div>
        </label>

        {monitors.length > 1 && (
          <label className="setting-row">
            <span className="setting-label">Open on Monitor</span>
            <select
              className="setting-select"
              value={config.preferred_monitor ?? 0}
              onChange={(e) => autoSave({ ...config, preferred_monitor: Number(e.target.value) })}
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

        {/* ── Tasks ── */}
        <div className="setting-group-label">Tasks</div>

        <label className="setting-row setting-row--toggle">
          <span className="setting-label">Move completed to bottom</span>
          <input
            type="checkbox"
            checked={config.sort_completed ?? true}
            onChange={(e) => autoSave({ ...config, sort_completed: e.target.checked })}
            className="setting-toggle"
          />
        </label>

        <label className="setting-row setting-row--toggle">
          <span className="setting-label">Hide completed tasks</span>
          <input
            type="checkbox"
            checked={config.hide_completed_full ?? false}
            onChange={(e) => autoSave({ ...config, hide_completed_full: e.target.checked })}
            className="setting-toggle"
          />
        </label>

        <label className="setting-row setting-row--toggle">
          <span className="setting-label">Hide collapsed divider content</span>
          <input
            type="checkbox"
            checked={(config.collapse_mode ?? 'dim') === 'hide'}
            onChange={(e) => autoSave({ ...config, collapse_mode: e.target.checked ? 'hide' : 'dim' })}
            className="setting-toggle"
          />
        </label>

        {/* ── Behavior ── */}
        <div className="setting-group-label">Behavior</div>

        <label className="setting-row setting-row--toggle">
          <span className="setting-label">Open at login</span>
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

        <label className="setting-row setting-row--toggle">
          <span className="setting-label">Match system dark/light</span>
          <input
            type="checkbox"
            checked={config.match_system_theme ?? false}
            onChange={(e) => autoSave({ ...config, match_system_theme: e.target.checked })}
            className="setting-toggle"
          />
        </label>

        <label className="setting-row setting-row--toggle">
          <span className="setting-label">Confirm before deleting</span>
          <input
            type="checkbox"
            checked={localStorage.getItem('skipDeleteConfirm') !== 'true'}
            onChange={(e) => {
              if (e.target.checked) localStorage.removeItem('skipDeleteConfirm');
              else localStorage.setItem('skipDeleteConfirm', 'true');
            }}
            className="setting-toggle"
          />
        </label>

        {/* ── Keyboard Shortcuts (collapsible) ── */}
        <div className="setting-section">
          <button className="setting-section-toggle" onClick={() => setShowShortcuts((v) => !v)}>
            Keyboard Shortcuts
            <span className={`setting-section-chevron${showShortcuts ? ' open' : ''}`}>&#9662;</span>
          </button>
          {showShortcuts && (<div className="setting-section-content">
          {(() => {
            const merged = getMergedHotkeys(config.hotkey_overrides as HotkeyOverrides | undefined);
            const conflicts = findConflicts(merged);
            const conflictMap: Record<string, string> = {};
            for (const [a, b] of conflicts) {
              conflictMap[a] = merged[b].label;
              conflictMap[b] = merged[a].label;
            }
            const groupOrder = ['Navigation', 'Notes', 'Editor', 'App'];
            const groups: Record<string, string[]> = {};
            for (const [id, def] of Object.entries(merged)) {
              if (!groups[def.group]) groups[def.group] = [];
              groups[def.group].push(id);
            }
            return (
              <>
                {groupOrder.map((g) => (
                  <div key={g}>
                    <div className="shortcut-group-title">{g}</div>
                    {(groups[g] ?? []).map((id) => (
                      <ShortcutRow
                        key={id}
                        actionId={id}
                        label={merged[id].label}
                        currentCombo={formatHotkey(merged[id])}
                        conflict={conflictMap[id]}
                        onCapture={(actionId, key, meta, shift, alt) => {
                          const overrides = { ...(config.hotkey_overrides ?? {}) } as Record<string, { key?: string; meta?: boolean; shift?: boolean; alt?: boolean }>;
                          overrides[actionId] = { key, meta, shift, alt };
                          const next = { ...config, hotkey_overrides: overrides };
                          saveConfig(next);
                        }}
                      />
                    ))}
                  </div>
                ))}
                {Object.keys(config.hotkey_overrides ?? {}).length > 0 && (
                  <button
                    className="btn-small"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      const next = { ...config, hotkey_overrides: {} };
                      saveConfig(next);
                    }}
                  >
                    Reset all to defaults
                  </button>
                )}
              </>
            );
          })()}
          </div>)}
        </div>

        {/* ── Version + Updates (bottom) ── */}
        {appVersion && (
          <div className="settings-version-row">
            <span className="settings-version">Sidebar Notes v{appVersion}</span>
            {isWindows && updateAvailable ? (
              <button className="settings-update-link" onClick={checkForUpdates}>
                {updateStatus === 'downloading' ? 'Downloading...' :
                 updateStatus === 'installing' ? 'Restarting...' :
                 `Update to v${updateAvailable.version}`}
              </button>
            ) : !isWindows ? (
              <a
                className="settings-update-link"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  invoke('open_url', { url: 'https://github.com/kyleyoungblom/sidebar-notes/releases' });
                }}
              >
                Releases
              </a>
            ) : (
              <span className="settings-up-to-date">Up to date</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
