import { useState, useEffect, useRef } from "react";
import { useLanguage } from "@/hooks/useLanguage";

interface MembershipStatus {
  channelMember: boolean;
  groupMember: boolean;
  channelUrl: string;
  groupUrl: string;
  channelName: string;
  groupName: string;
}

interface ChannelJoinPopupProps {
  telegramId: string;
  onVerified: () => void;
}

export default function ChannelJoinPopup({ telegramId, onVerified }: ChannelJoinPopupProps) {
  const { t, isRTL } = useLanguage();
  const [isChecking, setIsChecking] = useState(false);
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [autoCheckCountdown, setAutoCheckCountdown] = useState<number | null>(null);
  const autoCheckTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const MAX_AUTO_RETRIES = 3;
  const RETRY_DELAYS = [8000, 13000, 20000]; // ms: progressively longer to allow Telegram API to propagate

  const checkMembership = async (isInitialCheck = false, isAutoRetry = false) => {
    if (isChecking) return;
    setIsChecking(true);
    setError(null);

    try {
      const headers: Record<string, string> = {};
      const tg = window.Telegram?.WebApp;
      if (tg?.initData) {
        headers['x-telegram-data'] = tg.initData;
      }

      const response = await fetch('/api/membership/check', { headers });
      const data = await response.json();

      if (data.success && data.isVerified) {
        retryCountRef.current = 0;
        onVerified();
        return;
      }

      if (data.success || data.channelUrl) {
        setMembershipStatus({
          channelMember: data.channelMember || false,
          groupMember: data.groupMember || false,
          channelUrl: data.channelUrl || 'https://t.me/PaidAdzNews',
          groupUrl: data.groupUrl || 'https://t.me/PaidAdzChat',
          channelName: data.channelName || 'PaidAdzNews',
          groupName: data.groupName || 'PaidAdzChat',
        });
      }

      // Auto-retry logic: Telegram API can be slow to reflect membership changes.
      // Automatically retry up to MAX_AUTO_RETRIES times with increasing delays.
      if (isAutoRetry && retryCountRef.current < MAX_AUTO_RETRIES) {
        const delay = RETRY_DELAYS[retryCountRef.current];
        retryCountRef.current += 1;
        const delaySec = Math.ceil(delay / 1000);
        setAutoCheckCountdown(delaySec);

        let remaining = delaySec;
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = setInterval(() => {
          remaining -= 1;
          setAutoCheckCountdown(remaining);
          if (remaining <= 0) {
            clearInterval(countdownRef.current!);
            setAutoCheckCountdown(null);
          }
        }, 1000);

        if (autoCheckTimerRef.current) clearTimeout(autoCheckTimerRef.current);
        autoCheckTimerRef.current = setTimeout(() => {
          checkMembership(false, true);
        }, delay);
        return; // Don't show error yet — still retrying
      }

      if (!isInitialCheck && !data.isVerified) {
        setError(t('not_member_yet'));
      }
    } catch (err) {
      console.error('Membership check error:', err);
      if (isAutoRetry && retryCountRef.current < MAX_AUTO_RETRIES) {
        // Network error during auto-retry — schedule next retry
        const delay = RETRY_DELAYS[retryCountRef.current];
        retryCountRef.current += 1;
        if (autoCheckTimerRef.current) clearTimeout(autoCheckTimerRef.current);
        autoCheckTimerRef.current = setTimeout(() => {
          checkMembership(false, true);
        }, delay);
        return;
      }
      if (!isInitialCheck) {
        setError(t('not_member_yet'));
      }
    } finally {
      setIsChecking(false);
      setHasInitialized(true);
    }
  };

  useEffect(() => {
    if (!hasInitialized) {
      checkMembership(true);
    }
  }, [telegramId, hasInitialized]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoCheckTimerRef.current) clearTimeout(autoCheckTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // Start auto-check countdown after user clicks join.
  // Resets the retry counter so each new join attempt gets a fresh set of retries.
  const startAutoCheck = () => {
    if (autoCheckTimerRef.current) clearTimeout(autoCheckTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    retryCountRef.current = 0; // reset retries on each new join click
    setError(null);

    const initialDelay = RETRY_DELAYS[0]; // 8 seconds for first check
    const delaySec = Math.ceil(initialDelay / 1000);
    setAutoCheckCountdown(delaySec);

    let remaining = delaySec;
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setAutoCheckCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
        setAutoCheckCountdown(null);
      }
    }, 1000);

    // First auto-check fires after initialDelay; if not verified, retries automatically
    autoCheckTimerRef.current = setTimeout(() => {
      checkMembership(false, true);
    }, initialDelay);
  };

  const openChannel = () => {
    const url = membershipStatus?.channelUrl || 'https://t.me/PaidAdzNews';
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.open(url, '_blank');
    }
    startAutoCheck();
  };

  const openGroup = () => {
    const url = membershipStatus?.groupUrl || 'https://t.me/PaidAdzChat';
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.open(url, '_blank');
    }
    startAutoCheck();
  };

  const channelJoined = membershipStatus?.channelMember ?? false;
  const groupJoined = membershipStatus?.groupMember ?? false;

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
    >
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #007BFF 0%, transparent 70%)' }} />
      </div>

      <div className="relative w-full max-w-sm">
        <div
          className="rounded-3xl overflow-hidden"
          style={{
            background: 'linear-gradient(145deg, #0d0d0d 0%, #111 100%)',
            border: '1px solid rgba(0,123,255,0.25)',
            boxShadow: '0 0 40px rgba(0,123,255,0.15), 0 20px 60px rgba(0,0,0,0.8)',
          }}
        >
          {/* Top accent bar */}
          <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #007BFF, #60a5fa, #007BFF)' }} />

          <div className="p-6">
            {/* Lock icon */}
            <div className="flex flex-col items-center mb-6">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
                style={{
                  background: 'radial-gradient(circle, rgba(0,123,255,0.2) 0%, rgba(0,123,255,0.05) 100%)',
                  border: '1.5px solid rgba(0,123,255,0.4)',
                }}
              >
                <span style={{ fontSize: 36 }}>🔒</span>
              </div>

              <h2 className="text-xl font-bold text-white text-center mb-2">
                {t('join_required')}
              </h2>
              <p className="text-sm text-center" style={{ color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                {t('join_required_desc')}
              </p>
            </div>

            {/* Join buttons */}
            <div className="space-y-3 mb-5">
              {/* Channel button */}
              <button
                onClick={openChannel}
                className="w-full flex items-center justify-between p-4 rounded-2xl transition-all active:scale-[0.98]"
                style={{
                  background: channelJoined
                    ? 'rgba(0,123,255,0.15)'
                    : 'rgba(255,255,255,0.05)',
                  border: channelJoined
                    ? '1px solid rgba(0,123,255,0.5)'
                    : '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(0,123,255,0.15)', border: '1px solid rgba(0,123,255,0.3)' }}
                  >
                    <span style={{ fontSize: 18 }}>📢</span>
                  </div>
                  <div className={isRTL ? 'text-right' : 'text-left'}>
                    <p className="text-white font-semibold text-sm">{t('join_channel')}</p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {membershipStatus?.channelName || 'PaidAdzNews'}
                    </p>
                  </div>
                </div>
                {channelJoined ? (
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.4)' }}
                  >
                    <svg className="w-3.5 h-3.5" style={{ color: '#22c55e' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <span
                    className="text-xs font-bold flex-shrink-0 px-3 py-1 rounded-full"
                    style={{
                      background: 'linear-gradient(135deg, #007BFF, #60a5fa)',
                      color: '#fff',
                    }}
                  >
                    JOIN
                  </span>
                )}
              </button>

              {/* Group button */}
              <button
                onClick={openGroup}
                className="w-full flex items-center justify-between p-4 rounded-2xl transition-all active:scale-[0.98]"
                style={{
                  background: groupJoined
                    ? 'rgba(0,123,255,0.15)'
                    : 'rgba(255,255,255,0.05)',
                  border: groupJoined
                    ? '1px solid rgba(0,123,255,0.5)'
                    : '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(0,123,255,0.15)', border: '1px solid rgba(0,123,255,0.3)' }}
                  >
                    <span style={{ fontSize: 18 }}>💬</span>
                  </div>
                  <div className={isRTL ? 'text-right' : 'text-left'}>
                    <p className="text-white font-semibold text-sm">{t('join_group')}</p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {membershipStatus?.groupName || 'PaidAdzChat'}
                    </p>
                  </div>
                </div>
                {groupJoined ? (
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.4)' }}
                  >
                    <svg className="w-3.5 h-3.5" style={{ color: '#22c55e' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <span
                    className="text-xs font-bold flex-shrink-0 px-3 py-1 rounded-full"
                    style={{
                      background: 'linear-gradient(135deg, #007BFF, #60a5fa)',
                      color: '#fff',
                    }}
                  >
                    JOIN
                  </span>
                )}
              </button>
            </div>

            {/* Auto-check countdown message */}
            {autoCheckCountdown !== null && (
              <div
                className="mb-4 py-2.5 px-3 rounded-xl text-center text-xs"
                style={{
                  background: 'rgba(0,123,255,0.08)',
                  border: '1px solid rgba(0,123,255,0.2)',
                  color: 'rgba(96,165,250,0.9)',
                }}
              >
                ⏳ Verifying automatically in {autoCheckCountdown}s...
              </div>
            )}

            {/* Error message */}
            {error && autoCheckCountdown === null && (
              <div
                className="mb-4 py-2.5 px-3 rounded-xl text-center text-xs"
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  color: '#f87171',
                }}
              >
                {error}
              </div>
            )}

            {/* Verify button */}
            <button
              onClick={() => checkMembership(false)}
              disabled={isChecking || autoCheckCountdown !== null}
              className="w-full py-3.5 px-4 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #007BFF 0%, #60a5fa 100%)',
                color: '#fff',
                boxShadow: '0 4px 20px rgba(0,123,255,0.35)',
              }}
            >
              {isChecking ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t('verifying')}
                </span>
              ) : (
                t('verify_membership')
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
