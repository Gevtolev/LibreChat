import type { TImageGenerationConfig } from 'librechat-data-provider';
import { getImageModels, getDefaultImageModel, getAspectRatios, findImageModel } from './models';
import { resolveImageProviders } from './providers/registry';

const config: TImageGenerationConfig = {
  providers: [
    {
      name: 'OpenRouter',
      protocol: 'openrouter',
      apiKey: 'k1',
      baseURL: 'https://openrouter.ai/api/v1',
      aspectRatios: ['auto', '1:1', '16:9'],
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
      apiKey: 'k2',
      baseURL: 'https://api.gptsapi.net',
      aspectRatios: ['1:1', '9:16'],
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

const providers = resolveImageProviders(config);

describe('getImageModels', () => {
  test('flattens models across providers, tagging each with its provider name', () => {
    const models = getImageModels(providers);
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({ id: 'google/gemini-3-pro-image', provider: 'OpenRouter' });
    expect(models[1]).toMatchObject({ id: 'gpt-image-2', provider: 'GPTsAPI' });
  });
});

describe('getDefaultImageModel', () => {
  test('returns the model flagged isDefault', () => {
    const model = getDefaultImageModel(providers);
    expect(model).toMatchObject({ id: 'google/gemini-3-pro-image', provider: 'OpenRouter' });
  });

  test('falls back to the first model when none is flagged default', () => {
    const noDefaultConfig: TImageGenerationConfig = { providers: [config.providers[1]] };
    const model = getDefaultImageModel(resolveImageProviders(noDefaultConfig));
    expect(model).toMatchObject({ id: 'gpt-image-2' });
  });
});

describe('getAspectRatios', () => {
  test('unions aspect ratios across all providers', () => {
    expect(getAspectRatios(providers).sort()).toEqual(['1:1', '16:9', '9:16', 'auto'].sort());
  });
});

describe('findImageModel', () => {
  test('finds a model by provider + id', () => {
    expect(findImageModel(providers, 'GPTsAPI', 'gpt-image-2').label).toBe('GPT Image 2');
  });

  test('throws for an unknown provider/model combination', () => {
    expect(() => findImageModel(providers, 'GPTsAPI', 'nope')).toThrow(
      'Unknown image model "nope" for provider "GPTsAPI"',
    );
  });
});
