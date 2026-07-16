jest.mock('~/server/middleware/optionalJwtAuth', () => (req, res, next) => next());
jest.mock('~/server/middleware', () => ({
  uaParser: (req, res, next) => next(),
  checkBan: (req, res, next) => next(),
  guestChatIpLimiter: (req, res, next) => next(),
}));

const mockGetAppConfig = jest.fn();
jest.mock('~/server/services/Config/app', () => ({
  getAppConfig: (...args) => mockGetAppConfig(...args),
}));

const mockIncrementGuestUsage = jest.fn();
jest.mock('~/models', () => ({
  incrementGuestUsage: (...args) => mockIncrementGuestUsage(...args),
}));

const mockGetTenantId = jest.fn(() => undefined);
jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  getTenantId: (...args) => mockGetTenantId(...args),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockGetOrCreateGuestId = jest.fn(() => ({ guestId: 'guest-123', isNew: true }));
const mockGetGuestUsageExpiresAt = jest.fn(() => new Date('2026-08-01T00:00:00Z'));
const mockRunGuestChat = jest.fn();
jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  getOrCreateGuestId: (...args) => mockGetOrCreateGuestId(...args),
  getGuestUsageExpiresAt: (...args) => mockGetGuestUsageExpiresAt(...args),
  runGuestChat: (...args) => mockRunGuestChat(...args),
}));

const request = require('supertest');
const express = require('express');
const guestRoute = require('../guest');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use('/api/guest', guestRoute);
  return app;
}

const enabledGuestChatConfig = {
  guestChat: { provider: 'openAI', model: 'gpt-4o-mini', messageLimit: 1 },
};

afterEach(() => {
  jest.clearAllMocks();
  mockGetOrCreateGuestId.mockReturnValue({ guestId: 'guest-123', isNew: true });
  mockGetGuestUsageExpiresAt.mockReturnValue(new Date('2026-08-01T00:00:00Z'));
});

describe('POST /api/guest/chat', () => {
  it('returns 415 for non-JSON content types', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/api/guest/chat')
      .set('Content-Type', 'text/plain')
      .send('hello');

    expect(response.statusCode).toBe(415);
  });

  it('returns 400 for empty message text', async () => {
    mockGetAppConfig.mockResolvedValue(enabledGuestChatConfig);
    const app = createApp();

    const response = await request(app).post('/api/guest/chat').send({ text: '   ' });

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for message text over the length limit', async () => {
    mockGetAppConfig.mockResolvedValue(enabledGuestChatConfig);
    const app = createApp();

    const response = await request(app)
      .post('/api/guest/chat')
      .send({ text: 'a'.repeat(4001) });

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when guest chat is not enabled', async () => {
    mockGetAppConfig.mockResolvedValue({});
    const app = createApp();

    const response = await request(app).post('/api/guest/chat').send({ text: 'hello' });

    expect(response.statusCode).toBe(404);
    expect(mockIncrementGuestUsage).not.toHaveBeenCalled();
  });

  it('returns 403 with guest_login_required when the trial is exhausted', async () => {
    mockGetAppConfig.mockResolvedValue(enabledGuestChatConfig);
    mockIncrementGuestUsage.mockResolvedValue(null);
    const app = createApp();

    const response = await request(app).post('/api/guest/chat').send({ text: 'hello' });

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ code: 'guest_login_required' });
    expect(mockRunGuestChat).not.toHaveBeenCalled();
  });

  it('returns 200 with the reply text on success, ignoring client-supplied endpoint/model', async () => {
    mockGetAppConfig.mockResolvedValue(enabledGuestChatConfig);
    mockIncrementGuestUsage.mockResolvedValue({ guest_id: 'guest-123', messages_used: 1 });
    mockRunGuestChat.mockResolvedValue('Hello, guest!');
    const app = createApp();

    const response = await request(app)
      .post('/api/guest/chat')
      .send({ text: 'hello', endpoint: 'anthropic', model: 'claude-opus' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ text: 'Hello, guest!' });
    expect(mockRunGuestChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openAI',
        model: 'gpt-4o-mini',
        text: 'hello',
      }),
    );
  });

  it('returns 500 and fails closed when incrementGuestUsage throws', async () => {
    mockGetAppConfig.mockResolvedValue(enabledGuestChatConfig);
    mockIncrementGuestUsage.mockRejectedValue(new Error('db down'));
    const app = createApp();

    const response = await request(app).post('/api/guest/chat').send({ text: 'hello' });

    expect(response.statusCode).toBe(500);
    expect(mockRunGuestChat).not.toHaveBeenCalled();
  });

  it('returns 500 when runGuestChat throws', async () => {
    mockGetAppConfig.mockResolvedValue(enabledGuestChatConfig);
    mockIncrementGuestUsage.mockResolvedValue({ guest_id: 'guest-123', messages_used: 1 });
    mockRunGuestChat.mockRejectedValue(new Error('provider error'));
    const app = createApp();

    const response = await request(app).post('/api/guest/chat').send({ text: 'hello' });

    expect(response.statusCode).toBe(500);
  });
});
