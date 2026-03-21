import { useState, useEffect, useCallback, useRef } from 'react';

export interface MenuItem {
  id: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return 'separator' in entry;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: MenuEntry[];
  onSelect: (id: string) => void;
}

let showMenuFn: ((state: ContextMenuState) => void) | null = null;

/** Imperative API: call from any component to show the context menu */
export function showContextMenu(
  x: number,
  y: number,
  items: MenuEntry[],
  onSelect: (id: string) => void,
) {
  showMenuFn?.({ x, y, items, onSelect });
}

export function ContextMenuProvider() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    showMenuFn = setMenu;
    return () => { showMenuFn = null; };
  }, []);

  const close = useCallback(() => {
    setMenu(null);
    setFocusIdx(-1);
  }, []);

  // Close on click outside or Escape
  useEffect(() => {
    if (!menu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      const actionItems = menu.items
        .map((item, i) => ({ item, i }))
        .filter(({ item }) => !isSeparator(item) && !(item as MenuItem).disabled);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((prev) => {
          const curActionIdx = actionItems.findIndex(({ i }) => i === prev);
          const next = curActionIdx < actionItems.length - 1 ? curActionIdx + 1 : 0;
          return actionItems[next].i;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((prev) => {
          const curActionIdx = actionItems.findIndex(({ i }) => i === prev);
          const next = curActionIdx > 0 ? curActionIdx - 1 : actionItems.length - 1;
          return actionItems[next].i;
        });
      } else if (e.key === 'Enter' && focusIdx >= 0) {
        e.preventDefault();
        const entry = menu.items[focusIdx];
        if (entry && !isSeparator(entry) && !entry.disabled) {
          menu.onSelect(entry.id);
          close();
        }
      }
    };

    // Use capture phase so we get Escape before other handlers
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [menu, focusIdx, close]);

  // Close on scroll
  useEffect(() => {
    if (!menu) return;
    const onScroll = () => close();
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [menu, close]);

  // Adjust menu position after render to keep it in viewport
  useEffect(() => {
    if (!menu || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > vw) x = vw - rect.width - 4;
    if (y + rect.height > vh) y = vh - rect.height - 4;
    if (x < 0) x = 4;
    if (y < 0) y = 4;
    if (x !== menu.x || y !== menu.y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }, [menu]);

  if (!menu) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: menu.x,
    top: menu.y,
    zIndex: 200,
  };

  return (
    <div className="context-menu" ref={menuRef} style={style}>
      {menu.items.map((entry, i) => {
        if (isSeparator(entry)) {
          return <div key={`sep-${i}`} className="context-menu-separator" />;
        }
        const item = entry;
        return (
          <button
            key={item.id}
            className={`context-menu-item${item.danger ? ' context-menu-item--danger' : ''}${item.disabled ? ' context-menu-item--disabled' : ''}${i === focusIdx ? ' context-menu-item--focused' : ''}`}
            onClick={() => {
              if (!item.disabled) {
                menu.onSelect(item.id);
                close();
              }
            }}
            onMouseEnter={() => setFocusIdx(i)}
            disabled={item.disabled}
          >
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
