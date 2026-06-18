const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Jest mock factories cannot reference out-of-scope variables unless prefixed with `mock`.
// We use a shared state object (mock-prefixed) so the middleware closure can read the
// current test user set by each test.
const mockState = { user: null };

jest.mock('~/models', () => {
  const mongooseInstance = require('mongoose');
  const { createMethods } = require('@librechat/data-schemas');
  return createMethods(mongooseInstance);
});

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => {
    req.user = mockState.user;
    next();
  },
}));

let app;
let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  require('~/db/models'); // registers all models incl. Note
  if (!mongoose.modelNames().includes('Note')) {
    throw new Error('Note model not registered — ensure Task 1 added it to createModels()');
  }
  const notesRoutes = require('~/server/routes/notes');
  app = express();
  app.use(express.json());
  app.use('/api/notes', notesRoutes);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  mockState.user = { id: new mongoose.Types.ObjectId().toString() };
});

describe('Notes routes', () => {
  test('POST / creates a note', async () => {
    const res = await request(app).post('/api/notes').send({ title: 'My Note', content: 'hi' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('My Note');
  });

  test('POST / requires title', async () => {
    const res = await request(app).post('/api/notes').send({ content: 'no title' });
    expect(res.status).toBe(400);
  });

  test('GET / lists the user notes', async () => {
    await request(app).post('/api/notes').send({ title: 'A' });
    const res = await request(app).get('/api/notes');
    expect(res.status).toBe(200);
    expect(res.body.notes).toHaveLength(1);
  });

  test('notes are scoped per user', async () => {
    await request(app).post('/api/notes').send({ title: 'mine' });
    mockState.user = { id: new mongoose.Types.ObjectId().toString() };
    const res = await request(app).get('/api/notes');
    expect(res.body.notes).toHaveLength(0);
  });

  test('GET /:id returns the note', async () => {
    const created = await request(app).post('/api/notes').send({ title: 'X', content: 'body' });
    const res = await request(app).get(`/api/notes/${created.body._id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('X');
    expect(res.body.content).toBe('body');
  });

  test('PATCH updates and DELETE removes', async () => {
    const created = await request(app).post('/api/notes').send({ title: 'x' });
    const id = created.body._id;
    const upd = await request(app).patch(`/api/notes/${id}`).send({ title: 'y' });
    expect(upd.body.title).toBe('y');
    const del = await request(app).delete(`/api/notes/${id}`);
    expect(del.body.ok).toBe(true);
    const get = await request(app).get(`/api/notes/${id}`);
    expect(get.status).toBe(404);
  });
});
