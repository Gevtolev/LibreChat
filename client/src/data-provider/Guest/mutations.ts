import { useMutation } from '@tanstack/react-query';
import { MutationKeys, dataService } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import type * as t from 'librechat-data-provider';

export const useGuestChatMutation = (
  options?: t.MutationOptions<t.TGuestChatResponse, t.TGuestChatRequest, unknown, unknown>,
): UseMutationResult<t.TGuestChatResponse, unknown, t.TGuestChatRequest, unknown> => {
  return useMutation([MutationKeys.guestChat], {
    mutationFn: (payload: t.TGuestChatRequest) => dataService.guestChat(payload),
    ...(options || {}),
  });
};
