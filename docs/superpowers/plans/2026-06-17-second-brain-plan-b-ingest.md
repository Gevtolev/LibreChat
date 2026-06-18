# 笔记第二大脑 — Plan B:多模态入料管线(ingest)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `packages/api/src/notes/ingest.ts` —— 把上传的文件按类型"文本化"成 `derivedText`(text/md、pdf/office、音频、图片 OCR+vision 描述),编排现有零件,仅图片描述为新建块;视频明确不支持(P1)。

**Architecture:** 一个 `ingestFile({ file, req })` 入口,用 `librechat-data-provider` 的 mime 正则路由到各 handler;handler 复用现成抽取函数(`parseTextNative`/`parseDocument`/`processAudioFile`/`performOCR`),图片额外调一次 vision LLM 生成 caption。返回 `{ kind, derivedText, tokenCount }`。本层不碰 DB、不存原件、不接 Note(那是后续 plan 的接入层)。

**Tech Stack:** TypeScript(`packages/api`)、`@librechat/agents`(vision 模型)、`@librechat/api` 现成抽取函数、`librechat-data-provider`(mime 路由)、Jest(fixture + mock 外部 HTTP,无 mongo)。

## Global Constraints

- 新后端逻辑 TypeScript in `packages/api/src/notes/`;**编排现成函数,不重新实现解析**。
- Never `any`;避免 `unknown`/`Record<string,unknown>`/`as unknown as T`;显式类型。
- 单词文件名(`ingest.ts`、`caption.ts`)。
- **图片 caption**:provider=OpenAI、model=`gpt-4.1-mini`(最便宜 vision,memory agent 默认),用 `initializeModel` + **直接 `model.invoke([HumanMessage])`(非流式)** —— 不要走 `attemptInvoke`(它永远走 streaming)。apiKey 经 `process.env.OPENAI_API_KEY`。
- **视频**:不做转录 → 返回 `kind:'video'` + 空 `derivedText` + 一个明确的 unsupported 标记;不引 ffmpeg(P1)。
- 测试:纯解析(text/doc)用**真实 fixture 文件**;外部服务(vision LLM、Mistral OCR、STT)是外部 HTTP → **mock**(CLAUDE.md 允许 mock 外部 HTTP API)。ingest 不碰 DB,测试**不需** `mongodb-memory-server`/env 前缀。
- 探索发现的接口为准(见各 task);implementer 实现时若 import 路径/签名与现状不符,以代码库实际为准并在 report 注明。

---

## File Structure

- Create `packages/api/src/notes/types.ts` — `IngestKind`、`IngestResult`、`IngestParams`
- Create `packages/api/src/notes/caption.ts` — `captionImage()`(vision LLM 调用,新建块)
- Create `packages/api/src/notes/ingest.ts` — `routeByMime()` + `ingestFile()` 编排
- Create `packages/api/src/notes/ingest.spec.ts` — 路由 + 各 handler 测试
- Create `packages/api/src/notes/caption.spec.ts` — caption 测试(mock 模型)
- Modify `packages/api/src/index.ts` — 导出 `ingestFile`(供后续 plan 的接入层使用)
- Test fixtures: `packages/api/src/notes/__fixtures__/sample.txt`, `sample.md`(纯文本,真实)

> 注:实现前 `grep` 确认现成函数的真实导出与 import 路径:`parseTextNative`/`parseDocument`/`processAudioFile`/`performOCR` 由 `@librechat/api`(`packages/api/src/files/index.ts`)导出;`initializeModel`/`Providers` 由 `@librechat/agents` 导出;`Tokenizer` 由 `@librechat/api` 导出。

---

## Task 1: ingest 骨架 + mime 路由 + 文本/文档抽取

**Files:**
- Create: `packages/api/src/notes/types.ts`
- Create: `packages/api/src/notes/ingest.ts`
- Create: `packages/api/src/notes/__fixtures__/sample.txt`, `sample.md`
- Test: `packages/api/src/notes/ingest.spec.ts`
- Modify: `packages/api/src/index.ts`(导出)

**Interfaces:**
- Produces: `IngestKind`(`'image'|'audio'|'video'|'pdf'|'doc'|'text'`)、`IngestResult`(`{ kind: IngestKind; derivedText: string; tokenCount: number }`)、`IngestParams`(`{ file: IngestFile; req?: ServerRequest }`,其中 `IngestFile = { path: string; mimetype: string; originalname: string; size: number }`)、`routeByMime(mimetype: string): IngestKind`、`ingestFile(params: IngestParams): Promise<IngestResult>`。Task 2/3 往 `ingestFile` 的 switch 补 image/audio 分支。

