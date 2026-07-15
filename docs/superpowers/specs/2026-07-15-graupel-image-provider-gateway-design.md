# Graupel 图像生成 Provider 网关抽象设计

> **日期**: 2026-07-15 ｜ **作者**: 小天 ｜ **类型**: 技术债偿还 / 架构重构
>
> **关联**: [图像工作台原始设计](2026-06-23-graupel-image-workspace-design.md)(本设计在其之上做后端重构,前端交互/UX 不变);对标文本模型的 `endpoints.custom` 网关抽象。

---

## 1. 背景与问题

[图像工作台](2026-06-23-graupel-image-workspace-design.md)上线时,后端 `packages/api/src/images/{models,client,service}.ts` 是**单一 provider 写死**的实现:全局唯一一份 `{ baseUrl, apiKey }`(来自 `GPTSAPI_BASE_URL`/`GPTSAPI_KEY`),`IMAGE_MODELS` 是硬编码数组,`client.ts` 的请求/响应格式和"提交预测任务→轮询结果"这套异步协议完全绑死 GPTsAPI 一家的私有 `/api/v3/{vendor}/{model}/{action}` 接口。

现在想接入 **OpenRouter 的 Image API**(`POST /api/v1/images`,同步返回 `b64_json`,无 predictionId 轮询概念)作为第二个 provider,与 GPTsAPI 并存、可配置切换或共存。当前代码结构做不到——协议形状完全不同,只能改代码,不能改配置。

文本模型这边已经有对应的解法:`librechat.yaml` 的 `endpoints.custom` 数组,统一 `baseURL`/`apiKey`/`models`/`headers` 等字段,由 `packages/api/src/endpoints/{custom,anthropic,openai,google}/` 按 provider 做初始化,最终交给 `@librechat/agents`(开源包,MIT,`github.com/danny-avila/agents`,LangGraph 实现)执行真正的 LLM 调用。本设计参照这个思路,给图像生成也做一套等价的、config-driven 的 provider 网关抽象。

**不参照的部分**:`packages/api/src/endpoints/` 深度耦合 `@librechat/agents` 的流式对话/工具调用/Agent 初始化,和"发一次 REST 请求拿图片"毫无关系,因此新抽象**不物理合并**进 `endpoints/`,而是留在 `packages/api/src/images/` 下,只是在目录组织上模仿 `endpoints/custom/{config,initialize}.ts` 的命名套路(见 §4)。

## 2. 范围

**做**:
- 新增 `librechat.yaml` 顶层配置块 `imageGeneration.providers[]`,支持同时配置 GPTsAPI(现状,异步提交+轮询协议)和 OpenRouter(新增,同步协议),模型清单(含 `id`/展示名/能力字段)从硬编码迁移到该配置里
- 新增 provider 适配器接口 `ImageProviderAdapter`,`OpenRouterAdapter`(新写)+ `GptsapiAdapter`(把现有 `client.ts` 逻辑原样迁移)两个实现
- `service.ts`(`submitGeneration`/`resolveResult`)、`api/server/routes/images.js` 改为按配置解析 provider,而非写死调用 GPTsAPI
- 前端 `ImageWorkspace.tsx` 做最小适配:`GET /api/images/models` 返回的模型清单现在带 provider 归属,选择器/生成请求原样透传即可

**不做(YAGNI,明确排除)**:
- 上游 Agent 工具(`DALLE3.js`/`FluxAPI.js`/`OpenAIImageTools.js`/`gemini_image_gen`)不动、不纳入本次抽象
- 不做模型清单动态发现(`fetch: true` 那种运行时拉取),v1 阶段两个 provider 的模型清单都是 yaml 里静态声明
- 不改 `File` schema、不改图库(`GET /api/images`)查询逻辑
- 不接计费门控(`service.ts:33` 的 `// TODO(gating)` 检查点保留原样,不在本次范围内动)
- 不改前端 UX/交互设计,只做"消费新响应形状"级别的适配

## 3. 配置 Schema

新增顶层 key,与 `endpoints`、`webSearch`、`memory` 等平级(证据:`packages/data-provider/src/config.ts:1355` 起的 `configSchema`,`endpoints` 只是众多顶层 feature key 之一,不是特殊位置)。

