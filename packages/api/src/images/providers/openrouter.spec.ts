import type { TOpenRouterImageModel } from 'librechat-data-provider';
import type { ImageProviderRuntimeConfig } from './types';

const mockPost = jest.fn();

jest.mock('~/utils/axios', () => ({
  createAxiosInstance: () => ({ post: mockPost }),
  logAxiosError: ({ message }: { message: string }) => message,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generate } = require('./openrouter') as {
  generate: (
    args: {
      model: TOpenRouterImageModel;
      prompt: string;
      aspectRatio: string;
      paramValue: string;
      imageUrls?: string[];
    },
    cfg: ImageProviderRuntimeConfig,
  ) => Promise<{ status: string; imageB64?: string; mediaType?: string }>;
};

const cfg: ImageProviderRuntimeConfig = {
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'or-key',
};

const geminiModel: TOpenRouterImageModel = {
  id: 'google/gemini-3-pro-image',
  label: 'Nano Banana Pro',
  supportsEdit: true,
  paramKey: 'output_format',
  paramValues: ['png', 'jpeg'],
  defaultParam: 'png',
};

describe('openrouter generate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('posts to /images with model id, prompt, aspect_ratio, and paramKey', async () => {
    mockPost.mockResolvedValue({
      data: { data: [{ b64_json: 'BASE64DATA', media_type: 'image/png' }] },
    });
    const result = await generate(
      { model: geminiModel, prompt: 'a red panda', aspectRatio: '16:9', paramValue: 'png' },
      cfg,
    );
    expect(result).toEqual({ status: 'completed', imageB64: 'BASE64DATA', mediaType: 'image/png' });
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/images');
    expect(body).toEqual({
      model: 'google/gemini-3-pro-image',
      prompt: 'a red panda',
      aspect_ratio: '16:9',
      output_format: 'png',
    });
  });

  test('maps imageUrls to input_references', async () => {
    mockPost.mockResolvedValue({ data: { data: [{ b64_json: 'X', media_type: 'image/png' }] } });
    await generate(
      {
        model: geminiModel,
        prompt: 'edit this',
        aspectRatio: '1:1',
        paramValue: 'png',
        imageUrls: ['https://example.com/a.png'],
      },
      cfg,
    );
    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({
      input_references: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }],
    });
  });

  test('throws when response has no image data', async () => {
    mockPost.mockResolvedValue({ data: { data: [] } });
    await expect(
      generate({ model: geminiModel, prompt: 'x', aspectRatio: '1:1', paramValue: 'png' }, cfg),
    ).rejects.toThrow('openrouter image generation failed');
  });

  test('throws on axios error', async () => {
    mockPost.mockRejectedValue(new Error('network fail'));
    await expect(
      generate({ model: geminiModel, prompt: 'x', aspectRatio: '1:1', paramValue: 'png' }, cfg),
    ).rejects.toThrow('openrouter image generation failed');
  });
});
