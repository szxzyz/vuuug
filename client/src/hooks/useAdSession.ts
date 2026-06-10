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
  const listenerRef         = useRef<(() => void) | null>(null);

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

    if (listenerRef.current) {
      document.removeEventListener('visibilitychange', listenerRef.current);
    }

    const handler = () => {
      if (document.hidden) {
        backgroundStartRef.current   = Date.now();
        backgroundEnteredRef.current = true;
      } else {
        if (backgroundStartRef.current !== null) {
          backgroundDurRef.current += Date.now() - backgroundStartRef.current;
          backgroundStartRef.current = null;
        }
      }
    };

    listenerRef.current = handler;
    document.addEventListener('visibilitychange', handler);
    return sessionId;
  }, []);

  const endSession = useCallback((): AdSessionResult => {
    if (backgroundStartRef.current !== null) {
      backgroundDurRef.current += Date.now() - backgroundStartRef.current;
      backgroundStartRef.current = null;
    }
    if (listenerRef.current) {
      document.removeEventListener('visibilitychange', listenerRef.current);
      listenerRef.current = null;
    }
    return {
      sessionId:          sessionIdRef.current,
      backgroundDuration: backgroundDurRef.current,
      backgroundEntered:  backgroundEnteredRef.current,
      sessionStart:       sessionStartRef.current,
      totalDuration:      Date.now() - sessionStartRef.current,
    };
  }, []);

  const cancelSession = useCallback(() => {
    if (listenerRef.current) {
      document.removeEventListener('visibilitychange', listenerRef.current);
      listenerRef.current = null;
    }
  }, []);

  return { startSession, endSession, cancelSession };
}
