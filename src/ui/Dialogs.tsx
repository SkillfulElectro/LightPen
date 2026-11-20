/** Modal dialogs: camera permission rationale, settings, cheat sheet, shortcuts. */

import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
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
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
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
  if (!open) return null;
  return (
    <Modal title={t('settings.title')} onClose={() => setOpen(false)}>
      <label>
        {t('settings.pinchThreshold')} ({settings.pinchThreshold.toFixed(2)})
        <input
          type="range"
          min={0.1}
          max={0.8}
          step={0.01}
          value={settings.pinchThreshold}
          onChange={(e) => update({ pinchThreshold: Number(e.target.value) })}
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
        <select value={settings.language} onChange={(e) => update({ language: e.target.value })}>
          <option value="en">English</option>
        </select>
      </label>
      <fieldset>
        <legend>{t('settings.gestures')}</legend>
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
  if (!open) return null;
  return (
    <Modal title={t('toolbar.cheatSheet')} onClose={() => setOpen(false)}>
      <ul className="cheat-list">
        <li>✌️ {t('gestures.penDown')}</li>
        <li>👉 {t('gestures.hover')}</li>
        <li>🖐️ {t('gestures.erase')}</li>
        <li>👋 {t('gestures.swipe')}</li>
        <li>✊ {t('gestures.pause')}</li>
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