```yaml
imageGeneration:
  providers:
    - name: 'OpenRouter'
      protocol: 'openrouter'
      apiKey: '${OPENROUTER_KEY}'
      baseURL: 'https://openrouter.ai/api/v1'
      models:
        - id: 'google/gemini-3-pro-image'
          label: 'Nano Banana Pro'
          isDefault: true
          supportsEdit: true
          aspectRatios: ['auto', '1:1', '9:16', '16:9', '4:3', '3:4']
          paramKey: 'output_format'
          paramValues: ['png', 'jpeg']
          defaultParam: 'png'
        - id: 'openai/gpt-image-2'
          label: 'GPT Image 2'
          supportsEdit: true
          aspectRatios: ['auto', '1:1', '9:16', '16:9', '4:3', '3:4']
          paramKey: 'resolution'
          paramValues: ['1K', '2K', '4K']
          defaultParam: '1K'
    - name: 'GPTsAPI'
      protocol: 'gptsapi-predictions'
      apiKey: '${GPTSAPI_KEY}'
      baseURL: 'https://api.gptsapi.net'
      models:
        # 原 IMAGE_MODELS 数组原样迁移:id/label/vendor/supportsEdit/editImagesKey/paramKey/paramValues/defaultParam
        - id: 'gemini-3-pro-image-preview'
          label: 'Nano Banana Pro (GPTsAPI)'
          vendor: 'google'
          supportsEdit: true
          editImagesKey: 'images'
          paramKey: 'output_format'
          paramValues: ['png', 'jpeg']
          defaultParam: 'png'
        # ...其余 3 个模型同理迁移
```

`packages/data-provider/src/config.ts` 新增:
- `imageProviderModelSchema`:按 `protocol` 做 `z.discriminatedUnion`。两种 protocol 共享同一形状——`aspectRatios`(通用宽高比白名单)+ 一个"额外调节项"三元组 `paramKey`/`paramValues`/`defaultParam`(GPTsAPI 是 `output_format`|`resolution` 二选一,OpenRouter 同理)——这与当前前端 UI 每个模型只暴露"宽高比 + 一个额外参数"的形状完全对应。GPTsAPI 额外多出 `vendor`/`editImagesKey` 两个字段,用于拼接它私有的 `/api/v3/{vendor}/{model}/{action}` 路径和编辑接口的参考图参数名,OpenRouter 没有这两个字段
- `imageProviderConfigSchema`:`name`/`protocol`/`apiKey`/`baseURL`/`models` 数组
- `imageGenerationConfigSchema`:`{ providers: imageProviderConfigSchema[] }`
- `configSchema` 里加一行 `imageGeneration: imageGenerationConfigSchema.optional()`

## 4. 适配器接口与实现

```ts
// packages/api/src/images/providers/types.ts
export type GenerationOutcome =
  | { status: 'completed'; imageUrl?: string; imageB64?: string; mediaType?: string }
  | { status: 'pending'; jobId: string }
  | { status: 'failed'; error: string };

export interface GenerateArgs {
  modelId: string;
  prompt: string;
  aspectRatio?: string;
  paramValue?: string;
  imageUrls?: string[];
}

export interface ImageProviderAdapter {
  readonly protocol: string;
  generate(args: GenerateArgs, provider: ImageProviderConfig): Promise<GenerationOutcome>;
  poll?(jobId: string, provider: ImageProviderConfig): Promise<GenerationOutcome>;
}
```

- `packages/api/src/images/providers/openrouter.ts`:`generate()` 直接 `POST {baseURL}/images`,同步拿 `b64_json`/`media_type`,返回 `{ status: 'completed', imageB64, mediaType }`,不实现 `poll`
- `packages/api/src/images/providers/gptsapi.ts`:把现有 `client.ts` 的 `submitPrediction`/`getPrediction` 原样迁移为 `generate()`(返回 `{ status: 'pending', jobId }`)和 `poll()`
- `packages/api/src/images/providers/registry.ts`:按 `protocol` 分发到对应 adapter 实例;提供 `resolveModel(modelId, config)` 按 model id 反查其所属 provider + 该 provider 的 adapter 实例(前端生成请求只带一个 model id,后端需要知道它属于哪个 provider)

