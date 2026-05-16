import { useCallback, useState } from "react";
import { LoginScreen } from "./features/auth/LoginScreen";
import { AppShell } from "./shell/AppShell";
import { ConsoleStoreProvider } from "./state/ConsoleStore";
import { ToastProvider } from "./ui/Toast";
import { clearToken, loadToken, saveToken } from "./lib/auth";

export default function App(): JSX.Element {
  const [token, setToken] = useState<string>(() => loadToken());

  const handleAuthenticated = useCallback((next: string) => {
    saveToken(next);
    setToken(next);
  }, []);

  const handleLogout = useCallback(() => {
    clearToken();
    setToken("");
  }, []);

  if (!token) {
    return (
      <ToastProvider>
        <LoginScreen onAuthenticated={handleAuthenticated} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <ConsoleStoreProvider token={token} onAuthFailure={handleLogout}>
        <AppShell onLogout={handleLogout} />
      </ConsoleStoreProvider>
    </ToastProvider>
  );
}
