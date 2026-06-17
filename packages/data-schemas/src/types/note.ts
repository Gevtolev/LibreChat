import type { Types, Document } from 'mongoose';

export type NoteAttachmentKind = 'image' | 'audio' | 'video' | 'pdf' | 'doc' | 'web';
export type NoteSource = 'manual' | 'upload' | 'clip';

export interface INoteAttachment {
  file_id: string;
  kind: NoteAttachmentKind;
  derivedText?: string;
  sourceUrl?: string;
}

export interface INote extends Document {
  user: Types.ObjectId;
  notebookId?: Types.ObjectId;
  title: string;
  content: string;
  tags?: string[];
  links?: Types.ObjectId[];
  attachments?: INoteAttachment[];
  source: NoteSource;
  tokenCount?: number;
  maintainedAt?: Date;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface INoteLean {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  notebookId?: Types.ObjectId;
  title: string;
  content: string;
  tags?: string[];
  links?: Types.ObjectId[];
  attachments?: INoteAttachment[];
  source: NoteSource;
  tokenCount?: number;
  maintainedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateNoteParams {
  user: string | Types.ObjectId;
  title: string;
  content?: string;
  tags?: string[];
  source?: NoteSource;
}

export interface GetNoteParams {
  user: string | Types.ObjectId;
  id: string | Types.ObjectId;
}

export interface GetUserNotesParams {
  user: string | Types.ObjectId;
  tags?: string[];
}

export interface UpdateNoteParams {
  user: string | Types.ObjectId;
  id: string | Types.ObjectId;
  update: {
    title?: string;
    content?: string;
    tags?: string[];
    addLinks?: (string | Types.ObjectId)[];
  };
}

export interface SearchNotesParams {
  user: string | Types.ObjectId;
  query: string;
  tags?: string[];
  limit?: number;
}

export interface DeleteNoteParams {
  user: string | Types.ObjectId;
  id: string | Types.ObjectId;
}

export interface NoteDeleteResult {
  ok: boolean;
}
