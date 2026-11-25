/** Modal dialogs: camera permission rationale, settings, cheat sheet, shortcuts. */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  pinchThresholdToSensitivity,
  releaseThresholdFor,
  sensitivityToPinchThreshold,
} from '../core/settings';
import { LANGUAGES, initI18n } from '../i18n';
import type { ComputeBackend, GestureMode } from '../core/types';
import { getFullDiagnosticReport, getNativeLogPath } from '../platform/logger';
import { getComputeCapabilities } from '../platform/mediapipe';
import { saveBytesAs } from '../platform/tauri';
import { useStore } from '../store/useStore';
import { CloseIcon } from './Icons';
import { PauseIllustration } from './illustrations';
import { startTracking } from './trackingHandle';

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Focus the dialog on open and restore focus when it closes (a11y).
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={title + ' — close'}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function PermissionDialog() {
  const { t } = useTranslation();
  const open = useStore((s) => s.permissionOpen);
  const setOpen = useStore((s) => s.setPermissionOpen);
  if (!open) return null;
  return (
    <Modal title={t('camera.rationaleTitle')} onClose={() => setOpen(false)}>
      <p>{t('camera.rationaleBody')}</p>
      <p className="privacy-note">{t('camera.privacy')}</p>
      <div className="modal-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setOpen(false);
            void startTracking();
          }}
        >
          {t('camera.allow')}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          {t('camera.notNow')}
        </button>
      </div>
    </Modal>
  );
}

