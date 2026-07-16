import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Request, Response } from 'express';
import { shouldUseSecureCookie } from '~/oauth/csrf';

export const GUEST_COOKIE_NAME = 'graupel_guest_id';
const GUEST_COOKIE_PATH = '/api';
const DEFAULT_GUEST_COOKIE_DAYS = 30;

/**
 * How long a guest identity (and its cookie) stays valid, in milliseconds.
 * Configurable via `GUEST_CHAT_COOKIE_DAYS`; falls back to 30 days.
 */
export function getGuestCookieMaxAgeMs(): number {
  const days = parseInt(process.env.GUEST_CHAT_COOKIE_DAYS ?? '', 10);
  const validDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_GUEST_COOKIE_DAYS;
  return validDays * 24 * 60 * 60 * 1000;
}

/** Fixed "never expires" period for a guest's usage record — see incrementGuestUsage. */
export function getGuestUsageExpiresAt(): Date {
  return new Date(Date.now() + getGuestCookieMaxAgeMs());
}

function signGuestPayload(guestId: string, issuedAtSec: number, secret?: string): string {
  const key = secret || process.env.JWT_SECRET;
  if (!key) {
    throw new Error('JWT_SECRET is required for guest cookie signing');
  }
  return crypto.createHmac('sha256', key).update(`${guestId}.${issuedAtSec}`).digest('hex');
}

function buildGuestCookieValue(guestId: string, issuedAtSec: number): string {
  return `${guestId}.${issuedAtSec}.${signGuestPayload(guestId, issuedAtSec)}`;
}

/**
 * Verifies the signed cookie value and confirms it hasn't outlived
 * `GUEST_CHAT_COOKIE_DAYS`. The expiry check happens here (not just via the
 * cookie's own Max-Age) so a replayed old cookie value can't outlive its
 * intended lifetime — the signature alone doesn't carry an expiry.
 */
function parseAndVerifyGuestCookie(
  raw: string | undefined,
): { guestId: string; issuedAtSec: number } | null {
  if (!raw) {
    return null;
  }
  const parts = raw.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [guestId, issuedAtSecStr, signature] = parts;
  const issuedAtSec = Number(issuedAtSecStr);
  if (!guestId || !Number.isFinite(issuedAtSec)) {
    return null;
  }

  const expected = signGuestPayload(guestId, issuedAtSec);
  if (signature.length !== expected.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  const maxAgeSec = getGuestCookieMaxAgeMs() / 1000;
  if (Date.now() / 1000 - issuedAtSec > maxAgeSec) {
    return null;
  }

  return { guestId, issuedAtSec };
}

/**
 * Reads the guest identity from the incoming request's cookie, verifying its
 * signature and age. If missing or invalid, mints a new guest id and sets a
 * fresh cookie on the response.
 */
export function getOrCreateGuestId(
  req: Request,
  res: Response,
): { guestId: string; isNew: boolean } {
  const raw = (req.cookies as Record<string, string> | undefined)?.[GUEST_COOKIE_NAME];
  const parsed = parseAndVerifyGuestCookie(raw);
  if (parsed) {
    return { guestId: parsed.guestId, isNew: false };
  }

  const guestId = uuidv4();
  const issuedAtSec = Math.floor(Date.now() / 1000);
  res.cookie(GUEST_COOKIE_NAME, buildGuestCookieValue(guestId, issuedAtSec), {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'lax',
    maxAge: getGuestCookieMaxAgeMs(),
    path: GUEST_COOKIE_PATH,
  });
  return { guestId, isNew: true };
}
