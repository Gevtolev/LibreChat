# 笔记第二大脑 — 设计稿(draft)

> **日期**: 2026-06-17 ｜ **作者**: 小天 ｜ **类型**: 功能设计稿(待评审,定稿后转正式 stage spec)
>
> **上游**: [MVP 范围 & 第二大脑架构研究](2026-06-17-graupel-mvp-scope-and-second-brain.md)、[全量盘点](2026-06-17-chatgpt-benchmark-librechat-inventory.md)
>
> **已定决策**(前几轮拍板):
> - 形态:**轻容器 + Karpathy LLM Wiki 检索 + 多模态文本化入料**(不上向量 RAG)
> - 触发:MVP 用**手动触发**(走对话式 agent 路径),避开后台 req/res 解耦硬骨头
> - 门控:**Free 也给受限额度**,所有档可用,靠**配额递增**区分(非 boolean feature flag)
> - 实现:agent 引擎 + MCP 作为**内部实现**,用户不可见 agent/MCP 概念
> - 写回:**Notes MCP**(非 Action);MVP **扁平 wiki + tags**(Notebook 作 P1);整理用 **cheap 档模型**(Haiku/gpt-5-nano)、lint 随手动整理;笔记**独立长期留存**(不套 30 天对话 TTL,GDPR export/delete 仍涵盖)

---

## 1. 概念模型

```
User
 └── Notebook(轻容器/项目,可选分组;含项目级指令)        ← 对标 use.ai Projects / youmind Board
       └── Note(wiki 页面 = 第二大脑的原子)
             ├── content   markdown 正文(已文本化,含多模态转写)
             ├── tags      轻路由维度
             ├── links     双链(wiki 结构)
             └── attachments  多模态原件引用(file_id → R2)+ derivedText
```

- **Note** 是 wiki 页面,用户可编辑;**也可被 agent 读写维护**(LLM Wiki 的核心)。
- **Notebook** 是轻容器(主题分组 + 项目级指令)。MVP 可先扁平(notebookId 可空,= 全局 wiki),容器作为分组维度渐进上。
- **多模态**不单独存为"附件孤岛":原件进 R2,**转写/caption/OCR 结果(derivedText)进 Note**,使其可被 Wiki 检索;看原图时再把原件喂 vision 模型。

---

## 2. 数据模型(贴合现有 schema 风格)

> 文件:`packages/data-schemas/src/schema/{notebook.ts,note.ts}`;类型:`packages/data-schemas/src/types/{notebook.ts,note.ts}`;共享类型(前后端)放 `packages/data-provider/src/types/`。复用 `file.file_id` 关联多模态原件,**不重复造文件存储**。

```ts
// schema/notebook.ts
const notebook: Schema<INotebook> = new Schema({
  user:         { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  title:        { type: String, required: true },
  description:  { type: String },
  instructions: { type: String },              // 项目级指令(注入问答/整理 agent)
  tokenBudget:  { type: Number, default: 0 },   // long-context 预算上限(防整篇塞爆)
  tenantId:     { type: String, index: true },
}, { timestamps: true });

// schema/note.ts
const note: Schema<INote> = new Schema({
  user:        { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  notebookId:  { type: Schema.Types.ObjectId, ref: 'Notebook', index: true }, // 空 = 未归类
  title:       { type: String, required: true },
  content:     { type: String, default: '' },   // markdown(已文本化)
  tags:        { type: [String], index: true },
  links:       [{ type: Schema.Types.ObjectId, ref: 'Note' }], // 双链
  attachments: [{
    file_id:     { type: String, required: true }, // 复用 file.file_id,原件在 R2
    kind:        { type: String, enum: ['image','audio','video','pdf','doc','web'], required: true },
    derivedText: { type: String },                 // 转写/caption/OCR 结果
    sourceUrl:   { type: String },                 // web 剪藏来源
  }],
  source:      { type: String, enum: ['manual','upload','clip'], default: 'manual' },
  tokenCount:  { type: Number, default: 0 },       // long-context 预算核算
  maintainedAt:{ type: Date },                     // LLM 最近维护(lint/compile)时间
  tenantId:    { type: String, index: true },
}, { timestamps: true });

note.index({ user: 1, notebookId: 1, updatedAt: -1 });
note.index({ user: 1, tags: 1 });
```

