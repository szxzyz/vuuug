import { QueryClient, QueryFunction, keepPreviousData } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = text;
    let json: any = null;
    try {
      json = JSON.parse(text);
      message = json.message || text;
    } catch {
      // not JSON — use raw text as-is
    }
    const err: any = new Error(message);
    err.status = res.status;
    // Preserve structured error fields (errorType, secsLeft, limitType, etc.)
    // from the server's JSON body so callers can branch on them (e.g. to show
    // a specific popup instead of a generic toast). Without this, every
    // error becomes a plain Error with only `.message`, silently discarding
    // errorType and causing callers to always fall back to generic handling.
    if (json && typeof json === "object") {
      Object.assign(err, json);
    }
    throw err;
  }
}

// Helper function to get Telegram data with proper WebApp detection
const getTelegramInitData = (): string | null => {
  if (typeof window !== 'undefined') {
    // ALWAYS check Telegram SDK first — works in both dev and production.
    // Previously this was skipped for replit.app domains (treated as "dev"),
    // which caused GET /api/auth/user to have no x-telegram-data header.
    // Without telegram data, the server fell back to the test user (REPL_ID check),
    // returning usdBalance="0" instead of the real user's balance.
    if (window.Telegram?.WebApp?.initData && window.Telegram.WebApp.initData.trim() !== '') {
      return window.Telegram.WebApp.initData;
    }

    // Dev-only fallback: URL param ?tgData=... (for browser testing without Telegram SDK)
    const urlParams = new URLSearchParams(window.location.search);
    const tgData = urlParams.get('tgData');
    if (tgData) return tgData;
  }
  return null;
};

export { getTelegramInitData };

// ─── Device fingerprint + platform headers ───────────────────────────────────
// Sent with every request so the server can do accurate risk scoring.
// No sensitive data — only browser environment metadata.

let _cachedDeviceId: string | null = null;

function getDeviceId(): string {
  if (_cachedDeviceId) return _cachedDeviceId;
  // Use existing stored ID or generate a new stable one
  try {
    let id = localStorage.getItem('_paid_adz_did');
    if (!id) {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      id = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('_paid_adz_did', id);
    }
    _cachedDeviceId = id;
    return id;
  } catch {
    // localStorage unavailable (private mode etc.)
    return 'nls_' + Math.random().toString(36).slice(2, 18);
  }
}

function buildDeviceFingerprint(): string {
  try {
    const tg = (window as any).Telegram?.WebApp;
    const fp: Record<string, unknown> = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      languages: navigator.languages?.join(','),
      screenW: screen.width,
      screenH: screen.height,
      colorDepth: screen.colorDepth,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: (navigator as any).deviceMemory,
      // Telegram-specific signals
      tgPlatform: tg?.platform,
      tgVersion: tg?.version,
      tgColorScheme: tg?.colorScheme,
      tgIsExpanded: tg?.isExpanded,
    };
    return JSON.stringify(fp);
  } catch {
    return JSON.stringify({ userAgent: navigator.userAgent, platform: navigator.platform });
  }
}

function getTelegramPlatform(): string {
  try {
    return (window as any).Telegram?.WebApp?.platform || 'unknown';
  } catch {
    return 'unknown';
  }
}

function buildSecurityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    headers['x-device-id'] = getDeviceId();
    headers['x-device-fingerprint'] = buildDeviceFingerprint();
    headers['x-tg-platform'] = getTelegramPlatform();
  } catch {
    // Never break requests due to header building errors
  }
  return headers;
}
// ─────────────────────────────────────────────────────────────────────────────

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

  // Attach device + platform headers for server-side risk scoring
  Object.assign(headers, buildSecurityHeaders());

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

    // Attach device + platform headers for server-side risk scoring
    Object.assign(headers, buildSecurityHeaders());

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
      // Telegram users switch apps constantly; refetching on every focus with
      // staleTime:0 caused a visible flash-of-zeros in production (API latency
      // 50–500 ms vs ~1 ms in dev). Disable focus-refetch so data only
      // refreshes on explicit invalidation or mount.
      refetchOnWindowFocus: false,
      // 30 s staleTime: data is considered fresh for 30 seconds after it
      // arrives. This prevents the refetch storm that caused every balance/
      // counter to blank out simultaneously in production.
      staleTime: 1000 * 30,
      gcTime: 1000 * 60 * 5,
      retry: false,
      // Keep the last successful data visible while a background refetch is
      // in flight — eliminates the "flash of 0" during any background update.
      placeholderData: keepPreviousData,
    },
  },
});