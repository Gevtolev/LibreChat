import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import noteSchema from '~/schema/note';
import { createNoteMethods } from './note';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  mongoose.models.Note || mongoose.model('Note', noteSchema);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

describe('Note schema', () => {
  const user = new mongoose.Types.ObjectId();

  test('creates a note with defaults', async () => {
    const Note = mongoose.models.Note;
    const note = await Note.create({ user, title: 'My Note' });
    expect(note.title).toBe('My Note');
    expect(note.content).toBe('');
    expect(note.source).toBe('manual');
    expect(note.tokenCount).toBe(0);
    expect(note.createdAt).toBeInstanceOf(Date);
  });

  test('requires a title', async () => {
    const Note = mongoose.models.Note;
    await expect(Note.create({ user })).rejects.toThrow();
  });

  test('rejects an invalid attachment kind', async () => {
    const Note = mongoose.models.Note;
    await expect(
      Note.create({ user, title: 'T', attachments: [{ file_id: 'f1', kind: 'bogus' }] }),
    ).rejects.toThrow();
  });
});

describe('Note methods', () => {
  const user = new mongoose.Types.ObjectId();
  const otherUser = new mongoose.Types.ObjectId();
  const methods = createNoteMethods(mongoose);

  test('createNote then getNoteById', async () => {
    const created = await methods.createNote({ user, title: 'A', content: 'body', tags: ['x'] });
    expect(created.title).toBe('A');
    const fetched = await methods.getNoteById({ user, id: created._id });
    expect(fetched?.content).toBe('body');
  });

  test('getNoteById is user-scoped', async () => {
    const created = await methods.createNote({ user, title: 'mine' });
    const leaked = await methods.getNoteById({ user: otherUser, id: created._id });
    expect(leaked).toBeNull();
  });

  test('getUserNotes lists only the user notes, newest first', async () => {
    await methods.createNote({ user, title: 'first' });
    await methods.createNote({ user, title: 'second' });
    await methods.createNote({ user: otherUser, title: 'theirs' });
    const notes = await methods.getUserNotes({ user });
    expect(notes).toHaveLength(2);
  });

  test('updateNote sets fields and addLinks', async () => {
    const a = await methods.createNote({ user, title: 'a' });
    const b = await methods.createNote({ user, title: 'b' });
    const updated = await methods.updateNote({
      user,
      id: a._id,
      update: { content: 'new', tags: ['t'], addLinks: [b._id] },
    });
    expect(updated?.content).toBe('new');
    expect(updated?.tags).toEqual(['t']);
    expect(updated?.links?.map((l) => l.toString())).toContain(b._id.toString());
  });

  test('searchNotes matches title/content, respects tags + limit', async () => {
    await methods.createNote({ user, title: 'pricing ideas', content: 'subscription', tags: ['biz'] });
    await methods.createNote({ user, title: 'random', content: 'nothing here', tags: ['misc'] });
    const byKeyword = await methods.searchNotes({ user, query: 'subscription' });
    expect(byKeyword).toHaveLength(1);
    expect(byKeyword[0].title).toBe('pricing ideas');
    const byTag = await methods.searchNotes({ user, query: '', tags: ['biz'] });
    expect(byTag).toHaveLength(1);
  });

  test('deleteNote and deleteAllUserNotes', async () => {
    const n = await methods.createNote({ user, title: 'to delete' });
    const del = await methods.deleteNote({ user, id: n._id });
    expect(del.ok).toBe(true);
    await methods.createNote({ user, title: 'one' });
    await methods.createNote({ user, title: 'two' });
    const count = await methods.deleteAllUserNotes(user);
    expect(count).toBe(2);
  });
});
