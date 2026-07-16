# 图像生成 Provider 网关抽象 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把图像生成后端从"写死调用 GPTsAPI 一家私有异步预测协议"重构成 config-driven 的 provider 网关,让 OpenRouter(同步协议)和 GPTsAPI(异步提交+轮询协议)可以并存配置,不改动上游 Agent 工具、图库、计费门控。

**Architecture:** 新增 `librechat.yaml` 顶层配置块 `imageGeneration.providers[]`(zod discriminated union 按 `protocol` 区分两种模型能力形状);`packages/api/src/images/providers/` 下按 protocol 写两个纯函数式 adapter 模块(`openrouter.ts` 同步返回 base64,`gptsapi.ts` 提交返回 jobId + 单独 poll),`registry.ts` 按 provider 名称/`protocol` 分发;`service.ts` 的 `submitGeneration`/`resolveResult` 改为消费 registry 而不是写死的单一 gptsapi client;外部 HTTP 契约(`POST /generate` 返回 `predictionId`,前端轮询 `GET /result/:id`)不变。

**Tech Stack:** TypeScript(`packages/api`、`packages/data-provider`、`packages/data-schemas`),Express(`api/server/routes/images.js`),Zod,Jest + `mongodb-memory-server`,React + React Query(`client/src`)。

**关联设计文档:** [docs/superpowers/specs/2026-07-15-graupel-image-provider-gateway-design.md](../specs/2026-07-15-graupel-image-provider-gateway-design.md)

## Global Constraints

- 新后端代码一律 TypeScript,业务逻辑放 `packages/api`;`api/server/routes/images.js` 只做薄 wrapper(项目 CLAUDE.md)。
- 共享类型(前后端都用的)放 `packages/data-provider`;新 zod config schema 放 `packages/data-provider/src/config.ts`(与 `endpoints`/`webSearch` 等现有顶层 key 同一文件、同一模式)。
- 禁止使用 `any`;避免 `unknown`/`Record<string, unknown>`。
- 涉及 mongodb-memory-server 的 jest 测试,本机(无 AVX + OpenSSL3)必须加前缀,否则 SIGILL 或缺库报错:
  `LD_LIBRARY_PATH="$HOME/.local/ssl1.1/usr/lib/x86_64-linux-gnu" MONGOMS_VERSION=4.4.18 npx jest <pattern>`
- 测试哲学:真实逻辑优先,只 mock 不可控外部依赖(HTTP 调用);spy 优于替换实现;不允许静默吞错误。
- 每个 task 结束保持仓库可编译、测试全绿(中间状态不能破坏已有测试)——`client.ts`/`client.spec.ts`(GPTsAPI 旧实现)要等到 Task 7(`service.ts` 重构,最后一个消费者切走)才删除,不提前删。
- 不改动:上游 4 个 Agent 工具(`DALLE3.js`/`FluxAPI.js`/`OpenAIImageTools.js`/`gemini_image_gen`)、`File` schema、图库分页查询逻辑、`service.ts` 里的 `// TODO(gating)` 检查点。
- 提交信息不加 Co-Authored-By 签名(用户全局 CLAUDE.md)。

---

### Task 1: 配置 Schema 与共享类型(`packages/data-provider`)

**Files:**
- Modify: `packages/data-provider/src/config.ts`
- Modify: `packages/data-provider/src/types/images.ts`
- Test: `packages/data-provider/specs/config-schemas.spec.ts`

**Interfaces:**
- Consumes: 无(自包含,zod 库已是既有依赖)
- Produces:
  - `openRouterImageModelSchema`、`gptsapiImageModelSchema`、`imageProviderConfigSchema`(discriminated union on `protocol`)、`imageGenerationConfigSchema` — 从 `packages/data-provider/src/config.ts` 导出
  - 类型 `TOpenRouterImageModel`、`TGptsapiImageModel`、`TImageProviderConfig`、`TImageGenerationConfig`
  - `configSchema` 新增顶层可选字段 `imageGeneration`
  - `TImageModel`(已存在,`packages/data-provider/src/types/images.ts`)新增必填字段 `provider: string`
  - `TImageGenRequest`(已存在)新增必填字段 `provider: string`

- [ ] **Step 1: 写失败的 schema 测试**

在 `packages/data-provider/specs/config-schemas.spec.ts` 顶部 import 里加入新 schema,并在文件末尾追加:

```ts
import {
  // ...现有 imports 保持不变,追加:
  imageGenerationConfigSchema,
} from '../src/config';
```

在文件末尾追加:

```ts
describe('imageGenerationConfigSchema', () => {
  it('accepts a valid OpenRouter provider entry', () => {
    const result = imageGenerationConfigSchema.safeParse({
      providers: [
        {
          name: 'OpenRouter',
          protocol: 'openrouter',
          apiKey: '${OPENROUTER_KEY}',
          baseURL: 'https://openrouter.ai/api/v1',
          aspectRatios: ['auto', '1:1', '9:16', '16:9', '4:3', '3:4'],
          models: [
            {
              id: 'google/gemini-3-pro-image',
              label: 'Nano Banana Pro',
              isDefault: true,
              supportsEdit: true,
              paramKey: 'output_format',
              paramValues: ['png', 'jpeg'],
              defaultParam: 'png',
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid GPTsAPI provider entry with vendor/editImagesKey', () => {
    const result = imageGenerationConfigSchema.safeParse({
      providers: [
        {
          name: 'GPTsAPI',
          protocol: 'gptsapi-predictions',
          apiKey: '${GPTSAPI_KEY}',
          baseURL: 'https://api.gptsapi.net',
          aspectRatios: ['auto', '1:1', '9:16', '16:9', '4:3', '3:4'],
          models: [
            {
              id: 'gemini-3-pro-image-preview',
              label: 'Nano Banana Pro (GPTsAPI)',
              vendor: 'google',
              supportsEdit: true,
              editImagesKey: 'images',
              paramKey: 'output_format',
              paramValues: ['png', 'jpeg'],
              defaultParam: 'png',
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown protocol', () => {
    const result = imageGenerationConfigSchema.safeParse({
      providers: [
        {
          name: 'X',
          protocol: 'unknown-protocol',
          apiKey: 'k',
          baseURL: 'https://x.example.com',
          aspectRatios: ['1:1'],
          models: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a provider with an empty models array', () => {
    const result = imageGenerationConfigSchema.safeParse({
      providers: [
        {
          name: 'OpenRouter',
          protocol: 'openrouter',
          apiKey: 'k',
          baseURL: 'https://openrouter.ai/api/v1',
          aspectRatios: ['1:1'],
          models: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a gptsapi model missing vendor', () => {
    const result = imageGenerationConfigSchema.safeParse({
      providers: [
        {
          name: 'GPTsAPI',
          protocol: 'gptsapi-predictions',
          apiKey: 'k',
          baseURL: 'https://api.gptsapi.net',
          aspectRatios: ['1:1'],
          models: [
            {
              id: 'gemini-3-pro-image-preview',
              label: 'Nano Banana Pro',
              supportsEdit: true,
              editImagesKey: 'images',
              paramKey: 'output_format',
              paramValues: ['png'],
              defaultParam: 'png',
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/data-provider && npx jest specs/config-schemas.spec.ts -t imageGenerationConfigSchema`
Expected: FAIL — `imageGenerationConfigSchema` is not exported / `Cannot find module` 之类的报错(schema 还不存在)。

- [ ] **Step 3: 在 `packages/data-provider/src/config.ts` 里实现 schema**

在文件中找到 `export const assistantEndpointSchema = ...`(现有 endpoint schema 定义区域)附近,添加以下内容(放在 `export const configSchema = z.object({` 定义之前的任意位置,与其它 schema 定义放在一起即可):

```ts
const imageProviderCommonFields = {
  name: z.string(),
  apiKey: z.string(),
  baseURL: z.string(),
  aspectRatios: z.array(z.string()).min(1),
};

export const openRouterImageModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  isDefault: z.boolean().optional(),
  supportsEdit: z.boolean(),
  paramKey: z.union([z.literal('output_format'), z.literal('resolution')]),
  paramValues: z.array(z.string()).min(1),
  defaultParam: z.string(),
});

export const gptsapiImageModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  isDefault: z.boolean().optional(),
  vendor: z.union([z.literal('google'), z.literal('openai')]),
  supportsEdit: z.boolean(),
  editImagesKey: z.union([z.literal('images'), z.literal('input_urls')]),
  paramKey: z.union([z.literal('output_format'), z.literal('resolution')]),
  paramValues: z.array(z.string()).min(1),
  defaultParam: z.string(),
});

export const imageProviderConfigSchema = z.discriminatedUnion('protocol', [
  z.object({
    ...imageProviderCommonFields,
    protocol: z.literal('openrouter'),
    models: z.array(openRouterImageModelSchema).min(1),
  }),
  z.object({
    ...imageProviderCommonFields,
    protocol: z.literal('gptsapi-predictions'),
    models: z.array(gptsapiImageModelSchema).min(1),
  }),
]);

export const imageGenerationConfigSchema = z.object({
  providers: z.array(imageProviderConfigSchema).min(1),
});

export type TOpenRouterImageModel = z.infer<typeof openRouterImageModelSchema>;
export type TGptsapiImageModel = z.infer<typeof gptsapiImageModelSchema>;
export type TImageProviderConfig = z.infer<typeof imageProviderConfigSchema>;
export type TImageGenerationConfig = z.infer<typeof imageGenerationConfigSchema>;
```

然后在 `export const configSchema = z.object({` 内部,找到 `endpoints: z` 那一行的前面(或后面均可,顺序不影响功能),添加一行:

```ts
  imageGeneration: imageGenerationConfigSchema.optional(),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/data-provider && npx jest specs/config-schemas.spec.ts -t imageGenerationConfigSchema`
Expected: PASS(5 个 test 全绿)。

- [ ] **Step 5: 更新共享的 `TImageModel`/`TImageGenRequest` 类型**

打开 `packages/data-provider/src/types/images.ts`,把:

```ts
export interface TImageModel {
  id: string;
  label: string;
  supportsEdit: boolean;
  paramKey: string;
  paramValues: string[];
  defaultParam: string;
}
```

改成:

```ts
export interface TImageModel {
  id: string;
  label: string;
  provider: string;
  supportsEdit: boolean;
  paramKey: string;
  paramValues: string[];
  defaultParam: string;
}
```

把:

```ts
export interface TImageGenRequest {
  prompt: string;
  model: string;
  aspectRatio: string;
  param?: string;
  imageUrls?: string[];
}
```

改成:

```ts
export interface TImageGenRequest {
  prompt: string;
  model: string;
  provider: string;
  aspectRatio: string;
  param?: string;
  imageUrls?: string[];
}
```

- [ ] **Step 6: 跑 data-provider 全量测试确认没有破坏其它用例**

Run: `cd packages/data-provider && npx jest`
Expected: PASS(既有测试不受影响;这一步不涉及 mongodb-memory-server,不需要 no-AVX 前缀)。

- [ ] **Step 7: Commit**

```bash
git add packages/data-provider/src/config.ts packages/data-provider/src/types/images.ts packages/data-provider/specs/config-schemas.spec.ts
git commit -m "feat(data-provider): add imageGeneration provider config schema"
```

---

### Task 2: AppConfig 接入(`packages/data-schemas`)

**Files:**
- Modify: `packages/data-schemas/src/types/app.ts`
- Modify: `packages/data-schemas/src/app/service.ts`
- Test: `packages/data-schemas/src/app/service.spec.ts`

**Interfaces:**
- Consumes: `TCustomConfig['imageGeneration']`(Task 1 产出的 zod 推导类型,`TCustomConfig` 已存在于 `librechat-data-provider`)
- Produces: `AppConfig.imageGeneration`(运行时,`AppService(...)` 返回值上可读到 `result.imageGeneration`)

- [ ] **Step 1: 写失败的测试**

