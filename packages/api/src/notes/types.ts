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
}

export interface IngestResult {
  kind: IngestKind;
  derivedText: string;
  tokenCount: number;
}
