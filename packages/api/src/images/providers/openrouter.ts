import type { TOpenRouterImageModel } from 'librechat-data-provider';
import { createAxiosInstance, logAxiosError } from '~/utils/axios';
import type { GenerationOutcome, ImageProviderRuntimeConfig } from './types';

const axios = createAxiosInstance();

export const protocol = 'openrouter' as const;

export interface OpenRouterGenerateArgs {
  model: TOpenRouterImageModel;
  prompt: string;
  aspectRatio: string;
  paramValue: string;
  imageUrls?: string[];
}

export async function generate(
  args: OpenRouterGenerateArgs,
  cfg: ImageProviderRuntimeConfig,
): Promise<GenerationOutcome> {
  const { model, prompt, aspectRatio, paramValue, imageUrls } = args;
  const body: Record<string, unknown> = {
    model: model.id,
    prompt,
    aspect_ratio: aspectRatio,
    [model.paramKey]: paramValue,
  };
  if (Array.isArray(imageUrls) && imageUrls.length > 0) {
    body.input_references = imageUrls.map((url) => ({ type: 'image_url', image_url: { url } }));
  }
  try {
    const res = await axios.post(`${cfg.baseUrl}/images`, body, {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    });
    const image = res.data?.data?.[0];
    if (!image?.b64_json) {
      throw new Error('openrouter image generation returned no image data');
    }
    return { status: 'completed', imageB64: image.b64_json, mediaType: image.media_type };
  } catch (error) {
    throw new Error(logAxiosError({ error, message: 'openrouter image generation failed' }));
  }
}
