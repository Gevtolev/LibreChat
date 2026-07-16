import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import guestUsageSchema from '~/schema/guestUsage';
import type { IGuestUsage } from '~/types/guestUsage';
import { createGuestUsageMethods } from './guestUsage';

let mongoServer: MongoMemoryServer;
let GuestUsage: mongoose.Model<IGuestUsage>;
let guestUsageMethods: ReturnType<typeof createGuestUsageMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  GuestUsage =
    mongoose.models.GuestUsage || mongoose.model<IGuestUsage>('GuestUsage', guestUsageSchema);
  guestUsageMethods = createGuestUsageMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await GuestUsage.ensureIndexes();
});

describe('GuestUsageMethods', () => {
  test('incrementGuestUsage allows up to limit, then returns null', async () => {
    const guestId = 'guest-1';
    const limit = 3;
    const expiresAt = new Date('2026-08-01T00:00:00Z');

    for (let i = 0; i < limit; i++) {
      const doc = await guestUsageMethods.incrementGuestUsage({ guestId, limit, expiresAt });
      expect(doc).not.toBeNull();
      expect(doc!.messages_used).toBe(i + 1);
    }

    const over = await guestUsageMethods.incrementGuestUsage({ guestId, limit, expiresAt });
    expect(over).toBeNull();
  });

  test('incrementGuestUsage tracks distinct guests independently', async () => {
    const expiresAt = new Date('2026-08-01T00:00:00Z');
    const limit = 1;

    const first = await guestUsageMethods.incrementGuestUsage({
      guestId: 'guest-a',
      limit,
      expiresAt,
    });
    const second = await guestUsageMethods.incrementGuestUsage({
      guestId: 'guest-b',
      limit,
      expiresAt,
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.guest_id).toBe('guest-a');
    expect(second!.guest_id).toBe('guest-b');
  });

  test('incrementGuestUsage sets expires_at only on first insert', async () => {
    const guestId = 'guest-expiry';
    const firstExpiry = new Date('2026-08-01T00:00:00Z');
    const secondExpiry = new Date('2026-09-01T00:00:00Z');

    const first = await guestUsageMethods.incrementGuestUsage({
      guestId,
      limit: 5,
      expiresAt: firstExpiry,
    });
    const second = await guestUsageMethods.incrementGuestUsage({
      guestId,
      limit: 5,
      expiresAt: secondExpiry,
    });

    expect(first!.expires_at.toISOString()).toBe(firstExpiry.toISOString());
    expect(second!.expires_at.toISOString()).toBe(firstExpiry.toISOString());
  });

  /**
   * Concurrency / race test, mirroring methods/quota.spec's coverage of the
   * atomic check-and-increment pattern: fire 20 parallel increments with
   * limit=10. Exactly 10 should succeed; the rest must return null — proving
   * the atomic filter prevents a guest from overrunning their trial via
   * concurrent requests.
   */
  test('concurrent incrementGuestUsage: exactly limit succeed (race test)', async () => {
    const TOTAL = 20;
    const LIMIT = 10;
    const guestId = 'guest-race';
    const expiresAt = new Date('2026-08-01T00:00:00Z');

    const results = await Promise.all(
      Array.from({ length: TOTAL }, () =>
        guestUsageMethods.incrementGuestUsage({ guestId, limit: LIMIT, expiresAt }),
      ),
    );

    const successes = results.filter((r) => r !== null).length;
    const failures = results.filter((r) => r === null).length;

    expect(successes).toBe(LIMIT);
    expect(failures).toBe(TOTAL - LIMIT);
  }, 15000);
});
