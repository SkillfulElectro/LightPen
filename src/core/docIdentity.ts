/**
 * Stable identity for a document, derived from its bytes.
 *
 * Sidecars used to be keyed by file name alone, so `report.pdf` in two folders
 * shared one set of annotations. Keying by content fixes that: the same file
 * opened from anywhere gets the same identity, and two different files never
 * collide, even when they share a name. Renaming a file also keeps its ink.
 *
 * Pure logic, no DOM — usable from the browser build, Tauri and tests.
 */

/** FNV-1a over the whole buffer: fast, no dependency, good spread for our use. */
function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Content key for a document: `<length>-<fnv1a>`. The same bytes always give the
 * same key; the length also separates documents that differ only in trailing
 * bytes. The whole buffer is hashed — a PDF's trailer carries the cross-reference
 * table — which is one linear pass over bytes already in memory.
 */
export function contentKey(bytes: Uint8Array): string {
  return `${bytes.length.toString(36)}-${fnv1a(bytes).toString(16).padStart(8, '0')}`;
}

/**
 * Sidecar file name for a content key. Note what is *not* in it: the document
 * name. No user-supplied string reaches the file system, and renaming a file
 * cannot orphan its annotations. The original name is kept inside the JSON.
 */
export function sidecarFileName(key: string): string {
  const safe = key.replace(/[^a-z0-9-]/gi, '').slice(0, 64);
  return `${safe || 'unknown'}.lightpen.json`;
}
