# Graupel 笔记第二大脑 — 功能规格(Spec)

> **日期**: 2026-06-17 ｜ **作者**: 小天 ｜ **状态**: 待落地(plan 拆分见 §13)
>
> **定位**: MVP 五功能之一(聊天 / 多模态解析 / 图片生成 / Memory / **笔记第二大脑**)。横切 `data-schemas` + `packages/api` + `api/server` + `client`,**不占 stage 1-5 工程主线编号**;依赖 [stage-3](2026-05-21-graupel-stage-3-plan-gating.md) 的配额框架。
>
> **推导底稿**(research/,非 source of truth): [设计稿](../research/2026-06-17-second-brain-design-draft.md)、[MVP 范围与架构](../research/2026-06-17-graupel-mvp-scope-and-second-brain.md)。本 spec 为权威规格。

---

## 1. 目标与定位

让用户在 Graupel 内建立**个人笔记第二大脑**:创建可长期留存的笔记,往笔记里塞各种多模态材料(图/音/视/文档/网页),并让 AI 基于这些笔记做**跨材料检索问答**与**自动整理维护**(摘要、建链、去重)。

检索采用 **Karpathy LLM Wiki 思路**(结构化 markdown + 关键词/标签轻路由 + 相关笔记整篇进 long-context),**不上向量 RAG**。这是 Graupel 区别于"又一个 wrapper"(以及薄壳 use.ai)的核心差异化,对标 use.ai `Projects` / youmind `Board` 的"容器层"。

## 2. 范围

### In scope(P0)
- 笔记 CRUD(markdown 正文、标签、双链),长期留存
- 多模态入料:上传图/音/视/pdf/office → 自动**文本化**(caption/OCR/转写/抽取)→ 并入笔记
- Notes MCP server(系统注册,7 个读写工具),供内部 agent 调用
- 检索问答:聊天内 `@我的笔记`,跨笔记综合作答带来源
- 整理维护:用户手动触发(对话式),agent 读→综合→写回笔记
- 配额:`quota.notes`(原子 check-and-increment),Free 也给受限额度

### Out of scope / 非目标
- ❌ **后台自动维护**(无人触发的 compile/lint)→ P1,需 `backgroundAgentRunner` 解 req/res 耦合
- ❌ **Notebook 容器**(项目分组 + 项目级指令)→ P1;P0 为全局扁平 wiki + tags
- ❌ **向量 RAG / pgvector**(本功能明确不用)
- ❌ web 剪藏浏览器插件、`merge_notes` 去重、多模态**产出**(youmind 式文/图/音频成品)、协作编辑 → 均 P1+
- ❌ 任何对用户暴露的 agent/MCP 概念(纯内部实现)

## 3. 与 Graupel stage 的关系

| 关系 | 说明 |
|---|---|
| 依赖 | [stage-3](2026-05-21-graupel-stage-3-plan-gating.md) 的配额框架(原子 check-and-increment、plan 体系) |
| 正交 | 与 stage 1-5 工程主线(fork/auth/marketing/launch)无强耦合,可在 stage 3 之后任意时点开工 |
| 复用 | 现有文件存储(R2)、OCR(`ocr.ts`)、STT、vision encode、文本抽取(`text.ts`/`context.ts`)、agent 引擎(LangGraph loop)、MCP 集成 |

## 4. 已定决策(前序拍板)

| # | 决策 |
|---|---|
| 1 | 形态:轻容器 + LLM Wiki 检索 + 多模态文本化入料,**不上向量 RAG** |
| 2 | 触发:MVP **手动触发**(走对话式 agent 路径),避开后台 req/res 解耦 |
| 3 | 门控:**Free 也给受限额度**,所有档可用,靠 `quota.notes` 配额递增(非 feature flag) |
| 4 | 写回:**Notes MCP**(不用 OpenAPI Action) |
| 5 | MVP **扁平 wiki + tags**,Notebook 容器作 P1 |
| 6 | 整理用 **cheap 档模型**(Haiku / gpt-5-nano),lint 在每次手动整理时做 |
| 7 | 笔记**独立长期留存**,不套 30 天对话 TTL;GDPR export/delete 仍涵盖 |
| 8 | agent / MCP 作为**内部实现**,用户不可见这些概念 |

