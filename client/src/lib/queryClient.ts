import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { supabase } from "./supabase";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * fetch() med Supabase JWT automatisk lagt til som Authorization-header.
 * Bruk denne for alle /api/... kall som ikke går gjennom apiRequest()
 * (f.eks. fire-and-forget POST, FormData-uploads, eller når du må håndtere
 * non-OK responses selv).
 */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const auth = await authHeaders();
  return fetch(url, {
    ...init,
    headers: { ...auth, ...((init.headers as Record<string, string>) || {}) },
  });
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // Gateway-feil fra Render (502/503/504) gir HTML-feilside, ikke JSON.
    // Erstatt med en lesbar norsk-melding så toast-en blir forståelig.
    const looksLikeHtml = text.trimStart().toLowerCase().startsWith("<");
    const friendly = looksLikeHtml
      ? res.status === 502 || res.status === 504
        ? "Tjeneren brukte for lang tid på å svare. Prøv igjen — hvis dette gjentar seg, kan forespørselen være for tung."
        : "Tjeneren er utilgjengelig akkurat nå. Prøv igjen om litt."
      : text;
    throw new Error(`${res.status}: ${friendly}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = { ...(await authHeaders()) };
  if (data) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const headers = await authHeaders();
    const res = await fetch(queryKey.join("/") as string, { headers });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
