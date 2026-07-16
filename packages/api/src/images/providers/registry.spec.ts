import type { TImageGenerationConfig } from 'librechat-data-provider';

jest.mock('./openrouter');
jest.mock('./gptsapi');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveImageProviders, findProvider, generateImage, pollImage } = require('./registry') as {
  resolveImageProviders: typeof import('./registry').resolveImageProviders;
  findProvider: typeof import('./registry').findProvider;
  generateImage: typeof import('./registry').generateImage;
  pollImage: typeof import('./registry').pollImage;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const openrouterAdapter = require('./openrouter');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gptsapiAdapter = require('./gptsapi');

const config: TImageGenerationConfig = {
  providers: [
    {
      name: 'OpenRouter',
      protocol: 'openrouter',
      apiKey: '${TEST_OPENROUTER_KEY}',
      baseURL: 'https://openrouter.ai/api/v1',
      aspectRatios: ['1:1'],
      models: [
        {
          id: 'google/gemini-3-pro-image',
          label: 'Nano Banana Pro',
          supportsEdit: true,
          paramKey: 'output_format',
          paramValues: ['png'],
          defaultParam: 'png',
        },
      ],
    },
    {
      name: 'GPTsAPI',
      protocol: 'gptsapi-predictions',
      apiKey: '${TEST_GPTSAPI_KEY}',
      baseURL: 'https://api.gptsapi.net',
      aspectRatios: ['1:1'],
      models: [
        {
          id: 'gemini-3-pro-image-preview',
          label: 'Nano Banana Pro (GPTsAPI)',
          vendor: 'google',
          supportsEdit: true,
          editImagesKey: 'images',
          paramKey: 'output_format',
          paramValues: ['png'],
          defaultParam: 'png',
        },
      ],
    },
  ],
};

describe('resolveImageProviders', () => {
  beforeEach(() => {
    process.env.TEST_OPENROUTER_KEY = 'or-secret';
    process.env.TEST_GPTSAPI_KEY = 'gpts-secret';
  });

  test('resolves env vars in apiKey/baseURL for each provider', () => {
    const resolved = resolveImageProviders(config);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].runtimeConfig).toEqual({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'or-secret',
    });
    expect(resolved[1].runtimeConfig.apiKey).toBe('gpts-secret');
  });

  test('returns an empty array when imageGeneration is undefined', () => {
    expect(resolveImageProviders(undefined)).toEqual([]);
  });
});

describe('findProvider', () => {
  test('throws for an unknown provider name', () => {
    const providers = resolveImageProviders(config);
    expect(() => findProvider(providers, 'Nope')).toThrow('Unknown image provider: Nope');
  });
});

describe('generateImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TEST_OPENROUTER_KEY = 'or-secret';
    process.env.TEST_GPTSAPI_KEY = 'gpts-secret';
  });

  test('dispatches to the openrouter adapter for an openrouter provider', async () => {
    openrouterAdapter.generate.mockResolvedValue({ status: 'completed', imageB64: 'X' });
    const providers = resolveImageProviders(config);
    const result = await generateImage(providers, {
      providerName: 'OpenRouter',
      modelId: 'google/gemini-3-pro-image',
      prompt: 'a cat',
      aspectRatio: '1:1',
      paramValue: 'png',
    });
    expect(result).toEqual({ status: 'completed', imageB64: 'X' });
    expect(openrouterAdapter.generate).toHaveBeenCalledTimes(1);
    expect(gptsapiAdapter.generate).not.toHaveBeenCalled();
  });

  test('dispatches to the gptsapi adapter for a gptsapi provider', async () => {
    gptsapiAdapter.generate.mockResolvedValue({ status: 'pending', jobId: 'p1' });
    const providers = resolveImageProviders(config);
    const result = await generateImage(providers, {
      providerName: 'GPTsAPI',
      modelId: 'gemini-3-pro-image-preview',
      prompt: 'a cat',
      aspectRatio: '1:1',
      paramValue: 'png',
    });
    expect(result).toEqual({ status: 'pending', jobId: 'p1' });
    expect(gptsapiAdapter.generate).toHaveBeenCalledTimes(1);
  });

  test('throws for an unknown provider name', async () => {
    const providers = resolveImageProviders(config);
    await expect(
      generateImage(providers, {
        providerName: 'Nope',
        modelId: 'x',
        prompt: 'x',
        aspectRatio: '1:1',
        paramValue: 'png',
      }),
    ).rejects.toThrow('Unknown image provider: Nope');
  });

  test('throws for an unknown model id within a known provider', async () => {
    const providers = resolveImageProviders(config);
    await expect(
      generateImage(providers, {
        providerName: 'OpenRouter',
        modelId: 'not-a-real-model',
        prompt: 'x',
        aspectRatio: '1:1',
        paramValue: 'png',
      }),
    ).rejects.toThrow('Unknown image model "not-a-real-model" for provider "OpenRouter"');
  });
});

describe('pollImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TEST_GPTSAPI_KEY = 'gpts-secret';
  });

  test('dispatches to gptsapi.poll for a gptsapi-predictions provider', async () => {
    gptsapiAdapter.poll.mockResolvedValue({ status: 'completed', imageUrl: 'https://x' });
    const providers = resolveImageProviders(config);
    const result = await pollImage(providers, 'GPTsAPI', 'job-1');
    expect(result).toEqual({ status: 'completed', imageUrl: 'https://x' });
  });

  test('throws when polling an openrouter (synchronous) provider', async () => {
    const providers = resolveImageProviders(config);
    await expect(pollImage(providers, 'OpenRouter', 'job-1')).rejects.toThrow(
      'Provider "OpenRouter" does not support polling',
    );
  });
});
