import { Schema } from 'mongoose';
import type { IGuestUsage } from '~/types/guestUsage';

const guestUsageSchema = new Schema<IGuestUsage>(
  {
    guest_id: {
      type: String,
      required: true,
    },
    ip_hash: {
      type: String,
      required: false,
    },
    messages_used: {
      type: Number,
      default: 0,
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
    updated_at: {
      type: Date,
      default: Date.now,
    },
    /** Guest identity lifetime — matches the signed cookie's own expiry. */
    expires_at: {
      type: Date,
      required: true,
    },
  },
  { timestamps: false },
);

guestUsageSchema.index({ guest_id: 1 }, { unique: true });
guestUsageSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export default guestUsageSchema;