export function SettingsDialog() {
  const { t } = useTranslation();
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const reset = useStore((s) => s.resetSettings);
  const requestCalibration = useStore((s) => s.requestCalibration);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [copiedLog, setCopiedLog] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCopiedLog(false);
    void getNativeLogPath().then((p) => {
      if (!cancelled) setLogPath(p);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const caps = getComputeCapabilities();
  const hwSummary = `${caps.cpuCores} CPU · ${
    caps.hasWebGL2 ? 'WebGL2 GPU' : caps.hasWebGL ? 'WebGL GPU' : 'CPU WASM'
  }${caps.gpuRenderer ? ` (${caps.gpuRenderer})` : ''}`;

  return (
    <Modal title={t('settings.title')} onClose={() => setOpen(false)}>
      <fieldset className="settings-section">
        <legend>{t('settings.computeBackend')}</legend>
        <label>
          {t('settings.computeBackend')}
          <select
            value={settings.computeBackend}
            onChange={(e) => update({ computeBackend: e.target.value as ComputeBackend })}
            aria-describedby="compute-backend-help"
          >
            <option value="hybrid">{t('settings.backendHybrid')}</option>
            <option value="gpu">{t('settings.backendGpu')}</option>
            <option value="cpu">{t('settings.backendCpu')}</option>
          </select>
        </label>
        <p className="settings-help" id="compute-backend-help">
          {t('settings.backendHelp', { hardware: hwSummary })}
        </p>
      </fieldset>

      <label>
        {t('settings.pinchThreshold')} (
        {Math.round(pinchThresholdToSensitivity(settings.pinchThreshold) * 100)}%)
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(pinchThresholdToSensitivity(settings.pinchThreshold) * 100)}
          onChange={(e) => {
            const threshold = sensitivityToPinchThreshold(Number(e.target.value) / 100);
            update({
              pinchThreshold: threshold,
              pinchReleaseThreshold: releaseThresholdFor(threshold),
            });
          }}
        />
      </label>

      <label>
        {t('settings.smoothing')} ({settings.smoothingMinCutoff.toFixed(1)})
        <input
          type="range"
          min={0.3}
          max={5}
          step={0.1}
          value={settings.smoothingMinCutoff}
          onChange={(e) => update({ smoothingMinCutoff: Number(e.target.value) })}
        />
      </label>

      <label>
        {t('settings.smoothingBeta')} ({settings.smoothingBeta.toFixed(2)})
        <input
          type="range"
          min={0}
          max={0.1}
          step={0.005}
          value={settings.smoothingBeta}
          onChange={(e) => update({ smoothingBeta: Number(e.target.value) })}
        />
      </label>

      <label>
        {t('settings.penWidth')} ({settings.penWidth.toFixed(1)} pt)
        <input
          type="range"
          min={0.5}
          max={12}
          step={0.5}
          value={settings.penWidth}
          onChange={(e) => update({ penWidth: Number(e.target.value) })}
        />
      </label>

      <label>
        {t('settings.penColor')}
        <input
          type="color"
          value={settings.penColor}
          onChange={(e) => update({ penColor: e.target.value })}
          aria-label={t('settings.penColor')}
        />
      </label>

      <label>
        {t('settings.mirrored')}
        <select
          value={settings.mirrored ? 'on' : 'off'}
          onChange={(e) => update({ mirrored: e.target.value === 'on' })}
        >
          <option value="on">{t('settings.mirrorOn')}</option>
          <option value="off">{t('settings.mirrorOff')}</option>
        </select>
      </label>

      <label>
        {t('settings.preview')}
        <select
          value={settings.showPreview ? 'on' : 'off'}
          onChange={(e) => update({ showPreview: e.target.value === 'on' })}
        >
          <option value="on">{t('settings.previewOn')}</option>
          <option value="off">{t('settings.previewOff')}</option>
        </select>
      </label>

      <label>
        {t('settings.dominantHand')}
        <select
          value={settings.dominantHand}
          onChange={(e) => update({ dominantHand: e.target.value as 'left' | 'right' | 'auto' })}
        >
          <option value="auto">{t('settings.auto')}</option>
          <option value="left">{t('settings.left')}</option>
          <option value="right">{t('settings.right')}</option>
        </select>
      </label>

      <label>
        {t('settings.theme')}
        <select
          value={settings.theme}
          onChange={(e) => update({ theme: e.target.value as 'light' | 'dark' | 'system' })}
        >
          <option value="system">{t('settings.system')}</option>
          <option value="light">{t('settings.light')}</option>
          <option value="dark">{t('settings.dark')}</option>
        </select>
      </label>

      <label>
        {t('settings.language')}
        <select
          value={settings.language}
          onChange={(e) => {
            update({ language: e.target.value });
            void initI18n(e.target.value);
          }}
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="settings-section">
        <legend>{t('settings.gestures')}</legend>
        <label>
          {t('settings.gestureMode')}
          <select
            value={settings.gestureMode}
            onChange={(e) => update({ gestureMode: e.target.value as GestureMode })}
            aria-describedby="gesture-mode-help"
          >
            <option value="air">{t('settings.modeAir')}</option>
            <option value="touch">{t('settings.modeTouch')}</option>
          </select>
        </label>
        <p className="settings-help" id="gesture-mode-help">
          {settings.gestureMode === 'touch'
            ? t('settings.modeTouchHelp')
            : t('settings.modeAirHelp')}
        </p>
        {settings.gestureMode === 'air' && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.enablePageSwipe}
                onChange={(e) => update({ enablePageSwipe: e.target.checked })}
              />
              {t('settings.enableSwipe')}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.enablePauseFist}
                onChange={(e) => update({ enablePauseFist: e.target.checked })}
              />
              {t('settings.enablePause')}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.enableErase}
                onChange={(e) => update({ enableErase: e.target.checked })}
              />
              {t('settings.enableErase')}
            </label>
          </>
        )}
        {settings.gestureMode === 'touch' && (
          <label>
            {t('settings.zoomSensitivity')}
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.25}
              value={settings.zoomSensitivity}
              onChange={(e) => update({ zoomSensitivity: Number(e.target.value) })}
              aria-label={t('settings.zoomSensitivity')}
            />
          </label>
        )}
      </fieldset>

      <fieldset className="settings-section">
        <legend>{t('settings.calibration')}</legend>
        <p className="settings-help">
          {settings.calibration
            ? t('settings.calibrationSet', {
                x0: Math.round(settings.calibration.x0 * 100),
                y0: Math.round(settings.calibration.y0 * 100),
                x1: Math.round(settings.calibration.x1 * 100),
                y1: Math.round(settings.calibration.y1 * 100),
              })
            : t('settings.calibrationUnset')}
        </p>
        <div className="settings-row">
          <button type="button" onClick={requestCalibration}>
            {t('settings.calibrate')}
          </button>
          <button
            type="button"
            onClick={() => update({ calibration: null })}
            disabled={!settings.calibration}
          >
            {t('settings.clearCalibration')}
          </button>
        </div>
      </fieldset>

      <fieldset className="settings-section">
        <legend>{t('settings.diagnostics')}</legend>
        <p className="settings-help">{t('settings.diagnosticsHelp')}</p>
        {logPath && (
          <p className="camera-diagnostic">{t('settings.diagnosticsPath', { path: logPath })}</p>
        )}
        <div className="settings-row">
          <button
            type="button"
            onClick={() => {
              void getFullDiagnosticReport({ Version: '0.1.10', Hardware: hwSummary })
                .then(async (report) => {
                  if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(report);
                    setCopiedLog(true);
                  }
                })
                .catch(() => {
                  // Clipboard unavailable — user can still save the file.
                });
            }}
          >
            {copiedLog ? t('settings.copiedLog') : t('settings.copyLog')}
          </button>
          <button
            type="button"
            onClick={() => {
              void getFullDiagnosticReport({ Version: '0.1.10', Hardware: hwSummary })
                .then((report) =>
                  saveBytesAs('lightpen-diagnostics.log', new TextEncoder().encode(report)),
                )
                .catch(() => {
                  // Save cancelled or unavailable.
                });
            }}
          >
            {t('settings.saveLog')}
          </button>
        </div>
      </fieldset>

      <div className="modal-actions">
        <button type="button" onClick={reset}>
          {t('settings.reset')}
        </button>
        <button type="button" className="btn-primary" onClick={() => setOpen(false)}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}

