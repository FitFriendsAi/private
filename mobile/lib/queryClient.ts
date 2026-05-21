import { QueryClient } from "@tanstack/react-query";
import { apiRequest } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err: any) => {
        // Don't retry on auth errors
        if (err?.status === 401 || err?.status === 403) return false;
        return count < 2;
      },
    },
  },
});

/** Helper for useQuery queryFn */
export function fetchFn<T>(path: string) {
  return () => apiRequest<T>("GET", path);
}
