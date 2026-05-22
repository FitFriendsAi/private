/**
 * API client for FitCore mobile.
 * Uses JWT stored in SecureStore (set after login).
 * All requests go to API_BASE_URL — set via EXPO_PUBLIC_API_URL env var,
 * falls back to localhost:5001 for local dev.
 */

import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// On web: use a relative URL so API calls go to the same origin
// (works on localhost:5173 in dev, fitfriends.replit.app in prod, etc.)
// On native (iOS/Android): use the configured URL or fallback to local dev server
export const API_BASE =
  Platform.OS === "web"
    ? ""
    : (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:5001");

const TOKEN_KEY = "fitcore_jwt";
const isWeb = Platform.OS === "web";

export async function getToken(): Promise<string | null> {
  if (isWeb) {
    try { return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null; }
    catch { return null; }
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  if (isWeb) {
    try { globalThis.localStorage?.setItem(TOKEN_KEY, token); } catch {}
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  if (isWeb) {
    try { globalThis.localStorage?.removeItem(TOKEN_KEY); } catch {}
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  body?: unknown
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Abort after 10 s so the user gets an error instead of infinite spin
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === "AbortError") {
      throw new ApiError(0, "Cannot reach server — check that FitCore is running and you're on the same Wi-Fi.");
    }
    throw new ApiError(0, err?.message ?? "Network error");
  }
  clearTimeout(timer);

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      message = json.message ?? message;
    } catch {}
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
