/**
 * Tauri/native adapters with graceful web fallback.
 * In a plain browser (`npm run dev`) every function degrades to
 * browser APIs so the app is fully usable without Tauri.
 */

import type { SidecarData } from '../core/types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
}

/** Open a PDF via the native file dialog (Tauri) or `<input type=file>` (web). */
export async function openPdfFile(): Promise<OpenedFile | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (typeof selected !== 'string') return null;
    const bytes = await readFile(selected);
    const name = selected.split(/[\\/]/).pop() ?? 'document.pdf';
    return { name, bytes: new Uint8Array(bytes) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      void file
        .arrayBuffer()
        .then((buf) => resolve({ name: file.name, bytes: new Uint8Array(buf) }));
    };
    input.click();
  });
}

/** Save bytes via native dialog (Tauri) or browser download (web). */
export async function saveBytesAs(defaultName: string, bytes: Uint8Array): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: defaultName });
    if (!path) return false;
    await writeFile(path, bytes);
    return true;
  }
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

function sidecarKey(pdfName: string): string {
  return `lightpen:sidecar:${pdfName}`;
}

/** File-system-safe sidecar name: `<name>.lightpen.json` with unsafe chars replaced. */
export function sidecarFileName(pdfName: string): string {
  const unsafeChars = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);
  const safe = Array.from(pdfName)
    .filter((ch) => !unsafeChars.has(ch) && ch.charCodeAt(0) >= 32)
    .join('')
    .slice(0, 120);
  return `${safe || 'document'}.lightpen.json`;
}

/** Load the annotation sidecar for a PDF (app data dir in Tauri, localStorage on web). */
export async function loadSidecar(pdfName: string): Promise<SidecarData | null> {
  if (isTauri()) {
    try {
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const dir = await appDataDir();
      // Note: only paths inside $APPDATA/** are allowed by the capability scope.
      const text = await readTextFile(await join(dir, sidecarFileName(pdfName)));
      return JSON.parse(text) as SidecarData;
    } catch {
      return null;
    }
  }
  try {
    const raw = localStorage.getItem(sidecarKey(pdfName));
    return raw ? (JSON.parse(raw) as SidecarData) : null;
  } catch {
    return null;
  }
}

/** Save the annotation sidecar. */
export async function saveSidecar(pdfName: string, data: SidecarData): Promise<void> {
  if (isTauri()) {
    try {
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const dir = await appDataDir();
      await mkdir(dir, { recursive: true });
      await writeTextFile(await join(dir, sidecarFileName(pdfName)), JSON.stringify(data));
    } catch {
      // Autosave must never break drawing; ignore write failures.
    }
    return;
  }
  try {
    localStorage.setItem(sidecarKey(pdfName), JSON.stringify(data));
  } catch {
    // Storage full / private mode — ignore.
  }
}

/** Persist window size (desktop) so the app reopens at the same size. */
export function saveWindowSize(): void {
  try {
    localStorage.setItem(
      'lightpen:window',
      JSON.stringify({ w: window.innerWidth, h: window.innerHeight }),
    );
  } catch {
    // ignore
  }
}

export async function restoreWindowSize(): Promise<void> {
  if (!isTauri()) return;
  try {
    const raw = localStorage.getItem('lightpen:window');
    if (!raw) return;
    const { w, h } = JSON.parse(raw) as { w?: number; h?: number };
    if (typeof w === 'number' && typeof h === 'number' && w > 200 && h > 200) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { LogicalSize } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setSize(new LogicalSize(w, h));
    }
  } catch {
    // ignore
  }
}
