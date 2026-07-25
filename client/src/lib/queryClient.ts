import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    try {
      const json = JSON.parse(text);
      throw new Error(json.message || text);
    } catch (parseError) {
      throw new Error(text);
    }
  }
}

// Helper function to get Telegram data with proper WebApp detection
const getTelegramInitData = (): string | null => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isDev = hostname === 'localhost' || 
                  hostname.includes('replit.app') || 
                  hostname.includes('replit.dev') ||
                  hostname.includes('127.0.0.1');
    
    if (isDev) {
      const urlParams = new URLSearchParams(window.location.search);
      const tgData = urlParams.get('tgData');
      if (tgData) return tgData;
      return null;
    }
    
    if (window.Telegram?.WebApp?.initData) {
      const initData = window.Telegram.WebApp.initData;
      if (initData && initData.trim() !== '') return initData;
    }
    
    return null;
  }
  return null;
};

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};
  
  if (data) {
    headers["Content-Type"] = "application/json";
  }
  
  const telegramData = getTelegramInitData();
  if (telegramData) {
    headers["x-telegram-data"] = telegramData;
  }

  // Attach device fingerprint + platform so server risk scoring works on this path too
  try {
    const tgPlatform = (window as any).Telegram?.WebApp?.platform || 'unknown';
    let did = '';
    try { did = localStorage.getItem('_paid_adz_did') || ''; } catch {}
    if (did) headers['x-device-id'] = did;
    headers['x-tg-platform'] = tgPlatform;
  } catch {}

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
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
    const headers: Record<string, string> = {};
    
    const telegramData = getTelegramInitData();
    if (telegramData) {
      headers["x-telegram-data"] = telegramData;
    }

    // Attach device fingerprint + platform for risk scoring
    try {
      const tgPlatform = (window as any).Telegram?.WebApp?.platform || 'unknown';
      let did = '';
      try { did = localStorage.getItem('_paid_adz_did') || ''; } catch {}
      if (did) headers['x-device-id'] = did;
      headers['x-tg-platform'] = tgPlatform;
    } catch {}

    const res = await fetch(queryKey.join("/") as string, {
      headers,
      credentials: "include",
    });

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
  },
});