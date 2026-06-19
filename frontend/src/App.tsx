import { useCallback, useRef, useState } from "react";
import { api } from "./api";
import { LoginScreen } from "./features/auth/LoginScreen";
import { i18n } from "./lib/i18n";
import { AppShell } from "./shell/AppShell";
import { ConsoleStoreProvider } from "./state/ConsoleStore";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { ToastProvider } from "./ui/Toast";
import { clearAuth, loadAuth, saveAuth } from "./lib/auth";
import type { TokenPair } from "./types";

export default function App(): JSX.Element {
  const [auth, setAuth] = useState<TokenPair | null>(() => loadAuth());
  const authRef = useRef(auth);
  authRef.current = auth;

  const handleAuthenticated = useCallback((next: TokenPair) => {
    saveAuth(next);
    setAuth(next);
  }, []);

  const handleLogout = useCallback(() => {
    // 调后端吊销 token (UPDATE admins.tokens_invalidated_at) 让已签发的 access/refresh
    // 立即失效; 即使后端调用失败 (网络/401), 本地仍按用户意图清状态.
    const current = authRef.current;
    if (current) {
      api.logout(current.access_token).catch(() => {});
    }
    clearAuth();
    setAuth(null);
  }, []);

  if (!auth) {
    return (
      <ToastProvider>
        <LoginScreen onAuthenticated={handleAuthenticated} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <ConsoleStoreProvider auth={auth} onAuthUpdate={handleAuthenticated} onAuthFailure={handleLogout}>
        <ErrorBoundary
          fallbackTitle={i18n.errorBoundary.appTitle}
          fallbackDescription={i18n.errorBoundary.appDescription}
          actionLabel={i18n.errorBoundary.reloadPage}
          onAction={() => window.location.reload()}
          resetKeys={[auth.access_token]}
        >
          <AppShell onLogout={handleLogout} />
        </ErrorBoundary>
      </ConsoleStoreProvider>
    </ToastProvider>
  );
}
