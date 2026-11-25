/**
 * Structured diagnostic logger for LightPen.
 *
 * - Keeps an in-memory ring buffer of recent events (privacy-safe: never logs
 *   camera frames, PDF text, or user file paths).
 * - Mirrors events to the browser console outside unit tests.
 * - On Tauri desktop/mobile, forwards events immediately to Rust (`log_event`)
 *   so running `./LightPen_*.AppImage` in a terminal shows live diagnostics AND
 *   persists them to `$APPDATA/logs/lightpen.log` before any WebView crash.
 */

import { isTauri } from './tauri';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  context?: Record<string, unknown>;
}

const MAX_LOG_ENTRIES = 500;
const entries: LogEntry[] = [];
let globalHandlersInstalled = false;
let invokePromise: Promise<
  ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null
> | null = null;

function isTestRuntime(): boolean {
  const mode = (import.meta as unknown as { env?: { MODE?: string } })?.env?.MODE;
  return mode === 'test';
}

function getTauriInvoke(): Promise<
  ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null
> {
  if (!isTauri()) return Promise.resolve(null);
  if (!invokePromise) {
    invokePromise = import('@tauri-apps/api/core')
      .then(
        (mod) => mod.invoke as (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
      )
      .catch(() => null);
  }
  return invokePromise;
}

function safeSerializeContext(context?: Record<string, unknown>): string | undefined {
  if (!context || Object.keys(context).length === 0) return undefined;
  try {
    return JSON.stringify(context, (_key, value: unknown) => {
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        return String(value);
      }
      return value;
    });
  } catch {
    return '{"error":"unserializable-context"}';
  }
}

export function formatLogEntry(entry: LogEntry): string {
  const ctx = safeSerializeContext(entry.context);
  return `[${entry.ts}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}${ctx ? ` ${ctx}` : ''}`;
}

export function logEvent(
  level: LogLevel,
  scope: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
  };

  entries.push(entry);
  if (entries.length > MAX_LOG_ENTRIES) {
    entries.splice(0, entries.length - MAX_LOG_ENTRIES);
  }

  const formatted = formatLogEntry(entry);

  if (!isTestRuntime() && typeof console !== 'undefined') {
    if (level === 'error') console.error(formatted);
    else if (level === 'warn') console.warn(formatted);
    else if (level === 'info') console.info(formatted);
    else console.debug(formatted);
  }

  if (isTauri()) {
    const contextStr = safeSerializeContext(context);
    void getTauriInvoke().then((invoke) => {
      if (!invoke) return;
      void invoke('log_event', {
        level,
        scope,
        message,
        context: contextStr ?? null,
      }).catch(() => {
        // Logging must never throw or disrupt the render/tracking loop.
      });
    });
  }
}

export function logInfo(scope: string, message: string, context?: Record<string, unknown>): void {
  logEvent('info', scope, message, context);
}

export function logWarn(scope: string, message: string, context?: Record<string, unknown>): void {
  logEvent('warn', scope, message, context);
}

export function logError(scope: string, message: string, context?: Record<string, unknown>): void {
  logEvent('error', scope, message, context);
}

export function getLogEntries(): readonly LogEntry[] {
  return entries;
}

export function clearLogEntries(): void {
  entries.length = 0;
}

/** Build a shareable plain-text diagnostic report from in-memory frontend logs. */
export function formatDiagnosticReport(extraHeader?: Record<string, unknown>): string {
  const lines: string[] = [
    '=== LightPen Diagnostic Report ===',
    `Generated: ${new Date().toISOString()}`,
    `UserAgent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
    `Viewport: ${
      typeof window !== 'undefined'
        ? `${window.innerWidth}x${window.innerHeight} @ dpr=${window.devicePixelRatio || 1}`
        : 'unknown'
    }`,
    `Tauri: ${isTauri() ? 'yes' : 'no'}`,
  ];
  if (extraHeader) {
    for (const [k, v] of Object.entries(extraHeader)) {
      lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
  }
  lines.push('', '--- Frontend Events ---');
  if (entries.length === 0) {
    lines.push('(no frontend events recorded yet)');
  } else {
    for (const entry of entries) {
      lines.push(formatLogEntry(entry));
    }
  }
  return lines.join('\n') + '\n';
}

/** Return the persistent native log file path when running in Tauri. */
export async function getNativeLogPath(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const invoke = await getTauriInvoke();
    if (!invoke) return null;
    const path = await invoke('get_log_path');
    return typeof path === 'string' && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/** Combine frontend ring-buffer diagnostics with persisted native Rust logs (in Tauri). */
export async function getFullDiagnosticReport(
  extraHeader?: Record<string, unknown>,
): Promise<string> {
  let report = formatDiagnosticReport(extraHeader);
  if (isTauri()) {
    try {
      const invoke = await getTauriInvoke();
      if (invoke) {
        const nativeTail = await invoke('read_recent_logs', { maxBytes: 128_000 });
        if (typeof nativeTail === 'string' && nativeTail.trim().length > 0) {
          report += '\n--- Native Log File (tail) ---\n' + nativeTail.trimEnd() + '\n';
        }
      }
    } catch {
      // Fall back to frontend-only report if native log read fails.
    }
  }
  return report;
}

/**
 * Install global uncaught error & unhandled promise rejection listeners once so
 * runtime crashes always leave a timestamped trace in the terminal and log file.
 */
export function installGlobalErrorLogging(): () => void {
  if (typeof window === 'undefined' || globalHandlersInstalled) {
    return () => {};
  }
  globalHandlersInstalled = true;

  const onError = (event: ErrorEvent) => {
    logError('window', event.message || 'Uncaught error', {
      filename: event.filename || undefined,
      lineno: event.lineno || undefined,
      colno: event.colno || undefined,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    logError(
      'promise',
      reason instanceof Error ? reason.message : `Unhandled rejection: ${String(reason)}`,
      reason instanceof Error ? { name: reason.name, stack: reason.stack } : undefined,
    );
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    globalHandlersInstalled = false;
  };
}