- [ ] **Step 1: 写类型**

Create `packages/api/src/notes/types.ts`:

```ts
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
```

> implementer: 确认 `ServerRequest` 在 `~/types` 可导入(file 抽取函数也用它);若类型名不同,用 `packages/api` 现有的请求类型别名。

- [ ] **Step 2: 写 fixtures**

Create `packages/api/src/notes/__fixtures__/sample.txt` with content:
```
Hello second brain.
This is a plain text note fixture.
```
Create `packages/api/src/notes/__fixtures__/sample.md` with content:
```
# Sample

A **markdown** fixture for ingest.
```

- [ ] **Step 3: 写失败测试(路由 + 文本/文档抽取)**

Create `packages/api/src/notes/ingest.spec.ts`:

```ts
import path from 'path';
import { routeByMime, ingestFile } from './ingest';

const fixture = (name: string) => path.join(__dirname, '__fixtures__', name);

describe('routeByMime', () => {
  test('classifies common types', () => {
    expect(routeByMime('text/plain')).toBe('text');
    expect(routeByMime('text/markdown')).toBe('text');
    expect(routeByMime('application/pdf')).toBe('pdf');
    expect(routeByMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('doc');
    expect(routeByMime('image/png')).toBe('image');
    expect(routeByMime('audio/mpeg')).toBe('audio');
    expect(routeByMime('video/mp4')).toBe('video');
  });
});

describe('ingestFile — text', () => {
  test('extracts plain text and counts tokens', async () => {
    const result = await ingestFile({
      file: { path: fixture('sample.txt'), mimetype: 'text/plain', originalname: 'sample.txt', size: 50 },
    });
    expect(result.kind).toBe('text');
    expect(result.derivedText).toContain('second brain');
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  test('extracts markdown', async () => {
    const result = await ingestFile({
      file: { path: fixture('sample.md'), mimetype: 'text/markdown', originalname: 'sample.md', size: 50 },
    });
    expect(result.kind).toBe('text');
    expect(result.derivedText).toContain('markdown');
  });

  test('video is unsupported (empty derivedText, no throw)', async () => {
    const result = await ingestFile({
      file: { path: '/tmp/x.mp4', mimetype: 'video/mp4', originalname: 'x.mp4', size: 10 },
    });
    expect(result.kind).toBe('video');
    expect(result.derivedText).toBe('');
  });
});
```

- [ ] **Step 4: 运行测试,确认失败**

Run: `cd /data/lidongyu/projects/LibreChat/packages/api && npx jest src/notes/ingest.spec.ts`
Expected: FAIL — `./ingest` 不存在。

- [ ] **Step 5: 写 ingest 骨架**

Create `packages/api/src/notes/ingest.ts`:

```ts
import {
  textMimeTypes,
  imageMimeTypes,
  audioMimeTypes,
  videoMimeTypes,
  documentParserMimeTypes,
  applicationMimeTypes,
} from 'librechat-data-provider';
import { parseTextNative, parseDocument, Tokenizer } from '@librechat/api';
import type { IngestKind, IngestParams, IngestResult } from './types';

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

async function toResult(kind: IngestKind, derivedText: string): Promise<IngestResult> {
  const tokenCount = derivedText ? await Tokenizer.getTokenCount(derivedText, 'o200k_base') : 0;
  return { kind, derivedText, tokenCount };
}

export async function ingestFile({ file, req }: IngestParams): Promise<IngestResult> {
  const kind = routeByMime(file.mimetype);

  if (kind === 'text') {
    const { text } = await parseTextNative(file);
    return toResult('text', text);
  }

  if (kind === 'pdf' || kind === 'doc') {
    const { text } = await parseDocument({ file });
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
```

> implementer 验证点:(a) `Tokenizer.getTokenCount` 是否需要先 `await Tokenizer.initEncoding('o200k_base')` —— 若同步取数前未初始化,改用 `await countTokens(text)`(自初始化)替代,见探索发现;(b) `parseDocument`/`parseTextNative` 的 import 是否真由 `@librechat/api` 导出;(c) mime 正则的导出名(`documentParserMimeTypes` 是数组,`imageMimeTypes` 等是 RegExp)。

- [ ] **Step 6: 导出 ingestFile**

