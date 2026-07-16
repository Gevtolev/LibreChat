import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { TImageGenerationConfig } from 'librechat-data-provider';
import { submitGeneration, resolveResult } from './service';
import type { ImageDeps } from './service';
import { resolveImageProviders } from './providers/registry';

jest.mock('./providers/openrouter');
jest.mock('./providers/gptsapi');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const openrouterAdapter = require('./providers/openrouter');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gptsapiAdapter = require('./providers/gptsapi');

const testConfig: TImageGenerationConfig = {
  providers: [
    {
      name: 'OpenRouter',
      protocol: 'openrouter',
      apiKey: 'or-key',
      baseURL: 'https://openrouter.ai/api/v1',
      aspectRatios: ['1:1', '16:9'],
      models: [
        {
          id: 'google/gemini-3-pro-image',
          label: 'Nano Banana Pro',
          isDefault: true,
          supportsEdit: true,
          paramKey: 'output_format',
          paramValues: ['png', 'jpeg'],
          defaultParam: 'png',
        },
      ],
    },
    {
      name: 'GPTsAPI',
      protocol: 'gptsapi-predictions',
      apiKey: 'gpts-key',
      baseURL: 'https://api.gptsapi.net',
      aspectRatios: ['1:1', '16:9'],
      models: [
        {
          id: 'gpt-image-2',
          label: 'GPT Image 2',
          vendor: 'openai',
          supportsEdit: true,
          editImagesKey: 'input_urls',
          paramKey: 'resolution',
          paramValues: ['1K', '2K', '4K'],
          defaultParam: '1K',
        },
      ],
    },
  ],
};

const providers = resolveImageProviders(testConfig);

let mongoServer: MongoMemoryServer;

function buildDeps(): ImageDeps {
  const methods = createMethods(mongoose);
  const fetchImage = jest.fn();
  const fetchImageFromB64 = jest.fn();
  const saveImageFile = jest.fn();
  return {
    fetchImage,
    fetchImageFromB64,
    saveImageFile,
    createFileRecord: (doc) =>
      methods.createFile(doc as Parameters<typeof methods.createFile>[0], true) as ReturnType<
        ImageDeps['createFileRecord']
      >,
    findFileByPrediction: async (userId, predictionId) => {
      const files = await methods.getFiles(
        { user: userId, 'metadata.imageGen.predictionId': predictionId },
        {},
        {},
      );
      return files && files.length > 0 ? files[0] : null;
    },
  };
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  for (const modelName of Object.keys(mongoose.models)) {
    await mongoose.models[modelName].ensureIndexes();
  }
  jest.clearAllMocks();
});

const userId = () => new mongoose.Types.ObjectId().toString();

// ---------------------------------------------------------------------------
// submitGeneration
// ---------------------------------------------------------------------------

describe('submitGeneration', () => {
  test('unknown provider/model throws', async () => {
    const deps = buildDeps();
    await expect(
      submitGeneration(
        { providerName: 'Nope', model: 'bad', prompt: 'hi', aspectRatio: '1:1' },
        providers,
        deps,
        userId(),
      ),
    ).rejects.toThrow('Unknown image model "bad" for provider "Nope"');
  });

  test('empty prompt throws', async () => {
    const deps = buildDeps();
    await expect(
      submitGeneration(
        {
          providerName: 'OpenRouter',
          model: 'google/gemini-3-pro-image',
          prompt: '  ',
          aspectRatio: '1:1',
        },
        providers,
        deps,
        userId(),
      ),
    ).rejects.toThrow('prompt is required');
  });

  test('invalid aspect ratio throws', async () => {
    const deps = buildDeps();
    await expect(
      submitGeneration(
        {
          providerName: 'OpenRouter',
          model: 'google/gemini-3-pro-image',
          prompt: 'a cat',
          aspectRatio: 'bad-ratio',
        },
        providers,
        deps,
        userId(),
      ),
    ).rejects.toThrow('invalid aspect_ratio: bad-ratio');
  });

  test('gpt-image-2 with 4K + 1:1 throws', async () => {
    const deps = buildDeps();
    await expect(
      submitGeneration(
        {
          providerName: 'GPTsAPI',
          model: 'gpt-image-2',
          prompt: 'a cat',
          aspectRatio: '1:1',
          param: '4K',
        },
        providers,
        deps,
        userId(),
      ),
    ).rejects.toThrow('1:1 cannot be 4K');
  });

  test('openrouter (synchronous) provider downloads from base64 and returns completed immediately', async () => {
    openrouterAdapter.generate.mockResolvedValue({
      status: 'completed',
      imageB64: 'BASE64DATA',
      mediaType: 'image/png',
    });
    const deps = buildDeps();
    (deps.fetchImageFromB64 as jest.Mock).mockResolvedValueOnce({
      buffer: Buffer.from('fake-image'),
      contentType: 'image/png',
      width: 1024,
      height: 1024,
    });
    (deps.saveImageFile as jest.Mock).mockResolvedValueOnce({
      filepath: '/storage/out.png',
      source: 'r2',
      bytes: 10,
      filename: 'out.png',
      storageMetadata: { storageKey: 'gen/out.png', storageRegion: 'auto' },
    });

    const uid = userId();
    const result = await submitGeneration(
      {
        providerName: 'OpenRouter',
        model: 'google/gemini-3-pro-image',
        prompt: 'a cat',
        aspectRatio: '1:1',
      },
      providers,
      deps,
      uid,
    );

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') {
      throw new Error('expected completed result');
    }
    expect(result.file.context).toBe('image_generation');
    expect(result.file.metadata?.imageGen?.prompt).toBe('a cat');
    expect(deps.fetchImageFromB64).toHaveBeenCalledWith('BASE64DATA', 'image/png');
    expect(deps.fetchImage).not.toHaveBeenCalled();
  });

  test('gptsapi (asynchronous) provider returns pending with jobId, does not touch storage', async () => {
    gptsapiAdapter.generate.mockResolvedValue({ status: 'pending', jobId: 'pred-123' });
    const deps = buildDeps();
    const result = await submitGeneration(
      {
        providerName: 'GPTsAPI',
        model: 'gpt-image-2',
        prompt: 'a cat',
        aspectRatio: '1:1',
      },
      providers,
      deps,
      userId(),
    );
    expect(result).toEqual({ status: 'pending', predictionId: 'pred-123' });
    expect(deps.fetchImage).not.toHaveBeenCalled();
    expect(deps.saveImageFile).not.toHaveBeenCalled();
  });

  test('adapter failure status throws', async () => {
    gptsapiAdapter.generate.mockResolvedValue({ status: 'failed', error: 'quota exceeded' });
    const deps = buildDeps();
    await expect(
      submitGeneration(
        { providerName: 'GPTsAPI', model: 'gpt-image-2', prompt: 'a cat', aspectRatio: '1:1' },
        providers,
        deps,
        userId(),
      ),
    ).rejects.toThrow('quota exceeded');
  });
});

