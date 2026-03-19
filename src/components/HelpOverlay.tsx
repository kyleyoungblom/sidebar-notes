import { useEffect } from 'react';
import { IconClose } from './Icons';

interface ShortcutEntry {
  keys: string;
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: 'Esc', description: 'Back to list' },
      { keys: '\u2318P', description: 'Quick switcher' },
      { keys: '\u2318F', description: 'Search notes' },
      { keys: '\u2191 / \u2193', description: 'Navigate list' },
      { keys: 'Enter', description: 'Open note' },
    ],
  },
  {
    title: 'Editor',
    shortcuts: [
      { keys: '\u2318Enter', description: 'Toggle task checkbox' },
      { keys: 'Tab', description: 'Indent' },
      { keys: '\u21E7Tab', description: 'Outdent' },
      { keys: '\u2318\u2325\u2191 / \u2193', description: 'Cycle through notes' },
      { keys: '\u2318\u2191 / \u2318\u2193', description: 'Jump to top / bottom' },
    ],
  },
  {
    title: 'Notes',
    shortcuts: [
      { keys: '\u2318N', description: 'New note' },
      { keys: '\u2318D', description: 'Duplicate note' },
      { keys: '\u2318\u232B', description: 'Delete note' },
      { keys: '\u2318R', description: 'Rename note' },
      { keys: '\u2318Z', description: 'Undo close (on list)' },
    ],
  },
  {
    title: 'App',
    shortcuts: [
      { keys: '\u2325.', description: 'Toggle sidebar' },
      { keys: '\u2318W', description: 'Hide panel' },
      { keys: '\u2318,', description: 'Settings' },
      { keys: '\u2318/', description: 'Show this help' },
    ],
  },
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  // Capture Escape at the window level to prevent the global handler from firing
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
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="help-group">
              <div className="help-group-title">{group.title}</div>
              {group.shortcuts.map((sc) => (
                <div key={sc.keys} className="help-row">
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
