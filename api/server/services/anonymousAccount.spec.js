const mongoose = require('mongoose');
const { createModels, createMethods } = require('@librechat/data-schemas');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  getTransactionSupport: jest.fn().mockResolvedValue(false),
  createModels: jest.requireActual('@librechat/data-schemas').createModels,
  createMethods: jest.requireActual('@librechat/data-schemas').createMethods,
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

let mongoServer;
let methods;
let User;
let Conversation;
let Message;
let File;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  createModels(mongoose);
  const dbModels = require('~/db/models');
  Object.assign(mongoose.models, dbModels);
  ({ User, Conversation, Message, File } = dbModels);

  methods = createMethods(mongoose, {
    matchModelName: () => null,
    findMatchingPattern: () => null,
    getCache: () => ({ get: async () => null, set: async () => {} }),
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Promise.all(
    [User, Conversation, Message, File].map((Model) => Model.deleteMany({})),
  );
});

// Required after jest.doMock above so the module under test picks up the mocks.
const { getPriorAnonymousUserId, migrateAnonymousData } = require('./anonymousAccount');

async function createAnonymousUser() {
  return User.create({
    email: `anon-${new mongoose.Types.ObjectId()}@chatchat.anonymous`,
    provider: 'anonymous',
    role: 'GUEST',
  });
}

describe('getPriorAnonymousUserId', () => {
  it('returns null when there is no refreshToken cookie', async () => {
    const result = await getPriorAnonymousUserId({ cookies: {} });
    expect(result).toBeNull();
  });

  it('returns null when the refreshToken does not match any session', async () => {
    const result = await getPriorAnonymousUserId({ cookies: { refreshToken: 'not-a-real-token' } });
    expect(result).toBeNull();
  });

  it('returns null when the session belongs to a non-anonymous user', async () => {
    const realUser = await User.create({ email: 'real@example.com', provider: 'local' });
    const { refreshToken } = await methods.createSession(realUser._id.toString());

    const result = await getPriorAnonymousUserId({ cookies: { refreshToken } });
    expect(result).toBeNull();
  });

  it('returns the user id when the session belongs to a live anonymous account', async () => {
    const anonUser = await createAnonymousUser();
    const { refreshToken } = await methods.createSession(anonUser._id.toString());

    const result = await getPriorAnonymousUserId({ cookies: { refreshToken } });
    expect(result).toBe(anonUser._id.toString());
  });
});

describe('migrateAnonymousData', () => {
  it('reassigns conversations/messages/files and deletes the anonymous account', async () => {
    const anonUser = await createAnonymousUser();
    const targetUser = await User.create({ email: 'target@example.com', provider: 'local' });

    const convo = await Conversation.create({
      conversationId: new mongoose.Types.ObjectId().toString(),
      user: anonUser._id,
      endpoint: 'openAI',
    });
    const message = await Message.create({
      messageId: new mongoose.Types.ObjectId().toString(),
      conversationId: convo.conversationId,
      user: anonUser._id,
      text: 'hello',
      isCreatedByUser: true,
    });
    const file = await File.create({
      file_id: new mongoose.Types.ObjectId().toString(),
      user: anonUser._id,
      filename: 'a.png',
      filepath: '/tmp/a.png',
      type: 'image/png',
      bytes: 1,
    });

    await migrateAnonymousData(anonUser._id.toString(), targetUser._id.toString());

    const [migratedConvo, migratedMessage, migratedFile, deletedAnonUser] = await Promise.all([
      Conversation.findById(convo._id).lean(),
      Message.findById(message._id).lean(),
      File.findById(file._id).lean(),
      User.findById(anonUser._id).lean(),
    ]);

    expect(String(migratedConvo.user)).toBe(targetUser._id.toString());
    expect(String(migratedMessage.user)).toBe(targetUser._id.toString());
    expect(String(migratedFile.user)).toBe(targetUser._id.toString());
    expect(deletedAnonUser).toBeNull();
  });

  it('is a no-op when the source account is no longer a live anonymous placeholder', async () => {
    const realUser = await User.create({ email: 'already-real@example.com', provider: 'local' });
    const targetUser = await User.create({ email: 'target2@example.com', provider: 'local' });

    await migrateAnonymousData(realUser._id.toString(), targetUser._id.toString());

    const stillThere = await User.findById(realUser._id).lean();
    expect(stillThere).not.toBeNull();
  });
});