// ---------------------------------------------------------------------------
// resolveResult
// ---------------------------------------------------------------------------

describe('resolveResult', () => {
  test('processing status returns { status: "processing" } with no File created', async () => {
    gptsapiAdapter.poll.mockResolvedValue({ status: 'pending', jobId: 'pred-proc' });
    const deps = buildDeps();
    const result = await resolveResult(
      {
        predictionId: 'pred-proc',
        userId: userId(),
        providerName: 'GPTsAPI',
        model: 'gpt-image-2',
        prompt: 'a cat',
      },
      deps,
      providers,
    );
    expect(result).toEqual({ status: 'processing' });
    expect(deps.fetchImage).not.toHaveBeenCalled();
  });

  test('completed status downloads image and creates File with correct fields', async () => {
    gptsapiAdapter.poll.mockResolvedValue({
      status: 'completed',
      imageUrl: 'http://result.example.com/out.png',
    });
    const deps = buildDeps();
    (deps.fetchImage as jest.Mock).mockResolvedValueOnce({
      buffer: Buffer.from('fake-image'),
      contentType: 'image/png',
      width: 1024,
      height: 1024,
    });
    (deps.saveImageFile as jest.Mock).mockResolvedValueOnce({
      filepath: '/storage/out.png',
      source: 'r2',
      bytes: 10,
      filename: 'out.png',
      storageMetadata: { storageKey: 'gen/out.png', storageRegion: 'auto' },
    });

    const uid = userId();
    const result = await resolveResult(
      {
        predictionId: 'pred-resolve-001',
        userId: uid,
        providerName: 'GPTsAPI',
        model: 'gpt-image-2',
        prompt: 'a cat',
      },
      deps,
      providers,
    );

    expect(result.status).toBe('completed');
    expect(result.file!.context).toBe('image_generation');
    expect(result.file!.model).toBe('gpt-image-2');
    expect(result.file!.metadata?.imageGen?.prompt).toBe('a cat');
    expect(result.file!.metadata?.imageGen?.predictionId).toBe('pred-resolve-001');
    expect(deps.fetchImage).toHaveBeenCalledWith('http://result.example.com/out.png');
  });

  test('failed status returns { status: "failed", error } instead of throwing', async () => {
    gptsapiAdapter.poll.mockResolvedValue({ status: 'failed', error: 'out of memory' });
    const deps = buildDeps();
    const result = await resolveResult(
      {
        predictionId: 'pred-fail',
        userId: userId(),
        providerName: 'GPTsAPI',
        model: 'gpt-image-2',
        prompt: 'x',
      },
      deps,
      providers,
    );
    expect(result).toEqual({ status: 'failed', error: 'out of memory' });
    expect(deps.fetchImage).not.toHaveBeenCalled();
  });

  test('idempotent: second call with same predictionId returns existing File without duplicate', async () => {
    gptsapiAdapter.poll.mockResolvedValue({
      status: 'completed',
      imageUrl: 'http://result.example.com/out.png',
    });
    const deps = buildDeps();
    (deps.fetchImage as jest.Mock).mockResolvedValueOnce({
      buffer: Buffer.from('fake-image'),
      contentType: 'image/png',
      width: 512,
      height: 512,
    });
    (deps.saveImageFile as jest.Mock).mockResolvedValueOnce({
      filepath: '/storage/idem.png',
      source: 'r2',
      bytes: 5,
      filename: 'idem.png',
      storageMetadata: {},
    });

    const uid = userId();
    const pidIdem = 'pred-idempotent-001';
    const args = {
      predictionId: pidIdem,
      userId: uid,
      providerName: 'GPTsAPI',
      model: 'gpt-image-2',
      prompt: 'dog',
    };
    const first = await resolveResult(args, deps, providers);
    expect(first.status).toBe('completed');

    const second = await resolveResult(args, deps, providers);
    expect(second.status).toBe('completed');
    expect(gptsapiAdapter.poll).toHaveBeenCalledTimes(1);
    expect(deps.fetchImage).toHaveBeenCalledTimes(1);

    const methods = createMethods(mongoose);
    const files = await methods.getFiles({ 'metadata.imageGen.predictionId': pidIdem }, {}, {});
    expect(files?.length).toBe(1);
  });
});
