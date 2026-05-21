import { QueryClient } from "@tanstack/react-query";

async function defaultQueryFn({ queryKey }: { queryKey: readonly unknown[] }) {
  const url = queryKey[0] as string;
  return apiRequest("GET", url);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, queryFn: defaultQueryFn },
  },
});

export async function apiRequest<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
