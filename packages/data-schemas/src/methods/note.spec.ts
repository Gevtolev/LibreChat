import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import noteSchema from '~/schema/note';

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
