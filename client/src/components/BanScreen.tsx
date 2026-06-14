import { AlertTriangle, Unlock } from "lucide-react";
import { useState, useEffect } from "react";
import { getTranslation } from "@/hooks/useLanguage";

interface BanScreenProps {
  reason?: string;
}

export default function BanScreen({ reason }: BanScreenProps) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isUnbanning, setIsUnbanning] = useState(false);
  const [unbanError, setUnbanError] = useState<string | null>(null);
  const [unbanSuccess, setUnbanSuccess] = useState(false);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg?.initData && tg?.initDataUnsafe?.user?.id) {
      const userId = tg.initDataUnsafe.user.id.toString();
      const adminId = import.meta.env.VITE_TELEGRAM_ADMIN_ID;
      setIsAdmin(userId === adminId);
    }
    // force re-render to pick up language from localStorage
    forceUpdate(n => n + 1);
  }, []);

  const t = getTranslation;

  const handleContactSupport = () => {
    window.open('https://t.me/szxzyz', '_blank');
  };

  const handleSelfUnban = async () => {
    setIsUnbanning(true);
    setUnbanError(null);
    
    try {
      const tg = window.Telegram?.WebApp;
      const initData = tg?.initData;
      
      if (!initData) {
        setUnbanError("Telegram WebApp not available");
        return;
      }
      
      const response = await fetch('/api/admin/self-unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setUnbanSuccess(true);
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        setUnbanError(data.message || t('failed'));
      }
    } catch (error) {
      setUnbanError(t('something_went_wrong'));
    } finally {
      setIsUnbanning(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-black via-[#0a0a0a] to-black">
      <div className="max-w-md w-full">
        <div className="bg-gradient-to-br from-red-950/20 to-black border border-red-900/30 rounded-2xl p-8 shadow-2xl">
          <div className="flex flex-col items-center text-center space-y-6">
            <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center border-2 border-red-500/30">
              <AlertTriangle className="w-10 h-10 text-red-500" />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl font-bold text-red-500 leading-tight">
                {t('account_banned_msg')}
              </h1>

              {reason && (
                <div className="mt-4 p-3 bg-red-950/20 border border-red-900/30 rounded-lg">
                  <p className="text-xs font-semibold text-red-400/70 mb-1">
                    {t('ban_details')}
                  </p>
                  <p className="text-xs text-gray-400">
                    {reason}
                  </p>
                </div>
              )}

              <p className="text-gray-400 text-sm mt-4">
                {t('all_features_disabled')}{' '}
                <button onClick={handleContactSupport} className="text-red-500 hover:text-red-400 font-semibold underline underline-offset-4 transition-colors">
                  {t('support_team')}
                </button>.
              </p>
            </div>

            {unbanSuccess && (
              <div className="w-full p-3 bg-green-950/30 border border-green-500/30 rounded-lg">
                <p className="text-green-400 text-sm font-semibold">
                  {t('unbanned_successfully')}
                </p>
              </div>
            )}

            {unbanError && (
              <div className="w-full p-3 bg-red-950/30 border border-red-500/30 rounded-lg">
                <p className="text-red-400 text-sm">{unbanError}</p>
              </div>
            )}

            {isAdmin && !unbanSuccess && (
              <button
                onClick={handleSelfUnban}
                disabled={isUnbanning}
                className="w-full py-3 px-6 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isUnbanning ? (
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                ) : (
                  <>
                    <Unlock className="w-5 h-5" />
                    {t('admin_self_unban')}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
