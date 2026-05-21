import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface AuthUser { id: number; email: string; name: string; }

export function useAuth() {
  const qc = useQueryClient();

  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: () => apiRequest("GET", "/api/auth/me").catch(() => null),
    staleTime: Infinity,
  });

  const login = useMutation({
    mutationFn: (creds: { email: string; password: string }) => apiRequest("POST", "/api/auth/login", creds),
    onSuccess: (user) => qc.setQueryData(["/api/auth/me"], user),
  });

  const register = useMutation({
    mutationFn: (data: { email: string; password: string; name: string }) => apiRequest("POST", "/api/auth/register", data),
    onSuccess: (user) => qc.setQueryData(["/api/auth/me"], user),
  });

  const logout = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/logout"),
    onSuccess: () => { qc.setQueryData(["/api/auth/me"], null); qc.clear(); },
  });

  return { user: user ?? null, isLoading, login, register, logout };
}
