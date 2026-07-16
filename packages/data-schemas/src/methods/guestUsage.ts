import type { FilterQuery, Model, UpdateQuery } from 'mongoose';
import type { IGuestUsage, IGuestUsageLean } from '~/types/guestUsage';

export function createGuestUsageMethods(mongoose: typeof import('mongoose')) {
  /**
   * Atomically increments messages_used by 1 if below limit.
   * Returns the updated doc on success, or null when the guest's trial is exhausted.
   *
   * Mirrors the Quota atomic check-and-increment pattern (methods/quota.ts) —
   * a single findOneAndUpdate with a `messages_used < limit` filter so MongoDB
   * enforces the cap atomically, no read-then-write race.
   *
   * On duplicate-key (11000) from a concurrent upsert, retries once via an
   * update-only path (no upsert) to resolve the race without creating a dupe.
   */
  async function incrementGuestUsage(args: {
    guestId: string;
    limit: number;
    expiresAt: Date;
  }): Promise<IGuestUsageLean | null> {
    const GuestUsage = mongoose.models.GuestUsage as Model<IGuestUsage>;
    const now = new Date();

    const filter: FilterQuery<IGuestUsage> = {
      guest_id: args.guestId,
      messages_used: { $lt: args.limit },
    };
    const update: UpdateQuery<IGuestUsage> = {
      $inc: { messages_used: 1 },
      $setOnInsert: { created_at: now, expires_at: args.expiresAt },
      $set: { updated_at: now },
    };

    try {
      return await GuestUsage.findOneAndUpdate(filter, update, {
        new: true,
        upsert: true,
      }).lean<IGuestUsageLean>();
    } catch (err: unknown) {
      const mongoErr = err as { code?: number };
      if (mongoErr.code !== 11000) {
        throw err;
      }
      // Concurrent upsert collision: retry once without upsert
      return GuestUsage.findOneAndUpdate(
        filter,
        { $inc: { messages_used: 1 }, $set: { updated_at: now } },
        {
          new: true,
          upsert: false,
        },
      ).lean<IGuestUsageLean>();
    }
  }

  return {
    incrementGuestUsage,
  };
}

export type GuestUsageMethods = ReturnType<typeof createGuestUsageMethods>;
