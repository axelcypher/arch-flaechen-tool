import { isTauri } from './files';

/**
 * Anwendungsprotokoll zum Debuggen.
 *
 *  - Einträge landen in einem Ringpuffer (im Protokoll-Fenster sichtbar, kopier- und speicherbar)
 *    und in der Browser-Konsole.
 *  - In der Desktop-App zusätzlich in eine Logdatei (tauri-plugin-log, Ordner „logs“ im
 *    App-Datenverzeichnis, z. B. %LOCALAPPDATA%\de.pendzialek.flaechenrechner\logs).
 *  - Unbehandelte Fehler, abgelehnte Promises sowie console.warn/error von Bibliotheken
 *    werden automatisch mitgeschrieben.
 *
 * Verwendung:  const log = logger('ifc');  log.info('Import gestartet', { datei });
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  time: Date;
  level: LogLevel;
  scope: string;
  message: string;
  data?: string;
}

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const MAX = 2000;
const DEBUG_KEY = 'flaechenrechner.log.debug';

const entries: LogEntry[] = [];
const listeners = new Set<() => void>();
let nextId = 1;
let debugEnabled = readDebug();

// Originale Konsolenfunktionen (vor dem Einklinken), damit keine Schleifen entstehen
const cons = { debug: console.debug.bind(console), info: console.info.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };

type PluginLog = typeof import('@tauri-apps/plugin-log');
let plugin: Promise<PluginLog | null> | null = null;
function tauriLog(): Promise<PluginLog | null> {
  if (!plugin) plugin = isTauri() ? import('@tauri-apps/plugin-log').catch(() => null) : Promise.resolve(null);
  return plugin;
}

function readDebug(): boolean {
  try {
    return localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

export function isDebugEnabled() {
  return debugEnabled;
}

export function setDebugEnabled(on: boolean) {
  debugEnabled = on;
  try {
    if (on) localStorage.setItem(DEBUG_KEY, '1');
    else localStorage.removeItem(DEBUG_KEY);
  } catch {
    // ohne Speicher nur für diese Sitzung
  }
  emit();
}

/** Werte lesbar machen (Fehler mit Stack, Objekte als JSON, gekürzt) */
export function formatData(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ''}`;
  if (typeof v === 'string') return v;
  try {
    const s = JSON.stringify(v, (_k, x) => (x instanceof Uint8Array || x instanceof ArrayBuffer ? `<${x.byteLength} Bytes>` : x instanceof Error ? `${x.name}: ${x.message}` : x));
    return s.length > 4000 ? `${s.slice(0, 4000)} …` : s;
  } catch {
    return String(v);
  }
}

export function write(level: LogLevel, scope: string, message: string, data?: unknown, mirror = true) {
  if (level === 'debug' && !debugEnabled) return;
  const e: LogEntry = { id: nextId++, time: new Date(), level, scope, message, data: formatData(data) };
  entries.push(e);
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  if (mirror) cons[level](`[${scope}] ${message}`, ...(data === undefined ? [] : [data]));
  const line = `[${scope}] ${message}${e.data ? ` | ${e.data}` : ''}`;
  void tauriLog().then((p) => p?.[level === 'warn' ? 'warn' : level](line).catch(() => undefined));
  emit();
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  /** Dauer einer Aktion messen: const done = log.time('Export'); …; done({ zeilen }) */
  time(message: string): (data?: unknown) => void;
}

export function logger(scope: string): Logger {
  return {
    debug: (m, d) => write('debug', scope, m, d),
    info: (m, d) => write('info', scope, m, d),
    warn: (m, d) => write('warn', scope, m, d),
    error: (m, d) => write('error', scope, m, d),
    time: (m) => {
      const t0 = performance.now();
      write('debug', scope, `${m} …`);
      return (d) => write('info', scope, `${m} (${Math.round(performance.now() - t0)} ms)`, d);
    },
  };
}

export function getEntries(): readonly LogEntry[] {
  return entries;
}

export function clearLog() {
  entries.length = 0;
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let version = 0;
export function logVersion() {
  return version;
}
function emit() {
  version++;
  for (const l of listeners) l();
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export function formatTime(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Protokoll als Text (zum Kopieren/Speichern) */
export function logText(list: readonly LogEntry[] = entries): string {
  return list.map((e) => `${e.time.toISOString()} ${e.level.toUpperCase().padEnd(5)} [${e.scope}] ${e.message}${e.data ? `\n    ${e.data.replace(/\n/g, '\n    ')}` : ''}`).join('\n');
}

export function levelRank(l: LogLevel) {
  return LEVELS.indexOf(l);
}

let installed = false;

/** Globale Fehler und Konsolenausgaben mitschreiben; einmal beim Start aufrufen */
export function installLogging(info: Record<string, unknown>) {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (ev) => {
    write('error', 'global', ev.message || 'Unbehandelter Fehler', ev.error ?? `${ev.filename}:${ev.lineno}:${ev.colno}`, false);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    write('error', 'global', 'Unbehandelte Promise-Ablehnung', ev.reason, false);
  });
  // Warnungen/Fehler von Bibliotheken (React, pdf.js, three.js …) übernehmen
  console.warn = (...args: unknown[]) => {
    cons.warn(...args);
    write('warn', 'console', args.map((a) => (typeof a === 'string' ? a : formatData(a))).join(' '), undefined, false);
  };
  console.error = (...args: unknown[]) => {
    cons.error(...args);
    const err = args.find((a) => a instanceof Error);
    write('error', 'console', args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : formatData(a))).join(' '), err, false);
  };
  write('info', 'app', 'Start', info);
}
