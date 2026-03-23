import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { IconCopy, IconClear } from './Icons';

interface LogEntry {
  ts: number;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug' | 'exception' | 'event' | 'network';
  msg: string;
}

function formatArg(a: unknown): string {
  if (a === undefined) return 'undefined';
  if (a === null) return 'null';
  if (typeof a === 'string') return a;
  if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
  if (a instanceof Event) return `[Event: ${a.type}]`;
  if (a instanceof HTMLElement) return `<${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''}${a.className ? '.' + String(a.className).split(' ').join('.') : ''}>`;
  try { return JSON.stringify(a, null, 2); } catch { return String(a); }
}

export function DebugDrawer() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const originals = useRef<Record<string, (...args: unknown[]) => void>>({});

  const addEntry = useCallback((level: LogEntry['level'], msg: string) => {
    setEntries((prev) => {
      const next = [...prev, { ts: Date.now(), level, msg }];
      // Cap at 500 entries to prevent memory growth
      return next.length > 500 ? next.slice(-400) : next;
    });
  }, []);

  useEffect(() => {
    // Save originals
    originals.current = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    };

    const intercept = (level: LogEntry['level']) => {
      const orig = originals.current[level];
      return (...args: unknown[]) => {
        orig.apply(console, args);
        const msg = args.map(formatArg).join(' ');
        addEntry(level, msg);
      };
    };

    console.log = intercept('log');
    console.warn = intercept('warn');
    console.error = intercept('error');
    console.info = intercept('info');
    console.debug = intercept('debug');

    // Capture unhandled errors
    const onError = (e: ErrorEvent) => {
      addEntry('exception', `Unhandled: ${e.message}\n  at ${e.filename}:${e.lineno}:${e.colno}`);
    };
    window.addEventListener('error', onError);

    // Capture unhandled promise rejections
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason instanceof Error
        ? `${e.reason.message}\n${e.reason.stack ?? ''}`
        : String(e.reason);
      addEntry('exception', `Unhandled rejection: ${reason}`);
    };
    window.addEventListener('unhandledrejection', onRejection);

    // Capture Tauri IPC errors via invoke failures
    // (these show up as console.error already, but we also capture Tauri events)
    const unlistenPromises: Promise<() => void>[] = [];

    // Listen for panel events for visibility debugging
    for (const evt of ['panel-did-show', 'panel-did-resign-key']) {
      unlistenPromises.push(
        listen(evt, () => addEntry('event', `Tauri event: ${evt}`))
      );
    }

    // Capture fetch/XHR errors
    const origFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      try {
        const resp = await origFetch(...args);
        if (!resp.ok) {
          addEntry('network', `Fetch ${resp.status}: ${typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '?'}`);
        }
        return resp;
      } catch (err) {
        addEntry('network', `Fetch error: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    };

    return () => {
      console.log = originals.current.log;
      console.warn = originals.current.warn;
      console.error = originals.current.error;
      console.info = originals.current.info;
      console.debug = originals.current.debug;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.fetch = origFetch;
      unlistenPromises.forEach(p => p.then(fn => fn()));
    };
  }, [addEntry]);

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

  const levelColor: Record<string, string> = {
    error: 'debug-log-entry--error',
    exception: 'debug-log-entry--error',
    warn: 'debug-log-entry--warn',
    info: 'debug-log-entry--info',
    debug: 'debug-log-entry--debug',
    event: 'debug-log-entry--event',
    network: 'debug-log-entry--network',
  };

  return (
    <div className="debug-drawer">
      <div className="debug-drawer-header">
        <span className="debug-drawer-title">Logs</span>
        <span className="debug-drawer-count">{entries.length}</span>
        <div className="debug-drawer-actions">
          <button className="btn-icon btn-small" onClick={handleCopy} title="Copy logs">
            <IconCopy size={14} />
          </button>
          <button className="btn-icon btn-small" onClick={handleClear} title="Clear logs">
            <IconClear size={14} />
          </button>
        </div>
      </div>
      <div className="debug-drawer-logs" ref={scrollRef}>
        {entries.map((e, i) => (
          <div key={i} className={`debug-log-entry ${levelColor[e.level] ?? ''}`}>
            <span className="debug-log-ts">{new Date(e.ts).toLocaleTimeString()}</span>
            <span className="debug-log-level">{e.level.toUpperCase()}</span>
            {' '}{e.msg}
          </div>
        ))}
        {entries.length === 0 && (
          <div className="debug-log-empty">No logs yet</div>
        )}
      </div>
    </div>
  );
}
