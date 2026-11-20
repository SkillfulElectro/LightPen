import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildAnnotatedPdf } from './core/pdfExport';
import { useStore, tutorialSeen } from './store/useStore';
import { isTauri, restoreWindowSize, saveBytesAs, saveWindowSize } from './platform/tauri';
import CameraPreview from './ui/CameraPreview';
import { CheatSheet, PermissionDialog, SettingsDialog, ShortcutsHelp } from './ui/Dialogs';
import PdfViewer from './ui/PdfViewer';
import Toolbar from './ui/Toolbar';
import Tutorial from './ui/Tutorial';

export default function App() {
  const { t } = useTranslation();
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const settings = useStore((s) => s.settings);
  const setPdf = useStore((s) => s.setPdf);
  const setTutorialOpen = useStore((s) => s.setTutorialOpen);
  const setCheatSheetOpen = useStore((s) => s.setCheatSheetOpen);
  const noteGesture = useStore((s) => s.noteGesture);
  const currentPage = useStore((s) => s.currentPage);

  // First-run tutorial.
  useEffect(() => {
    if (!tutorialSeen()) setTutorialOpen(true);
    void restoreWindowSize();
    const onResize = () => saveWindowSize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setTutorialOpen]);

  // Theme (light/dark/system).
  useEffect(() => {
    const apply = () => {
      const dark =
        settings.theme === 'dark' ||
        (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);

  // "Open with" from the OS (double-click / Finder) and CLI arguments.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let unlistenMenu: (() => void) | undefined;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');
        const openPath = async (path: string) => {
          const file = await invoke<{ name: string; bytes: number[] } | null>('read_open_file', {
            path,
          });
          if (!file) return;
          setPdfBytes(new Uint8Array(file.bytes));
          setPdfName(file.name);
        };
        unlisten = await listen<string>(
          'lightpen:open-path',
          (event) => void openPath(event.payload),
        );

        // Native menu → same actions as the toolbar / shortcuts.
        const navigate: Record<string, () => void> = {
          open: () => window.dispatchEvent(new CustomEvent('lightpen:open-dialog')),
          undo: () => useStore.getState().undo(),
          redo: () => useStore.getState().redo(),
          zoom_in: () => useStore.getState().setZoom(useStore.getState().zoom + 0.25),
          zoom_out: () => useStore.getState().setZoom(useStore.getState().zoom - 0.25),
          fit_page: () => useStore.getState().setFitMode('fit-page'),
          tutorial: () => useStore.getState().setTutorialOpen(true),
          cheat_sheet: () => useStore.getState().setCheatSheetOpen(true),
          shortcuts: () => useStore.getState().setShortcutsOpen(true),
          export_pdf: () => window.dispatchEvent(new CustomEvent('lightpen:export-pdf')),
          export_png: () => window.dispatchEvent(new CustomEvent('lightpen:export-png')),
        };
        unlistenMenu = await listen<string>('lightpen:menu', (event) =>
          navigate[event.payload]?.(),
        );
      } catch {
        // Tauri APIs unavailable (web build) — nothing to do.
      }
    })();
    return () => {
      unlisten?.();
      unlistenMenu?.();
    };
  }, []);

  // Files opened via dialog / drag-and-drop (dispatched from PdfViewer).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ name: string; bytes: Uint8Array }>).detail;
      setPdfBytes(detail.bytes);
      setPdfName(detail.name);
    };
    window.addEventListener('lightpen:file', handler);
    return () => window.removeEventListener('lightpen:file', handler);
  }, []);

  const onPdfLoaded = useCallback(
    (
      name: string,
      bytes: Uint8Array,
      pageCount: number,
      pageSizes: { width: number; height: number }[],
    ) => {
      setPdf({ name, bytes, pageCount, pageSizes });
    },
    [setPdf],
  );

  const loadSample = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample.pdf`);
      const buf = await res.arrayBuffer();
      setPdfBytes(new Uint8Array(buf));
      setPdfName('sample.pdf');
    } catch {
      // Sample missing — ignore.
    }
  }, []);

  const exportPdf = useCallback(async () => {
    // Invoked from the toolbar and from the native File menu.
    const state = useStore.getState();
    const doc = state.pdf;
    if (!doc) return;
    const bytes = await buildAnnotatedPdf(doc.bytes, state.annotations.all);
    const out = doc.name.replace(/\.pdf$/i, '') + '.annotated.pdf';
    await saveBytesAs(out, bytes);
  }, []);

  const exportPng = useCallback(async () => {
    const pageCanvas = document.querySelector<HTMLCanvasElement>('.page-canvas');
    const inkCanvas = document.querySelector<HTMLCanvasElement>('.ink-canvas');
    if (!pageCanvas || !inkCanvas) return;
    const out = document.createElement('canvas');
    out.width = pageCanvas.width;
    out.height = pageCanvas.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(pageCanvas, 0, 0);
    ctx.drawImage(inkCanvas, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const name = (pdfName ?? 'page').replace(/\.pdf$/i, '') + `-page-${currentPage + 1}.png`;
    await saveBytesAs(name, bytes);
  }, [pdfName, currentPage]);

  // Native menu export commands.
  useEffect(() => {
    const onPdf = () => void exportPdf();
    const onPng = () => void exportPng();
    window.addEventListener('lightpen:export-pdf', onPdf);
    window.addEventListener('lightpen:export-png', onPng);
    return () => {
      window.removeEventListener('lightpen:export-pdf', onPdf);
      window.removeEventListener('lightpen:export-png', onPng);
    };
  }, [exportPdf, exportPng]);

  // Keyboard shortcuts (desktop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA'
      )
        return;
      const mod = e.ctrlKey || e.metaKey;
      const s = useStore.getState();
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('lightpen:open-dialog'));
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if (
        mod &&
        (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        s.redo();
      } else if (mod && e.key === '+') {
        s.setZoom(s.zoom + 0.25);
      } else if (mod && e.key === '-') {
        s.setZoom(s.zoom - 0.25);
      } else if (e.key === '0') {
        s.setFitMode('fit-page');
      } else if (e.key === 'ArrowRight') {
        s.setCurrentPage(s.currentPage + 1);
      } else if (e.key === 'ArrowLeft') {
        s.setCurrentPage(s.currentPage - 1);
      } else if (e.key.toLowerCase() === 'e') {
        s.setTool('eraser');
      } else if (e.key.toLowerCase() === 'b') {
        s.setTool('pen');
      } else if (e.key === '?') {
        s.setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Size of the page on screen, published by the viewer. Stored as a stable
  // reference: a selector returning a fresh object would re-render forever.
  const pageSize = useStore((s) => s.currentPageSize);

  return (
    <div className="app">
      <Toolbar
        onOpen={() => window.dispatchEvent(new CustomEvent('lightpen:open-dialog'))}
        onSample={() => void loadSample()}
        onExportPdf={() => void exportPdf()}
        onExportPng={() => void exportPng()}
      />
      <main className="app-main">
        <section className="viewer-section" aria-label="PDF viewer">
          <PdfViewer pdfBytes={pdfBytes} pdfName={pdfName} onPdfLoaded={onPdfLoaded} />
        </section>
        <aside className="side-panel">
          <CameraPreview pageSize={pageSize} onGesture={noteGesture} />
          <p className="side-hint">{t('app.tagline')}</p>
          <button type="button" className="link-button" onClick={() => setCheatSheetOpen(true)}>
            ✋ {t('toolbar.cheatSheet')}
          </button>
        </aside>
      </main>
      <PermissionDialog />
      <SettingsDialog />
      <CheatSheet />
      <ShortcutsHelp />
      <Tutorial />
    </div>
  );
}