在 `packages/data-schemas/src/app/service.spec.ts` 末尾追加:

```ts
describe('AppService imageGeneration passthrough', () => {
  it('passes through the imageGeneration config unchanged', async () => {
    const config = {
      imageGeneration: {
        providers: [
          {
            name: 'OpenRouter',
            protocol: 'openrouter',
            apiKey: '${OPENROUTER_KEY}',
            baseURL: 'https://openrouter.ai/api/v1',
            aspectRatios: ['1:1'],
            models: [
              {
                id: 'google/gemini-3-pro-image',
                label: 'Nano Banana Pro',
                supportsEdit: true,
                paramKey: 'output_format',
                paramValues: ['png'],
                defaultParam: 'png',
              },
            ],
          },
        ],
      },
    } as DeepPartial<TCustomConfig>;
    const result = await AppService({ config });
    expect(result.imageGeneration?.providers?.[0]?.name).toBe('OpenRouter');
  });

  it('is undefined when not configured', async () => {
    const result = await AppService({ config: {} as DeepPartial<TCustomConfig> });
    expect(result.imageGeneration).toBeUndefined();
  });
});
```

(`AppService`、`DeepPartial`、`TCustomConfig` 在该文件顶部已经 import,不需要新增 import。)

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/data-schemas && LD_LIBRARY_PATH="$HOME/.local/ssl1.1/usr/lib/x86_64-linux-gnu" MONGOMS_VERSION=4.4.18 npx jest src/app/service.spec.ts -t "imageGeneration passthrough"`
Expected: FAIL — `result.imageGeneration` 是 `undefined`,第一个 `it` 断言失败(`AppConfig` 类型上目前也没有 `imageGeneration`,如果开了 strict 类型检查会先报编译错误)。

- [ ] **Step 3: 在 `AppConfig` 接口加字段**

打开 `packages/data-schemas/src/types/app.ts`,在 `webSearch?: TCustomConfig['webSearch'];` 那一行下面新增一行:

```ts
  /** Image generation provider configuration */
  imageGeneration?: TCustomConfig['imageGeneration'];