export function CheatSheet() {
  const { t } = useTranslation();
  const open = useStore((s) => s.cheatSheetOpen);
  const setOpen = useStore((s) => s.setCheatSheetOpen);
  const mode = useStore((s) => s.settings.gestureMode);
  if (!open) return null;
  const gestures =
    mode === 'touch'
      ? [
          ['☝️', t('gestures.touchPoint')],
          ['👌', t('gestures.touchDrag')],
          ['⚡', t('gestures.touchTap')],
          ['✌️', t('gestures.touchScroll')],
          ['🤏', t('gestures.touchZoom')],
          ['✊', t('gestures.touchLongPress')],
        ]
      : [
          ['✌️', t('gestures.penDown')],
          ['👉', t('gestures.hover')],
          ['🖐️', t('gestures.erase')],
          ['👋', t('gestures.swipe')],
          ['✊', t('gestures.pause')],
        ];
  return (
    <Modal title={t('toolbar.cheatSheet')} onClose={() => setOpen(false)}>
      <p className="settings-help">
        {mode === 'touch' ? t('gestures.modeTouch') : t('gestures.modeAir')}
      </p>
      {mode === 'air' && <PauseIllustration label={t('gestures.pauseArt')} />}
      <ul className="cheat-list">
        {gestures.map(([icon, label]) => (
          <li key={label}>
            <span className="cheat-icon" aria-hidden="true">
              {icon}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function ShortcutsHelp() {
  const { t } = useTranslation();
  const open = useStore((s) => s.shortcutsOpen);
  const setOpen = useStore((s) => s.setShortcutsOpen);
  if (!open) return null;
  const rows: [string, string][] = [
    ['Ctrl/⌘+O', t('shortcuts.open')],
    ['Ctrl/⌘+Z', t('shortcuts.undo')],
    ['Ctrl/⌘+Shift+Z', t('shortcuts.redo')],
    ['E', t('shortcuts.eraser')],
    ['B', t('shortcuts.pen')],
    ['D', t('shortcuts.darkMode')],
    ['Ctrl/⌘ + +', t('shortcuts.zoomIn')],
    ['Ctrl/⌘ + −', t('shortcuts.zoomOut')],
    ['0', t('shortcuts.fit')],
    ['← / →', t('shortcuts.pages')],
    ['C', t('shortcuts.camera')],
    ['?', t('shortcuts.help')],
  ];
  return (
    <Modal title={t('shortcuts.title')} onClose={() => setOpen(false)}>
      <table className="shortcuts-table">
        <tbody>
          {rows.map(([key, label]) => (
            <tr key={key}>
              <td>
                <kbd>{key}</kbd>
              </td>
              <td>{label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
