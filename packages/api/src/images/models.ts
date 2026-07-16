import type { TImageModel } from 'librechat-data-provider';
import type { ResolvedImageProvider } from './providers/registry';

export function getImageModels(providers: ResolvedImageProvider[]): TImageModel[] {
  const models: TImageModel[] = [];
  for (const provider of providers) {
    for (const model of provider.config.models) {
      models.push({
        id: model.id,
        label: model.label,
        provider: provider.name,
        supportsEdit: model.supportsEdit,
        paramKey: model.paramKey,
        paramValues: model.paramValues,
        defaultParam: model.defaultParam,
      });
    }
  }
  return models;
}

export function getDefaultImageModel(providers: ResolvedImageProvider[]): TImageModel | undefined {
  const models = getImageModels(providers);
  for (const provider of providers) {
    const defaultModel = provider.config.models.find((model) => model.isDefault);
    if (defaultModel) {
      return models.find((m) => m.id === defaultModel.id && m.provider === provider.name);
    }
  }
  return models[0];
}

export function getAspectRatios(providers: ResolvedImageProvider[]): string[] {
  const all = new Set<string>();
  for (const provider of providers) {
    for (const ratio of provider.config.aspectRatios) {
      all.add(ratio);
    }
  }
  return Array.from(all);
}

export function findImageModel(
  providers: ResolvedImageProvider[],
  providerName: string,
  modelId: string,
): TImageModel {
  const model = getImageModels(providers).find(
    (m) => m.provider === providerName && m.id === modelId,
  );
  if (!model) {
    throw new Error(`Unknown image model "${modelId}" for provider "${providerName}"`);
  }
  return model;
}
