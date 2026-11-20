/**
 * Sidecar persistence: debounced autosave and restore, kept apart from the store
 * so the store stays synchronous and this file can be tested on its own.
 *
 * Sidecars are keyed by document *content* (see core/docIdentity), so the same
 * file opened from anywhere keeps its ink and same-named files never share it.
 */

import { AnnotationStore } from '../core/annotations';
import { contentKey } from '../core/docIdentity';
import { loadSidecar, saveSidecar } from '../platform/tauri';

/** Longest autosave delay; drawing for minutes must not postpone the save. */
const MAX_AUTOSAVE_WAIT_MS = 5000;

export interface SidecarTarget {
  /** Stable document identity; the sidecar file name is derived from it. */
  key: string;
  serialize: () => ReturnType<AnnotationStore['serialize']>;
}

export interface SidecarWriter {
  schedule: (target: SidecarTarget) => void;
  /** Write now if a save is pending (page hide, export, document close). */
  flush: () => Promise<void>;
  cancel: () => void;
}

/**
 * Debounce writes by `delayMs`, but hold the interval down while the user keeps
 * drawing: the payload keeps changing, so waiting for a pause risks losing the
 * last strokes on a crash.
 */
export function createSidecarWriter(
  delayMs: number,
  save: (key: string, data: ReturnType<AnnotationStore['serialize']>) => Promise<void>,
  now: () => number = Date.now,
): SidecarWriter {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstQueuedAt: number | null = null;
  let pending: SidecarTarget | null = null;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    firstQueuedAt = null;
  };

  const write = async () => {
    const target = pending;
    cancel();
    pending = null;
    if (!target) return;
    await save(target.key, target.serialize());
  };

  const schedule = (target: SidecarTarget) => {
    pending = target;
    if (timer !== null) clearTimeout(timer);
    const at = now();
    if (firstQueuedAt === null) firstQueuedAt = at;
    // Deadline measured from the first change in this burst, so a long stroke
    // cannot starve the save (a `null` sentinel, not 0 — the clock may be 0).
    const remaining = Math.max(0, MAX_AUTOSAVE_WAIT_MS - (at - firstQueuedAt));
    const wait = Math.min(delayMs, remaining);
    timer = setTimeout(() => void write(), wait);
  };

  return { schedule, flush: write, cancel };
}

/** Restore annotations for a document, or start clean if it has none. */
export async function restoreAnnotations(key: string): Promise<AnnotationStore> {
  const data = await loadSidecar(key);
  return data ? AnnotationStore.deserialize(data) : new AnnotationStore();
}

export { contentKey, saveSidecar };