> 命名遵循单词文件名(`note.ts`/`notebook.ts`);user 关联沿用 `file.ts` 的 `user: ObjectId ref User`;`tenantId`/`timestamps` 与现有 schema 一致。

---

## 3. Notes MCP 工具清单(agent 的读写接口)

> 一个**系统注册**的 Notes MCP server(不出现在用户 MCP UI)。agent 通过它读写笔记 —— 即 §5 技术核验确认的写回路径。**(已定 06-17:用 MCP,不用 OpenAPI Action。)**

| 工具 | 签名 | 用途 | 读/写 |
|---|---|---|---|
| `search_notes` | `(query, tags?, notebookId?, limit=10)` → `[{id,title,snippet,tags}]` | 关键词/标签**轻路由召回** | 读 |
| `get_note` | `(id)` → `{title,content,links,attachments}` | 取**整篇**进 long-context | 读 |
| `list_notes` | `(notebookId?, tags?)` → `[{id,title,updatedAt}]` | 目录/索引(供 agent 纵览) | 读 |
| `create_note` | `(title, content, tags?, links?, notebookId?)` → `{id}` | 新建笔记 | 写 |
| `update_note` | `(id, {content?|appendContent?, tags?, addLinks?})` → `ok` | 更新/追加 | 写 |
| `link_notes` | `(fromId, toId)` → `ok` | 建双链(wiki 结构) | 写 |
| `merge_notes` | `(ids[], intoTitle)` → `{id}` | 去重合并(增量,非 MVP 必需) | 写 |

所有工具按 `req.user.id` 作用域隔离;写工具受 §6 配额校验。

---

## 4. 多模态文本化入料管线(复用现有零件)

```
上传/剪藏 → 判类型 ┬ image  → vision caption + OCR        (复用 vision encode + ocr.ts)
                   ├ audio/video → STT 转写                (复用 STT service)
                   ├ pdf/office  → 文本抽取                (复用 text.ts / context.ts)
                   └ web         → 抓正文                  (复用 web 抓取)
   → 原件存 R2(file 记录) + 生成 derivedText
   → 落 Note.attachments[{file_id,kind,derivedText}] 并把 derivedText 并入/关联 Note.content
```

复用点:`packages/api/src/files/{ocr.ts,text.ts,context.ts}`、STT service、vision encode。新代码主要是**编排**(packages/api/src/notes/ingest.ts),不是从零做解析。

---

## 5. 三条核心流程

**① 入料**(上面 §4):材料 → 文本化 → Note。

**② 检索问答**(读):
```
用户提问 → agent: search_notes(轻路由) → get_note(取相关整篇) → long-context 综合作答(带笔记来源引用)
```

**③ 整理/维护**(写,MVP 手动触发):
```
用户点「整理我的笔记」/ 聊天里 @我的笔记 → 对话式 agent run(用户 req/res 天然在)
  → list_notes + get_note 读现状 + 读新材料 → 综合洞察
  → create_note / update_note / link_notes 写回 → 标记 maintainedAt(lint 点)
```
> MVP 只做手动触发 → 完全避开后台 req/res 解耦那 ~400 行。后台自动 compile/lint 留作第一个增量。

---

## 6. 配额与防滥用(因 Free 也给额度)

沿用 [stage-3](../specs/2026-05-21-graupel-stage-3-plan-gating.md) 的**原子 check-and-increment**(单 `findOneAndUpdate` + `$inc` + 上限 filter,绝不 read-then-write)。第二大脑是 **quota 维度**而非 feature flag:

```ts
// plan.quota 扩展(示意,数值待 stage-4 竞品研究 + stage-5 真实数据校准)
notes: {
  maxNotes:          number;   // 笔记总数上限
  organizePerPeriod: number;   // 「整理」(写回 agent run)次数/周期
  ingestPerPeriod:   number;   // 多模态入料次数/周期(控成本)
}
```

| 档 | maxNotes | organize/period | 说明 |
|---|---|---|---|
| Free | ~10 | ~1/天 | 尝鲜,卡点引导升级 |
| Trial | ~100 | 充足 | 全功能体验 |
| Pro | ~1000+ | 充足 | 主力 |

