import { useCallback, useState } from "react";
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

  const handleAuthenticated = useCallback((next: TokenPair) => {
    saveAuth(next);
    setAuth(next);
  }, []);

  const handleLogout = useCallback(() => {
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
