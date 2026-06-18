jest.mock('./caption', () => ({ captionImage: jest.fn() }));
jest.mock('~/files/audio', () => ({ processAudioFile: jest.fn() }));

import path from 'path';
import { captionImage } from './caption';
import { processAudioFile } from '~/files/audio';
import { routeByMime, ingestFile } from './ingest';

const fixture = (name: string) => path.join(__dirname, '__fixtures__', name);

describe('routeByMime', () => {
  test('classifies common types', () => {
    expect(routeByMime('text/plain')).toBe('text');
    expect(routeByMime('text/markdown')).toBe('text');
    expect(routeByMime('application/pdf')).toBe('pdf');
    expect(
      routeByMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('doc');
    expect(routeByMime('image/png')).toBe('image');
    expect(routeByMime('audio/mpeg')).toBe('audio');
    expect(routeByMime('video/mp4')).toBe('video');
  });
});

describe('ingestFile — text', () => {
  test('extracts plain text and counts tokens', async () => {
    const result = await ingestFile({
      file: {
        path: fixture('sample.txt'),
        mimetype: 'text/plain',
        originalname: 'sample.txt',
        size: 50,
      },
    });
    expect(result.kind).toBe('text');
    expect(result.derivedText).toContain('second brain');
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  test('extracts markdown', async () => {
    const result = await ingestFile({
      file: {
        path: fixture('sample.md'),
        mimetype: 'text/markdown',
        originalname: 'sample.md',
        size: 50,
      },
    });
    expect(result.kind).toBe('text');
    expect(result.derivedText).toContain('markdown');
  });

  test('video is unsupported (empty derivedText, no throw)', async () => {
    const result = await ingestFile({
      file: {
        path: fixture('sample.txt'),
        mimetype: 'video/mp4',
        originalname: 'sample.mp4',
        size: 10,
      },
    });
    expect(result.kind).toBe('video');
    expect(result.derivedText).toBe('');
  });
});

describe('ingestFile — image', () => {
  test('returns caption as derivedText', async () => {
    (captionImage as jest.Mock).mockResolvedValue('A handwritten to-do list.');
    const result = await ingestFile({
      file: { path: '/tmp/note.png', mimetype: 'image/png', originalname: 'note.png', size: 100 },
    });
    expect(result.kind).toBe('image');
    expect(result.derivedText).toContain('A handwritten to-do list.');
  });
});

describe('ingestFile — audio', () => {
  const fakeSttService = {};
  const fakeReq = {
    config: { speech: { stt: { openai: { apiKey: 'k', model: 'whisper-1' } } } },
  } as never;

  beforeEach(() => {
    (processAudioFile as jest.Mock).mockReset();
  });

  test('transcribes audio to derivedText', async () => {
    (processAudioFile as jest.Mock).mockResolvedValue({
      text: 'Meeting notes: ship Plan B.',
      bytes: 100,
    });
    const result = await ingestFile({
      file: { path: '/tmp/voice.m4a', mimetype: 'audio/mp4', originalname: 'voice.m4a', size: 100 },
      req: fakeReq,
      sttService: fakeSttService,
    });
    expect(result.kind).toBe('audio');
    expect(result.derivedText).toContain('ship Plan B');
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  test('returns empty derivedText when req is absent', async () => {
    const result = await ingestFile({
      file: { path: '/tmp/voice.m4a', mimetype: 'audio/mp4', originalname: 'voice.m4a', size: 100 },
      sttService: fakeSttService,
    });
    expect(result.kind).toBe('audio');
    expect(result.derivedText).toBe('');
    expect(processAudioFile).not.toHaveBeenCalled();
  });

  test('returns empty derivedText when sttService is absent', async () => {
    const result = await ingestFile({
      file: { path: '/tmp/voice.m4a', mimetype: 'audio/mp4', originalname: 'voice.m4a', size: 100 },
      req: fakeReq,
    });
    expect(result.kind).toBe('audio');
    expect(result.derivedText).toBe('');
    expect(processAudioFile).not.toHaveBeenCalled();
  });
});
