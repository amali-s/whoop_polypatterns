// Server-only WHOOP token store access + OAuth session cookie helpers.
//
// The encrypted whoop_tokens table (supabase/migrations/0001_init.sql) is the
// durable source of truth for a member's WHOOP OAuth tokens (Phase 1.4). This
// module is the single place that:
//   - reads a row and decryptToken()s it back to usable plaintext tokens
//     (getWhoopTokens), so Phase 1.5 refresh and Phase 2 API calls reuse it;
//   - encodes/decodes the opaque session cookie that ties a browser to its
//     stored row (encodeSession / decodeSession).
//
// SECURITY:
//   - Server-only. It composes lib/crypto.ts (reads TOKEN_ENCRYPTION_KEY) and
//     lib/supabase.ts (service-role key), so it must NEVER be imported into
//     /src — same contract as those two modules.
//   - Plaintext tokens exist only in the value getWhoopTokens() returns, for the
//     duration of one serverless request. Nothing here logs token material.

import { decryptToken, encryptToken } from './crypto.js';
import { DatabaseUnavailableError, getSupabaseAdmin, isDbUnavailableStatus } from './supabase.js';

const TOKENS_TABLE = 'whoop_tokens';

/** Decrypted tokens for one WHOOP member, as returned by getWhoopTokens(). */
export interface WhoopTokens {
  /** WHOOP member id this row is keyed by. */
  userId: string;
  accessToken: string;
  refreshToken: string;
  /** Absolute access-token expiry, or null if the column was never set. */
  expiresAt: Date | null;
  /** Space-delimited scopes granted, or null. */
  scope: string | null;
}

/**
 * Read a member's row from whoop_tokens and decrypt both tokens.
 *
 * Returns null when no row exists for `userId` (e.g. the member never
 * connected, or the row was deleted). Throws if a row exists but its ciphertext
 * fails to decrypt — that is a real integrity/key problem the caller must not
 * paper over by treating it as "not connected".
 */
export async function getWhoopTokens(userId: string): Promise<WhoopTokens | null> {
  const supabase = getSupabaseAdmin();
  const { data, error, status } = await supabase
    .from(TOKENS_TABLE)
    .select('access_token_encrypted, refresh_token_encrypted, expires_at, scope')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    // A paused/unreachable Supabase project fails at the gateway level (Phase
    // 2.5) — distinguish it from a genuine query error so /api/session can
    // report "waking" instead of a failure that looks like a broken session.
    if (isDbUnavailableStatus(status)) {
      throw new DatabaseUnavailableError(status);
    }
    throw new Error(`Failed to read whoop_tokens: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  return {
    userId,
    accessToken: decryptToken(data.access_token_encrypted),
    refreshToken: decryptToken(data.refresh_token_encrypted),
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
    scope: data.scope ?? null,
  };
}

// ── Session cookie ─────────────────────────────────────────────────────────
// The browser holds NO tokens (Phase 1.4). Instead it carries an opaque session
// cookie whose value is encryptToken(user_id): the AES-256-GCM auth tag makes it
// tamper-evident (a client can't swap in another member's id), and encryption
// keeps the raw WHOOP member id off the wire / out of the browser. Decoding it
// server-side yields the user_id to look the row up with getWhoopTokens().

/** Name of the HttpOnly cookie that references the stored token row. */
export const SESSION_COOKIE = 'whoop_session';

/** Build the opaque session cookie value for a member id. */
export function encodeSession(userId: string): string {
  return encryptToken(userId);
}

/**
 * Reverse encodeSession(). Returns null if the value is missing or fails to
 * decrypt (tampered / minted under an old key), so callers treat it as "no
 * valid session" rather than crashing.
 */
export function decodeSession(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return decryptToken(value);
  } catch {
    return null;
  }
}
