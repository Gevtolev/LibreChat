import { Providers } from '@librechat/agents';
import type { AppConfig } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types';

const mockRunCreate = jest.fn();
const mockProcessStream = jest.fn();

jest.mock('@librechat/agents', () => {
  const actual = jest.requireActual('@librechat/agents');
  return {
    ...actual,
    Run: {
      create: (...args: unknown[]) => mockRunCreate(...args),
    },
  };
});

const mockGetOptions = jest.fn();
jest.mock('~/endpoints/config/providers', () => ({
  getProviderConfig: jest.fn(() => ({
    getOptions: (...args: unknown[]) => mockGetOptions(...args),
    overrideProvider: 'openAI',
  })),
}));

import { runGuestChat } from './chat';

describe('runGuestChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunCreate.mockResolvedValue({
      processStream: mockProcessStream,
    });
    mockProcessStream.mockResolvedValue([{ type: 'text', text: 'Hello, guest!' }]);
  });

  const baseArgs = {
    req: {} as ServerRequest,
    appConfig: {} as AppConfig,
    provider: 'openAI',
    model: 'gpt-4o-mini',
    text: 'hi',
  };

  it('merges configOptions into llmConfig.configuration so the reverse proxy is used', async () => {
    mockGetOptions.mockResolvedValue({
      llmConfig: { model: 'gpt-4o-mini', apiKey: 'sk-test', streaming: true },
      configOptions: { baseURL: 'https://api.gptsapi.net/v1' },
    });

    await runGuestChat(baseArgs);

    const runConfig = mockRunCreate.mock.calls[0][0] as {
      graphConfig: { llmConfig: Record<string, unknown> };
    };
    expect(runConfig.graphConfig.llmConfig.configuration).toEqual({
      baseURL: 'https://api.gptsapi.net/v1',
    });
  });

  it('forces streaming off regardless of what the provider config requests', async () => {
    mockGetOptions.mockResolvedValue({
      llmConfig: { model: 'gpt-4o-mini', apiKey: 'sk-test', streaming: true },
    });

    await runGuestChat(baseArgs);

    const runConfig = mockRunCreate.mock.calls[0][0] as {
      graphConfig: { llmConfig: Record<string, unknown> };
    };
    expect(runConfig.graphConfig.llmConfig.streaming).toBe(false);
    expect(runConfig.graphConfig.llmConfig.disableStreaming).toBe(true);
  });

  it('does not set configuration when the provider returns no configOptions', async () => {
    mockGetOptions.mockResolvedValue({
      llmConfig: { model: 'gpt-4o-mini', apiKey: 'sk-test' },
    });

    await runGuestChat(baseArgs);

    const runConfig = mockRunCreate.mock.calls[0][0] as {
      graphConfig: { llmConfig: Record<string, unknown> };
    };
    expect(runConfig.graphConfig.llmConfig.configuration).toBeUndefined();
  });

  it('sets the resolved provider on the final llmConfig', async () => {
    mockGetOptions.mockResolvedValue({
      llmConfig: { model: 'gpt-4o-mini', apiKey: 'sk-test' },
    });

    await runGuestChat(baseArgs);

    const runConfig = mockRunCreate.mock.calls[0][0] as {
      graphConfig: { llmConfig: Record<string, unknown> };
    };
    expect(runConfig.graphConfig.llmConfig.provider).toBe(Providers.OPENAI);
  });

  it('extracts text content from the run result', async () => {
    mockGetOptions.mockResolvedValue({
      llmConfig: { model: 'gpt-4o-mini', apiKey: 'sk-test' },
    });
    mockProcessStream.mockResolvedValue([
      { type: 'text', text: 'Hello, ' },
      { type: 'text', text: 'guest!' },
    ]);

    const result = await runGuestChat(baseArgs);

    expect(result).toBe('Hello, guest!');
  });

  it('sets req.config so initializeXxx functions can read it', async () => {
    mockGetOptions.mockResolvedValue({
      llmConfig: { model: 'gpt-4o-mini', apiKey: 'sk-test' },
    });
    const appConfig = { guestChat: { provider: 'openAI', model: 'gpt-4o-mini' } } as AppConfig;
    const req = {} as ServerRequest;

    await runGuestChat({ ...baseArgs, req, appConfig });

    expect(req.config).toBe(appConfig);
  });
});
