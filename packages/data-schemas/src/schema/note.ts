import { Schema } from 'mongoose';
import type { INote } from '~/types/note';

const noteAttachment = new Schema(
  {
    file_id: { type: String, required: true },
    kind: {
      type: String,
      enum: ['image', 'audio', 'video', 'pdf', 'doc', 'web'],
      required: true,
    },
    derivedText: { type: String },
    sourceUrl: { type: String },
  },
  { _id: false },
);

const note: Schema<INote> = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    notebookId: { type: Schema.Types.ObjectId, ref: 'Notebook', index: true },
    title: { type: String, required: true },
    content: { type: String, default: '' },
    tags: { type: [String], index: true },
    links: [{ type: Schema.Types.ObjectId, ref: 'Note' }],
    attachments: { type: [noteAttachment], default: undefined },
    source: { type: String, enum: ['manual', 'upload', 'clip'], default: 'manual' },
    tokenCount: { type: Number, default: 0 },
    maintainedAt: { type: Date },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

note.index({ user: 1, updatedAt: -1 });
note.index({ user: 1, tags: 1 });

export default note;
