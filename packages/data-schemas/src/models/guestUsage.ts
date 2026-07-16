import guestUsageSchema from '~/schema/guestUsage';
import type { IGuestUsage } from '~/types/guestUsage';

export function createGuestUsageModel(mongoose: typeof import('mongoose')) {
  return mongoose.models.GuestUsage || mongoose.model<IGuestUsage>('GuestUsage', guestUsageSchema);
}
