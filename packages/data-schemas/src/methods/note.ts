import { Types } from 'mongoose';
import type { FilterQuery, UpdateQuery } from 'mongoose';
import type * as t from '~/types';
import type { INote } from '~/types/note';

export function createNoteMethods(mongoose: typeof import('mongoose')) {
  async function createNote({
    user,
    title,
    content = '',
    tags,
    source = 'manual',
  }: t.CreateNoteParams): Promise<t.INoteLean> {
    const Note = mongoose.models.Note;
    const doc = await Note.create({ user, title, content, tags, source });
    const note: t.INoteLean = doc.toObject();
    return note;
  }

  async function getNoteById({ user, id }: t.GetNoteParams): Promise<t.INoteLean | null> {
    const Note = mongoose.models.Note;
    return await Note.findOne({ _id: id, user }).lean<t.INoteLean | null>();
  }

  async function getUserNotes({ user, tags }: t.GetUserNotesParams): Promise<t.INoteLean[]> {
    const Note = mongoose.models.Note;
    const filter: FilterQuery<INote> = { user };
    if (tags && tags.length > 0) {
      filter.tags = { $in: tags };
    }
    return await Note.find(filter).sort({ updatedAt: -1 }).lean<t.INoteLean[]>();
  }

  async function updateNote({ user, id, update }: t.UpdateNoteParams): Promise<t.INoteLean | null> {
    const Note = mongoose.models.Note;
    const ops: UpdateQuery<INote> = {};
    const set: Partial<Pick<INote, 'title' | 'content' | 'tags'>> = {};
    if (update.title !== undefined) set.title = update.title;
    if (update.content !== undefined) set.content = update.content;
    if (update.tags !== undefined) set.tags = update.tags;
    if (Object.keys(set).length > 0) {
      ops.$set = set;
    }
    if (update.addLinks && update.addLinks.length > 0) {
      ops.$addToSet = { links: { $each: update.addLinks.map((l) => new Types.ObjectId(l)) } };
    }
    if (Object.keys(ops).length === 0) {
      return await Note.findOne({ _id: id, user }).lean<t.INoteLean | null>();
    }
    return await Note.findOneAndUpdate({ _id: id, user }, ops, {
      new: true,
    }).lean<t.INoteLean | null>();
  }

  async function deleteNote({ user, id }: t.DeleteNoteParams): Promise<t.NoteDeleteResult> {
    const Note = mongoose.models.Note;
    const result = await Note.findOneAndDelete({ _id: id, user });
    return { ok: !!result };
  }

  async function searchNotes({
    user,
    query,
    tags,
    limit = 10,
  }: t.SearchNotesParams): Promise<t.INoteLean[]> {
    const Note = mongoose.models.Note;
    const filter: FilterQuery<INote> = { user };
    if (query) {
      const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { title: { $regex: safe, $options: 'i' } },
        { content: { $regex: safe, $options: 'i' } },
      ];
    }
    if (tags && tags.length > 0) {
      filter.tags = { $in: tags };
    }
    return await Note.find(filter).sort({ updatedAt: -1 }).limit(limit).lean<t.INoteLean[]>();
  }

  async function deleteAllUserNotes(user: string | Types.ObjectId): Promise<number> {
    const Note = mongoose.models.Note;
    const result = await Note.deleteMany({ user });
    return result.deletedCount;
  }

  return {
    createNote,
    getNoteById,
    getUserNotes,
    updateNote,
    deleteNote,
    searchNotes,
    deleteAllUserNotes,
  };
}

export type NoteMethods = ReturnType<typeof createNoteMethods>;