Modify `packages/api/src/index.ts` — 在合适分组处加:

```ts
export { ingestFile, routeByMime } from './notes/ingest';
export type { IngestKind, IngestResult, IngestParams, IngestFile } from './notes/types';
```

- [ ] **Step 7: 运行测试,确认通过**

Run: `cd /data/lidongyu/projects/LibreChat/packages/api && npx jest src/notes/ingest.spec.ts`
Expected: PASS(routeByMime 1 + text 3 = 4 用例)。也跑 `npx tsc -p tsconfig.json --noEmit`(或包内 typecheck 命令)→ exit 0。

- [ ] **Step 8: 提交**

```bash
cd /data/lidongyu/projects/LibreChat
git add packages/api/src/notes/types.ts packages/api/src/notes/ingest.ts packages/api/src/notes/__fixtures__ packages/api/src/notes/ingest.spec.ts packages/api/src/index.ts
git commit -m "feat(notes): add ingest skeleton with text/document extraction"
```

---

## Task 2: 图片分支 — OCR + vision caption

**Files:**
- Create: `packages/api/src/notes/caption.ts`
- Create: `packages/api/src/notes/caption.spec.ts`
- Modify: `packages/api/src/notes/ingest.ts`(image 分支)
- Test: `packages/api/src/notes/ingest.spec.ts`(image 用例)

**Interfaces:**
- Consumes: `IngestResult`/`IngestParams`(Task 1)。
- Produces: `captionImage(params: { filePath: string; mimetype: string }): Promise<string>` —— 给图片返回一两句文字描述。image 分支把 OCR 文本(若有)与 caption 合成 `derivedText`。

- [ ] **Step 1: 写失败测试(caption,mock 模型)**

Create `packages/api/src/notes/caption.spec.ts`:

```ts
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
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /data/lidongyu/projects/LibreChat/packages/api && npx jest src/notes/caption.spec.ts`
Expected: FAIL — `./caption` 不存在。

- [ ] **Step 3: 写 caption**

Create `packages/api/src/notes/caption.ts`:

```ts
import fs from 'fs';
import { initializeModel, Providers } from '@librechat/agents';
import { HumanMessage } from '@langchain/core/messages';

const CAPTION_MODEL = 'gpt-4.1-mini';
const CAPTION_PROMPT = 'Describe this image in one or two concise sentences for a personal notes archive.';

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
      .filter((b): b is { type: string; text: string } =>
        typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text',
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
  const base64 = fs.readFileSync(filePath).toString('base64');
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
  return extractText(response.content).trim();
}
```

> implementer 验证点:(a) `HumanMessage` 的真实 import —— 探索给的是 `@langchain/core/messages`;若 `@librechat/agents` re-export 了 messages 用那个;以代码库实际能编译者为准。(b) `initializeModel` 的 `clientOptions` 中 apiKey 落点(`configuration.apiKey` vs 顶层 `apiKey`)—— 探索风险点#2,两个都设以保险。(c) `model.invoke` 返回 `AIMessage`,`.content` 可能是 string 或 block 数组,`extractText` 已兼容。**必须直接 `.invoke()`,不要用 `attemptInvoke`(永远 streaming)。**

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /data/lidongyu/projects/LibreChat/packages/api && npx jest src/notes/caption.spec.ts`
Expected: PASS(2 用例)。

- [ ] **Step 5: 写 image 分支失败测试**

在 `packages/api/src/notes/ingest.spec.ts` 顶部加 mock(OCR + caption),并加 image describe:

```ts
jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return { ...actual, performOCR: jest.fn() };
});
jest.mock('./caption', () => ({ captionImage: jest.fn() }));
```

新增用例(放文件末尾):

```ts
import { performOCR } from '@librechat/api';
import { captionImage } from './caption';

