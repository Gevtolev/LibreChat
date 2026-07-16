export type GenerationOutcome =
  | { status: 'completed'; imageUrl?: string; imageB64?: string; mediaType?: string }
  | { status: 'pending'; jobId: string }
  | { status: 'failed'; error: string };

export interface ImageProviderRuntimeConfig {
  baseUrl: string;
  apiKey: string;
}
