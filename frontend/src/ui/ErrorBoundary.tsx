import React, { type ReactNode } from "react";
import { navigate } from "../lib/routing";
import { i18n } from "../lib/i18n";

type Props = {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackDescription?: string;
  actionLabel?: string;
  onAction?: () => void;
  resetKeys?: unknown[];
};

type State = {
  hasError: boolean;
};

function areResetKeysEqual(prev: unknown[] = [], next: unknown[] = []): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((value, index) => Object.is(value, next[index]));
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: Props): void {
    if (this.state.hasError && !areResetKeysEqual(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: unknown): void {
    console.error("ErrorBoundary captured error", error);
  }

  private handleAction = (): void => {
    this.setState({ hasError: false });
    this.props.onAction?.();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="mx-auto flex min-h-[360px] max-w-[720px] items-center justify-center">
        <div className="w-full rounded-2xl border border-red-500/20 bg-red-500/[0.05] px-6 py-8 text-center shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10 text-red-300">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v6" />
              <path d="M12 16h.01" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white">
            {this.props.fallbackTitle ?? i18n.errorBoundary.routeTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-[56ch] text-sm leading-6 text-gray-400">
            {this.props.fallbackDescription ?? i18n.errorBoundary.routeDescription}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={this.handleAction}
              className="rounded-lg border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
            >
              {this.props.actionLabel ?? i18n.common.retry}
            </button>
            <button
              type="button"
              onClick={() => navigate({ name: "overview" })}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-300 transition hover:border-white/20 hover:text-white"
            >
              {i18n.errorBoundary.goOverview}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
