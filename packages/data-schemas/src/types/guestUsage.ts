import type { Types, Document } from 'mongoose';

export interface IGuestUsage extends Document {
  guest_id: string;
  ip_hash?: string;
  messages_used: number;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
}

export interface IGuestUsageLean {
  _id: Types.ObjectId;
  guest_id: string;
  ip_hash?: string;
  messages_used: number;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  __v?: number;
}