## 5. 数据模型

> 文件:`packages/data-schemas/src/schema/note.ts`(P0);类型 `packages/data-schemas/src/types/note.ts`;前后端共享类型 `packages/data-provider/src/types/`。复用 `file.file_id` 关联原件,不重造存储。Notebook schema 属 P1,本 spec 数据模型只定义 Note(含为 P1 预留的可空 `notebookId`)。

```ts
// schema/note.ts  (P0)
const note: Schema<INote> = new Schema({
  user:        { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  notebookId:  { type: Schema.Types.ObjectId, ref: 'Notebook', index: true }, // P1 预留,P0 恒空
  title:       { type: String, required: true },
  content:     { type: String, default: '' },     // markdown(已文本化)
  tags:        { type: [String] },
  links:       [{ type: Schema.Types.ObjectId, ref: 'Note' }], // 双链
  attachments: [{
    file_id:     { type: String, required: true }, // 复用 file.file_id,原件在 R2
    kind:        { type: String, enum: ['image','audio','video','pdf','doc','web'], required: true },
    derivedText: { type: String },                 // 转写/caption/OCR 结果
    sourceUrl:   { type: String },
  }],
  source:      { type: String, enum: ['manual','upload','clip'], default: 'manual' },
  tokenCount:  { type: Number, default: 0 },
  maintainedAt:{ type: Date },                     // LLM 最近整理时间(lint 点)
  tenantId:    { type: String, index: true },
}, { timestamps: true });

note.index({ user: 1, updatedAt: -1 });
note.index({ user: 1, tags: 1 });
```

## 6. Notes MCP 工具契约

| 工具 | 签名 | 用途 | 读/写 |
|---|---|---|---|
| `search_notes` | `(query, tags?, limit=10)` → `[{id,title,snippet,tags}]` | 关键词/标签轻路由召回 | 读 |
| `get_note` | `(id)` → `{title,content,links,attachments}` | 取整篇进 long-context | 读 |
| `list_notes` | `(tags?)` → `[{id,title,updatedAt}]` | 目录/索引 | 读 |
| `create_note` | `(title, content, tags?, links?)` → `{id}` | 新建 | 写 |
| `update_note` | `(id, {content?\|appendContent?, tags?, addLinks?})` → `ok` | 更新/追加 | 写 |
| `link_notes` | `(fromId, toId)` → `ok` | 建双链 | 写 |

> 全部按 `req.user.id` 作用域隔离;写工具受 §9 配额校验。`merge_notes` 为 P1。

## 7. 多模态文本化入料管线

```
上传 → 判类型 ┬ image → vision caption + OCR    (复用 vision encode + ocr.ts)
             ├ audio/video → STT 转写            (复用 STT service)
             ├ pdf/office  → 文本抽取            (复用 text.ts / context.ts)
             └ (web 剪藏 P1)
   → 原件存 R2(file 记录)+ 生成 derivedText
   → 落 Note.attachments[{file_id,kind,derivedText}],derivedText 并入/关联 Note.content
```

新代码主要是**编排**(`packages/api/src/notes/ingest.ts`),解析全部复用现有零件。

> **P1 延期说明**: 视频 → STT 转写为 P1(当前返回空文本)。图片 OCR 为 P1(MVP 仅做 vision caption,因为 `performOCR` 需要远端/签名 URL,本地文件路径不支持)。

## 8. 核心流程

- **入料**:见 §7。
- **检索问答**:`@我的笔记` → 内部 agent:`search_notes`(轻路由)→ `get_note`(取相关整篇)→ long-context 综合作答(带来源引用)。
- **整理维护**(P0 手动):用户点「整理」/ 聊天 `@我的笔记` 整理 → 对话式 agent run(用户 req/res 天然在)→ `list_notes`+`get_note` 读现状 + 读新材料 → 综合 → `create_note`/`update_note`/`link_notes` 写回 → 标记 `maintainedAt`。

## 9. 配额与防滥用

