import type { ServerRequest } from '~/types';

export type IngestKind = 'image' | 'audio' | 'video' | 'pdf' | 'doc' | 'text';

export interface IngestFile {
  path: string;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface IngestParams {
  file: IngestFile;
  req?: ServerRequest;
  /** STTService instance, injected by the api-layer caller (avoids packages/api → api/ reverse-dependency).
   *  typed `unknown` because STTService is defined in the `api/` workspace which packages/api must not import. */
  sttService?: unknown;
}

export interface IngestResult {
  kind: IngestKind;
  derivedText: string;
  tokenCount: number;
}
