import {
  textMimeTypes,
  imageMimeTypes,
  audioMimeTypes,
  videoMimeTypes,
  documentParserMimeTypes,
  applicationMimeTypes,
} from 'librechat-data-provider';
import { parseTextNative } from '~/files/text';
import { parseDocument } from '~/files/documents/crud';
import { countTokens } from '~/utils/tokenizer';
import type { IngestKind, IngestFile, IngestParams, IngestResult } from './types';

const PDF_MIME = 'application/pdf';

export function routeByMime(mimetype: string): IngestKind {
  if (imageMimeTypes.test(mimetype)) return 'image';
  if (audioMimeTypes.test(mimetype)) return 'audio';
  if (videoMimeTypes.test(mimetype)) return 'video';
  if (mimetype === PDF_MIME) return 'pdf';
  if (documentParserMimeTypes.some((re) => re.test(mimetype))) return 'doc';
  if (textMimeTypes.test(mimetype) || applicationMimeTypes.test(mimetype)) return 'text';
  return 'text';
}

/** Cast IngestFile to the Express.Multer.File subset used by parse functions. */
function toMulterFile(file: IngestFile): Express.Multer.File {
  return file as Express.Multer.File;
}

async function toResult(kind: IngestKind, derivedText: string): Promise<IngestResult> {
  const tokenCount = derivedText ? await countTokens(derivedText) : 0;
  return { kind, derivedText, tokenCount };
}

export async function ingestFile({ file }: IngestParams): Promise<IngestResult> {
  const kind = routeByMime(file.mimetype);

  if (kind === 'text') {
    const { text } = await parseTextNative(toMulterFile(file));
    return toResult('text', text);
  }

  if (kind === 'pdf' || kind === 'doc') {
    const { text } = await parseDocument({ file: toMulterFile(file) });
    return toResult(kind, text);
  }

  if (kind === 'video') {
    return toResult('video', '');
  }

  // image / audio branches added in Task 2 / Task 3
  if (kind === 'image') {
    throw new Error('image ingest not yet implemented (Task 2)');
  }
  if (kind === 'audio') {
    throw new Error('audio ingest not yet implemented (Task 3)');
  }

  return toResult('text', '');
}
