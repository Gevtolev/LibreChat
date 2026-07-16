import type { TCustomConfig, TGuestChatConfig } from 'librechat-data-provider';

/**
 * Unlike memory's agent (opt-in, since it has invisible side effects like
 * writing user memories), guest chat defaults to enabled once provider+model
 * are configured — enabling it is the entire point of setting it up.
 */
export function loadGuestChatConfig(
  config: TCustomConfig['guestChat'],
): TGuestChatConfig | undefined {
  if (!config) return undefined;
  return config as TGuestChatConfig;
}

export function isGuestChatEnabled(config: TGuestChatConfig | undefined): boolean {
  return !!config && config.enabled !== false && !!config.provider && !!config.model;
}
