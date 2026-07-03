import { useRef, useCallback } from 'react';

export interface AdSessionResult {
  sessionId: string;
  backgroundDuration: number;
  backgroundEntered: boolean;
  sessionStart: number;
  totalDuration: number;
}

export function useAdSession() {
  const sessionIdRef        = useRef<string>('');
  const sessionStartRef     = useRef<number>(0);
  const backgroundStartRef  = useRef<number | null>(null);
  const backgroundDurRef    = useRef<number>(0);
  const backgroundEnteredRef = useRef<boolean>(false);
  const isHiddenRef         = useRef<boolean>(false);
  const listenersRef        = useRef<Array<{ target: Document | Window; type: string; fn: EventListener }>>([]);

  const startSession = useCallback((): string => {
    const rand = () => Math.random().toString(36).slice(2, 9);
    const uid  = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : rand() + rand();
    const sessionId = `${Date.now()}-${rand()}-${uid}`;

    sessionIdRef.current         = sessionId;
    sessionStartRef.current      = Date.now();
    backgroundStartRef.current   = null;
    backgroundDurRef.current     = 0;
    backgroundEnteredRef.current = false;
    isHiddenRef.current          = false;

    // Tear down any listeners from a previous session
    for (const { target, type, fn } of listenersRef.current) {
      target.removeEventListener(type, fn);
    }
    listenersRef.current = [];

    const enterBackground = () => {
      if (isHiddenRef.current) return; // already counted
      isHiddenRef.current = true;
      backgroundStartRef.current   = Date.now();
      backgroundEnteredRef.current = true;
    };

    const exitBackground = () => {
      if (!isHiddenRef.current) return;
      isHiddenRef.current = false;
      if (backgroundStartRef.current !== null) {
        backgroundDurRef.current += Date.now() - backgroundStartRef.current;
        backgroundStartRef.current = null;
      }
    };

    // Different WebViews (Telegram Android/iOS/Desktop, mobile browsers) are
    // inconsistent about which of these fire when the user minimizes the app
    // or switches to another window — listen to all of them so a genuine
    // minimize is reliably detected regardless of platform.
    const onVisibilityChange = () => { document.hidden ? enterBackground() : exitBackground(); };
    const onBlur   = () => enterBackground();
    const onFocus  = () => exitBackground();
    const onPageHide = () => enterBackground();
    const onPageShow = () => exitBackground();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);

    listenersRef.current = [
      { target: document, type: 'visibilitychange', fn: onVisibilityChange },
      { target: window,   type: 'blur',              fn: onBlur },
      { target: window,   type: 'focus',             fn: onFocus },
      { target: window,   type: 'pagehide',           fn: onPageHide },
      { target: window,   type: 'pageshow',           fn: onPageShow },
    ];

    return sessionId;
  }, []);

  const teardownListeners = () => {
    for (const { target, type, fn } of listenersRef.current) {
      target.removeEventListener(type, fn);
    }
    listenersRef.current = [];
  };

  // Resolves once the app has actually returned to the foreground (i.e. the
  // user has come back from minimizing/switching away). If the app is
  // already foregrounded, resolves immediately. This lets callers avoid
  // firing the reward request while the user is still backgrounded — which
  // would both undercount backgroundDuration and confusingly claim the
  // reward before the user has genuinely "returned".
  // A generous timeout guards against the case where no return event ever
  // fires (e.g. the ad never actually backgrounded the app at all).
  const waitForForeground = useCallback((timeoutMs = 10_000): Promise<void> => {
    return new Promise((resolve) => {
      if (!isHiddenRef.current && !document.hidden) { resolve(); return; }

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        document.removeEventListener('visibilitychange', onReturn);
        window.removeEventListener('focus', onReturn);
        window.removeEventListener('pageshow', onReturn);
        clearTimeout(timer);
        resolve();
      };
      const onReturn = () => {
        if (!document.hidden) finish();
      };

      document.addEventListener('visibilitychange', onReturn);
      window.addEventListener('focus', onReturn);
      window.addEventListener('pageshow', onReturn);
      const timer = setTimeout(finish, timeoutMs);
    });
  }, []);

  const endSession = useCallback((): AdSessionResult => {
    if (backgroundStartRef.current !== null) {
      backgroundDurRef.current += Date.now() - backgroundStartRef.current;
      backgroundStartRef.current = null;
    }
    teardownListeners();
    return {
      sessionId:          sessionIdRef.current,
      backgroundDuration: backgroundDurRef.current,
      backgroundEntered:  backgroundEnteredRef.current,
      sessionStart:       sessionStartRef.current,
      totalDuration:      Date.now() - sessionStartRef.current,
    };
  }, []);

  const cancelSession = useCallback(() => {
    teardownListeners();
  }, []);

  return { startSession, endSession, cancelSession, waitForForeground };
}
