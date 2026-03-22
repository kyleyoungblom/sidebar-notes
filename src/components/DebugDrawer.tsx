import { useEffect, useRef, useState, useCallback } from 'react';

interface LogEntry {
  ts: number;
  level: 'log' | 'warn' | 'error' | 'info';
  msg: string;
}

export function DebugDrawer() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const originals = useRef<Record<string, (...args: unknown[]) => void>>({});

  useEffect(() => {
    // Save originals
    originals.current = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
    };

    const intercept = (level: LogEntry['level']) => {
      const orig = originals.current[level];
      return (...args: unknown[]) => {
        orig.apply(console, args);
        const msg = args
          .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
          .join(' ');
        setEntries((prev) => [...prev, { ts: Date.now(), level, msg }]);
      };
    };

    console.log = intercept('log');
    console.warn = intercept('warn');
    console.error = intercept('error');
    console.info = intercept('info');

    return () => {
      console.log = originals.current.log;
      console.warn = originals.current.warn;
      console.error = originals.current.error;
      console.info = originals.current.info;
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const handleClear = useCallback(() => setEntries([]), []);

  const handleCopy = useCallback(() => {
    const text = entries
      .map((e) => {
        const t = new Date(e.ts).toLocaleTimeString();
        return `[${t}] [${e.level.toUpperCase()}] ${e.msg}`;
      })
      .join('\n');
    navigator.clipboard.writeText(text);
  }, [entries]);

  return (
    <div className="debug-drawer">
      <div className="debug-drawer-header">
        <span className="debug-drawer-title">Debug Logs</span>
        <div className="debug-drawer-actions">
          <button className="btn-icon btn-sm" onClick={handleCopy} title="Copy logs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button className="btn-icon btn-sm" onClick={handleClear} title="Clear logs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
      <div className="debug-drawer-logs" ref={scrollRef}>
        {entries.map((e, i) => (
          <div key={i} className={`debug-log-entry debug-log-entry--${e.level}`}>
            <span className="debug-log-ts">{new Date(e.ts).toLocaleTimeString()}</span>{' '}
            {e.msg}
          </div>
        ))}
        {entries.length === 0 && (
          <div className="debug-log-empty">No logs yet</div>
        )}
      </div>
    </div>
  );
}
