import { v4 as uuidv4 } from 'uuid';
import { Run, Providers } from '@librechat/agents';
import { HumanMessage } from '@librechat/agents/langchain/messages';
import { getProviderConfig } from '~/endpoints/config/providers';
import type { LLMConfig, MessageContentComplex } from '@librechat/agents';
import type { AppConfig } from '@librechat/data-schemas';
import type { ServerRequest, EndpointDbMethods } from '~/types';

export interface GuestChatOptions {
  req: ServerRequest;
  appConfig: AppConfig;
  provider: string;
  model: string;
  instructions?: string;
  model_parameters?: Record<string, string | number | boolean>;
  text: string;
}

/**
 * Guest chat only supports system-wide credentials (never `user_provided`
 * key/baseURL), so the initialize functions' `db.getUserKeyValues` branch is
 * unreachable here — these stubs exist only to satisfy the required type.
 */
const guestDbMethods: EndpointDbMethods = {
  getUserKey: async () => {
    throw new Error('Guest chat does not support user-provided credentials');
  },
  getUserKeyValues: async () => {
    throw new Error('Guest chat does not support user-provided credentials');
  },
};

function isTextPart(part: MessageContentComplex): part is { type: 'text'; text: string } {
  return (
    !!part &&
    typeof part === 'object' &&
    (part as { type?: unknown }).type === 'text' &&
    typeof (part as { text?: unknown }).text === 'string'
  );
}

function extractText(content: MessageContentComplex[] | undefined): string {
  if (!content) {
    return '';
  }
  return content
    .filter(isTextPart)
    .map((part) => part.text)
    .join('');
}

/**
 * Runs a single ephemeral, non-persisted LLM turn for the guest trial chat
 * feature. Mirrors the memory agent's `Run.create` + `processStream` usage
 * (`~/agents/memory.ts`), but resolves real provider credentials via the same
 * `getProviderConfig`/`initializeXxx` chain the authenticated agent flow uses
 * (`~/agents/initialize.ts`) — `@librechat/agents` does not resolve
 * credentials on its own.
 */
export async function runGuestChat({
  req,
  appConfig,
  provider,
  model,
  instructions,
  model_parameters,
  text,
}: GuestChatOptions): Promise<string> {
  const { getOptions, overrideProvider } = getProviderConfig({ provider, appConfig });

  /** `initializeXxx` functions read credentials/config off `req.config`. */
  req.config = appConfig;
  const options = await getOptions({
    req,
    endpoint: provider,
    model_parameters: { ...model_parameters, model },
    db: guestDbMethods,
  });

  const llmConfig: LLMConfig = {
    ...(options.llmConfig as LLMConfig),
    provider: overrideProvider as Providers,
    /**
     * `initializeXxx` defaults `streaming: true` for the authenticated SSE
     * chat flow. Guest chat returns one JSON response (no SSE consumer), so
     * without this override the run hangs waiting on stream events nobody
     * reads until it eventually times out.
     */
    streaming: false,
    disableStreaming: true,
    maxRetries: 0,
  };
  /**
   * `getOptions` (e.g. `initializeOpenAI`) returns `baseURL`/reverse-proxy
   * config as a separate `configOptions` object, not nested inside
   * `llmConfig` — the authenticated agent flow merges it the same way
   * (`~/agents/initialize.ts`). Without this, the reverse proxy URL is
   * silently dropped and the client falls back to the real provider API.
   */
  if (options.configOptions) {
    (llmConfig as Record<string, unknown>).configuration = options.configOptions;
  }

  const run = await Run.create({
    runId: uuidv4(),
    graphConfig: {
      type: 'standard',
      llmConfig,
      tools: [],
      instructions,
    },
    returnContent: true,
  });

  const content = await run.processStream(
    { messages: [new HumanMessage(text)] },
    { runName: 'GuestChatRun', streamMode: 'values', recursionLimit: 3, version: 'v2' },
  );

  return extractText(content);
}