```

- [ ] **Step 4: 在 `AppService` 里透传该字段**

打开 `packages/data-schemas/src/app/service.ts`,找到:

```ts
  const speech = config.speech;

  const defaultConfig = {
```

改成:

```ts
  const speech = config.speech;
  const imageGeneration = config.imageGeneration;

  const defaultConfig = {
```

然后在 `defaultConfig` 对象字面量里(紧挨着 `speech,` 那一行)加入 `imageGeneration,`:

```ts
  const defaultConfig = {
    ocr,
    paths,
    config,
    memory,
    speech,
    imageGeneration,
    balance,
    actions,
    webSearch,
    mcpSettings,
    transactions,
    fileStrategy,
    registration,
    filteredTools,
    includedTools,
    summarization,
    availableTools,
    imageOutputType,
    interfaceConfig,
    turnstileConfig,
    mcpConfig: mcpServersConfig,
    fileStrategies: config.fileStrategies,
    cloudfront: config.cloudfront as AppConfig['cloudfront'],
  };
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/data-schemas && LD_LIBRARY_PATH="$HOME/.local/ssl1.1/usr/lib/x86_64-linux-gnu" MONGOMS_VERSION=4.4.18 npx jest src/app/service.spec.ts -t "imageGeneration passthrough"`
Expected: PASS(2 个 test 绿)。

- [ ] **Step 6: 跑该文件全量测试,确认没有破坏既有的 memory/webSearch 等透传测试**

Run: `cd packages/data-schemas && LD_LIBRARY_PATH="$HOME/.local/ssl1.1/usr/lib/x86_64-linux-gnu" MONGOMS_VERSION=4.4.18 npx jest src/app/service.spec.ts`
Expected: PASS(全部 test 绿)。

- [ ] **Step 7: Commit**

```bash
git add packages/data-schemas/src/types/app.ts packages/data-schemas/src/app/service.ts packages/data-schemas/src/app/service.spec.ts
git commit -m "feat(data-schemas): pass through imageGeneration config on AppConfig"
```

---

### Task 3: Adapter 接口 + GptsapiAdapter(迁移现有 `client.ts`)

**Files:**
- Create: `packages/api/src/images/providers/types.ts`
- Create: `packages/api/src/images/providers/gptsapi.ts`
- Create: `packages/api/src/images/providers/gptsapi.spec.ts`
- (不动,留到 Task 7 再删) `packages/api/src/images/client.ts`、`packages/api/src/images/client.spec.ts`

**Interfaces:**
- Consumes: 无(自包含,`~/utils/axios` 的 `createAxiosInstance`/`logAxiosError` 已是既有工具)
- Produces:
  - `packages/api/src/images/providers/types.ts` 导出 `GenerationOutcome`、`ImageProviderRuntimeConfig`
  - `packages/api/src/images/providers/gptsapi.ts` 导出 `generate(args, cfg)`、`poll(jobId, cfg)`、`protocol = 'gptsapi-predictions'`

- [ ] **Step 1: 创建 `types.ts`**

```ts
// packages/api/src/images/providers/types.ts
export type GenerationOutcome =
  | { status: 'completed'; imageUrl?: string; imageB64?: string; mediaType?: string }
  | { status: 'pending'; jobId: string }
  | { status: 'failed'; error: string };

export interface ImageProviderRuntimeConfig {
  baseUrl: string;
  apiKey: string;
}
```

- [ ] **Step 2: 写失败的 `gptsapi.spec.ts`**

```ts
// packages/api/src/images/providers/gptsapi.spec.ts
import type { TGptsapiImageModel } from 'librechat-data-provider';
import type { ImageProviderRuntimeConfig } from './types';

const mockPost = jest.fn();
const mockGet = jest.fn();

jest.mock('~/utils/axios', () => ({
  createAxiosInstance: () => ({ post: mockPost, get: mockGet }),
  logAxiosError: ({ message }: { message: string }) => message,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generate, poll } = require('./gptsapi') as {
  generate: (
    args: {
      model: TGptsapiImageModel;
      prompt: string;
      aspectRatio: string;
      paramValue: string;
      imageUrls?: string[];
    },
    cfg: ImageProviderRuntimeConfig,
  ) => Promise<{ status: string; jobId?: string; imageUrl?: string; error?: string }>;
  poll: (
    jobId: string,
    cfg: ImageProviderRuntimeConfig,
  ) => Promise<{ status: string; jobId?: string; imageUrl?: string; error?: string }>;
};

const cfg: ImageProviderRuntimeConfig = { baseUrl: 'https://api.gptsapi.net', apiKey: 'test-key' };

const geminiModel: TGptsapiImageModel = {
  id: 'gemini-3-pro-image-preview',
  label: 'Nano Banana Pro',
  vendor: 'google',
  supportsEdit: true,
  editImagesKey: 'images',
  paramKey: 'output_format',
  paramValues: ['png', 'jpeg'],
  defaultParam: 'png',
};

const gptImageModel: TGptsapiImageModel = {
  id: 'gpt-image-2',
  label: 'GPT Image 2',
  vendor: 'openai',
  supportsEdit: true,
  editImagesKey: 'input_urls',
  paramKey: 'resolution',
  paramValues: ['1K', '2K', '4K'],
  defaultParam: '1K',
};

describe('gptsapi generate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('text-to-image: hits correct URL, returns pending with jobId', async () => {
    mockPost.mockResolvedValue({ data: { data: { id: 'pred-123' } } });
    const result = await generate(
      { model: geminiModel, prompt: 'a cat', aspectRatio: '1:1', paramValue: 'png' },
      cfg,
    );
    expect(result).toEqual({ status: 'pending', jobId: 'pred-123' });
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe(
      'https://api.gptsapi.net/api/v3/google/gemini-3-pro-image-preview/text-to-image',
    );
    expect(body).toEqual({ prompt: 'a cat', aspect_ratio: '1:1', output_format: 'png' });
  });

  test('image-edit (google): sets images key', async () => {
    mockPost.mockResolvedValue({ data: { data: { id: 'pred-456' } } });
    await generate(
      {
        model: geminiModel,
        prompt: 'add a hat',
        aspectRatio: '16:9',
        paramValue: 'jpeg',
        imageUrls: ['https://example.com/img.jpg'],
      },
      cfg,
    );
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('https://api.gptsapi.net/api/v3/google/gemini-3-pro-image-preview/image-edit');
    expect(body).toMatchObject({ images: ['https://example.com/img.jpg'] });
  });

  test('image-edit (openai): sets input_urls key', async () => {
    mockPost.mockResolvedValue({ data: { data: { id: 'pred-789' } } });
    await generate(
      {
        model: gptImageModel,
        prompt: 'change background',
        aspectRatio: '1:1',
        paramValue: '1K',
        imageUrls: ['https://example.com/photo.png'],
      },
      cfg,
    );
    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({ input_urls: ['https://example.com/photo.png'] });
    expect(body).not.toHaveProperty('images');
  });

  test('throws when response has no id', async () => {
    mockPost.mockResolvedValue({ data: { data: {} } });
    await expect(
      generate({ model: geminiModel, prompt: 'x', aspectRatio: 'auto', paramValue: 'png' }, cfg),
    ).rejects.toThrow('gptsapi image submit failed');
  });
});

describe('gptsapi poll', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('maps completed status to imageUrl', async () => {
    mockGet.mockResolvedValue({
      data: { data: { status: 'completed', outputs: ['https://img.url/1.png'] } },
    });
    const result = await poll('pred-123', cfg);
    expect(result).toEqual({ status: 'completed', imageUrl: 'https://img.url/1.png' });
    const [url] = mockGet.mock.calls[0];
    expect(url).toBe('https://api.gptsapi.net/api/v3/predictions/pred-123/result');
  });

  test('maps failed status to error', async () => {
    mockGet.mockResolvedValue({ data: { data: { status: 'failed', error: 'quota exceeded' } } });
    const result = await poll('pred-err', cfg);
    expect(result).toEqual({ status: 'failed', error: 'quota exceeded' });
  });

  test('maps error status to error', async () => {
    mockGet.mockResolvedValue({ data: { data: { status: 'error', error: 'provider error' } } });
    const result = await poll('pred-err2', cfg);
    expect(result).toEqual({ status: 'failed', error: 'provider error' });
  });

  test('maps processing/created/unknown status to pending', async () => {
    mockGet.mockResolvedValue({ data: { data: { status: 'processing' } } });
    const result = await poll('pred-456', cfg);
    expect(result).toEqual({ status: 'pending', jobId: 'pred-456' });
  });

  test('throws on get error', async () => {
    mockGet.mockRejectedValue(new Error('network fail'));
    await expect(poll('pred-err3', cfg)).rejects.toThrow('gptsapi image poll failed');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/api && npx jest src/images/providers/gptsapi.spec.ts`
Expected: FAIL — `Cannot find module './gptsapi'`。

- [ ] **Step 4: 实现 `gptsapi.ts`(从 `client.ts` 迁移逻辑,改造返回形状)**

```ts
// packages/api/src/images/providers/gptsapi.ts
import type { TGptsapiImageModel } from 'librechat-data-provider';
import { createAxiosInstance, logAxiosError } from '~/utils/axios';
import type { GenerationOutcome, ImageProviderRuntimeConfig } from './types';

const axios = createAxiosInstance();

export const protocol = 'gptsapi-predictions' as const;

export interface GptsapiGenerateArgs {
  model: TGptsapiImageModel;
  prompt: string;
  aspectRatio: string;
  paramValue: string;
  imageUrls?: string[];
}

export async function generate(
  args: GptsapiGenerateArgs,
  cfg: ImageProviderRuntimeConfig,
): Promise<GenerationOutcome> {
  const { model, prompt, aspectRatio, paramValue, imageUrls } = args;
  const isEdit = Array.isArray(imageUrls) && imageUrls.length > 0;
  const action = isEdit ? 'image-edit' : 'text-to-image';
  const url = `${cfg.baseUrl}/api/v3/${model.vendor}/${model.id}/${action}`;
  const body: Record<string, unknown> = {
    prompt,
    aspect_ratio: aspectRatio,
    [model.paramKey]: paramValue,
  };
  if (isEdit) {
    body[model.editImagesKey] = imageUrls;
  }
  try {
    const res = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    });
    const id = res.data?.data?.id;
    if (!id) {
      throw new Error('gptsapi submit returned no prediction id');
    }
    return { status: 'pending', jobId: id as string };
  } catch (error) {
    throw new Error(logAxiosError({ error, message: 'gptsapi image submit failed' }));
  }
}

export async function poll(
  jobId: string,
  cfg: ImageProviderRuntimeConfig,
): Promise<GenerationOutcome> {
  const url = `${cfg.baseUrl}/api/v3/predictions/${jobId}/result`;
  try {
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    const data = res.data?.data ?? {};
    const status = data.status ?? 'unknown';
    if (status === 'completed') {
      const outputs = data.outputs ?? [];
      return { status: 'completed', imageUrl: outputs[0] };
    }
    if (status === 'failed' || status === 'error') {
      return { status: 'failed', error: data.error ?? 'image generation failed' };
    }
    return { status: 'pending', jobId };
  } catch (error) {
    throw new Error(logAxiosError({ error, message: 'gptsapi image poll failed' }));
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/api && npx jest src/images/providers/gptsapi.spec.ts`
Expected: PASS(11 个 test 绿)。

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/images/providers/types.ts packages/api/src/images/providers/gptsapi.ts packages/api/src/images/providers/gptsapi.spec.ts
git commit -m "feat(api/images): add ImageProviderAdapter types and gptsapi adapter"
```

Note: `client.ts`/`client.spec.ts` 暂时保留(`service.ts` 还在用它们),会在 Task 7 一并删除。

---

### Task 4: OpenRouterAdapter(新写)

**Files:**
- Create: `packages/api/src/images/providers/openrouter.ts`
- Create: `packages/api/src/images/providers/openrouter.spec.ts`

**Interfaces:**
- Consumes: `GenerationOutcome`、`ImageProviderRuntimeConfig`(Task 3 产出)、`TOpenRouterImageModel`(Task 1 产出)
- Produces: `packages/api/src/images/providers/openrouter.ts` 导出 `generate(args, cfg)`、`protocol = 'openrouter'`(无 `poll`,协议本身同步)

- [ ] **Step 1: 写失败的 `openrouter.spec.ts`**

```ts
// packages/api/src/images/providers/openrouter.spec.ts
import type { TOpenRouterImageModel } from 'librechat-data-provider';
import type { ImageProviderRuntimeConfig } from './types';

const mockPost = jest.fn();

jest.mock('~/utils/axios', () => ({
  createAxiosInstance: () => ({ post: mockPost }),
  logAxiosError: ({ message }: { message: string }) => message,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generate } = require('./openrouter') as {
  generate: (
    args: {
      model: TOpenRouterImageModel;
      prompt: string;
      aspectRatio: string;
      paramValue: string;
      imageUrls?: string[];
    },
    cfg: ImageProviderRuntimeConfig,
  ) => Promise<{ status: string; imageB64?: string; mediaType?: string }>;
};

const cfg: ImageProviderRuntimeConfig = {
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'or-key',
};

const geminiModel: TOpenRouterImageModel = {
  id: 'google/gemini-3-pro-image',
  label: 'Nano Banana Pro',
  supportsEdit: true,
  paramKey: 'output_format',
  paramValues: ['png', 'jpeg'],
  defaultParam: 'png',
};

describe('openrouter generate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('posts to /images with model id, prompt, aspect_ratio, and paramKey', async () => {
    mockPost.mockResolvedValue({
      data: { data: [{ b64_json: 'BASE64DATA', media_type: 'image/png' }] },
    });
    const result = await generate(
      { model: geminiModel, prompt: 'a red panda', aspectRatio: '16:9', paramValue: 'png' },
      cfg,
    );
    expect(result).toEqual({ status: 'completed', imageB64: 'BASE64DATA', mediaType: 'image/png' });
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/images');
    expect(body).toEqual({
      model: 'google/gemini-3-pro-image',
      prompt: 'a red panda',
      aspect_ratio: '16:9',
      output_format: 'png',
    });
  });

  test('maps imageUrls to input_references', async () => {
    mockPost.mockResolvedValue({ data: { data: [{ b64_json: 'X', media_type: 'image/png' }] } });
    await generate(
      {
        model: geminiModel,
        prompt: 'edit this',
        aspectRatio: '1:1',
        paramValue: 'png',
        imageUrls: ['https://example.com/a.png'],
      },
      cfg,
    );
    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({
      input_references: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }],
    });
  });

  test('throws when response has no image data', async () => {
    mockPost.mockResolvedValue({ data: { data: [] } });
    await expect(
      generate({ model: geminiModel, prompt: 'x', aspectRatio: '1:1', paramValue: 'png' }, cfg),
    ).rejects.toThrow('openrouter image generation failed');
  });

  test('throws on axios error', async () => {
    mockPost.mockRejectedValue(new Error('network fail'));
    await expect(
      generate({ model: geminiModel, prompt: 'x', aspectRatio: '1:1', paramValue: 'png' }, cfg),
    ).rejects.toThrow('openrouter image generation failed');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && npx jest src/images/providers/openrouter.spec.ts`
Expected: FAIL — `Cannot find module './openrouter'`。

- [ ] **Step 3: 实现 `openrouter.ts`**

```ts
// packages/api/src/images/providers/openrouter.ts
import type { TOpenRouterImageModel } from 'librechat-data-provider';
import { createAxiosInstance, logAxiosError } from '~/utils/axios';
import type { GenerationOutcome, ImageProviderRuntimeConfig } from './types';

const axios = createAxiosInstance();

export const protocol = 'openrouter' as const;

export interface OpenRouterGenerateArgs {
  model: TOpenRouterImageModel;
  prompt: string;
  aspectRatio: string;
  paramValue: string;
  imageUrls?: string[];
}

export async function generate(
  args: OpenRouterGenerateArgs,
  cfg: ImageProviderRuntimeConfig,
): Promise<GenerationOutcome> {
  const { model, prompt, aspectRatio, paramValue, imageUrls } = args;
  const body: Record<string, unknown> = {
    model: model.id,
    prompt,
    aspect_ratio: aspectRatio,
    [model.paramKey]: paramValue,
  };
  if (Array.isArray(imageUrls) && imageUrls.length > 0) {
    body.input_references = imageUrls.map((url) => ({ type: 'image_url', image_url: { url } }));
  }
  try {
    const res = await axios.post(`${cfg.baseUrl}/images`, body, {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    });
    const image = res.data?.data?.[0];
    if (!image?.b64_json) {
      throw new Error('openrouter image generation returned no image data');
    }
    return { status: 'completed', imageB64: image.b64_json, mediaType: image.media_type };
  } catch (error) {
    throw new Error(logAxiosError({ error, message: 'openrouter image generation failed' }));
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/api && npx jest src/images/providers/openrouter.spec.ts`
Expected: PASS(4 个 test 绿)。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/images/providers/openrouter.ts packages/api/src/images/providers/openrouter.spec.ts
git commit -m "feat(api/images): add OpenRouter image generation adapter"
```

---

### Task 5: Provider 配置解析与分发(`registry.ts`)

**Files:**
- Create: `packages/api/src/images/providers/registry.ts`
- Create: `packages/api/src/images/providers/registry.spec.ts`

**Interfaces:**
- Consumes: `extractEnvVariable`(从 `librechat-data-provider` 导出,`packages/data-provider/src/utils.ts:38`)、`TImageGenerationConfig`/`TImageProviderConfig`(Task 1)、`openrouter.generate`/`gptsapi.generate`/`gptsapi.poll`(Task 3、4)
- Produces:
  - `ResolvedImageProvider { name: string; runtimeConfig: ImageProviderRuntimeConfig; config: TImageProviderConfig }`
  - `resolveImageProviders(imageGeneration: TImageGenerationConfig | undefined): ResolvedImageProvider[]`
  - `findProvider(providers: ResolvedImageProvider[], name: string): ResolvedImageProvider`(未找到抛错)
  - `generateImage(providers, args: { providerName; modelId; prompt; aspectRatio; paramValue; imageUrls? }): Promise<GenerationOutcome>`
  - `pollImage(providers, providerName: string, jobId: string): Promise<GenerationOutcome>`

- [ ] **Step 1: 写失败的 `registry.spec.ts`**

```ts
// packages/api/src/images/providers/registry.spec.ts
import type { TImageGenerationConfig } from 'librechat-data-provider';

jest.mock('./openrouter');
jest.mock('./gptsapi');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveImageProviders, findProvider, generateImage, pollImage } = require('./registry') as {
  resolveImageProviders: typeof import('./registry').resolveImageProviders;
  findProvider: typeof import('./registry').findProvider;
  generateImage: typeof import('./registry').generateImage;
  pollImage: typeof import('./registry').pollImage;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const openrouterAdapter = require('./openrouter');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gptsapiAdapter = require('./gptsapi');

const config: TImageGenerationConfig = {
  providers: [
    {
      name: 'OpenRouter',
      protocol: 'openrouter',
      apiKey: '${TEST_OPENROUTER_KEY}',
      baseURL: 'https://openrouter.ai/api/v1',
      aspectRatios: ['1:1'],
      models: [
        {
          id: 'google/gemini-3-pro-image',
          label: 'Nano Banana Pro',
          supportsEdit: true,
          paramKey: 'output_format',
          paramValues: ['png'],
          defaultParam: 'png',
        },
      ],
    },
    {
      name: 'GPTsAPI',
      protocol: 'gptsapi-predictions',
      apiKey: '${TEST_GPTSAPI_KEY}',
      baseURL: 'https://api.gptsapi.net',
      aspectRatios: ['1:1'],
      models: [
        {
          id: 'gemini-3-pro-image-preview',
          label: 'Nano Banana Pro (GPTsAPI)',
          vendor: 'google',
          supportsEdit: true,
          editImagesKey: 'images',
          paramKey: 'output_format',
          paramValues: ['png'],
          defaultParam: 'png',
        },
      ],
    },
  ],
};

describe('resolveImageProviders', () => {
  beforeEach(() => {
    process.env.TEST_OPENROUTER_KEY = 'or-secret';
    process.env.TEST_GPTSAPI_KEY = 'gpts-secret';
  });

  test('resolves env vars in apiKey/baseURL for each provider', () => {
    const resolved = resolveImageProviders(config);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].runtimeConfig).toEqual({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'or-secret',
    });
    expect(resolved[1].runtimeConfig.apiKey).toBe('gpts-secret');
  });

  test('returns an empty array when imageGeneration is undefined', () => {
    expect(resolveImageProviders(undefined)).toEqual([]);
  });
});

describe('findProvider', () => {
  test('throws for an unknown provider name', () => {
    const providers = resolveImageProviders(config);
    expect(() => findProvider(providers, 'Nope')).toThrow('Unknown image provider: Nope');
  });
});

describe('generateImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TEST_OPENROUTER_KEY = 'or-secret';
    process.env.TEST_GPTSAPI_KEY = 'gpts-secret';
  });

  test('dispatches to the openrouter adapter for an openrouter provider', async () => {
    openrouterAdapter.generate.mockResolvedValue({ status: 'completed', imageB64: 'X' });
    const providers = resolveImageProviders(config);
    const result = await generateImage(providers, {
      providerName: 'OpenRouter',
      modelId: 'google/gemini-3-pro-image',
      prompt: 'a cat',
      aspectRatio: '1:1',
      paramValue: 'png',
    });
    expect(result).toEqual({ status: 'completed', imageB64: 'X' });
    expect(openrouterAdapter.generate).toHaveBeenCalledTimes(1);
    expect(gptsapiAdapter.generate).not.toHaveBeenCalled();
  });

  test('dispatches to the gptsapi adapter for a gptsapi provider', async () => {
    gptsapiAdapter.generate.mockResolvedValue({ status: 'pending', jobId: 'p1' });
    const providers = resolveImageProviders(config);
    const result = await generateImage(providers, {
      providerName: 'GPTsAPI',
      modelId: 'gemini-3-pro-image-preview',
      prompt: 'a cat',
      aspectRatio: '1:1',
      paramValue: 'png',
    });
    expect(result).toEqual({ status: 'pending', jobId: 'p1' });
    expect(gptsapiAdapter.generate).toHaveBeenCalledTimes(1);
  });

  test('throws for an unknown provider name', async () => {
    const providers = resolveImageProviders(config);
    await expect(
      generateImage(providers, {
        providerName: 'Nope',
        modelId: 'x',
        prompt: 'x',
        aspectRatio: '1:1',
        paramValue: 'png',
      }),
    ).rejects.toThrow('Unknown image provider: Nope');
  });

  test('throws for an unknown model id within a known provider', async () => {
    const providers = resolveImageProviders(config);
    await expect(
      generateImage(providers, {
        providerName: 'OpenRouter',
        modelId: 'not-a-real-model',
        prompt: 'x',
        aspectRatio: '1:1',
        paramValue: 'png',
      }),
    ).rejects.toThrow('Unknown image model "not-a-real-model" for provider "OpenRouter"');
  });
});

