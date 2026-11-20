import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';

interface Props {
  onOpen: () => void;
  onSample: () => void;
  onExportPdf: () => void;
  onExportPng: () => void;
}

export default function Toolbar({ onOpen, onSample, onExportPdf, onExportPng }: Props) {
  const { t } = useTranslation();
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const currentPage = useStore((s) => s.currentPage);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const pdf = useStore((s) => s.pdf);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const setFitMode = useStore((s) => s.setFitMode);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const clearPage = useStore((s) => s.clearPage);
  const trackingActive = useStore((s) => s.tracking.active);
  const setPermissionOpen = useStore((s) => s.setPermissionOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setTutorialOpen = useStore((s) => s.setTutorialOpen);
  const setCheatSheetOpen = useStore((s) => s.setCheatSheetOpen);
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const pageCount = pdf?.pageCount ?? 0;

  return (
    <header className="toolbar" role="toolbar" aria-label={t('app.title')}>
      <span className="brand">{t('app.title')}</span>
      <div className="toolbar-group">
        <button type="button" onClick={onOpen}>
          {t('toolbar.open')}
        </button>
        <button type="button" onClick={onSample}>
          {t('toolbar.sample')}
        </button>
      </div>
      <div className="toolbar-group" role="group" aria-label={t('toolbar.pen')}>
        <button
          type="button"
          className={tool === 'pen' ? 'active' : ''}
          onClick={() => setTool('pen')}
          aria-pressed={tool === 'pen'}
          aria-label={t('toolbar.pen')}
        >
          🖊
        </button>
        <button
          type="button"
          className={tool === 'eraser' ? 'active' : ''}
          onClick={() => setTool('eraser')}
          aria-pressed={tool === 'eraser'}
          aria-label={t('toolbar.eraser')}
        >
          🧽
        </button>
        <label className="color-picker">
          <input
            type="color"
            value={settings.penColor}
            onChange={(e) => updateSettings({ penColor: e.target.value })}
            aria-label={t('toolbar.pen')}
          />
        </label>
        <label className="width-picker">
          <input
            type="range"
            min={0.5}
            max={12}
            step={0.5}
            value={settings.penWidth}
            onChange={(e) => updateSettings({ penWidth: Number(e.target.value) })}
            aria-label={t('toolbar.pen')}
          />
        </label>
      </div>
      <div className="toolbar-group">
        <button type="button" onClick={undo} disabled={!canUndo} aria-label={t('toolbar.undo')}>
          ↩
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} aria-label={t('toolbar.redo')}>
          ↪
        </button>
        <button
          type="button"
          onClick={() => clearPage(currentPage)}
          aria-label={t('toolbar.clearPage')}
        >
          🗑
        </button>
      </div>
      <div className="toolbar-group" role="group" aria-label="Pages">
        <button
          type="button"
          onClick={() => setCurrentPage(currentPage - 1)}
          disabled={currentPage <= 0}
          aria-label={t('toolbar.prevPage')}
        >
          ‹
        </button>
        <span className="page-label" aria-live="polite">
          {t('viewer.pageOf', { current: currentPage + 1, total: pageCount || '–' })}
        </span>
        <button
          type="button"
          onClick={() => setCurrentPage(currentPage + 1)}
          disabled={pageCount === 0 || currentPage >= pageCount - 1}
          aria-label={t('toolbar.nextPage')}
        >
          ›
        </button>
        <input
          type="number"
          className="goto-input"
          min={1}
          max={pageCount || 1}
          value={currentPage + 1}
          onChange={(e) => setCurrentPage(Number(e.target.value) - 1)}
          aria-label={t('viewer.pageOf', { current: currentPage + 1, total: pageCount || '–' })}
        />
      </div>
      <div className="toolbar-group" role="group" aria-label="Zoom">
        <button
          type="button"
          onClick={() => setZoom(zoom - 0.25)}
          aria-label={t('toolbar.zoomOut')}
        >
          −
        </button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(zoom + 0.25)} aria-label={t('toolbar.zoomIn')}>
          +
        </button>
        <button
          type="button"
          onClick={() => setFitMode('fit-width')}
          aria-label={t('toolbar.fitWidth')}
        >
          {t('toolbar.fitWidth')}
        </button>
        <button
          type="button"
          onClick={() => setFitMode('fit-page')}
          aria-label={t('toolbar.fitPage')}
        >
          {t('toolbar.fitPage')}
        </button>
      </div>
      <div className="toolbar-group">
        <button
          type="button"
          className={trackingActive ? 'active' : ''}
          onClick={() => setPermissionOpen(true)}
          aria-pressed={trackingActive}
          aria-label={t('toolbar.camera')}
        >
          📷 {t('toolbar.camera')}
        </button>
        <button
          type="button"
          onClick={() => setTutorialOpen(true)}
          aria-label={t('toolbar.tutorial')}
        >
          🎓
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={t('toolbar.settings')}
        >
          ⚙
        </button>
        <button
          type="button"
          onClick={() => setCheatSheetOpen(true)}
          aria-label={t('toolbar.cheatSheet')}
        >
          ✋
        </button>
        <button type="button" onClick={() => setShortcutsOpen(true)} aria-label={t('toolbar.help')}>
          ?
        </button>
      </div>
      <div className="toolbar-group">
        <button
          type="button"
          onClick={onExportPdf}
          disabled={!pdf}
          aria-label={t('toolbar.exportPdf')}
        >
          {t('toolbar.exportPdf')}
        </button>
        <button
          type="button"
          onClick={onExportPng}
          disabled={!pdf}
          aria-label={t('toolbar.exportPng')}
        >
          {t('toolbar.exportPng')}
        </button>
      </div>
    </header>
  );
}
