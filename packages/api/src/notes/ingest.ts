import {
  textMimeTypes,
  imageMimeTypes,
  audioMimeTypes,
  videoMimeTypes,
  documentParserMimeTypes,
  applicationMimeTypes,
} from 'librechat-data-provider';
import { parseDocument } from '~/files/documents/crud';
import { processAudioFile } from '~/files/audio';
import { countTokens } from '~/utils/tokenizer';
import { parseTextNative } from '~/files/text';
import { captionImage } from './caption';
import type { IngestKind, IngestParams, IngestResult } from './types';
import type { STTService } from '~/types';

const PDF_MIME = 'application/pdf';

export function routeByMime(mimetype: string): IngestKind {
  if (imageMimeTypes.test(mimetype)) return 'image';
  if (audioMimeTypes.test(mimetype)) return 'audio';
  if (videoMimeTypes.test(mimetype)) return 'video';
  // PDF must be matched before the documentParserMimeTypes scan: that array
  // already includes application/pdf, so otherwise PDFs would route as 'doc'.
  if (mimetype === PDF_MIME) return 'pdf';
  if (documentParserMimeTypes.some((re) => re.test(mimetype))) return 'doc';
  if (textMimeTypes.test(mimetype) || applicationMimeTypes.test(mimetype)) return 'text';
  return 'text';
}

async function toResult(kind: IngestKind, derivedText: string): Promise<IngestResult> {
  const tokenCount = derivedText ? await countTokens(derivedText) : 0;
  return { kind, derivedText, tokenCount };
}

export async function ingestFile({ file, req, sttService }: IngestParams): Promise<IngestResult> {
  const kind = routeByMime(file.mimetype);
  // parsers declare Multer.File but read only path/size/mimetype/originalname, all on IngestFile
  const multerFile = file as Express.Multer.File;

  if (kind === 'text') {
    const { text } = await parseTextNative(multerFile);
    return toResult('text', text);
  }

  if (kind === 'pdf' || kind === 'doc') {
    const { text } = await parseDocument({ file: multerFile });
    return toResult(kind, text);
  }

  if (kind === 'video') {
    return toResult('video', '');
  }

  // image / audio branches added in Task 2 / Task 3
  if (kind === 'image') {
    // OCR (Mistral) requires a remote/signed URL — local file paths are not supported.
    // OCR integration is deferred to a P1 follow-up that uploads the file and obtains a signed URL.
    const caption = await captionImage({ filePath: file.path, mimetype: file.mimetype });
    return toResult('image', caption);
  }
  if (kind === 'audio') {
    if (!req || !sttService) {
      return toResult('audio', '');
    }
    // sttService is typed `unknown` on IngestParams (boundary exception: STTService lives in api/ which
    // packages/api must not import). processAudioFile's own parameter type (STTService) enforces the
    // contract at the call site in the api/ caller.
    const { text } = await processAudioFile({
      req,
      file: file as Express.Multer.File,
      sttService: sttService as STTService,
    });
    return toResult('audio', text);
  }

  return toResult('text', '');
}
