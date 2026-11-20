/**
 * Global app state (Zustand).
 * Hot-path data (in-progress stroke, hand cursor, FPS) lives in refs,
 * never in React state, to avoid re-renders during tracking.
 */

import { create } from 'zustand';
import { AnnotationStore } from '../core/annotations';
import { sanitizeSettings } from '../core/settings';
import type { PageSize, Settings, Stroke } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import { loadSidecar, saveSidecar } from '../platform/tauri';

export type Tool = 'pen' | 'eraser';
export type FitMode = 'fit-width' | 'fit-page' | 'manual';

export interface PdfDoc {
  name: string;
  bytes: Uint8Array;
  pageCount: number;
  pageSizes: PageSize[];
}

export interface TrackingState {
  active: boolean;
  fps: number;
  handPresent: boolean;
  hint: 'too-far' | 'too-close' | 'low-light' | 'out-of-frame' | null;
}

interface AppState {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;

  pdf: PdfDoc | null;
  setPdf: (doc: PdfDoc | null) => void;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  /** Update the displayed zoom without leaving the current fit mode. */
  setFitScale: (zoom: number) => void;
  fitMode: FitMode;
  setFitMode: (mode: FitMode) => void;

  tool: Tool;
  setTool: (tool: Tool) => void;

  /** Annotation store (mutable, non-reactive). Bump `strokesVersion` to redraw. */
  annotations: AnnotationStore;
  strokesVersion: number;
  addStroke: (stroke: Stroke) => void;
  eraseAt: (page: number, point: { x: number; y: number }, radius: number) => void;
  undo: () => void;
  redo: () => void;
  clearPage: (page: number) => void;
  canUndo: boolean;
  canRedo: boolean;

  tracking: TrackingState;
  setTracking: (patch: Partial<TrackingState>) => void;
  /** Last gesture emitted by the tracker; `seq` lets the tutorial react to repeats. */
  lastGesture: { kind: string; seq: number };
  noteGesture: (kind: string) => void;

  tutorialOpen: boolean;
  setTutorialOpen: (open: boolean) => void;
  permissionOpen: boolean;
  setPermissionOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  cheatSheetOpen: boolean;
  setCheatSheetOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;

  /** Hot-path refs (no re-renders). */
  handCursor: { x: number; y: number; kind: string } | null;
  activeStroke: Stroke | null;
  autosaveTimer: ReturnType<typeof setTimeout> | null;
}

const SETTINGS_KEY = 'lightpen:settings';
const TUTORIAL_KEY = 'lightpen:tutorial-seen';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const useStore = create<AppState>((set, get) => ({
  settings: loadSettings(),
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
    set({ settings });
  },
  resetSettings: () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
    } catch {
      // ignore
    }
    set({ settings: { ...DEFAULT_SETTINGS } });
  },

  pdf: null,
  setPdf: (doc) => set({ pdf: doc, currentPage: 0 }),
  currentPage: 0,
  setCurrentPage: (page) => {
    const { pdf } = get();
    const max = pdf ? pdf.pageCount - 1 : 0;
    set({ currentPage: Math.min(Math.max(page, 0), max) });
  },
  zoom: 1,
  setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.25, zoom)), fitMode: 'manual' }),
  setFitScale: (zoom) => set({ zoom: Math.min(4, Math.max(0.25, zoom)) }),
  fitMode: 'fit-width',
  setFitMode: (mode) => set({ fitMode: mode }),

  tool: 'pen',
  setTool: (tool) => set({ tool }),

  annotations: new AnnotationStore(),
  strokesVersion: 0,
  canUndo: false,
  canRedo: false,
  addStroke: (stroke) => {
    const { annotations } = get();
    annotations.addStroke(stroke);
    set({
      strokesVersion: get().strokesVersion + 1,
      canUndo: annotations.canUndo(),
      canRedo: annotations.canRedo(),
    });
    scheduleAutosave(get);
  },
  eraseAt: (page, point, radius) => {
    const { annotations } = get();
    const erased = annotations.eraseAt(page, point, radius);
    if (erased.length > 0) {
      set({
        strokesVersion: get().strokesVersion + 1,
        canUndo: annotations.canUndo(),
        canRedo: annotations.canRedo(),
      });
      scheduleAutosave(get);
    }
  },
  undo: () => {
    const { annotations } = get();
    if (annotations.undo()) {
      set({
        strokesVersion: get().strokesVersion + 1,
        canUndo: annotations.canUndo(),
        canRedo: annotations.canRedo(),
      });
      scheduleAutosave(get);
    }
  },
  redo: () => {
    const { annotations } = get();
    if (annotations.redo()) {
      set({
        strokesVersion: get().strokesVersion + 1,
        canUndo: annotations.canUndo(),
        canRedo: annotations.canRedo(),
      });
      scheduleAutosave(get);
    }
  },
  clearPage: (page) => {
    const { annotations } = get();
    annotations.clearPage(page);
    set({
      strokesVersion: get().strokesVersion + 1,
      canUndo: annotations.canUndo(),
      canRedo: annotations.canRedo(),
    });
    scheduleAutosave(get);
  },

  tracking: { active: false, fps: 0, handPresent: false, hint: null },
  setTracking: (patch) => set({ tracking: { ...get().tracking, ...patch } }),
  lastGesture: { kind: 'none', seq: 0 },
  noteGesture: (kind) => set({ lastGesture: { kind, seq: get().lastGesture.seq + 1 } }),

  tutorialOpen: false,
  setTutorialOpen: (open) => {
    if (!open) {
      try {
        localStorage.setItem(TUTORIAL_KEY, '1');
      } catch {
        // ignore
      }
    }
    set({ tutorialOpen: open });
  },
  permissionOpen: false,
  setPermissionOpen: (open) => set({ permissionOpen: open }),
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  cheatSheetOpen: false,
  setCheatSheetOpen: (open) => set({ cheatSheetOpen: open }),
  shortcutsOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

  handCursor: null,
  activeStroke: null,
  autosaveTimer: null,
}));

function scheduleAutosave(get: () => AppState): void {
  const state = get();
  if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
  const timer = setTimeout(() => {
    const s = get();
    if (s.pdf) void saveSidecar(s.pdf.name, s.annotations.serialize());
  }, 800);
  useStore.setState({ autosaveTimer: timer });
}

/** Restore annotations for a freshly opened PDF. */
export async function restoreAnnotations(pdfName: string): Promise<void> {
  const data = await loadSidecar(pdfName);
  const store = data ? AnnotationStore.deserialize(data) : new AnnotationStore();
  useStore.setState({
    annotations: store,
    strokesVersion: useStore.getState().strokesVersion + 1,
    canUndo: false,
    canRedo: false,
  });
}

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}
