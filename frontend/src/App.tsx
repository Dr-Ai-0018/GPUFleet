import { useCallback, useState } from "react";
import { LoginScreen } from "./features/auth/LoginScreen";
import { AppShell } from "./shell/AppShell";
import { ConsoleStoreProvider } from "./state/ConsoleStore";
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
        <AppShell onLogout={handleLogout} />
      </ConsoleStoreProvider>
    </ToastProvider>
  );
}
