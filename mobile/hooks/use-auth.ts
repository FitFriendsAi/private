import { useState, useEffect, useCallback } from "react";
import { apiRequest, setToken, clearToken, getToken } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
}

interface LoginResponse {
  token: string;
  user: AuthUser;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, try to restore session from stored token
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) { setLoading(false); return; }
        const me = await apiRequest<AuthUser>("GET", "/api/auth/me-mobile");
        setUser(me);
      } catch {
        await clearToken();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { token, user } = await apiRequest<LoginResponse>("POST", "/api/auth/login-mobile", {
      email,
      password,
    });
    await setToken(token);
    setUser(user);
    queryClient.clear();
  }, []);

  const logout = useCallback(async () => {
    await clearToken();
    setUser(null);
    queryClient.clear();
  }, []);

  return { user, loading, login, logout };
}
