import type { TokenPair } from "../types";

const TOKEN_KEY = "gpufleet-console-auth";

export function loadAuth(): TokenPair | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TokenPair>;
    if (
      typeof parsed.access_token !== "string" ||
      typeof parsed.refresh_token !== "string" ||
      parsed.token_type !== "bearer"
    ) {
      return null;
    }
    return parsed as TokenPair;
  } catch {
    return null;
  }
}

export function saveAuth(auth: TokenPair): void {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(auth));
  } catch {
    /* ignore */
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
