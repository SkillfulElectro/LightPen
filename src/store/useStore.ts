/**
 * Application state (Zustand). Hot-path coordinates (hand cursor, active stroke)
 * live on mutable refs/state read directly by the canvas loop to avoid React re-renders.
 */
import { create } from 'zustand';
import { AnnotationStore } from '../core/annotations';
import { sanitizeSettings } from '../core/settings';
import type {
  ActiveComputeBackend,
  AirCursorState,
  PageSize,
  Settings,
  Stroke,
  TutorialPace,
} from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import { saveSidecar } from '../platform/tauri';
import { createSidecarWriter, restoreAnnotations as restoreFromSidecar } from './sidecar';

export type Tool = 'pen' | 'eraser';
export type FitMode = 'fit-width' | 'fit-page' | 'manual';

export interface PdfDoc {
  name: string;
  bytes: Uint8Array;
  pageCount: number;
  pageSizes: PageSize[];
  /** Content key (see core/docIdentity) that keeps same-named files apart. */
  key: string;
}

export interface TrackingState {
  active: boolean;
  fps: number;
  handPresent: boolean;
  hint: 'too-far' | 'too-close' | 'low-light' | 'out-of-frame' | null;
  backend: ActiveComputeBackend;
}

interface AppState {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;

  pdf: PdfDoc | null;
  setPdf: (doc: PdfDoc | null) => void;
  /** Size of the page currently on screen (used for air-writing mapping). */
  currentPageSize: PageSize;
  setCurrentPageSize: (size: PageSize) => void;
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
  /** Step to start on when the tutorial opens (0 = welcome). */
  tutorialStartStep: number;
  setTutorialOpen: (open: boolean, startStep?: number) => void;
  permissionOpen: boolean;
  setPermissionOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** Bumped when the user asks to re-run calibration from Settings. */
  calibrateRequest: number;
  requestCalibration: () => void;
  cheatSheetOpen: boolean;
  setCheatSheetOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  /** Tutorial pacing cadence (guided/normal/quick). */
  tutorialPace: TutorialPace;
  setTutorialPace: (pace: TutorialPace) => void;

  /** Hot-path refs (no re-renders). */
  handCursor: { x: number; y: number; kind: string } | null;
  airCursor: AirCursorState | null;
  activeStroke: Stroke | null;
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
    const settings = sanitizeSettings({ ...get().settings, ...patch });
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
  setPdf: (doc) => set({ pdf: doc, currentPage: 0, activeStroke: null }),
  currentPageSize: { width: 612, height: 792 },
  setCurrentPageSize: (size) => {
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return;
    if (size.width <= 0 || size.height <= 0) return;
    const prev = get().currentPageSize;
    if (prev.width === size.width && prev.height === size.height) return;
    set({ currentPageSize: size });
  },
  currentPage: 0,
  setCurrentPage: (page) => {
    if (!Number.isFinite(page)) return;
    const { pdf } = get();
    const max = pdf ? Math.max(0, pdf.pageCount - 1) : 0;
    const next = Math.min(Math.max(Math.trunc(page), 0), max);
    if (next === get().currentPage) return;
    set({ currentPage: next, activeStroke: null });
  },
  zoom: 1,
  setZoom: (zoom) => {
    if (!Number.isFinite(zoom)) return;
    set({ zoom: Math.min(4, Math.max(0.25, zoom)), fitMode: 'manual' });
  },
  setFitScale: (zoom) => {
    if (!Number.isFinite(zoom)) return;
    set({ zoom: Math.min(4, Math.max(0.25, zoom)) });
  },
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
      activeStroke: null,
    });
    scheduleAutosave(get);
  },

  tracking: { active: false, fps: 0, handPresent: false, hint: null, backend: 'CPU+GPU' },
  setTracking: (patch) => {
    const cur = get().tracking;
    let changed = false;
    for (const k of Object.keys(patch) as (keyof TrackingState)[]) {
      if (patch[k] !== cur[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    set({ tracking: { ...cur, ...patch } });
  },

  lastGesture: { kind: 'none', seq: 0 },
  noteGesture: (kind) => set({ lastGesture: { kind, seq: get().lastGesture.seq + 1 } }),

  tutorialOpen: false,
  tutorialStartStep: 0,
  setTutorialOpen: (open, startStep = 0) => {
    if (!open) {
      try {
        localStorage.setItem(TUTORIAL_KEY, '1');
      } catch {
        // ignore
      }
    }
    set({ tutorialOpen: open, tutorialStartStep: startStep });
  },
  permissionOpen: false,
  setPermissionOpen: (open) => set({ permissionOpen: open }),
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  calibrateRequest: 0,
  requestCalibration: () => {
    set({
      settingsOpen: false,
      tutorialOpen: true,
      tutorialStartStep: 3,
      calibrateRequest: get().calibrateRequest + 1,
    });
  },
  cheatSheetOpen: false,
  setCheatSheetOpen: (open) => set({ cheatSheetOpen: open }),
  shortcutsOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  tutorialPace: 'guided',
  setTutorialPace: (tutorialPace) => set({ tutorialPace }),

  handCursor: null,
  airCursor: null,
  activeStroke: null,
}));

/** Autosave writer shared by every mutation that changes annotations. */
const autosave = createSidecarWriter(800, saveSidecar);

function scheduleAutosave(get: () => AppState): void {
  const { pdf, annotations } = get();
  if (!pdf) return;
  // Capture the key and serializer, not a live store read: a save that lands
  // after the document changed must not write old ink under the new key.
  const store = annotations;
  autosave.schedule({ key: pdf.key, serialize: () => store.serialize() });
}

/** Restore annotations for a freshly opened PDF (keyed by content). */
export async function restoreAnnotations(key: string): Promise<void> {
  const store = await restoreFromSidecar(key);
  useStore.setState({
    annotations: store,
    strokesVersion: useStore.getState().strokesVersion + 1,
    canUndo: false,
    canRedo: false,
    activeStroke: null,
  });
}

/** Write any pending sidecar immediately (export, page hide, window close). */
export function flushAutosave(): Promise<void> {
  return autosave.flush();
}

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}
