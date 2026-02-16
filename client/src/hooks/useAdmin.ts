import { useAuth } from "./useAuth";

export function useAdmin() {
  const { user, isLoading } = useAuth();
  
  // Check if current user is admin based on their Telegram ID
  // In development mode, allow test user to be admin
  const telegramId = (user as any)?.telegram_id || (user as any)?.telegramId;
  const isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';
  
  const isAdmin = telegramId === (import.meta.env.VITE_ADMIN_TELEGRAM_ID || "6653616672") || 
                  (telegramId === "123456789" && isDevelopment);
  
  console.log('🔍 Admin check:', { telegramId, isDevelopment, isAdmin, user: !!user });
  
  return {
    isAdmin,
    isLoading,
    user
  };
}