目录/文件命名模仿 `packages/api/src/endpoints/custom/{config,initialize}.ts` 的套路(该目录是文本模型侧"配置解析成具体实现"的等价物),但**物理上不合并**——`endpoints/` 深度耦合 `@librechat/agents` 的 `Providers` 枚举与 agent 初始化流程,图像生成没有这些依赖,合并只会让人误以为两者要接入同一条流水线。

## 5. 后端接线改动

`api/server/routes/images.js`:
- 原来写死的 `cfg()`(单一 `{ baseUrl, apiKey }`)替换为从 `appConfig.imageGeneration.providers` 读取,经 `registry.ts` 解析
- `GET /models`:聚合所有已配置 provider 的模型清单返回,每个模型标注所属 provider(前端选择后原样带回)
- `POST /generate`:按 model id 反查 provider → `adapter.generate()`:
  - 返回 `completed`(OpenRouter 走这条):立即下载/落 `File`(复用现有 `deps.saveImageFile`/`deps.createFileRecord`),前端第一次轮询 `/result/:id` 就拿到最终结果
  - 返回 `pending`(GPTsAPI 走这条):行为与现状完全一致,存 `jobId` + provider 归属到现有 `CacheKeys.IMAGE_GENERATION` 缓存
- `GET /result/:predictionId`:缓存里已是 `completed` 直接返回;否则按缓存记录的 provider 调 `adapter.poll(jobId)`

`service.ts` 的 `submitGeneration`/`resolveResult` 现有校验逻辑(prompt 长度、`aspectRatio` 合法性、`paramValue` 合法性、`supportsEdit` 检查、`gpt-image-2` 的 4K+1:1 互斥等[原设计 §5](2026-06-23-graupel-image-workspace-design.md#5-引擎与模型gptsapi-v3-异步预测-api)里定义的约束)全部保留,只是校验所依据的"这个模型允许哪些值"改成从对应 provider 的配置里查,而不是硬编码常量。

## 6. 明确不变的下游

- `File` schema / `metadata.imageGen.{prompt,predictionId}` 不变
- 图库 `GET /api/images` 分页查询不变
- 计费门控 TODO 保留原样,不在本次接线
- 前端 `ImageGallery.tsx`、`ImageControls.tsx`(风格后缀等)不变

## 7. 测试策略

沿用原设计"真实逻辑优先,只 mock 不可控外部依赖"的原则(见 [图像工作台设计 §11](2026-06-23-graupel-image-workspace-design.md#11-测试策略jest真实逻辑优先)):
- `providers/openrouter.spec.ts` / `providers/gptsapi.spec.ts`:mock axios HTTP 层,验证请求体拼装、响应解析、错误冒泡
- `providers/registry.spec.ts`:model id → provider 反查的单测(含"未配置/未知 model id"报错路径)
- `service.spec.ts`:用 in-memory adapter test double 覆盖两条路径——"同步 completed 直接落 File"和"pending → poll → completed 落 File",复用现有幂等性测试(同 predictionId/jobId 重复 resolve 不重复落库)
- 前端:`ImageWorkspace` 相关测试补充"模型清单带 provider 归属"这一变化的断言,不新增交互测试

## 8. 待验证项

- OpenRouter Image API 的实际延迟/成功率(相比 GPTsAPI 实测 ~40s 的异步任务,同步请求是否会触发网关超时,需要实测调整 axios timeout)
- OpenRouter `input_references`(图生图/编辑)的 URL 可达性要求,是否和现有参考图上传存储策略兼容(同 GPTsAPI 那条"必须是可访问 URL"的既有限制)
- 现有 4 个 GPTsAPI 模型 id 全部原样迁移进 yaml 是否需要额外确认(直接照抄现有 `IMAGE_MODELS` 数组内容,理论上零风险)

## 9. 工作量预估

- 配置 Schema(zod discriminated union)+ `configSchema` 接线:~3-4h
- `OpenRouterAdapter` 新写 + `GptsapiAdapter` 迁移 + `registry.ts`:~5-6h
- `service.ts` 重构(双路径:同步立即完成 / 异步 pending+poll)+ `images.js` 路由接线:~3-4h
- `models.ts` 从硬编码数组改为读取 provider 配置的解析函数:~2-3h
- 测试(adapter/registry/service 双路径):~5-6h
- 前端最小适配(models 响应形状变化)+ 联调:~3-4h
- **合计 ~21-27h**
