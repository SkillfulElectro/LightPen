import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initI18n } from './i18n';
import { installGlobalErrorLogging, logInfo } from './platform/logger';
import './index.css';

installGlobalErrorLogging();
logInfo('startup', 'LightPen frontend booting', {
  version: '0.1.11',
  userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  viewport:
    typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'unknown',
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

void initI18n().then(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