沿用 [stage-3](2026-05-21-graupel-stage-3-plan-gating.md) 原子 `findOneAndUpdate` + `$inc` + 上限 filter(绝不 read-then-write)。新增 `quota.notes` 维度:

```ts
notes: {
  maxNotes:          number;   // 笔记总数上限
  organizePerPeriod: number;   // 「整理」次数/周期
  ingestPerPeriod:   number;   // 多模态入料次数/周期(控成本)
}
```

| 档 | maxNotes | organize/period | ingest/period | 说明(数值待 stage-4/5 校准) |
|---|---|---|---|---|
| Free | ~10 | ~1/天 | ~5/天 | 尝鲜,卡点引导升级 |
| Trial | ~100 | 充足 | 充足 | 全功能体验 |
| Pro | ~1000+ | 充足 | 充足 | 主力 |

`tokenBudget`/cheap 模型控 long-context 成本;`maintainedAt` 标记防并发写覆盖。

## 10. 前端与交互

- 独立笔记空间(侧栏入口「Notes」):三栏 = Notebook/标签列表 · markdown 编辑器 · 附件/多模态区;含「整理我的笔记」按钮。
- 聊天内 `@我的笔记` 把第二大脑当上下文检索。
- 所有用户可见文本走 `useLocalize()`,仅改英文 key。

## 11. 验收标准(P0,可测)

1. 用户能创建 / 编辑 / 删除笔记(markdown),笔记不被 30 天对话 TTL 清除。
2. 上传图 / 音 / 视 / pdf 到笔记 → 自动生成 `derivedText`(caption/OCR/转写/抽取)写入 `attachments` 与 `content`。
3. Notes MCP 6 个工具可被内部 agent 调用,按 `user.id` 隔离;**不出现在用户 MCP UI**。
4. 聊天 `@我的笔记` 能跨多篇笔记综合作答并标注来源笔记。
5. 点「整理」→ agent 实际 `create/update/link` 写回笔记,`maintainedAt` 更新。
6. `quota.notes` 原子校验:超 `maxNotes` 时创建被拒并返回升级引导;`organize`/`ingest` 超限同理。
7. Free 用户可见且可用第二大脑(受配额)。
8. 全程 UI 无 agent/MCP 字样。

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| long-context 整篇塞,token 成本高 | `tokenBudget` 限单次范围 + cheap 模型读 wiki |
| LLM 整理把错误"焊死"并顺链传播 | lint(每次整理)+ `maintainedAt` + 笔记用户可编辑纠正 |
| 配额滥用 / 刷成本 | 原子 check-inc;`organize`/`ingest` 独立限次 |
| 后台触发 req/res 耦合 | P0 仅手动触发规避;P1 再做 `backgroundAgentRunner` |
| 笔记规模涨大、索引超窗 | P0 限规模;P1 加轻检索层(仍不必向量库) |

## 13. 分阶段交付(plan 拆分)

> 每个 plan 独立产出可测软件。建议顺序:A →(B、C 可并行)→ D → E → F。

| Plan | 范围 | 可独立验收 |
|---|---|---|
| **A. Schema + CRUD** | `note.ts` schema + 类型 + CRUD 方法 + `api/server/routes/notes.js` 薄路由 | 笔记增删改查通过 mongodb-memory-server 测试 |
| **B. 多模态入料** | `packages/api/src/notes/ingest.ts` 编排 OCR/STT/vision/text | 各类型文件入料生成 derivedText |
| **C. Notes MCP server** | 6 工具的 MCP server + 系统注册 | 工具按 user 隔离、读写正确 |
| **D. 整理 + 检索接线** | 内部整理 agent + 检索路径 + 手动触发入口 | 点整理→写回;@笔记→综合作答 |
| **E. 配额 quota.notes** | 接 stage-3 框架,原子 check-inc + 升级引导 | 超限被拒、Free 受限可用 |
| **F. 前端笔记空间** | `client/src/components/Notes/` + data-provider hooks + 聊天 @笔记 | 三栏 UI、整理按钮、检索可用 |

> P1(本 spec 之后):后台自动维护、Notebook 容器 + 项目级指令、web 剪藏、merge 去重、规模化轻检索层。
