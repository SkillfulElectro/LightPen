import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLogEntries,
  formatDiagnosticReport,
  formatLogEntry,
  getLogEntries,
  logError,
  logInfo,
  logWarn,
} from './logger';

beforeEach(() => {
  clearLogEntries();
});

describe('diagnostic logger', () => {
  it('records structured entries in order and caps the ring buffer', () => {
    logInfo('startup', 'LightPen ready', { version: '0.1.10' });
    logWarn('gpu', 'Slow GPU frame', { inferMs: 52.4 });
    logError('pdf', 'Render failed', { page: 2 });

    const list = getLogEntries();
    expect(list).toHaveLength(3);
    expect(list[0]?.level).toBe('info');
    expect(list[1]?.level).toBe('warn');
    expect(list[2]?.level).toBe('error');
    expect(formatLogEntry(list[0]!)).toContain('[INFO] [startup] LightPen ready');

    for (let i = 0; i < 600; i++) {
      logInfo('spam', `msg-${i}`);
    }
    expect(getLogEntries().length).toBeLessThanOrEqual(500);
    expect(getLogEntries().at(-1)?.message).toBe('msg-599');
  });

  it('builds a shareable diagnostic report with metadata and events', () => {
    logInfo('camera', 'Stream started', { width: 640, height: 480, fps: 30 });
    const report = formatDiagnosticReport({ Version: '0.1.10', Hardware: 'Test CPU' });
    expect(report).toContain('=== LightPen Diagnostic Report ===');
    expect(report).toContain('Version: 0.1.10');
    expect(report).toContain('Hardware: Test CPU');
    expect(report).toContain('[INFO] [camera] Stream started');
  });
});
