import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency } from "@/lib/utils";

export type NotificationType = "success" | "error" | "info";

interface NotificationData {
  message: string;
  type?: NotificationType;
  amount?: number;
  duration?: number;
}

let notificationQueue: NotificationData[] = [];
let isDisplaying = false;
let recentNotifications: Map<string, number> = new Map();
// Module-level setter refs so the visibilitychange handler can call them
// without capturing stale closures from the initial useEffect run.
let _setMessage: ((m: string) => void) | null = null;
let _setType: ((t: NotificationType) => void) | null = null;
let _setIsVisible: ((v: boolean) => void) | null = null;

const DUPLICATE_PREVENTION_WINDOW = 2000; // 2 seconds

function showNextNotification() {
  if (notificationQueue.length === 0 || isDisplaying) return;
  // Root cause of Issue 3: when the Telegram mini-app is backgrounded (user
  // watching an ad), the notification timer fires and the toast appears and
  // disappears while the screen is off. On return the user sees nothing.
  // Fix: defer display until the document is visible again.
  if (document.hidden) return;

  isDisplaying = true;
  const notification = notificationQueue.shift()!;

  _setMessage?.(notification.message);
  _setType?.(notification.type || "success");
  _setIsVisible?.(true);

  const displayDuration = notification.duration || 1500;

  setTimeout(() => {
    _setIsVisible?.(false);
    setTimeout(() => {
      isDisplaying = false;
      showNextNotification();
    }, 300);
  }, displayDuration);
}

export default function AppNotification() {
  const [isVisible, setIsVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [type, setType] = useState<NotificationType>("success");

  useEffect(() => {
    // Expose setters to module scope so showNextNotification (now module-level)
    // can call them without stale closure issues.
    _setMessage = setMessage;
    _setType = setType;
    _setIsVisible = setIsVisible;

    const handleNotification = (event: CustomEvent<NotificationData>) => {
      const { message: msg, type: notifType, amount, duration } = event.detail;
      
      let finalMessage = msg;
      if (amount !== undefined) {
        finalMessage = `${msg} +${formatCurrency(amount, false)}`;
      }
      
      // Check for duplicate notification
      const notificationKey = `${finalMessage}-${notifType}`;
      const now = Date.now();
      const lastShown = recentNotifications.get(notificationKey);
      
      if (lastShown && (now - lastShown) < DUPLICATE_PREVENTION_WINDOW) {
        return;
      }
      
      recentNotifications.set(notificationKey, now);
      
      // Clean up old entries (older than 5 seconds)
      for (const [key, timestamp] of Array.from(recentNotifications.entries())) {
        if (now - timestamp > 5000) {
          recentNotifications.delete(key);
        }
      }
      
      notificationQueue.push({ message: finalMessage, type: notifType, duration });
      showNextNotification();
    };

    // When the user returns from background (e.g. after watching an ad), drain
    // any queued notifications that were deferred because the doc was hidden.
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        showNextNotification();
      }
    };

    window.addEventListener('appNotification', handleNotification as EventListener);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('appNotification', handleNotification as EventListener);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      _setMessage = null;
      _setType = null;
      _setIsVisible = null;
    };
  }, []);

  if (!isVisible) return null;

  const getIcon = () => {
    switch (type) {
      case "success":
        return "✓";
      case "error":
        return "✕";
      case "info":
        return "ℹ";
      default:
        return "✓";
    }
  };

  const notificationElement = (
    <div 
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[99999] px-4 py-3 rounded-xl shadow-2xl text-white font-medium text-sm flex items-center gap-2 animate-slideDown max-w-[90vw]"
      style={{
        backgroundColor: '#1534A1',
        animation: isVisible ? "slideDown 0.3s ease-out" : "slideUp 0.3s ease-out",
        pointerEvents: 'auto'
      }}
    >
      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-white/20 flex-shrink-0">
        {getIcon()}
      </div>
      <span className="whitespace-nowrap">{message}</span>
    </div>
  );

  return createPortal(notificationElement, document.body);
}

export function showNotification(message: string, type: NotificationType = "success", amount?: number, duration?: number) {
  const event = new CustomEvent('appNotification', { 
    detail: { message, type, amount, duration } 
  });
  window.dispatchEvent(event);
}
