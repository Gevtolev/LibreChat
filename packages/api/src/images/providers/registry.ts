import { extractEnvVariable } from 'librechat-data-provider';
import type { TImageGenerationConfig, TImageProviderConfig } from 'librechat-data-provider';
import * as openrouter from './openrouter';
import * as gptsapi from './gptsapi';
import type { GenerationOutcome, ImageProviderRuntimeConfig } from './types';

export interface ResolvedImageProvider {
  name: string;
  runtimeConfig: ImageProviderRuntimeConfig;
  config: TImageProviderConfig;
}

export function resolveImageProviders(
  imageGeneration: TImageGenerationConfig | undefined,
): ResolvedImageProvider[] {
  if (!imageGeneration?.providers?.length) {
    return [];
  }
  return imageGeneration.providers.map((config) => ({
    name: config.name,
    runtimeConfig: {
      baseUrl: extractEnvVariable(config.baseURL),
      apiKey: extractEnvVariable(config.apiKey),
    },
    config,
  }));
}

export function findProvider(
  providers: ResolvedImageProvider[],
  name: string,
): ResolvedImageProvider {
  const provider = providers.find((p) => p.name === name);
  if (!provider) {
    throw new Error(`Unknown image provider: ${name}`);
  }
  return provider;
}

export interface GenerateImageArgs {
  providerName: string;
  modelId: string;
  prompt: string;
  aspectRatio: string;
  paramValue: string;
  imageUrls?: string[];
}

export async function generateImage(
  providers: ResolvedImageProvider[],
  args: GenerateImageArgs,
): Promise<GenerationOutcome> {
  const provider = findProvider(providers, args.providerName);
  const shared = {
    prompt: args.prompt,
    aspectRatio: args.aspectRatio,
    paramValue: args.paramValue,
    imageUrls: args.imageUrls,
  };
  if (provider.config.protocol === 'openrouter') {
    const model = provider.config.models.find((m) => m.id === args.modelId);
    if (!model) {
      throw new Error(`Unknown image model "${args.modelId}" for provider "${args.providerName}"`);
    }
    return openrouter.generate({ model, ...shared }, provider.runtimeConfig);
  }
  const model = provider.config.models.find((m) => m.id === args.modelId);
  if (!model) {
    throw new Error(`Unknown image model "${args.modelId}" for provider "${args.providerName}"`);
  }
  return gptsapi.generate({ model, ...shared }, provider.runtimeConfig);
}

export async function pollImage(
  providers: ResolvedImageProvider[],
  providerName: string,
  jobId: string,
): Promise<GenerationOutcome> {
  const provider = findProvider(providers, providerName);
  if (provider.config.protocol !== 'gptsapi-predictions') {
    throw new Error(`Provider "${providerName}" does not support polling`);
  }
  return gptsapi.poll(jobId, provider.runtimeConfig);
}
