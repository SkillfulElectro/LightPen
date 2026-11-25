/**
 * Defensive React Error Boundary around the PDF workspace so an unexpected
 * rendering or canvas exception recovers gracefully instead of white-screening,
 * and logs the full component stack for bug reports.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getFullDiagnosticReport, logError } from '../platform/logger';
import { saveBytesAs } from '../platform/tauri';

interface Props {
  title: string;
  reloadLabel: string;
  saveLogLabel?: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logError('error-boundary', error?.message || 'Workspace render crash', {
      name: error?.name,
      stack: error?.stack,
      componentStack: info.componentStack,
    });
  }

  private reset = () => {
    this.setState({ hasError: false, message: null });
  };

  private saveLogs = () => {
    void getFullDiagnosticReport({ Version: '0.1.10', Trigger: 'error-boundary' })
      .then((text) => saveBytesAs('lightpen-diagnostics.log', new TextEncoder().encode(text)))
      .catch(() => {
        // ignore save cancellation
      });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="viewer-error" role="alert">
          <div className="empty-card">
            <p className="viewer-empty-title">{this.props.title}</p>
            {this.state.message && <p className="camera-diagnostic">{this.state.message}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={this.reset}>
                {this.props.reloadLabel}
              </button>
              <button type="button" onClick={this.saveLogs}>
                {this.props.saveLogLabel ?? 'Save diagnostic log'}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
