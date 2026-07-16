import type { TGptsapiImageModel } from 'librechat-data-provider';
import type { ImageProviderRuntimeConfig } from './types';

const mockPost = jest.fn();
const mockGet = jest.fn();

jest.mock('~/utils/axios', () => ({
  createAxiosInstance: () => ({ post: mockPost, get: mockGet }),
  logAxiosError: ({ message }: { message: string }) => message,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generate, poll } = require('./gptsapi') as {
  generate: (
    args: {
      model: TGptsapiImageModel;
      prompt: string;
      aspectRatio: string;
      paramValue: string;
      imageUrls?: string[];
    },
    cfg: ImageProviderRuntimeConfig,
  ) => Promise<{ status: string; jobId?: string; imageUrl?: string; error?: string }>;
  poll: (
    jobId: string,
    cfg: ImageProviderRuntimeConfig,
  ) => Promise<{ status: string; jobId?: string; imageUrl?: string; error?: string }>;
};

const cfg: ImageProviderRuntimeConfig = { baseUrl: 'https://api.gptsapi.net', apiKey: 'test-key' };

const geminiModel: TGptsapiImageModel = {
  id: 'gemini-3-pro-image-preview',
  label: 'Nano Banana Pro',
  vendor: 'google',
  supportsEdit: true,
  editImagesKey: 'images',
  paramKey: 'output_format',
  paramValues: ['png', 'jpeg'],
  defaultParam: 'png',
};

const gptImageModel: TGptsapiImageModel = {
  id: 'gpt-image-2',
  label: 'GPT Image 2',
  vendor: 'openai',
  supportsEdit: true,
  editImagesKey: 'input_urls',
  paramKey: 'resolution',
  paramValues: ['1K', '2K', '4K'],
  defaultParam: '1K',
};

describe('gptsapi generate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('text-to-image: hits correct URL, returns pending with jobId', async () => {
    mockPost.mockResolvedValue({ data: { data: { id: 'pred-123' } } });
    const result = await generate(
      { model: geminiModel, prompt: 'a cat', aspectRatio: '1:1', paramValue: 'png' },
      cfg,
    );
    expect(result).toEqual({ status: 'pending', jobId: 'pred-123' });
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe(
      'https://api.gptsapi.net/api/v3/google/gemini-3-pro-image-preview/text-to-image',
    );
    expect(body).toEqual({ prompt: 'a cat', aspect_ratio: '1:1', output_format: 'png' });
  });

  test('image-edit (google): sets images key', async () => {
    mockPost.mockResolvedValue({ data: { data: { id: 'pred-456' } } });
    await generate(
      {
        model: geminiModel,
        prompt: 'add a hat',
        aspectRatio: '16:9',
        paramValue: 'jpeg',
        imageUrls: ['https://example.com/img.jpg'],
      },
      cfg,
    );
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('https://api.gptsapi.net/api/v3/google/gemini-3-pro-image-preview/image-edit');
    expect(body).toMatchObject({ images: ['https://example.com/img.jpg'] });
  });

  test('image-edit (openai): sets input_urls key', async () => {
    mockPost.mockResolvedValue({ data: { data: { id: 'pred-789' } } });
    await generate(
      {
        model: gptImageModel,
        prompt: 'change background',
        aspectRatio: '1:1',
        paramValue: '1K',
        imageUrls: ['https://example.com/photo.png'],
      },
      cfg,
    );
    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({ input_urls: ['https://example.com/photo.png'] });
    expect(body).not.toHaveProperty('images');
  });

  test('throws when response has no id', async () => {
    mockPost.mockResolvedValue({ data: { data: {} } });
    await expect(
      generate({ model: geminiModel, prompt: 'x', aspectRatio: 'auto', paramValue: 'png' }, cfg),
    ).rejects.toThrow('gptsapi image submit failed');
  });
});

describe('gptsapi poll', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('maps completed status to imageUrl', async () => {
    mockGet.mockResolvedValue({
      data: { data: { status: 'completed', outputs: ['https://img.url/1.png'] } },
    });
    const result = await poll('pred-123', cfg);
    expect(result).toEqual({ status: 'completed', imageUrl: 'https://img.url/1.png' });
    const [url] = mockGet.mock.calls[0];
    expect(url).toBe('https://api.gptsapi.net/api/v3/predictions/pred-123/result');
  });

  test('maps failed status to error', async () => {
    mockGet.mockResolvedValue({ data: { data: { status: 'failed', error: 'quota exceeded' } } });
    const result = await poll('pred-err', cfg);
    expect(result).toEqual({ status: 'failed', error: 'quota exceeded' });
  });

  test('maps error status to error', async () => {
    mockGet.mockResolvedValue({ data: { data: { status: 'error', error: 'provider error' } } });
    const result = await poll('pred-err2', cfg);
    expect(result).toEqual({ status: 'failed', error: 'provider error' });
  });

  test('maps processing/created/unknown status to pending', async () => {
    mockGet.mockResolvedValue({ data: { data: { status: 'processing' } } });
    const result = await poll('pred-456', cfg);
    expect(result).toEqual({ status: 'pending', jobId: 'pred-456' });
  });

  test('throws on get error', async () => {
    mockGet.mockRejectedValue(new Error('network fail'));
    await expect(poll('pred-err3', cfg)).rejects.toThrow('gptsapi image poll failed');
  });
});
