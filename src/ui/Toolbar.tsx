/**
 * Modern studio toolbar: crisp vector icons, ink presets, fit/zoom controls,
 * one-click dark/light theme toggle, camera tracking status, and PDF/PNG export.
 */
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
import {
  BrandNibIcon,
  CameraIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  EraserIcon,
  FileTextIcon,
  FolderOpenIcon,
  GraduationCapIcon,
  HandIcon,
  HelpIcon,
  ImageIcon,
  MoonIcon,
  PenIcon,
  RedoIcon,
  SettingsIcon,
  SunIcon,
  TrashIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from './Icons';

interface Props {
  onOpen: () => void;
  onSample: () => void;
  onExportPdf: () => void;
  onExportPng: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

const INK_SWATCHES = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#111827'];

export default function Toolbar({
  onOpen,
  onSample,
  onExportPdf,
  onExportPng,
  isDark,
  onToggleTheme,
}: Props) {
  const { t } = useTranslation();
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const currentPage = useStore((s) => s.currentPage);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const pdf = useStore((s) => s.pdf);
  const zoom = useStore((s) => s.zoom);
  const fitMode = useStore((s) => s.fitMode);
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
      <div className="brand-lockup">
        <BrandNibIcon className="brand-icon" />
        <span className="brand">{t('app.title')}</span>
        <span className="brand-version">v0.1.10</span>
      </div>

      <div className="toolbar-divider" aria-hidden="true" />

      <div className="toolbar-group">
        <button type="button" className="btn-primary" onClick={onOpen} title={t('toolbar.open')}>
          <FolderOpenIcon />
          <span>{t('toolbar.open')}</span>
        </button>
        <button type="button" onClick={onSample} title={t('toolbar.sample')}>
          <FileTextIcon />
          <span>{t('toolbar.sample')}</span>
        </button>
      </div>

      <div className="toolbar-divider" aria-hidden="true" />

      <div className="toolbar-group segmented" role="group" aria-label={t('toolbar.pen')}>
        <button
          type="button"
          className={`icon-btn ${tool === 'pen' ? 'active' : ''}`}
          onClick={() => setTool('pen')}
          aria-pressed={tool === 'pen'}
          aria-label={t('toolbar.pen')}
          title={t('toolbar.pen')}
        >
          <PenIcon />
        </button>
        <button
          type="button"
          className={`icon-btn ${tool === 'eraser' ? 'active' : ''}`}
          onClick={() => setTool('eraser')}
          aria-pressed={tool === 'eraser'}
          aria-label={t('toolbar.eraser')}
          title={t('toolbar.eraser')}
        >
          <EraserIcon />
        </button>
        <div className="swatch-row" role="group" aria-label="Ink presets">
          {INK_SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              className={`color-swatch ${settings.penColor.toLowerCase() === hex ? 'selected' : ''}`}
              style={{ backgroundColor: hex }}
              onClick={() => {
                setTool('pen');
                updateSettings({ penColor: hex });
              }}
              aria-label={`Ink ${hex}`}
              title={hex}
            />
          ))}
        </div>
        <label className="color-picker" title={t('settings.penColor')}>
          <input
            type="color"
            value={settings.penColor}
            onChange={(e) => {
              setTool('pen');
              updateSettings({ penColor: e.target.value });
            }}
            aria-label={t('toolbar.pen')}
          />
        </label>
        <label className="width-picker" title={t('settings.penWidth')}>
          <span
            className="width-dot"
            aria-hidden="true"
            style={{
              width: Math.max(4, Math.min(14, settings.penWidth * 1.4)),
              height: Math.max(4, Math.min(14, settings.penWidth * 1.4)),
              backgroundColor: settings.penColor,
            }}
          />
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
        <button
          type="button"
          className="icon-btn"
          onClick={undo}
          disabled={!canUndo}
          aria-label={t('toolbar.undo')}
          title={t('toolbar.undo')}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={redo}
          disabled={!canRedo}
          aria-label={t('toolbar.redo')}
          title={t('toolbar.redo')}
        >
          <RedoIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => clearPage(currentPage)}
          aria-label={t('toolbar.clearPage')}
          title={t('toolbar.clearPage')}
        >
          <TrashIcon />
        </button>
      </div>

      <div className="toolbar-divider" aria-hidden="true" />

      <div className="toolbar-group" role="group" aria-label="Pages">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCurrentPage(currentPage - 1)}
          disabled={currentPage <= 0}
          aria-label={t('toolbar.prevPage')}
          title={t('toolbar.prevPage')}
        >
          <ChevronLeftIcon />
        </button>
        <span className="page-label" aria-live="polite">
          {t('viewer.pageOf', { current: currentPage + 1, total: pageCount || '–' })}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCurrentPage(currentPage + 1)}
          disabled={pageCount === 0 || currentPage >= pageCount - 1}
          aria-label={t('toolbar.nextPage')}
          title={t('toolbar.nextPage')}
        >
          <ChevronRightIcon />
        </button>
        <input
          type="number"
          className="goto-input"
          min={1}
          max={pageCount || 1}
          value={currentPage + 1}
          onChange={(e) => {
            const parsed = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(parsed)) setCurrentPage(parsed - 1);
          }}
          aria-label={t('viewer.pageOf', { current: currentPage + 1, total: pageCount || '–' })}
        />
      </div>

      <div className="toolbar-group" role="group" aria-label="Zoom">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setZoom(zoom - 0.25)}
          aria-label={t('toolbar.zoomOut')}
          title={t('toolbar.zoomOut')}
        >
          <ZoomOutIcon />
        </button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setZoom(zoom + 0.25)}
          aria-label={t('toolbar.zoomIn')}
          title={t('toolbar.zoomIn')}
        >
          <ZoomInIcon />
        </button>
        <button
          type="button"
          className={fitMode === 'fit-width' ? 'active' : ''}
          onClick={() => setFitMode('fit-width')}
          aria-label={t('toolbar.fitWidth')}
        >
          {t('toolbar.fitWidth')}
        </button>
        <button
          type="button"
          className={fitMode === 'fit-page' ? 'active' : ''}
          onClick={() => setFitMode('fit-page')}
          aria-label={t('toolbar.fitPage')}
        >
          {t('toolbar.fitPage')}
        </button>
      </div>

      <div className="toolbar-spacer" aria-hidden="true" />

      <div className="toolbar-group">
        <button
          type="button"
          className={trackingActive ? 'active' : ''}
          onClick={() => setPermissionOpen(true)}
          aria-pressed={trackingActive}
          aria-label={t('toolbar.camera')}
          title={t('toolbar.camera')}
        >
          <CameraIcon />
          <span>{t('toolbar.camera')}</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          aria-pressed={isDark}
          aria-label={t(isDark ? 'toolbar.themeLight' : 'toolbar.themeDark')}
          title={t(isDark ? 'toolbar.themeLight' : 'toolbar.themeDark')}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setTutorialOpen(true)}
          aria-label={t('toolbar.tutorial')}
          title={t('toolbar.tutorial')}
        >
          <GraduationCapIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label={t('toolbar.settings')}
          title={t('toolbar.settings')}
        >
          <SettingsIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCheatSheetOpen(true)}
          aria-label={t('toolbar.cheatSheet')}
          title={t('toolbar.cheatSheet')}
        >
          <HandIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setShortcutsOpen(true)}
          aria-label={t('toolbar.help')}
          title={t('toolbar.help')}
        >
          <HelpIcon />
        </button>
      </div>

      <div className="toolbar-divider" aria-hidden="true" />

      <div className="toolbar-group">
        <button
          type="button"
          onClick={onExportPdf}
          disabled={!pdf}
          aria-label={t('toolbar.exportPdf')}
          title={t('toolbar.exportPdf')}
        >
          <DownloadIcon />
          <span>{t('toolbar.exportPdf')}</span>
        </button>
        <button
          type="button"
          onClick={onExportPng}
          disabled={!pdf}
          aria-label={t('toolbar.exportPng')}
          title={t('toolbar.exportPng')}
        >
          <ImageIcon />
          <span>{t('toolbar.exportPng')}</span>
        </button>
      </div>
    </header>
  );
}
