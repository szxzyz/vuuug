/**
 * Extends express-session's SessionData with application-specific fields.
 * Import this file anywhere that reads/writes custom session properties.
 */
import "express-session";

declare module "express-session" {
  interface SessionData {
    /** Set to `true` once the user passes Cloudflare Turnstile. */
    turnstileVerified?: boolean;
    /** Unix timestamp (ms) when turnstileVerified was last set. */
    turnstileVerifiedAt?: number;
    /** Telegram user data stored by authenticateTelegram middleware. */
    user?: any;
  }
}