describe('ingestFile — image', () => {
  test('combines OCR text and caption', async () => {
    (captionImage as jest.Mock).mockResolvedValue('A handwritten to-do list.');
    (performOCR as jest.Mock).mockResolvedValue({ text: 'Buy milk\nCall Sam' });
    const result = await ingestFile({
      file: { path: '/tmp/note.png', mimetype: 'image/png', originalname: 'note.png', size: 100 },
      req: { config: { ocr: { apiKey: 'k', baseURL: 'b', mistralModel: 'm' } } } as never,
    });
    expect(result.kind).toBe('image');
    expect(result.derivedText).toContain('A handwritten to-do list.');
    expect(result.derivedText).toContain('Buy milk');
  });
});
```

> 注:上面 `as never` 仅用于测试构造最小 fake `req`;实现代码中不得使用 `as never`/`as unknown as`。

- [ ] **Step 6: 实现 image 分支**

替换 `ingest.ts` 中 `if (kind === 'image') { throw ... }` 为:

```ts
  if (kind === 'image') {
    const caption = await captionImage({ filePath: file.path, mimetype: file.mimetype });
    let ocrText = '';
    const ocrCfg = req?.config?.ocr;
    if (ocrCfg?.apiKey) {
      try {
        const ocr = await performOCR({
          url: file.path,
          apiKey: ocrCfg.apiKey,
          model: ocrCfg.mistralModel,
          baseURL: ocrCfg.baseURL,
        });
        ocrText = ocr.text ?? '';
      } catch {
        ocrText = '';
      }
    }
    const parts = [caption, ocrText].filter(Boolean);
    return toResult('image', parts.join('\n\n'));
  }
```

并在 `ingest.ts` 顶部加 import:

```ts
import { performOCR } from '@librechat/api';
import { captionImage } from './caption';
```

> implementer 验证点:`performOCR` 的真实签名(探索:`performOCR({ url, apiKey, model?, baseURL?, documentType? })` → `OCRResult`,零 Express 耦合)。`url` 对本地文件路径是否可行,或需先 `getSignedUrl`/上传 —— 若 `performOCR` 要求远程 URL,则 OCR 对本地上传图片不可直接用;此时 image 分支 MVP **只用 caption**,OCR 留注释说明依赖签名 URL(P1)。先按 caption-only 跑通测试(把上面的 OCR 用例改为只断言 caption),OCR 作为可选增强按真实签名接入。

- [ ] **Step 7: 运行测试,确认通过**

Run: `cd /data/lidongyu/projects/LibreChat/packages/api && npx jest src/notes/ingest.spec.ts src/notes/caption.spec.ts`
Expected: PASS。typecheck exit 0。

- [ ] **Step 8: 提交**

```bash
cd /data/lidongyu/projects/LibreChat
git add packages/api/src/notes/caption.ts packages/api/src/notes/caption.spec.ts packages/api/src/notes/ingest.ts packages/api/src/notes/ingest.spec.ts
git commit -m "feat(notes): add image ingest (vision caption + OCR)"
```

---

## Task 3: 音频分支 — STT 转录

**Files:**
- Modify: `packages/api/src/notes/ingest.ts`(audio 分支)
- Test: `packages/api/src/notes/ingest.spec.ts`(audio 用例)

**Interfaces:**
- Consumes: `IngestParams.req`(STT 需 `req.config.speech.stt`)、现成 `processAudioFile`。
- Produces: image/audio/video/text/pdf/doc 全分支齐全的 `ingestFile`。

- [ ] **Step 1: 写 audio 分支失败测试**

在 `ingest.spec.ts` 加 mock + 用例。把顶部 `@librechat/api` 的 mock 扩展为也 mock `processAudioFile`:

```ts
jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return { ...actual, performOCR: jest.fn(), processAudioFile: jest.fn() };
});
```

新增用例:

```ts
import { processAudioFile } from '@librechat/api';

// mock STTService module (CJS in api/ tree) — implementer: adjust path to the real module
jest.mock(
  '../../../../api/server/services/Files/Audio/STTService',
  () => ({ STTService: { getInstance: jest.fn(async () => ({})) } }),
  { virtual: true },
);

describe('ingestFile — audio', () => {
  test('transcribes audio to derivedText', async () => {
    (processAudioFile as jest.Mock).mockResolvedValue({ text: 'Meeting notes: ship Plan B.', bytes: 100 });
    const result = await ingestFile({
      file: { path: '/tmp/voice.m4a', mimetype: 'audio/mp4', originalname: 'voice.m4a', size: 100 },
      req: { config: { speech: { stt: { openai: { apiKey: 'k', model: 'whisper-1' } } } } } as never,
    });
    expect(result.kind).toBe('audio');
    expect(result.derivedText).toContain('ship Plan B');
  });
});
```

> implementer 验证点:`STTService` 是 CJS,位于 `api/server/services/Files/Audio/STTService.js`(在 `api/` 工作区,不是 `packages/api`)。从 `packages/api` 跨工作区 import 它可能违反包边界且路径脆弱。**首选方案**:让 `ingestFile` 接受可选注入的 `sttService`(依赖注入),由调用方(后续接入层,在 `api/`)传入 `STTService.getInstance()`;ingest 只依赖 `processAudioFile({ req, file, sttService })` 这个 `@librechat/api` 导出。这样 `packages/api` 不反向依赖 `api/`。据此调整 `IngestParams` 增加可选 `sttService`,测试直接传一个 `{}` 占位的 sttService。

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /data/lidongyu/projects/LibreChat/packages/api && npx jest src/notes/ingest.spec.ts -t audio`
Expected: FAIL — audio 分支仍是 `throw`。