describe('pollImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TEST_GPTSAPI_KEY = 'gpts-secret';
  });

  test('dispatches to gptsapi.poll for a gptsapi-predictions provider', async () => {
    gptsapiAdapter.poll.mockResolvedValue({ status: 'completed', imageUrl: 'https://x' });
    const providers = resolveImageProviders(config);
    const result = await pollImage(providers, 'GPTsAPI', 'job-1');
    expect(result).toEqual({ status: 'completed', imageUrl: 'https://x' });
  });

  test('throws when polling an openrouter (synchronous) provider', async () => {
    const providers = resolveImageProviders(config);
    await expect(pollImage(providers, 'OpenRouter', 'job-1')).rejects.toThrow(
      'Provider "OpenRouter" does not support polling',
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && npx jest src/images/providers/registry.spec.ts`
Expected: FAIL — `Cannot find module './registry'`。

- [ ] **Step 3: 实现 `registry.ts`**

```ts
// packages/api/src/images/providers/registry.ts
import { extractEnvVariable } from 'librechat-data-provider';
import type { TImageGenerationConfig, TImageProviderConfig } from 'librechat-data-provider';
import * as openrouter from './openrouter';
import * as gptsapi from './gptsapi';
import type { GenerationOutcome, ImageProviderRuntimeConfig } from './types';

export interface ResolvedImageProvider {
  name: string;
  runtimeConfig: ImageProviderRuntimeConfig;
  config: TImageProviderConfig;
}

export function resolveImageProviders(
  imageGeneration: TImageGenerationConfig | undefined,
): ResolvedImageProvider[] {
  if (!imageGeneration?.providers?.length) {
    return [];
  }
  return imageGeneration.providers.map((config) => ({
    name: config.name,
    runtimeConfig: {
      baseUrl: extractEnvVariable(config.baseURL),
      apiKey: extractEnvVariable(config.apiKey),
    },
    config,
  }));
}

export function findProvider(
  providers: ResolvedImageProvider[],
  name: string,
): ResolvedImageProvider {
  const provider = providers.find((p) => p.name === name);
  if (!provider) {
    throw new Error(`Unknown image provider: ${name}`);
  }
  return provider;
}

export interface GenerateImageArgs {
  providerName: string;
  modelId: string;
  prompt: string;
  aspectRatio: string;
  paramValue: string;
  imageUrls?: string[];
}

export async function generateImage(
  providers: ResolvedImageProvider[],
  args: GenerateImageArgs,
): Promise<GenerationOutcome> {
  const provider = findProvider(providers, args.providerName);
  const shared = {
    prompt: args.prompt,
    aspectRatio: args.aspectRatio,
    paramValue: args.paramValue,
    imageUrls: args.imageUrls,
  };
  if (provider.config.protocol === 'openrouter') {
    const model = provider.config.models.find((m) => m.id === args.modelId);
    if (!model) {
      throw new Error(`Unknown image model "${args.modelId}" for provider "${args.providerName}"`);
    }
    return openrouter.generate({ model, ...shared }, provider.runtimeConfig);
  }
  const model = provider.config.models.find((m) => m.id === args.modelId);
  if (!model) {
    throw new Error(`Unknown image model "${args.modelId}" for provider "${args.providerName}"`);
  }
  return gptsapi.generate({ model, ...shared }, provider.runtimeConfig);
}

export async function pollImage(
  providers: ResolvedImageProvider[],
  providerName: string,
  jobId: string,
): Promise<GenerationOutcome> {
  const provider = findProvider(providers, providerName);
  if (provider.config.protocol !== 'gptsapi-predictions') {
    throw new Error(`Provider "${providerName}" does not support polling`);
  }
  return gptsapi.poll(jobId, provider.runtimeConfig);
}
```

**注意类型收窄细节:** `provider.config.protocol === 'openrouter'` 这个判断必须直接写在 `provider.config` 上(而不是拆出一个单独的 `protocol` 变量再判断),TypeScript 才能把 `provider.config.models` 正确收窄成 `TOpenRouterImageModel[]`。如果把 `protocol` 提到 `ResolvedImageProvider` 顶层字段单独存一份,判断这个顶层字段不会让 `provider.config.models` 的类型跟着收窄,会导致类型错误或需要不安全的类型断言——不要那样做。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/api && npx jest src/images/providers/registry.spec.ts`
Expected: PASS(9 个 test 绿)。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/images/providers/registry.ts packages/api/src/images/providers/registry.spec.ts
git commit -m "feat(api/images): add provider config resolution and dispatch registry"
```

---

### Task 6: `models.ts` 重写(从硬编码数组改为读取 provider 配置)

**Files:**
- Modify: `packages/api/src/images/models.ts`(整体重写,删除 `IMAGE_MODELS`/`ASPECT_RATIOS`/`DEFAULT_IMAGE_MODEL_ID`/`getImageModel`)
- Modify: `packages/api/src/images/models.spec.ts`(整体重写)

**Interfaces:**
- Consumes: `ResolvedImageProvider`(Task 5)、`TImageModel`(Task 1,来自 `librechat-data-provider`)
- Produces: `getImageModels(providers): TImageModel[]`、`getDefaultImageModel(providers): TImageModel | undefined`、`getAspectRatios(providers): string[]`、`findImageModel(providers, providerName, modelId): TImageModel`(未找到抛错,供 Task 7 的 `service.ts` 校验用)

- [ ] **Step 1: 写失败的 `models.spec.ts`(整体替换旧内容)**

```ts
// packages/api/src/images/models.spec.ts
import type { TImageGenerationConfig } from 'librechat-data-provider';
import { getImageModels, getDefaultImageModel, getAspectRatios, findImageModel } from './models';
import { resolveImageProviders } from './providers/registry';

const config: TImageGenerationConfig = {
  providers: [
    {
      name: 'OpenRouter',
      protocol: 'openrouter',
      apiKey: 'k1',
      baseURL: 'https://openrouter.ai/api/v1',
      aspectRatios: ['auto', '1:1', '16:9'],
      models: [
        {
          id: 'google/gemini-3-pro-image',
          label: 'Nano Banana Pro',
          isDefault: true,
          supportsEdit: true,
          paramKey: 'output_format',
          paramValues: ['png', 'jpeg'],
          defaultParam: 'png',
        },
      ],
    },
    {
      name: 'GPTsAPI',
      protocol: 'gptsapi-predictions',
      apiKey: 'k2',
      baseURL: 'https://api.gptsapi.net',
      aspectRatios: ['1:1', '9:16'],
      models: [
        {
          id: 'gpt-image-2',
          label: 'GPT Image 2',
          vendor: 'openai',
          supportsEdit: true,
          editImagesKey: 'input_urls',
          paramKey: 'resolution',
          paramValues: ['1K', '2K', '4K'],
          defaultParam: '1K',
        },
      ],
    },
  ],
};

const providers = resolveImageProviders(config);

describe('getImageModels', () => {
  test('flattens models across providers, tagging each with its provider name', () => {
    const models = getImageModels(providers);
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({ id: 'google/gemini-3-pro-image', provider: 'OpenRouter' });
    expect(models[1]).toMatchObject({ id: 'gpt-image-2', provider: 'GPTsAPI' });
  });
});

describe('getDefaultImageModel', () => {
  test('returns the model flagged isDefault', () => {
    const model = getDefaultImageModel(providers);
    expect(model).toMatchObject({ id: 'google/gemini-3-pro-image', provider: 'OpenRouter' });
  });

  test('falls back to the first model when none is flagged default', () => {
    const noDefaultConfig: TImageGenerationConfig = { providers: [config.providers[1]] };
    const model = getDefaultImageModel(resolveImageProviders(noDefaultConfig));
    expect(model).toMatchObject({ id: 'gpt-image-2' });
  });
});

describe('getAspectRatios', () => {
  test('unions aspect ratios across all providers', () => {
    expect(getAspectRatios(providers).sort()).toEqual(['1:1', '16:9', '9:16', 'auto'].sort());
  });
});

describe('findImageModel', () => {
  test('finds a model by provider + id', () => {
    expect(findImageModel(providers, 'GPTsAPI', 'gpt-image-2').label).toBe('GPT Image 2');
  });

  test('throws for an unknown provider/model combination', () => {
    expect(() => findImageModel(providers, 'GPTsAPI', 'nope')).toThrow(
      'Unknown image model "nope" for provider "GPTsAPI"',
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && npx jest src/images/models.spec.ts`
Expected: FAIL — `getImageModels`/`getDefaultImageModel`/`getAspectRatios`/`findImageModel` 都还不存在(旧的 `models.ts` 导出的是 `IMAGE_MODELS`/`getImageModel` 等不同的名字)。

- [ ] **Step 3: 重写 `models.ts`**

```ts
// packages/api/src/images/models.ts
import type { TImageModel } from 'librechat-data-provider';
import type { ResolvedImageProvider } from './providers/registry';

export function getImageModels(providers: ResolvedImageProvider[]): TImageModel[] {
  const models: TImageModel[] = [];
  for (const provider of providers) {
    for (const model of provider.config.models) {
      models.push({
        id: model.id,
        label: model.label,
        provider: provider.name,
        supportsEdit: model.supportsEdit,
        paramKey: model.paramKey,
        paramValues: model.paramValues,
        defaultParam: model.defaultParam,
      });
    }
  }
  return models;
}

export function getDefaultImageModel(providers: ResolvedImageProvider[]): TImageModel | undefined {
  const models = getImageModels(providers);
  for (const provider of providers) {
    const defaultModel = provider.config.models.find((model) => model.isDefault);
    if (defaultModel) {
      return models.find((m) => m.id === defaultModel.id && m.provider === provider.name);
    }
  }
  return models[0];
}

export function getAspectRatios(providers: ResolvedImageProvider[]): string[] {
  const all = new Set<string>();
  for (const provider of providers) {
    for (const ratio of provider.config.aspectRatios) {
      all.add(ratio);
    }
  }
  return Array.from(all);
}

export function findImageModel(
  providers: ResolvedImageProvider[],
  providerName: string,
  modelId: string,
): TImageModel {
  const model = getImageModels(providers).find(
    (m) => m.provider === providerName && m.id === modelId,
  );
  if (!model) {
    throw new Error(`Unknown image model "${modelId}" for provider "${providerName}"`);
  }
  return model;
}
```

删除旧文件里的 `IMAGE_MODELS`、`ASPECT_RATIOS`(如果 `ASPECT_RATIOS` 独立定义在这个文件——按当前代码它是,一并删除)、`DEFAULT_IMAGE_MODEL_ID`、`getImageModel`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/api && npx jest src/images/models.spec.ts`
Expected: PASS(6 个 test 绿)。这一步之后 `packages/api/src/images/service.ts` 和 `api/server/routes/images.js` 仍在 import 旧的 `IMAGE_MODELS`/`getImageModel`/`ASPECT_RATIOS`/`DEFAULT_IMAGE_MODEL_ID`,会编译失败——这是预期的中间状态,Task 7、8 会修复。**这一步先只跑 `models.spec.ts` 这一个文件,不要跑整个 `packages/api` 测试套件**(会因为 service.ts 还没改而报一堆无关失败)。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/images/models.ts packages/api/src/images/models.spec.ts
git commit -m "refactor(api/images): derive image models from resolved provider config"
```

---

### Task 7: `service.ts` 重构(双路径:同步立即完成 / 异步 pending+poll)+ 删除旧 `client.ts`

**Files:**
- Modify: `packages/api/src/images/service.ts`(重写 `submitGeneration`/`resolveResult`)
- Modify: `packages/api/src/images/service.spec.ts`(重写)
- Modify: `packages/api/src/images/index.ts`(barrel export 调整)
- Delete: `packages/api/src/images/client.ts`
- Delete: `packages/api/src/images/client.spec.ts`

**Interfaces:**
- Consumes: `findImageModel`(Task 6)、`resolveImageProviders`/`findProvider`/`generateImage`/`pollImage`(Task 5)、`GenerationOutcome`(Task 3)
- Produces:
  - `SubmitGenerationArgs { providerName; model; prompt; aspectRatio; param?; imageUrls? }`
  - `SubmitGenerationResult = { status: 'pending'; predictionId: string } | { status: 'completed'; predictionId: string; file: IMongoFile }`
  - `submitGeneration(args, providers, deps, userId): Promise<SubmitGenerationResult>`
  - `ResolveResultArgs { predictionId; userId; providerName; model; prompt }`
  - `resolveResult(args, deps, providers): Promise<{ status: string; file?: IMongoFile; error?: string }>`
  - `ImageDeps` 新增字段 `fetchImageFromB64: (b64: string, mediaType?: string) => Promise<{ buffer: Buffer; contentType: string; width?: number; height?: number }>`

- [ ] **Step 1: 写失败的 `service.spec.ts`(整体替换旧内容)**

```ts
// packages/api/src/images/service.spec.ts
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { TImageGenerationConfig } from 'librechat-data-provider';
import { submitGeneration, resolveResult } from './service';
import type { ImageDeps } from './service';
import { resolveImageProviders } from './providers/registry';

jest.mock('./providers/openrouter');
jest.mock('./providers/gptsapi');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const openrouterAdapter = require('./providers/openrouter');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gptsapiAdapter = require('./providers/gptsapi');

const testConfig: TImageGenerationConfig = {
  providers: [
    {
      name: 'OpenRouter',
      protocol: 'openrouter',
      apiKey: 'or-key',
      baseURL: 'https://openrouter.ai/api/v1',
      aspectRatios: ['1:1', '16:9'],
      models: [
        {
          id: 'google/gemini-3-pro-image',
          label: 'Nano Banana Pro',
          isDefault: true,
          supportsEdit: true,
          paramKey: 'output_format',
          paramValues: ['png', 'jpeg'],
          defaultParam: 'png',
        },
      ],
    },
    {
      name: 'GPTsAPI',
      protocol: 'gptsapi-predictions',
      apiKey: 'gpts-key',
      baseURL: 'https://api.gptsapi.net',
      aspectRatios: ['1:1', '16:9'],
      models: [
        {
          id: 'gpt-image-2',
          label: 'GPT Image 2',
          vendor: 'openai',
          supportsEdit: true,
          editImagesKey: 'input_urls',
          paramKey: 'resolution',
          paramValues: ['1K', '2K', '4K'],
          defaultParam: '1K',
        },
      ],
    },
  ],
};

const providers = resolveImageProviders(testConfig);

let mongoServer: MongoMemoryServer;

function buildDeps(): ImageDeps {
  const methods = createMethods(mongoose);
  const fetchImage = jest.fn();
  const fetchImageFromB64 = jest.fn();
  const saveImageFile = jest.fn();
  return {
    fetchImage,
    fetchImageFromB64,
    saveImageFile,
    createFileRecord: (doc) =>
      methods.createFile(doc as Parameters<typeof methods.createFile>[0], true) as ReturnType<
        ImageDeps['createFileRecord']
      >,
    findFileByPrediction: async (userId, predictionId) => {
      const files = await methods.getFiles(
        { user: userId, 'metadata.imageGen.predictionId': predictionId },
        {},
        {},
      );
      return files && files.length > 0 ? files[0] : null;
    },
  };
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  for (const modelName of Object.keys(mongoose.models)) {
    await mongoose.models[modelName].ensureIndexes();
  }
  jest.clearAllMocks();
});

const userId = () => new mongoose.Types.ObjectId().toString();

// ---------------------------------------------------------------------------
// submitGeneration
// ---------------------------------------------------------------------------

describe('submitGeneration', () => {
  test('unknown provider/model throws', async () => {
    const deps = buildDeps();
    await expect(
      submitGeneration(
        { providerName: 'Nope', model: 'bad', prompt: 'hi', aspectRatio: '1:1' },
        providers,
        deps,
        userId(),
      ),
    ).rejects.toThrow('Unknown image model "bad" for provider "Nope"');
  });

  test('empty prompt throws', async () => {
    const deps = buildDeps();
    await expect(
      submitGeneration(
        {
          providerName: 'OpenRouter',
          model: 'google/gemini-3-pro-image',
          prompt: '  ',
          aspectRatio: '1:1',
        },
        providers,
        deps,
        userId(),
      ),
    ).rejects.toThrow('prompt is required');
  });

  test('invalid aspect ratio throws', async () => {
    const deps = buildDeps();
    await expect(
      submitGeneration(
        {
          providerName: 'OpenRouter',
          model: 'google/gemini-3-pro-image',
          prompt: 'a cat',
          aspectRatio: 'bad-ratio',
        },
        providers,
        deps,
        userId(),
      ),
    ).rejects.toThrow('invalid aspect_ratio: bad-ratio');
  });

  test('gpt-image-2 with 4K + 1:1 throws', async () => {
    const deps = buildDeps();
    await expect(
      submitGeneration(
        {
          providerName: 'GPTsAPI',
          model: 'gpt-image-2',
          prompt: 'a cat',
          aspectRatio: '1:1',
          param: '4K',
        },
        providers,
        deps,
        userId(),
      ),
    ).rejects.toThrow('1:1 cannot be 4K');
  });

  test('openrouter (synchronous) provider downloads from base64 and returns completed immediately', async () => {
    openrouterAdapter.generate.mockResolvedValue({
      status: 'completed',
      imageB64: 'BASE64DATA',
      mediaType: 'image/png',
    });
    const deps = buildDeps();
    (deps.fetchImageFromB64 as jest.Mock).mockResolvedValueOnce({
      buffer: Buffer.from('fake-image'),
      contentType: 'image/png',
      width: 1024,
      height: 1024,
    });
    (deps.saveImageFile as jest.Mock).mockResolvedValueOnce({
      filepath: '/storage/out.png',
      source: 'r2',
      bytes: 10,
      filename: 'out.png',
      storageMetadata: { storageKey: 'gen/out.png', storageRegion: 'auto' },
    });

    const uid = userId();
    const result = await submitGeneration(
      {
        providerName: 'OpenRouter',
        model: 'google/gemini-3-pro-image',
        prompt: 'a cat',
        aspectRatio: '1:1',
      },
      providers,
      deps,
      uid,
    );

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') {
      throw new Error('expected completed result');
    }
    expect(result.file.context).toBe('image_generation');
    expect(result.file.metadata?.imageGen?.prompt).toBe('a cat');
    expect(deps.fetchImageFromB64).toHaveBeenCalledWith('BASE64DATA', 'image/png');
    expect(deps.fetchImage).not.toHaveBeenCalled();
  });

  test('gptsapi (asynchronous) provider returns pending with jobId, does not touch storage', async () => {
    gptsapiAdapter.generate.mockResolvedValue({ status: 'pending', jobId: 'pred-123' });
    const deps = buildDeps();
    const result = await submitGeneration(
      {
        providerName: 'GPTsAPI',
        model: 'gpt-image-2',
        prompt: 'a cat',
        aspectRatio: '1:1',
      },
      providers,
      deps,
      userId(),
    );
    expect(result).toEqual({ status: 'pending', predictionId: 'pred-123' });
    expect(deps.fetchImage).not.toHaveBeenCalled();
    expect(deps.saveImageFile).not.toHaveBeenCalled();
  });

  test('adapter failure status throws', async () => {
    gptsapiAdapter.generate.mockResolvedValue({ status: 'failed', error: 'quota exceeded' });
    const deps = buildDeps();
    await expect(
      submitGeneration(
        { providerName: 'GPTsAPI', model: 'gpt-image-2', prompt: 'a cat', aspectRatio: '1:1' },
        providers,
        deps,
        userId(),
      ),
    ).rejects.toThrow('quota exceeded');
  });
});

// ---------------------------------------------------------------------------
// resolveResult
// ---------------------------------------------------------------------------

describe('resolveResult', () => {
  test('processing status returns { status: "processing" } with no File created', async () => {
    gptsapiAdapter.poll.mockResolvedValue({ status: 'pending', jobId: 'pred-proc' });
    const deps = buildDeps();
    const result = await resolveResult(
      {
        predictionId: 'pred-proc',
        userId: userId(),
        providerName: 'GPTsAPI',
        model: 'gpt-image-2',
        prompt: 'a cat',
      },
      deps,
      providers,
    );
    expect(result).toEqual({ status: 'processing' });
    expect(deps.fetchImage).not.toHaveBeenCalled();
  });

  test('completed status downloads image and creates File with correct fields', async () => {
    gptsapiAdapter.poll.mockResolvedValue({
      status: 'completed',
      imageUrl: 'http://result.example.com/out.png',
    });
    const deps = buildDeps();
    (deps.fetchImage as jest.Mock).mockResolvedValueOnce({
      buffer: Buffer.from('fake-image'),
      contentType: 'image/png',
      width: 1024,
      height: 1024,
    });
    (deps.saveImageFile as jest.Mock).mockResolvedValueOnce({
      filepath: '/storage/out.png',
      source: 'r2',
      bytes: 10,
      filename: 'out.png',
      storageMetadata: { storageKey: 'gen/out.png', storageRegion: 'auto' },
    });

    const uid = userId();
    const result = await resolveResult(
      {
        predictionId: 'pred-resolve-001',
        userId: uid,
        providerName: 'GPTsAPI',
        model: 'gpt-image-2',
        prompt: 'a cat',
      },
      deps,
      providers,
    );

    expect(result.status).toBe('completed');
    expect(result.file!.context).toBe('image_generation');
    expect(result.file!.model).toBe('gpt-image-2');
    expect(result.file!.metadata?.imageGen?.prompt).toBe('a cat');
    expect(result.file!.metadata?.imageGen?.predictionId).toBe('pred-resolve-001');
    expect(deps.fetchImage).toHaveBeenCalledWith('http://result.example.com/out.png');
  });

  test('failed status returns { status: "failed", error } instead of throwing', async () => {
    gptsapiAdapter.poll.mockResolvedValue({ status: 'failed', error: 'out of memory' });
    const deps = buildDeps();
    const result = await resolveResult(
      {
        predictionId: 'pred-fail',
        userId: userId(),
        providerName: 'GPTsAPI',
        model: 'gpt-image-2',
        prompt: 'x',
      },
      deps,
      providers,
    );
    expect(result).toEqual({ status: 'failed', error: 'out of memory' });
    expect(deps.fetchImage).not.toHaveBeenCalled();
  });

  test('idempotent: second call with same predictionId returns existing File without duplicate', async () => {
    gptsapiAdapter.poll.mockResolvedValue({
      status: 'completed',
      imageUrl: 'http://result.example.com/out.png',
    });
    const deps = buildDeps();
    (deps.fetchImage as jest.Mock).mockResolvedValueOnce({
      buffer: Buffer.from('fake-image'),
      contentType: 'image/png',
      width: 512,
      height: 512,
    });
    (deps.saveImageFile as jest.Mock).mockResolvedValueOnce({
      filepath: '/storage/idem.png',
      source: 'r2',
      bytes: 5,
      filename: 'idem.png',
      storageMetadata: {},
    });

    const uid = userId();
    const pidIdem = 'pred-idempotent-001';
    const args = {
      predictionId: pidIdem,
      userId: uid,
      providerName: 'GPTsAPI',
      model: 'gpt-image-2',
      prompt: 'dog',
    };
    const first = await resolveResult(args, deps, providers);
    expect(first.status).toBe('completed');

    const second = await resolveResult(args, deps, providers);
    expect(second.status).toBe('completed');
    expect(gptsapiAdapter.poll).toHaveBeenCalledTimes(1);
    expect(deps.fetchImage).toHaveBeenCalledTimes(1);

    const methods = createMethods(mongoose);
    const files = await methods.getFiles({ 'metadata.imageGen.predictionId': pidIdem }, {}, {});
    expect(files?.length).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && LD_LIBRARY_PATH="$HOME/.local/ssl1.1/usr/lib/x86_64-linux-gnu" MONGOMS_VERSION=4.4.18 npx jest src/images/service.spec.ts`
Expected: FAIL — `submitGeneration`/`resolveResult` 签名不匹配(旧实现只接受 `(args, cfg)`,新测试传的是 `(args, providers, deps, userId)`/`(args, deps, providers)`)。

- [ ] **Step 3: 重写 `service.ts`**

```ts
// packages/api/src/images/service.ts
import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { findImageModel } from './models';
import { findProvider, generateImage, pollImage } from './providers/registry';
import type { ResolvedImageProvider } from './providers/registry';
import type { GenerationOutcome } from './providers/types';
import type { IMongoFile } from '@librechat/data-schemas';

export interface ImageDeps {
  fetchImage: (
    url: string,
  ) => Promise<{ buffer: Buffer; contentType: string; width?: number; height?: number }>;
  fetchImageFromB64: (
    b64: string,
    mediaType?: string,
  ) => Promise<{ buffer: Buffer; contentType: string; width?: number; height?: number }>;
  saveImageFile: (a: { userId: string; buffer: Buffer; contentType: string }) => Promise<{
    filepath: string;
    source: string;
    bytes: number;
    filename: string;
    storageMetadata: Record<string, unknown>;
  }>;
  createFileRecord: (doc: Partial<IMongoFile>) => Promise<IMongoFile | null>;
  findFileByPrediction: (userId: string, predictionId: string) => Promise<IMongoFile | null>;
}

export interface SubmitGenerationArgs {
  providerName: string;
  model: string;
  prompt: string;
  aspectRatio: string;
  param?: string;
  imageUrls?: string[];
}

export type SubmitGenerationResult =
  | { status: 'pending'; predictionId: string }
  | { status: 'completed'; predictionId: string; file: IMongoFile };

async function downloadAndSaveOutcome(
  outcome: Extract<GenerationOutcome, { status: 'completed' }>,
  meta: { userId: string; model: string; prompt: string; predictionId: string },
  deps: ImageDeps,
): Promise<IMongoFile> {
  const img = outcome.imageB64
    ? await deps.fetchImageFromB64(outcome.imageB64, outcome.mediaType)
    : await deps.fetchImage(outcome.imageUrl as string);
  const saved = await deps.saveImageFile({
    userId: meta.userId,
    buffer: img.buffer,
    contentType: img.contentType,
  });
  const storageExtra = saved.storageMetadata as { storageKey?: string; storageRegion?: string };
  const file = await deps.createFileRecord({
    user: new Types.ObjectId(meta.userId),
    file_id: uuidv4(),
    context: 'image_generation',
    model: meta.model,
    source: saved.source,
    filepath: saved.filepath,
    filename: saved.filename,
    bytes: saved.bytes,
    type: img.contentType,
    width: img.width,
    height: img.height,
    storageKey: storageExtra.storageKey,
    storageRegion: storageExtra.storageRegion,
    metadata: { imageGen: { prompt: meta.prompt, predictionId: meta.predictionId } },
  });
  if (!file) {
    throw new Error('failed to persist generated image');
  }
  return file;
}

export async function submitGeneration(
  args: SubmitGenerationArgs,
  providers: ResolvedImageProvider[],
  deps: ImageDeps,
  userId: string,
): Promise<SubmitGenerationResult> {
  // TODO(gating): checkBillingAccess(featureFlag: 'image_gen')
  const model = findImageModel(providers, args.providerName, args.model);
  const provider = findProvider(providers, args.providerName);
  const prompt = (args.prompt ?? '').trim();
  if (!prompt) {
    throw new Error('prompt is required');
  }
  if (prompt.length > 20000) {
    throw new Error('prompt too long');
  }
  if (!provider.config.aspectRatios.includes(args.aspectRatio)) {
    throw new Error(`invalid aspect_ratio: ${args.aspectRatio}`);
  }
  const paramValue = args.param ?? model.defaultParam;
  if (!model.paramValues.includes(paramValue)) {
    throw new Error(`invalid ${model.paramKey}: ${paramValue}`);
  }
  if (model.paramKey === 'resolution') {
    if (paramValue === '4K' && args.aspectRatio === '1:1') {
      throw new Error('1:1 cannot be 4K');
    }
    if (args.aspectRatio === 'auto' && paramValue !== '1K') {
      throw new Error('auto aspect_ratio supports only 1K');
    }
  }
  const imageUrls = args.imageUrls?.filter(Boolean) ?? [];
  if (imageUrls.length > 0 && !model.supportsEdit) {
    throw new Error(`${model.id} does not support image edit`);
  }
  const outcome = await generateImage(providers, {
    providerName: args.providerName,
    modelId: args.model,
    prompt,
    aspectRatio: args.aspectRatio,
    paramValue,
    imageUrls: imageUrls.length ? imageUrls : undefined,
  });
  if (outcome.status === 'failed') {
    throw new Error(outcome.error);
  }
  if (outcome.status === 'pending') {
    return { status: 'pending', predictionId: outcome.jobId };
  }
  const predictionId = uuidv4();
  const file = await downloadAndSaveOutcome(
    outcome,
    { userId, model: args.model, prompt, predictionId },
    deps,
  );
  return { status: 'completed', predictionId, file };
}

export interface ResolveResultArgs {
  predictionId: string;
  userId: string;
  providerName: string;
  model: string;
  prompt: string;
}

export async function resolveResult(
  args: ResolveResultArgs,
  deps: ImageDeps,
  providers: ResolvedImageProvider[],
): Promise<{ status: string; file?: IMongoFile; error?: string }> {
  const existing = await deps.findFileByPrediction(args.userId, args.predictionId);
  if (existing) {
    return { status: 'completed', file: existing };
  }
  const outcome = await pollImage(providers, args.providerName, args.predictionId);
  if (outcome.status === 'pending') {
    return { status: 'processing' };
  }
  if (outcome.status === 'failed') {
    return { status: 'failed', error: outcome.error };
  }
  const file = await downloadAndSaveOutcome(
    outcome,
    { userId: args.userId, model: args.model, prompt: args.prompt, predictionId: args.predictionId },
    deps,
  );
  return { status: 'completed', file };
}
```

- [ ] **Step 4: 删除旧的 `client.ts`/`client.spec.ts`**

```bash
git rm packages/api/src/images/client.ts packages/api/src/images/client.spec.ts
```

- [ ] **Step 5: 更新 barrel export**

打开 `packages/api/src/images/index.ts`,把:

```ts
export * from './models';
export * from './client';
export * from './service';
```

改成:

```ts
export * from './models';
export * from './service';
export * from './providers/types';
export * from './providers/registry';
```

(不导出 `./providers/openrouter`、`./providers/gptsapi` 这两个具体实现——外部只应该通过 `registry.ts` 的 `generateImage`/`pollImage` 使用它们,不直接导入具体 adapter。)

- [ ] **Step 6: 跑测试确认通过**

Run: `cd packages/api && LD_LIBRARY_PATH="$HOME/.local/ssl1.1/usr/lib/x86_64-linux-gnu" MONGOMS_VERSION=4.4.18 npx jest src/images/service.spec.ts`
Expected: PASS(10 个 test 绿)。

- [ ] **Step 7: 跑 `packages/api` 全量测试,确认 barrel export 改动没有破坏其它消费方**

Run: `cd packages/api && LD_LIBRARY_PATH="$HOME/.local/ssl1.1/usr/lib/x86_64-linux-gnu" MONGOMS_VERSION=4.4.18 npx jest`
Expected: FAIL — `api/server/routes/images.js` 还在用旧的 `IMAGE_MODELS`/`getImageModel`/`ASPECT_RATIOS`/`DEFAULT_IMAGE_MODEL_ID`/`cfg()` 单一配置调用 `submitGeneration`/`resolveResult`,这些导出已经不存在/签名已变——`packages/api` 自身的测试应该全绿,但如果这一步跑到了 `api/` 目录下依赖 `@librechat/api` 构建产物的测试会报错,是预期的,Task 8 会修复。**只需确认 `packages/api/src/images/**` 下的所有 `*.spec.ts` 全绿即可**,不需要在这里跑 `api/` 目录的测试。

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/images/service.ts packages/api/src/images/service.spec.ts packages/api/src/images/index.ts
git commit -m "refactor(api/images): route submitGeneration/resolveResult through provider registry"
```

---

### Task 8: 路由接线(`api/server/routes/images.js`)

**Files:**
- Modify: `api/server/routes/images.js`
- Modify: `api/server/routes/__tests__/images.spec.js`

**Interfaces:**
- Consumes: `submitGeneration`/`resolveResult`(Task 7 新签名)、`resolveImageProviders`/`getImageModels`/`getDefaultImageModel`/`getAspectRatios`(Task 5、6,经 `@librechat/api` barrel export)
- Produces: `GET /api/images/models` 返回 `{ models, default, aspectRatios }`(`models` 每项带 `provider` 字段);`POST /api/images/generate` 请求体新增 `provider` 字段,响应不变(`{ predictionId }`);`GET /api/images/result/:id` 行为不变

- [ ] **Step 1: 写失败的测试(重写 `images.spec.js` 里依赖旧常量/签名的部分)**

打开 `api/server/routes/__tests__/images.spec.js`,把顶部的 `getAppConfig` mock 从静态工厂改成可配置的 `jest.fn()`,并新增一份测试用的 `imageGeneration` config fixture。把:

```js
// --- mock app config ---
jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(async () => ({ fileStrategy: 'local' })),
}));
```

改成:

```js
// --- mock app config ---
const TEST_IMAGE_GENERATION_CONFIG = {
  providers: [
    {
      name: 'GPTsAPI',
      protocol: 'gptsapi-predictions',
      apiKey: 'test-gptsapi-key',
      baseURL: 'https://api.gptsapi.net',
      aspectRatios: ['auto', '1:1', '9:16', '16:9', '4:3', '3:4'],
      models: [
        {
          id: 'gemini-3-pro-image-preview',
          label: 'Nano Banana Pro',
          isDefault: true,
          vendor: 'google',
          supportsEdit: true,
          editImagesKey: 'images',
          paramKey: 'output_format',
          paramValues: ['png', 'jpeg'],
          defaultParam: 'png',
        },
      ],
    },
  ],
};

const mockGetAppConfig = jest.fn(async () => ({
  fileStrategy: 'local',
  imageGeneration: TEST_IMAGE_GENERATION_CONFIG,
}));
jest.mock('~/server/services/Config', () => ({
  getAppConfig: (...args) => mockGetAppConfig(...args),
}));
```

紧接着,把顶部这一段:

```js
const actualApi = jest.requireActual('@librechat/api');
const mockSubmitGeneration = jest.fn((...args) => actualApi.submitGeneration(...args));
const mockResolveResult = jest.fn((...args) => actualApi.resolveResult(...args));
```

保持不变(这两个 mock 的调用方式不变,只是底层 `actualApi.submitGeneration`/`resolveResult` 的签名已经变了,调用处会自动跟着变,不需要改这两行本身)。

然后把 `describe('GET /api/images/models', ...)` 整块改成:

```js
describe('GET /api/images/models', () => {
  it('returns model list (tagged with provider), default, and aspect ratios', async () => {
    const { app } = createApp();
    const res = await request(app).get('/api/images/models');

    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([
      expect.objectContaining({ id: 'gemini-3-pro-image-preview', provider: 'GPTsAPI' }),
    ]);
    expect(res.body.default).toBe('gemini-3-pro-image-preview');
    expect(res.body.aspectRatios).toEqual(
      expect.arrayContaining(['auto', '1:1', '9:16', '16:9', '4:3', '3:4']),
    );
  });
});
```

在 `describe('POST /api/images/generate', ...)` 块里,把三个 `it` 分别改成:

```js
describe('POST /api/images/generate', () => {
  it('calls submitGeneration and caches ctx, returns predictionId', async () => {
    mockSubmitGeneration.mockResolvedValue({ status: 'pending', predictionId: 'pred-abc' });

    const { app, user } = createApp();
    const res = await request(app)
      .post('/api/images/generate')
      .send({
        prompt: 'a sunset',
        model: 'gemini-3-pro-image-preview',
        provider: 'GPTsAPI',
        aspectRatio: '16:9',
      });

    expect(res.status).toBe(200);
    expect(res.body.predictionId).toBe('pred-abc');

    expect(mockSubmitGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ providerName: 'GPTsAPI', prompt: 'a sunset', aspectRatio: '16:9' }),
      expect.any(Array),
      expect.objectContaining({ fetchImage: expect.any(Function) }),
      user.id,
    );

    expect(mockCacheSet).toHaveBeenCalledWith(
      'pred-abc',
      expect.objectContaining({ userId: user.id, provider: 'GPTsAPI', prompt: 'a sunset' }),
      expect.any(Number),
    );
  });

  it('uses default model/provider and 1:1 when not provided', async () => {
    mockSubmitGeneration.mockResolvedValue({ status: 'pending', predictionId: 'pred-def' });

    const { app } = createApp();
    const res = await request(app).post('/api/images/generate').send({ prompt: 'mountains' });

    expect(res.status).toBe(200);
    expect(mockSubmitGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-pro-image-preview',
        providerName: 'GPTsAPI',
        aspectRatio: '1:1',
      }),
      expect.any(Array),
      expect.anything(),
      expect.any(String),
    );
  });

  it('does not write to cache when submitGeneration resolves synchronously (completed)', async () => {
    mockSubmitGeneration.mockResolvedValue({
      status: 'completed',
      predictionId: 'pred-sync-1',
      file: { _id: 'file-1', context: 'image_generation' },
    });

    const { app } = createApp();
    const res = await request(app).post('/api/images/generate').send({ prompt: 'a robot' });

    expect(res.status).toBe(200);
    expect(res.body.predictionId).toBe('pred-sync-1');
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it('returns 400 when submitGeneration throws', async () => {
    mockSubmitGeneration.mockRejectedValue(new Error('prompt is required'));

    const { app } = createApp();
    const res = await request(app)
      .post('/api/images/generate')
      .send({ model: 'gemini-3-pro-image-preview' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('prompt is required');
  });
});
```

在 `describe('GET /api/images/result/:predictionId (handler wiring)', ...)` 块里,把涉及 `mockResolveResult` 调用签名断言的用例改成(其余 403/404 相关用例不变):

```js
  it('returns resolveResult output and deletes cache on completed', async () => {
    const fileRecord = { _id: 'file-1', filepath: '/images/test.png', context: 'image_generation' };
    const { app, user } = createApp();
    mockCacheGet.mockResolvedValue({ userId: user.id, provider: 'GPTsAPI', model: 'm', prompt: 'a sunset' });
    mockResolveResult.mockResolvedValue({ status: 'completed', file: fileRecord });

    const res = await request(app).get('/api/images/result/pred-abc');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.file).toBeDefined();
    expect(mockResolveResult).toHaveBeenCalledWith(
      expect.objectContaining({ predictionId: 'pred-abc', providerName: 'GPTsAPI' }),
      expect.objectContaining({
        fetchImage: expect.any(Function),
        fetchImageFromB64: expect.any(Function),
        saveImageFile: expect.any(Function),
      }),
      expect.any(Array),
    );
    expect(mockCacheDelete).toHaveBeenCalledWith('pred-abc');
  });
```

`'uses fallback model/prompt when ctx is missing from cache'` 这个用例改成断言 `providerName: 'unknown'`:

```js
  it('uses fallback provider/model/prompt when ctx is missing from cache', async () => {
    mockCacheGet.mockResolvedValue(null);
    mockResolveResult.mockResolvedValue({ status: 'processing' });

    const { app } = createApp();
    await request(app).get('/api/images/result/pred-nocache');

    expect(mockResolveResult).toHaveBeenCalledWith(
      expect.objectContaining({ providerName: 'unknown', model: 'unknown', prompt: '' }),
      expect.anything(),
      expect.anything(),
    );
  });
```

在最下面的 `'GET /api/images/result/:predictionId — real completed path (M-1)'` 这个真实端到端 describe 块里,把 `beforeAll`/`afterAll` 改成通过 `mockGetAppConfig` 注入动态 baseURL(而不是 `process.env.GPTSAPI_BASE_URL`):

```js
describe('GET /api/images/result/:predictionId — real completed path (M-1)', () => {
  let server;
  let baseUrl;
  let pngBuffer;

  beforeAll(async () => {
    pngBuffer = await sharp({
      create: { width: 3, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    server = http.createServer((req, res) => {
      if (req.url.endsWith('/result')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            data: { status: 'completed', outputs: [`${baseUrl}/output.png`], error: null },
          }),
        );
        return;
      }
      if (req.url === '/output.png') {
        res.setHeader('Content-Type', 'image/png');
        res.end(pngBuffer);
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('downloads, stores, and persists a File with context image_generation', async () => {
    mockGetAppConfig.mockResolvedValueOnce({
      fileStrategy: 'local',
      imageGeneration: {
        providers: [
          {
            name: 'GPTsAPI',
            protocol: 'gptsapi-predictions',
            apiKey: 'test-key',
            baseURL,
            aspectRatios: ['1:1'],
            models: [
              {
                id: 'flux-1.1-ultra',
                label: 'Flux 1.1 Ultra',
                vendor: 'google',
                supportsEdit: false,
                editImagesKey: 'images',
                paramKey: 'output_format',
                paramValues: ['png'],
                defaultParam: 'png',
              },
            ],
          },
        ],
      },
    });

    const { app, user } = createApp();
    mockCacheGet.mockResolvedValue({
      userId: user.id,
      provider: 'GPTsAPI',
      model: 'flux-1.1-ultra',
      prompt: 'a real sunset',
    });

    const res = await request(app).get('/api/images/result/pred-real-123');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.file).toBeDefined();
    expect(res.body.file.filepath).toMatch(/^\/images\/user-1\//);
    expect(res.body.file.filepath).not.toContain('output.png');

    expect(mockSaveBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ buffer: expect.any(Buffer), fileName: expect.any(String) }),
    );

    const stored = await File.findOne({ user: user.id, context: 'image_generation' }).lean();
    expect(stored).not.toBeNull();
    expect(stored.metadata.imageGen.predictionId).toBe('pred-real-123');
    expect(stored.width).toBe(3);
    expect(stored.height).toBe(2);

    expect(mockCacheDelete).toHaveBeenCalledWith('pred-real-123');
  });
});
```

同时在 top-level `beforeEach` 里加一行,确保每个 test 默认拿到基础 fixture(不受上一条测试里 `mockResolveValueOnce` 覆盖的影响):

```js
beforeEach(async () => {
  jest.clearAllMocks();
  mockSubmitGeneration.mockImplementation((...args) => actualApi.submitGeneration(...args));
  mockResolveResult.mockImplementation((...args) => actualApi.resolveResult(...args));
  mockGetAppConfig.mockImplementation(async () => ({
    fileStrategy: 'local',
    imageGeneration: TEST_IMAGE_GENERATION_CONFIG,
  }));
  await File.deleteMany({});
});
```

(这一行替换原来 `beforeEach` 里没有 `mockGetAppConfig` 相关内容的版本。)

`GET /api/images/ — DB-level pagination` 那个 describe 块不涉及 provider,保持原样不变。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /data/lidongyu/projects/LibreChat && LD_LIBRARY_PATH="$HOME/.local/ssl1.1/usr/lib/x86_64-linux-gnu" MONGOMS_VERSION=4.4.18 npx jest api/server/routes/__tests__/images.spec.js`
Expected: FAIL — `submitGeneration`/`resolveResult` 的真实实现(`actualApi.submitGeneration`)现在需要 `(args, providers, deps, userId)` 四个参数,而路由代码还在按旧的 `(args, cfg())` 两参数调用;`resolveImageProviders`/`getImageModels`/`getDefaultImageModel`/`getAspectRatios` 在路由文件里还没被 `require`。

- [ ] **Step 3: 重写 `api/server/routes/images.js`**

把整个文件内容替换成:

```js
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { CacheKeys } = require('librechat-data-provider');
const {
  submitGeneration,
  resolveResult,
  resolveImageProviders,
  getImageModels,
  getDefaultImageModel,
  getAspectRatios,
  getStorageMetadata,
} = require('@librechat/api');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { getFileStrategy } = require('~/server/utils/getFileStrategy');
const { getAppConfig } = require('~/server/services/Config');
const { getLogStores } = require('~/cache');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();
router.use(requireJwtAuth);

const PENDING_TTL = 30 * 60 * 1000;

/** @returns {import('@librechat/api').ImageDeps} */
const buildDeps = (appConfig, req) => ({
  fetchImage: async (url) => {
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    const buffer = Buffer.from(r.data);
    const meta = await sharp(buffer).metadata();
    return {
      buffer,
      contentType: r.headers['content-type'] || 'image/png',
      width: meta.width,
      height: meta.height,
    };
  },
  fetchImageFromB64: async (b64, mediaType) => {
    const buffer = Buffer.from(b64, 'base64');
    const meta = await sharp(buffer).metadata();
    return {
      buffer,
      contentType: mediaType || 'image/png',
      width: meta.width,
      height: meta.height,
    };
  },
  saveImageFile: async ({ userId, buffer, contentType }) => {
    const source = getFileStrategy(appConfig, { isImage: true });
    const { saveBuffer } = getStrategyFunctions(source);
    const ext = contentType.includes('jpeg') ? 'jpg' : 'png';
    const filename = `${uuidv4()}.${ext}`;
    const filepath = await saveBuffer({
      userId,
      buffer,
      fileName: filename,
      tenantId: req.user.tenantId,
    });
    return {
      filepath,
      source,
      bytes: buffer.length,
      filename,
      storageMetadata: getStorageMetadata({ filepath, source }),
    };
  },
  createFileRecord: (doc) => db.createFile({ ...doc, tenantId: req.user.tenantId }, true),
  findFileByPrediction: async (userId, pid) => {
    const files = await db.getFiles(
      { user: userId, 'metadata.imageGen.predictionId': pid },
      null,
      null,
    );
    return files && files[0] ? files[0] : null;
  },
});

router.get('/models', async (req, res) => {
  const appConfig = await getAppConfig({ role: req.user.role });
  const providers = resolveImageProviders(appConfig.imageGeneration);
  const defaultModel = getDefaultImageModel(providers);
  res.json({
    models: getImageModels(providers),
    default: defaultModel?.id,
    aspectRatios: getAspectRatios(providers),
  });
});

router.post('/generate', async (req, res) => {
  try {
    const appConfig = await getAppConfig({ role: req.user.role });
    const providers = resolveImageProviders(appConfig.imageGeneration);
    const deps = buildDeps(appConfig, req);
    const defaultModel = getDefaultImageModel(providers);
    const { prompt, model, provider, aspectRatio, param, imageUrls } = req.body;
    const providerName = provider || defaultModel?.provider;
    const modelId = model || defaultModel?.id;
    const result = await submitGeneration(
      {
        providerName,
        model: modelId,
        prompt,
        aspectRatio: aspectRatio || '1:1',
        param,
        imageUrls,
      },
      providers,
      deps,
      req.user.id,
    );
    if (result.status === 'pending') {
      await getLogStores(CacheKeys.IMAGE_GENERATION).set(
        result.predictionId,
        { userId: req.user.id, provider: providerName, model: modelId, prompt },
        PENDING_TTL,
      );
    }
    res.json({ predictionId: result.predictionId });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get('/result/:predictionId', async (req, res) => {
  try {
    const { predictionId } = req.params;
    const cache = getLogStores(CacheKeys.IMAGE_GENERATION);
    const ctx = (await cache.get(predictionId)) || {};
    if (ctx.userId && ctx.userId !== req.user.id) {
      return res.status(403).json({ message: 'forbidden' });
    }
    const appConfig = await getAppConfig({ role: req.user.role });
    const providers = resolveImageProviders(appConfig.imageGeneration);
    const deps = buildDeps(appConfig, req);
    const out = await resolveResult(
      {
        predictionId,
        userId: req.user.id,
        providerName: ctx.provider || 'unknown',
        model: ctx.model || 'unknown',
        prompt: ctx.prompt || '',
      },
      deps,
      providers,
    );
    if (out.status === 'completed' || out.status === 'failed') {
      await cache.delete(predictionId);
    }
    res.json(out);
  } catch (err) {
    res.status(502).json({ status: 'failed', message: err.message });
  }
});

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  const filter = { user: req.user.id, context: 'image_generation' };
  if (req.query.cursor) {
    filter._id = { $lt: req.query.cursor };
  }
  const File = mongoose.models.File;
  const results = await File.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();
  let nextCursor = null;
  if (results.length > limit) {
    results.pop();
    nextCursor = results[results.length - 1]._id;
  }
  res.json({ images: results, nextCursor });
});

router.buildDeps = buildDeps;
module.exports = router;
```

**行为要点(务必保留):** 只有 `result.status === 'pending'` 时才写缓存;`completed` 的同步分支不写缓存,依赖 `resolveResult` 里 `deps.findFileByPrediction` 的既有-记录检查来处理后续的 `/result/:id` 轮询——查询本身按 `req.user.id` 过滤,所以即使没有缓存兜底的 403 检查,不同用户之间也不会串数据。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /data/lidongyu/projects/LibreChat && LD_LIBRARY_PATH="$HOME/.local/ssl1.1/usr/lib/x86_64-linux-gnu" MONGOMS_VERSION=4.4.18 npx jest api/server/routes/__tests__/images.spec.js`
Expected: PASS(全部 test 绿)。

- [ ] **Step 5: Commit**

```bash
git add api/server/routes/images.js api/server/routes/__tests__/images.spec.js
git commit -m "feat(api/routes): wire images route to multi-provider registry"
```

---

### Task 9: 前端最小适配 + 配置文档示例

**Files:**
- Modify: `client/src/components/Images/ImageWorkspace.tsx`
- Modify: `client/src/components/Images/__tests__/ImageWorkspace.spec.tsx`
- Modify: `librechat.example.yaml`

**Interfaces:**
- Consumes: `TImageModel.provider`(Task 1,已经通过 `GET /api/images/models` 响应体带到前端)
- Produces: `POST /api/images/generate` 请求体新增 `provider` 字段(前端侧)

- [ ] **Step 1: 写失败的前端测试**

打开 `client/src/components/Images/__tests__/ImageWorkspace.spec.tsx`,把 `mockModelsConfig.models` 里的两个模型各加一行 `provider: 'Flux'`:

```ts
const mockModelsConfig = {
  models: [
    {
      id: 'flux-pro',
      label: 'Flux Pro',
      provider: 'Flux',
      supportsEdit: false,
      paramKey: 'quality',
      paramValues: ['standard', 'hd'],
      defaultParam: 'standard',
    },
    {
      id: 'flux-edit',
      label: 'Flux Edit',
      provider: 'Flux',
      supportsEdit: true,
      paramKey: 'quality',
      paramValues: ['standard'],
      defaultParam: 'standard',
    },
  ],
  default: 'flux-pro',
  aspectRatios: ['1:1', '16:9', '9:16'],
};
```

然后把现有这个测试:

```ts
  it('clicking Generate calls mutate with prompt and default model', () => {
    render(<ImageWorkspace />);
    const textarea = screen.getByRole('textbox', { name: 'com_ui_image_prompt_placeholder' });
    fireEvent.change(textarea, { target: { value: 'a sunset over the mountains' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_generate' }));
    expect(mockGenerateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'a sunset over the mountains',
        model: 'flux-pro',
      }),
    );
  });
```

改成断言里加上 `provider`:

```ts
  it('clicking Generate calls mutate with prompt, default model, and its provider', () => {
    render(<ImageWorkspace />);
    const textarea = screen.getByRole('textbox', { name: 'com_ui_image_prompt_placeholder' });
    fireEvent.change(textarea, { target: { value: 'a sunset over the mountains' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_generate' }));
    expect(mockGenerateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'a sunset over the mountains',
        model: 'flux-pro',
        provider: 'Flux',
      }),
    );
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd client && npx jest src/components/Images/__tests__/ImageWorkspace.spec.tsx -t "clicking Generate"`
Expected: FAIL — `mockGenerateMutate` 被调用时的实参里没有 `provider` 字段(`toHaveBeenCalledWith` 用 `objectContaining` 断言失败)。

- [ ] **Step 3: 修改 `ImageWorkspace.tsx` 的 `handleGenerate`**

找到:

```tsx
  const handleGenerate = () => {
    if (!prompt.trim() || isGenerating) {
      return;
    }
    setErrorMsg(null);
    setIsGenerating(true);
    generateImage({
      prompt: applyStyleToPrompt(prompt.trim(), style),
      model,
      aspectRatio,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    });
  };
```

改成:

```tsx
  const handleGenerate = () => {
    if (!prompt.trim() || isGenerating || !selectedModel) {
      return;
    }
    setErrorMsg(null);
    setIsGenerating(true);
    generateImage({
      prompt: applyStyleToPrompt(prompt.trim(), style),
      model,
      provider: selectedModel.provider,
      aspectRatio,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    });
  };
```

(`selectedModel` 在同一个组件函数体里已经定义——`const selectedModel = models.find((m) => m.id === (model || defaultModel));`——虽然它在源码里写在 `handleGenerate` 下面,但 `handleGenerate` 只是定义了一个闭包,真正执行是在用户点击按钮之后,那时候整个组件函数体已经执行完,`selectedModel` 已经有值,这是 React 函数组件里的常见写法,不会有 TDZ 报错。)

- [ ] **Step 4: 跑测试确认通过**

Run: `cd client && npx jest src/components/Images/__tests__/ImageWorkspace.spec.tsx`
Expected: PASS(该文件全部 test 绿)。

- [ ] **Step 5: 跑 TypeScript 类型检查,确认 `TImageModel`/`TImageGenRequest` 新增必填字段没有在别处漏掉**

Run: `npm run build:data-provider && cd client && npx tsc --noEmit`
Expected: 无与 `TImageModel`/`TImageGenRequest`/`ImageWorkspace.tsx` 相关的类型错误。如果报出其它地方(比如某个测试 fixture)缺少 `provider` 字段,按同样方式补上 `provider: '<某个占位 provider 名>'`。

- [ ] **Step 6: 在 `librechat.example.yaml` 追加配置示例**

在文件末尾(第 746 行之后)追加:

```yaml

# Image Generation Providers Example
# Configure one or more providers for the Images workspace (left sidebar "图像"/Images entry).
# Each provider's `protocol` selects which adapter handles it — 'openrouter' (synchronous,
# calls OpenRouter's dedicated Image API) or 'gptsapi-predictions' (asynchronous submit+poll,
# the existing GPTsAPI-compatible relay protocol).
imageGeneration:
  providers:
    - name: 'OpenRouter'
      protocol: 'openrouter'
      apiKey: '${OPENROUTER_KEY}'
      baseURL: 'https://openrouter.ai/api/v1'
      aspectRatios: ['auto', '1:1', '9:16', '16:9', '4:3', '3:4']
      models:
        - id: 'google/gemini-3-pro-image'
          label: 'Nano Banana Pro'
          isDefault: true
          supportsEdit: true
          paramKey: 'output_format'
          paramValues: ['png', 'jpeg']
          defaultParam: 'png'
        - id: 'openai/gpt-image-2'
          label: 'GPT Image 2'
          supportsEdit: true
          paramKey: 'resolution'
          paramValues: ['1K', '2K', '4K']
          defaultParam: '1K'
    - name: 'GPTsAPI'
      protocol: 'gptsapi-predictions'
      apiKey: '${GPTSAPI_KEY}'
      baseURL: 'https://api.gptsapi.net'
      aspectRatios: ['auto', '1:1', '9:16', '16:9', '4:3', '3:4']
      models:
        - id: 'gemini-3-pro-image-preview'
          label: 'Nano Banana Pro (GPTsAPI)'
          vendor: 'google'
          supportsEdit: true
          editImagesKey: 'images'
          paramKey: 'output_format'
          paramValues: ['png', 'jpeg']
          defaultParam: 'png'
        - id: 'gpt-image-2'
          label: 'GPT Image 2 (GPTsAPI)'
          vendor: 'openai'
          supportsEdit: true
          editImagesKey: 'input_urls'
          paramKey: 'resolution'
          paramValues: ['1K', '2K', '4K']
          defaultParam: '1K'
```

`OPENROUTER_KEY` 和 `GPTSAPI_KEY`/`GPTSAPI_BASE_URL` 在 `.env.example` 里已经存在(分别在第 159 行、第 147 行附近),不需要新增或修改 `.env.example`。

- [ ] **Step 7: Commit**

```bash
git add client/src/components/Images/ImageWorkspace.tsx client/src/components/Images/__tests__/ImageWorkspace.spec.tsx librechat.example.yaml
git commit -m "feat(client): pass image model provider through to generate request"
```

---

## 计划完成后的整体验证

所有 9 个 task 完成后,跑一遍全量相关测试确认没有遗漏:

```bash
cd packages/data-provider && npx jest
cd packages/data-schemas && LD_LIBRARY_PATH="$HOME/.local/ssl1.1/usr/lib/x86_64-linux-gnu" MONGOMS_VERSION=4.4.18 npx jest
cd packages/api && LD_LIBRARY_PATH="$HOME/.local/ssl1.1/usr/lib/x86_64-linux-gnu" MONGOMS_VERSION=4.4.18 npx jest src/images
cd /data/lidongyu/projects/LibreChat && LD_LIBRARY_PATH="$HOME/.local/ssl1.1/usr/lib/x86_64-linux-gnu" MONGOMS_VERSION=4.4.18 npx jest api/server/routes/__tests__/images.spec.js
cd client && npx jest src/components/Images
```

Expected: 全绿。此外建议手动跑一次 `npm run build:data-provider && npm run build`(Turborepo 全量构建),确认 `packages/api`/`packages/data-schemas`/`client` 之间的类型没有断链。