防滥用:整理/入料都过便宜模型 + 配额闸;`tokenBudget` 限制单次 long-context 规模;`maintainedAt`/`previewRevision` 式标记防并发写覆盖。

---

## 7. 与 plan / agent 隐藏的集成

- **不加 boolean feature flag**:第二大脑对所有档可见,差异在 §6 配额。stage-3 的 `features:{agents,image_gen,voice,web_search}` 不动;新增 `quota.notes`。
- **agent/MCP 隐藏**:Notes MCP 系统注册,不进用户 MCP UI;整理走系统配置的**内部 agent**(固定 instructions + 仅挂 Notes 工具),用户看到的是「笔记」功能,不接触 agent/MCP 概念。
- **代码落点**(遵循 workspace 边界):业务逻辑 `packages/api/src/notes/`(TS);schema `packages/data-schemas`;共享类型 `packages/data-provider/src/types`;薄路由 `api/server/routes/notes.js`;前端 `client/src/components/Notes/` + `client/src/data-provider/Notes/`。

---

## 8. 交互草图(ASCII)

**笔记空间(独立页 / 侧栏入口「Notes」):**
```
┌──────────────┬───────────────────────────────┬──────────────────┐
│ Notebooks     │  # 一篇笔记(markdown 编辑器)   │ 附件 / 多模态     │
│ • 全部         │                               │ [img] 截图.png    │
│ • 研究A        │  ## 标题                       │   └ caption…      │
│ • 旅行          │  正文……                       │ [audio] 录音.m4a  │
│  + 新建        │  #tag1 #tag2                   │   └ 转写…         │
│               │  ↔ 链接: [[笔记B]] [[笔记C]]     │  + 拖拽上传/剪藏  │
│ [笔记列表]      │                               │                  │
│ • 笔记A ←       │  ┌─────────────────────────┐   │ ┌──────────────┐ │
│ • 笔记B        │  │ ✦ 整理我的笔记 (AI)        │   │ │ AI 已整理:     │ │
│ • 笔记C        │  └─────────────────────────┘   │ │ 建了2条链接…   │ │
└──────────────┴───────────────────────────────┴──────────────────┘
```

**聊天内检索(把第二大脑当上下文):**
```
[ 输入框 ]  @我的笔记 上周记的关于定价的想法有哪些共识?
   → AI: (search_notes→get_note 跨笔记综合) 你有 3 篇相关笔记,共识是…… ⟨来源: 笔记A, 笔记C⟩
```

---

## 9. MVP 切分与工作量

| 优先级 | 项 | 依赖 | 估量 |
|---|---|---|---|
| P0 | Note/Notebook schema + CRUD API + 前端笔记空间(列表/编辑器/附件) | — | 中 |
| P0 | 多模态入料管线(编排现有零件) | 现有 OCR/STT/vision/text | 中 |
| P0 | Notes MCP server(7 个工具) | schema/CRUD | 小-中 |
| P0 | 整理/检索:内部 agent + 手动触发(对话式) | MCP + agent 引擎(白送) | 小 |
| P0 | quota.notes 配额(原子 check-inc) | stage-3 配额框架 | 小 |
| P1 | 后台自动维护(backgroundAgentRunner,~400行) | req/res 解耦 | 中 |
| P1 | Notebook 项目级指令注入、merge 去重、web 剪藏插件 | — | 中 |

> P0 全是"现成机制上拼装 + 净新增 schema/UI",无硬骨头;对单人 10h/周可控。

---

## 10. 细节决策(已定 06-17)

1. ✅ **写回走 Notes MCP**(不用 OpenAPI Action)—— 更干净,符合 LibreChat 现代工具方向
2. ✅ **MVP 全局扁平 wiki + tags**,Notebook 容器作 P1 —— 更快出 MVP
3. ✅ **「整理」用 cheap 档模型**(Haiku / gpt-5-nano),lint 在每次手动整理时做
4. ✅ **笔记独立长期留存** —— 不套用 30 天对话 TTL;GDPR export/delete 仍涵盖笔记
