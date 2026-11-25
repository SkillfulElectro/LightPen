/**
 * Defensive React Error Boundary around the PDF workspace so an unexpected
 * rendering or canvas exception recovers gracefully instead of white-screening.
 */
import { Component, type ReactNode } from 'react';

interface Props {
  title: string;
  reloadLabel: string;
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

  private reset = () => {
    this.setState({ hasError: false, message: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="viewer-error" role="alert">
          <div className="empty-card">
            <p className="viewer-empty-title">{this.props.title}</p>
            {this.state.message && <p className="camera-diagnostic">{this.state.message}</p>}
            <button type="button" className="btn-primary" onClick={this.reset}>
              {this.props.reloadLabel}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