- [ ] **Step 3: 实现 audio 分支(依赖注入 sttService)**

更新 `types.ts` 的 `IngestParams`:

```ts
export interface IngestParams {
  file: IngestFile;
  req?: ServerRequest;
  sttService?: unknown; // STTService instance, injected by the api-layer caller (avoids packages/api → api/ dependency)
}
```

> 例外说明:此处 `sttService?: unknown` 是跨工作区边界的有意松类型(STTService 类型定义在 `api/`,`packages/api` 不应依赖它);用 `unknown` 而非 `any`,并在传给 `processAudioFile` 时由该函数的签名约束。这是 CLAUDE.md "limit unknown" 下的合理边界例外,在注释中说明。

替换 `ingest.ts` 的 `if (kind === 'audio') { throw ... }`:

```ts
  if (kind === 'audio') {
    if (!req || !sttService) {
      return toResult('audio', '');
    }
    const { text } = await processAudioFile({ req, file, sttService });
    return toResult('audio', text);
  }
```

并加 import + 把 `sttService` 加入解构:

```ts
import { parseTextNative, parseDocument, performOCR, processAudioFile, Tokenizer } from '@librechat/api';
// ...
export async function ingestFile({ file, req, sttService }: IngestParams): Promise<IngestResult> {
```

> implementer 验证点:`processAudioFile({ req, file, sttService })` 的真实签名(探索:`packages/api/src/files/audio.ts`,`req` 仅用于 `sttService.getProviderSchema(req)` → `req.config`)。`file` 需 `{ path, originalname, mimetype, size }` —— `IngestFile` 已满足。

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /data/lidongyu/projects/LibreChat/packages/api && npx jest src/notes/ingest.spec.ts src/notes/caption.spec.ts`
Expected: PASS(全部:routeByMime + text/video + image + audio + caption)。typecheck exit 0。eslint on `src/notes/*.ts` exit 0。

- [ ] **Step 5: 提交**

```bash
cd /data/lidongyu/projects/LibreChat
git add packages/api/src/notes/ingest.ts packages/api/src/notes/types.ts packages/api/src/notes/ingest.spec.ts
git commit -m "feat(notes): add audio ingest via injected STT service"
```

---

## Self-Review

- **Spec 覆盖**:Plan B 覆盖 [spec §7 多模态文本化入料](../specs/2026-06-17-graupel-second-brain.md#7-多模态文本化入料管线)与 §13 Plan B(`ingest.ts` 编排 OCR/STT/vision/text,各类型 → derivedText)。范围决策(已与用户确认):图片 = vision caption + OCR(OCR 视 `performOCR` 是否接受本地路径,否则 caption-only + P1 注释);视频 = unsupported 占位(P1,与 spec "video→STT" 的偏离已记此处,需回填 spec §7 标注 video 为 P1)。
- **Placeholder 扫描**:各 step 含真实代码;`as never` 仅出现在测试 fake req 构造并已注明;实现代码无 `as unknown as`。implementer 验证点均为"按代码库实际接口校准 import/签名",非占位。
- **类型一致**:`IngestKind`/`IngestResult`/`IngestParams` 贯穿三 task;`ingestFile` 签名在 Task 3 增加 `sttService` 后保持向后兼容(可选参数)。
- **跨包边界**:ingest 在 `packages/api`,仅依赖 `@librechat/api`/`@librechat/agents`/`librechat-data-provider`;STTService(在 `api/`)经依赖注入传入,不反向依赖。

## 给后续 plan 的衔接

- 本层只产出 `{ kind, derivedText, tokenCount }`,**不存原件、不写 Note**。接入层(上传端点 → 存 R2 → `ingestFile` → push `Note.attachments` + 并入 `content`)在后续 plan(配合 Plan A 的 CRUD 与 Plan F 前端)。
- 回填 spec §7:标注 video 为 P1、image 的 OCR 依赖签名 URL 时降级为 caption-only。
