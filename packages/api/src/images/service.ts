import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { findImageModel } from './models';
import { findProvider, generateImage, pollImage } from './providers/registry';
import type { ResolvedImageProvider } from './providers/registry';
import type { GenerationOutcome } from './providers/types';
import type { IMongoFile } from '@librechat/data-schemas';

export interface ImageDeps {
  fetchImage: (
    url: string,
  ) => Promise<{ buffer: Buffer; contentType: string; width?: number; height?: number }>;
  fetchImageFromB64: (
    b64: string,
    mediaType?: string,
  ) => Promise<{ buffer: Buffer; contentType: string; width?: number; height?: number }>;
  saveImageFile: (a: { userId: string; buffer: Buffer; contentType: string }) => Promise<{
    filepath: string;
    source: string;
    bytes: number;
    filename: string;
    storageMetadata: Record<string, unknown>;
  }>;
  createFileRecord: (doc: Partial<IMongoFile>) => Promise<IMongoFile | null>;
  findFileByPrediction: (userId: string, predictionId: string) => Promise<IMongoFile | null>;
}

export interface SubmitGenerationArgs {
  providerName: string;
  model: string;
  prompt: string;
  aspectRatio: string;
  param?: string;
  imageUrls?: string[];
}

export type SubmitGenerationResult =
  | { status: 'pending'; predictionId: string }
  | { status: 'completed'; predictionId: string; file: IMongoFile };

async function downloadAndSaveOutcome(
  outcome: Extract<GenerationOutcome, { status: 'completed' }>,
  meta: { userId: string; model: string; prompt: string; predictionId: string },
  deps: ImageDeps,
): Promise<IMongoFile> {
  const img = outcome.imageB64
    ? await deps.fetchImageFromB64(outcome.imageB64, outcome.mediaType)
    : await deps.fetchImage(outcome.imageUrl as string);
  const saved = await deps.saveImageFile({
    userId: meta.userId,
    buffer: img.buffer,
    contentType: img.contentType,
  });
  const storageExtra = saved.storageMetadata as { storageKey?: string; storageRegion?: string };
  const file = await deps.createFileRecord({
    user: new Types.ObjectId(meta.userId),
    file_id: uuidv4(),
    context: 'image_generation',
    model: meta.model,
    source: saved.source,
    filepath: saved.filepath,
    filename: saved.filename,
    bytes: saved.bytes,
    type: img.contentType,
    width: img.width,
    height: img.height,
    storageKey: storageExtra.storageKey,
    storageRegion: storageExtra.storageRegion,
    metadata: { imageGen: { prompt: meta.prompt, predictionId: meta.predictionId } },
  });
  if (!file) {
    throw new Error('failed to persist generated image');
  }
  return file;
}

export async function submitGeneration(
  args: SubmitGenerationArgs,
  providers: ResolvedImageProvider[],
  deps: ImageDeps,
  userId: string,
): Promise<SubmitGenerationResult> {
  // TODO(gating): checkBillingAccess(featureFlag: 'image_gen')
  const model = findImageModel(providers, args.providerName, args.model);
  const provider = findProvider(providers, args.providerName);
  const prompt = (args.prompt ?? '').trim();
  if (!prompt) {
    throw new Error('prompt is required');
  }
  if (prompt.length > 20000) {
    throw new Error('prompt too long');
  }
  if (!provider.config.aspectRatios.includes(args.aspectRatio)) {
    throw new Error(`invalid aspect_ratio: ${args.aspectRatio}`);
  }
  const paramValue = args.param ?? model.defaultParam;
  if (!model.paramValues.includes(paramValue)) {
    throw new Error(`invalid ${model.paramKey}: ${paramValue}`);
  }
  if (model.paramKey === 'resolution') {
    if (paramValue === '4K' && args.aspectRatio === '1:1') {
      throw new Error('1:1 cannot be 4K');
    }
    if (args.aspectRatio === 'auto' && paramValue !== '1K') {
      throw new Error('auto aspect_ratio supports only 1K');
    }
  }
  const imageUrls = args.imageUrls?.filter(Boolean) ?? [];
  if (imageUrls.length > 0 && !model.supportsEdit) {
    throw new Error(`${model.id} does not support image edit`);
  }
  const outcome = await generateImage(providers, {
    providerName: args.providerName,
    modelId: args.model,
    prompt,
    aspectRatio: args.aspectRatio,
    paramValue,
    imageUrls: imageUrls.length ? imageUrls : undefined,
  });
  if (outcome.status === 'failed') {
    throw new Error(outcome.error);
  }
  if (outcome.status === 'pending') {
    return { status: 'pending', predictionId: outcome.jobId };
  }
  const predictionId = uuidv4();
  const file = await downloadAndSaveOutcome(
    outcome,
    { userId, model: args.model, prompt, predictionId },
    deps,
  );
  return { status: 'completed', predictionId, file };
}

export interface ResolveResultArgs {
  predictionId: string;
  userId: string;
  providerName: string;
  model: string;
  prompt: string;
}

export async function resolveResult(
  args: ResolveResultArgs,
  deps: ImageDeps,
  providers: ResolvedImageProvider[],
): Promise<{ status: string; file?: IMongoFile; error?: string }> {
  const existing = await deps.findFileByPrediction(args.userId, args.predictionId);
  if (existing) {
    return { status: 'completed', file: existing };
  }
  const outcome = await pollImage(providers, args.providerName, args.predictionId);
  if (outcome.status === 'pending') {
    return { status: 'processing' };
  }
  if (outcome.status === 'failed') {
    return { status: 'failed', error: outcome.error };
  }
  const file = await downloadAndSaveOutcome(
    outcome,
    { userId: args.userId, model: args.model, prompt: args.prompt, predictionId: args.predictionId },
    deps,
  );
  return { status: 'completed', file };
}
