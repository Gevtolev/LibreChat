import { promises as fs } from 'fs';
import { initializeModel, Providers } from '@librechat/agents';
import { HumanMessage } from '@librechat/agents/langchain/messages';

const CAPTION_MODEL = 'gpt-4.1-mini';
const CAPTION_PROMPT =
  'Describe this image in one or two concise sentences for a personal notes archive.';

interface CaptionParams {
  filePath: string;
  mimetype: string;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (b): b is { type: string; text: string } =>
          typeof b === 'object' &&
          b !== null &&
          'type' in b &&
          'text' in b &&
          (b as { type: string }).type === 'text',
      )
      .map((b) => b.text)
      .join('');
  }
  return '';
}

export async function captionImage({ filePath, mimetype }: CaptionParams): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return '';
  }
  const base64 = (await fs.readFile(filePath)).toString('base64');
  const model = initializeModel({
    provider: Providers.OPENAI,
    clientOptions: {
      model: CAPTION_MODEL,
      maxTokens: 512,
      streaming: false,
      disableStreaming: true,
      configuration: { apiKey },
      apiKey,
    },
  });
  const message = new HumanMessage({
    content: [
      { type: 'image_url', image_url: { url: `data:${mimetype};base64,${base64}` } },
      { type: 'text', text: CAPTION_PROMPT },
    ],
  });
  const response = await model.invoke([message]);
  if (!response || typeof response !== 'object' || !('content' in response)) {
    return '';
  }
  return extractText((response as { content: unknown }).content).trim();
}
