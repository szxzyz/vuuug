import { useAuth } from "./useAuth";

export function useAdmin() {
  const { user, isLoading } = useAuth();
  
  const telegramId = (user as any)?.telegram_id || (user as any)?.telegramId;
  const isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';
  
  // Support multiple admin IDs (comma-separated) or single ID
  const adminIdsEnv = import.meta.env.VITE_ADMIN_TELEGRAM_IDS || import.meta.env.VITE_ADMIN_TELEGRAM_ID || "";
  const adminIds = adminIdsEnv
    .split(',')
    .map((id: string) => id.trim())
    .filter(Boolean);

  // Dev fallback: if no admin IDs configured, allow dev test user
  const isAdmin = (adminIds.length > 0 && telegramId && adminIds.includes(telegramId.toString())) ||
                  (isDevelopment && telegramId === "123456789" && adminIds.length === 0);
  
  return {
    isAdmin,
    isLoading,
    user
  };
}
