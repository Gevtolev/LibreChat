import crypto from 'crypto';
import type { Request, Response } from 'express';
import {
  GUEST_COOKIE_NAME,
  getOrCreateGuestId,
  getGuestCookieMaxAgeMs,
  getGuestUsageExpiresAt,
} from './cookie';

function mockRes(): Response & { cookie: jest.Mock } {
  return { cookie: jest.fn() } as unknown as Response & { cookie: jest.Mock };
}

function mockReq(cookieValue?: string): Request {
  return { cookies: cookieValue != null ? { [GUEST_COOKIE_NAME]: cookieValue } : {} } as Request;
}

describe('guest cookie', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_SECRET: 'test-secret' };
    delete process.env.GUEST_CHAT_COOKIE_DAYS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getGuestCookieMaxAgeMs', () => {
    it('defaults to 30 days when unset', () => {
      expect(getGuestCookieMaxAgeMs()).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('respects GUEST_CHAT_COOKIE_DAYS', () => {
      process.env.GUEST_CHAT_COOKIE_DAYS = '7';
      expect(getGuestCookieMaxAgeMs()).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('falls back to default for invalid values', () => {
      process.env.GUEST_CHAT_COOKIE_DAYS = 'not-a-number';
      expect(getGuestCookieMaxAgeMs()).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('falls back to default for non-positive values', () => {
      process.env.GUEST_CHAT_COOKIE_DAYS = '-5';
      expect(getGuestCookieMaxAgeMs()).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });

  describe('getGuestUsageExpiresAt', () => {
    it('returns a date offset by the cookie max age', () => {
      const before = Date.now();
      const expiresAt = getGuestUsageExpiresAt();
      const after = Date.now();
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + getGuestCookieMaxAgeMs());
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after + getGuestCookieMaxAgeMs());
    });
  });

  describe('getOrCreateGuestId', () => {
    it('mints a new guest id and sets a signed cookie when none exists', () => {
      const req = mockReq();
      const res = mockRes();

      const { guestId, isNew } = getOrCreateGuestId(req, res);

      expect(isNew).toBe(true);
      expect(guestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.cookie).toHaveBeenCalledTimes(1);
      const [name, value, options] = res.cookie.mock.calls[0];
      expect(name).toBe(GUEST_COOKIE_NAME);
      expect(value).toContain(guestId);
      expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/api' });
    });

    it('reuses the guest id from a valid signed cookie without re-issuing it', () => {
      const req1 = mockReq();
      const res1 = mockRes();
      const { guestId: mintedId } = getOrCreateGuestId(req1, res1);
      const [, cookieValue] = res1.cookie.mock.calls[0];

      const req2 = mockReq(cookieValue);
      const res2 = mockRes();
      const { guestId, isNew } = getOrCreateGuestId(req2, res2);

      expect(guestId).toBe(mintedId);
      expect(isNew).toBe(false);
      expect(res2.cookie).not.toHaveBeenCalled();
    });

    it('mints a new guest id when the cookie signature is tampered with', () => {
      const req1 = mockReq();
      const res1 = mockRes();
      getOrCreateGuestId(req1, res1);
      const [, cookieValue] = res1.cookie.mock.calls[0];
      const [guestId, issuedAt] = cookieValue.split('.');
      const tampered = `${guestId}.${issuedAt}.deadbeef`;

      const req2 = mockReq(tampered);
      const res2 = mockRes();
      const { isNew } = getOrCreateGuestId(req2, res2);

      expect(isNew).toBe(true);
      expect(res2.cookie).toHaveBeenCalledTimes(1);
    });

    it('mints a new guest id when the signed cookie has outlived its max age', () => {
      const req1 = mockReq();
      const res1 = mockRes();
      getOrCreateGuestId(req1, res1);
      const [, cookieValue] = res1.cookie.mock.calls[0];
      const [guestId] = cookieValue.split('.');

      // Reconstruct a cookie signed for a timestamp far in the past.
      process.env.GUEST_CHAT_COOKIE_DAYS = '1';
      const staleIssuedAtSec = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
      const staleSignature = crypto
        .createHmac('sha256', process.env.JWT_SECRET as string)
        .update(`${guestId}.${staleIssuedAtSec}`)
        .digest('hex');
      const staleCookie = `${guestId}.${staleIssuedAtSec}.${staleSignature}`;

      const req2 = mockReq(staleCookie);
      const res2 = mockRes();
      const { isNew } = getOrCreateGuestId(req2, res2);

      expect(isNew).toBe(true);
    });

    it('mints a new guest id for a malformed cookie value', () => {
      const req = mockReq('not-a-valid-cookie');
      const res = mockRes();

      const { isNew } = getOrCreateGuestId(req, res);

      expect(isNew).toBe(true);
      expect(res.cookie).toHaveBeenCalledTimes(1);
    });
  });
});
