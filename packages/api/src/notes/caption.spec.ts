const mockInvoke = jest.fn();
jest.mock('@librechat/agents', () => ({
  Providers: { OPENAI: 'openAI' },
  initializeModel: jest.fn(() => ({ invoke: mockInvoke })),
}));

import { captionImage } from './caption';

describe('captionImage', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  test('returns the model text for a string content response', async () => {
    mockInvoke.mockResolvedValue({ content: 'A red bicycle leaning on a brick wall.' });
    const caption = await captionImage({ filePath: __filename, mimetype: 'image/png' });
    expect(caption).toContain('red bicycle');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  test('joins array content blocks', async () => {
    mockInvoke.mockResolvedValue({ content: [{ type: 'text', text: 'Two cats.' }] });
    const caption = await captionImage({ filePath: __filename, mimetype: 'image/png' });
    expect(caption).toBe('Two cats.');
  });

  test('returns empty string when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const caption = await captionImage({ filePath: __filename, mimetype: 'image/png' });
    expect(caption).toBe('');
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
