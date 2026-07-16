import type { TGptsapiImageModel } from 'librechat-data-provider';
import { createAxiosInstance, logAxiosError } from '~/utils/axios';
import type { GenerationOutcome, ImageProviderRuntimeConfig } from './types';

const axios = createAxiosInstance();

export const protocol = 'gptsapi-predictions' as const;

export interface GptsapiGenerateArgs {
  model: TGptsapiImageModel;
  prompt: string;
  aspectRatio: string;
  paramValue: string;
  imageUrls?: string[];
}

export async function generate(
  args: GptsapiGenerateArgs,
  cfg: ImageProviderRuntimeConfig,
): Promise<GenerationOutcome> {
  const { model, prompt, aspectRatio, paramValue, imageUrls } = args;
  const isEdit = Array.isArray(imageUrls) && imageUrls.length > 0;
  const action = isEdit ? 'image-edit' : 'text-to-image';
  const url = `${cfg.baseUrl}/api/v3/${model.vendor}/${model.id}/${action}`;
  const body: Record<string, unknown> = {
    prompt,
    aspect_ratio: aspectRatio,
    [model.paramKey]: paramValue,
  };
  if (isEdit) {
    body[model.editImagesKey] = imageUrls;
  }
  try {
    const res = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    });
    const id = res.data?.data?.id;
    if (!id) {
      throw new Error('gptsapi submit returned no prediction id');
    }
    return { status: 'pending', jobId: id as string };
  } catch (error) {
    throw new Error(logAxiosError({ error, message: 'gptsapi image submit failed' }));
  }
}

export async function poll(
  jobId: string,
  cfg: ImageProviderRuntimeConfig,
): Promise<GenerationOutcome> {
  const url = `${cfg.baseUrl}/api/v3/predictions/${jobId}/result`;
  try {
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    const data = res.data?.data ?? {};
    const status = data.status ?? 'unknown';
    if (status === 'completed') {
      const outputs = data.outputs ?? [];
      return { status: 'completed', imageUrl: outputs[0] };
    }
    if (status === 'failed' || status === 'error') {
      return { status: 'failed', error: data.error ?? 'image generation failed' };
    }
    return { status: 'pending', jobId };
  } catch (error) {
    throw new Error(logAxiosError({ error, message: 'gptsapi image poll failed' }));
  }
}
