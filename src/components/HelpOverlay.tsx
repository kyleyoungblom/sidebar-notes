import { useEffect } from 'react';
import { IconClose } from './Icons';
import { useStore } from '../store';
import { getMergedHotkeys, formatHotkey } from '../hotkeys';

/** Extra shortcuts not in the registry (non-configurable, context-specific). */
const EXTRA_SHORTCUTS: Record<string, Array<{ keys: string; description: string }>> = {
  Navigation: [
    { keys: '↑ / ↓', description: 'Navigate list' },
    { keys: '↩', description: 'Open note' },
  ],
  Editor: [
    { keys: 'Tab', description: 'Indent' },
    { keys: '⇧Tab', description: 'Outdent' },
  ],
  App: [
    { keys: '⌥.', description: 'Toggle sidebar' },
  ],
};

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const config = useStore((s) => s.config);
  const hk = getMergedHotkeys(config.hotkey_overrides);

  // Group hotkeys by their group field
  const groups: Record<string, Array<{ keys: string; description: string }>> = {};
  for (const def of Object.values(hk)) {
    if (!groups[def.group]) groups[def.group] = [];
    groups[def.group].push({ keys: formatHotkey(def), description: def.label });
  }

  // Append extras
  for (const [group, extras] of Object.entries(EXTRA_SHORTCUTS)) {
    if (!groups[group]) groups[group] = [];
    groups[group].push(...extras);
  }

  // Ordered group display
  const groupOrder = ['Navigation', 'Editor', 'Notes', 'App'];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <span className="help-title">Keyboard Shortcuts</span>
          <button className="btn-icon help-close" onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="help-body">
          {groupOrder.map((title) => (
            <div key={title} className="help-group">
              <div className="help-group-title">{title}</div>
              {(groups[title] ?? []).map((sc) => (
                <div key={`${sc.keys}-${sc.description}`} className="help-row">
                  <kbd className="help-key">{sc.keys}</kbd>
                  <span className="help-desc">{sc.description}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
