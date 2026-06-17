# Graupel MVP 范围 & "笔记第二大脑" 架构研究

> **日期**: 2026-06-17 ｜ **作者**: 小天 ｜ **类型**: MVP 决策 / 架构前置研究
>
> **背景**: 承接 [ChatGPT 全量对标盘点](2026-06-17-chatgpt-benchmark-librechat-inventory.md)(背景参考)。本篇聚焦**收窄后的 MVP 范围**、**竞品一手对标(use.ai / youmind)**、以及新增的**"笔记第二大脑"功能的架构选型与可行性核验**。
>
> **取证说明**: use.ai 为 **Playwright 浏览器一手抓取**(2026-06-17);youmind 为多源实测评测综合 + 官网导航(官网本次导航超时,以评测为主);Karpathy LLM Wiki 为 web 检索;LibreChat 能力为**代码核验 agent** 逐文件验证(时点 `main @ 08cf714e9`,引用前复核)。

---

## 一句话

MVP 收窄到**五大功能**,其中三项(聊天 / 多模态解析)基本现成,只需配置 + 换肤;真正要开发的是**图片生成入口、Memory 修缮、笔记第二大脑**。第二大脑采用 **Karpathy LLM Wiki 思路(非向量 RAG)**,引擎能力 LibreChat 白送,缺"容器 + 写回工具 + 触发器"三块外围工程,**MVP 用手动触发可绕开唯一的硬骨头**。

---

## 一、MVP 范围:五大功能

用户明确把 MVP 收窄到以下五项(不追求 ChatGPT 全功能):

| # | 功能 | LibreChat 现状 | MVP 要做的事 | 开发量 |
|---|---|---|---|---|
| 1 | 聊天(多模型) | ✅ 完整 | 策展 `modelSpecs`(像 use.ai 挂自有品牌名、藏 provider)+ 换肤 | 配置为主 |
| 2 | 多模态解析 | ✅ 完整 | vision + 文件抽取基本开箱;收起上传菜单的技术选项(OCR/RAG/code) | 配置为主 |
| 3 | 图片生成 | 🟡 仅 agent 工具 | **做 plain-chat 入口**(否则"随手画图"不可用) | 真开发 |
| 4 | 用户 Memory | 🟡 受限 | 修普通用户可见 + 自动抽取默认开 + 打通直连端点(非仅 agents) | 真开发 |
| 5 | **笔记 / 第二大脑** | ❌ 净新增 | 新建容器 + Wiki 检索 + 多模态文本化入料(详见 §4-6) | 真开发(核心) |

> 与 [stage spec](../specs/) 的关系:#1#2#3#4 已在 MVP design 的功能表中("Web Search/RAG/TTS-STT/Image Gen/Memory 保留");**#5 笔记第二大脑是 spec 未覆盖的新增**,对应 spec 里 defer 到 v2 的 "Projects" 差异化(见 §2)。

---

## 二、竞品一手对标(use.ai / youmind)

### 2.1 use.ai 实况(Playwright 一手)

- **定位**: *"Your AI Workspace. Chat with the best AI models, research the web, and get things done, all in one place."* —— 与 Graupel 同一套打法(spec 称 Graupel 是 use.ai 的 follower)。
- **产品结构**(顶部导航即功能版图): `Start new` · **`Files & documents`** · **`Images`** · **`Apps`** · **`Projects`** · Sign in
- **模型呈现**: 默认显示 **"GPT 5.4 · by use.ai"** —— **重命名挂自有品牌、藏掉 provider**。实证了"用 modelSpecs 策展模型卡"的方向。
- **首页快捷入口**: Help me write / Analyze Image / Analyze Data / **Generate Images** / Translate …(多模态解析 + 图片生成是一等公民)。
- **定价**: 月付 **HK$29.99**、季付 HK$49.99、**HK$1.00 试用**;主打 *"25+ LLM models, 无限切换"*,**无 feature 分级**(所有档给全部模型)。
- **Help Center 信号**: 6 篇文章全是"取消订阅 / 退款 / 我没授权这笔扣费 / 我不知道有扣费 / 退款在哪 / 是否自动续费"——**零功能文档**。提示 use.ai 是营销驱动的薄壳 wrapper,且大概率有**自动续费争议**(对 Graupel 是反面教材:取消/退款/合规流要做干净)。

> ⚠️ **待决策 — 定价币种**: use.ai 是 **HK$**29.99 ≈ **US$3.8/月**(季付摊到 ~$2/月);[Graupel spec](../specs/2026-05-21-graupel-mvp-design.md) 写的 Pro 是 **US$**29.99,贵近 8 倍。spec 的 `$1 trial` 明显照搬 use.ai 的 `HK$1` 钩子,币种疑似看串。需确认是有意高端定位还是笔误。

### 2.2 youmind Board(实测评测综合)

**Board = 按主题划分的"项目工作台"**,是 youmind 核心原语。

- **装什么**: 捕获的源材料(网页/YouTube/播客剪藏 + PDF/Office/图片/音频上传,音视频自动转写)、高亮(Picks)、笔记(Notes)、AI 摘要、聊天历史、草稿(Pages)。
- **灵魂**: **AI 在整个 Board 维度共享上下文** —— "我存的资料共同观点是什么"返回**跨材料综合**,而非单文档问答。
- **工作流(Input→Process→Output)**: 剪藏/上传/语音入料(自动转写)→ Materials 阅读+高亮+笔记+音频概览、带源 AI chat、多模型 → Page 起草(选高亮/源 → AI 合成初稿 → agent 迭代)→ 多模态产出(文/幻灯/4K封面/SVG/播客音频)。
- **交互**: `@ThisBoard` 寻址上下文;**Ask(轻问答)/ Agent(多步创作)双模式**;Skills(预制 agent);**AI 产出是可编辑文档,非冻结气泡**。

### 2.3 Projects vs Board vs 我们的第二大脑

| 维度 | ChatGPT / use.ai **Projects**(轻) | youmind **Board**(重) | Graupel **笔记第二大脑** |
|---|---|---|---|
| 本质 | 对话分组 + 项目指令 + 项目文件 | 主题工作台:源料+标注+笔记+对话+草稿 | 介于两者,偏 Board |
| 多模态入料 | 上传文件 | 剪藏+上传+语音,**自动转写** | 明确要"塞各种多模态" → 偏 Board |
| AI 角色 | 在项目上下文里答 | **跨材料综合 + 维护 + 创作** | Karpathy Wiki:读 + **维护**笔记 |
| 检索 | 各家不同 | 跨材料上下文 | **Wiki / long-context,不上 RAG** |

> use.ai 的 `Projects` 在登录墙后,公开页拿不到细节(上为基于 ChatGPT/Claude Projects 通用模式的推断)。**两个对标产品的"容器层"(Projects/Board)正是 Graupel 笔记第二大脑要做的东西,是核心差异化而非边角料。**

---

## 三、功能上线 "必配 / 砍" 决策表

> 前提:plan `features` 开关为 true 时后端要真能跑。机器是 **Hetzner CCX13(2核/8G/80G,$13/月)**,Mongo 在 Atlas、文件在 R2(都不占本地内存)。**这条决定一切**:外部 API key 点亮的功能几乎零成本;自建吃内存服务才是真负担。

### 表 A — 只需外部 API Key(不占 VPS,beta 应全配)

| 功能 | 点亮需要 | beta 月成本(量小) | 不配的代价 | 推荐 |
|---|---|---|---|---|
| Web Search | 一个 provider key(Tavily 自带搜+抓;reranker 设 `none`) | ~$0 | 开关开了静默无效 | ✅ 必配 |
| Image Gen | `IMAGE_GEN_OAI_API_KEY` **+ 开发 plain-chat 入口** | 按张 ~$0.01–0.17 | 核心卖点形同虚设 | ✅ 必配 + 修入口 |
| Voice STT | 配 `speech.stt` = OpenAI Whisper(别用默认浏览器引擎) | $0.006/分钟 | 默认浏览器引擎质量差 | ✅ 必配 |
| Voice TTS | 配 `speech.tts` = OpenAI(ElevenLabs 太贵) | ~$15/1M 字符 | 默认机器音 | ✅ 必配 |
| Memory 自动抽取 | `memory.agent.enabled=true` + cheap 模型 **+ 开发普通用户可见** | 极低 | "记忆"名存实亡 | ✅ 配 + 修可见性 |

### 表 B — 需自建吃内存服务(8G 机器要权衡)

| 功能 | 点亮需要 | VPS 负担 | 砍/降级代价 | 推荐 |
|---|---|---|---|---|
| 文档向量 RAG | 自建 `rag_api` + pgvector + `EMBEDDINGS_PROVIDER` | ~1–1.5G | 退化成全文本注入(小文档够) | 🟡 beta 降级,真 RAG 列 P1 |
| 对话搜索 | 自建 MeiliSearch + `SEARCH=true` | 几百 M 起 | 无搜索框(beta 用户少价值低) | 🟡 defer |
| Code Interpreter | 官方付费 sandbox key,或自建容器沙箱 | 自建很重 | 随 agents·Pro 门控,本非主线 | 🟡 defer;真上只接官方按量,别自建 |

### 表 C — 纯默认值开关(零成本)

| 项 | Graupel 应设 | 理由 |
|---|---|---|
| `interface.parameters` | 保持隐藏 | 反 ChatGPT |
| `interface.marketplace.use` | 保持 false | agents 走 Pro·隐藏 |
| STT/TTS 默认引擎 | 换成 OpenAI | 浏览器音太差 |
| `artifacts` | 建议开 | 预览能力强、像 Canvas |
| 上传菜单技术选项 | 默认只留"上传文件" | 反 ChatGPT |

### beta 最小可行组合

**现在做**: 表 A 全配 + 表 C 改默认值。**先降级**: RAG 用全文本注入。**先 defer**: 对话搜索、Code Interpreter。**升机器时(stage 5)再上**: 向量 RAG、对话搜索。
→ 8G 不爆,固定成本只多 $13 机器钱,可感知功能(联网/画图/语音/记忆)全到位。

---

## 四、第二大脑选型:Karpathy LLM Wiki vs RAG

**判断:对"个人笔记第二大脑"场景,MVP 用 Karpathy Wiki / long-context 思路(非向量 RAG)更对,且与约束严丝合缝。** 落地是 hybrid,不是"RAG 已死"极端版。

| 维度 | 向量 RAG | Karpathy Wiki | 赢 |
|---|---|---|---|
| 规模匹配 | 强在百万级 | 甜区几百~几千篇(=个人第二大脑) | **Wiki** |
| 基建成本 | 要 pgvector+rag_api 常驻(吃 8G) | 只要 markdown + 长上下文,零基建 | **Wiki** |
| 保留结构 | 切块破坏组织 | 整篇喂,结构完整 | **Wiki** |
| 有状态/累积 | 每次 query 独立 | 知识累积,**LLM 可写回维护** | **Wiki** |
| 可解释 | 黑盒召回 | 明确读了哪几篇 | **Wiki** |
| 单次 token | top-k,省 | 整篇进,贵 | RAG |
| 超大规模 | 可扩展 | 索引超窗即崩 | RAG |
| 幻觉 | 错一次 | 维护时把错"焊死"并顺链传播(需 lint) | RAG |

**落地结论**:
1. **MVP 不上向量 RAG**;笔记走结构化 markdown + 关键词/标签/双链轻路由 → 相关笔记**整篇塞 long-context**。省掉 pgvector/rag_api 两个常驻服务。
2. **多模态入料文本化**:图片→caption/OCR、音视频→转写、PDF→抽取,存为 markdown;看原图时再喂 vision。复用现有 `ocr.ts` / STT / vision / `text.ts` / `context.ts`。
3. **差异化灵魂**:LLM 帮用户**维护**笔记(摘要、建反向链接、去重),对标 youmind 的 AI-maintained Board。
4. **诚实代价**:整篇贵→用便宜模型读 wiki;笔记多到索引超窗→加轻检索层(仍不必向量库);务必有 lint 防幻觉传播。

> 一句话:RAG 为"百万文档大海捞针"而设计,你的场景是"我自己的几百篇笔记",用 RAG 是杀鸡用牛刀且踩它所有缺点。

---

## 五、第二大脑技术可行性(LibreChat 代码核验)

**结论:做得到,但要建——无死结。** agent "读→综合洞察→多步→写回"的智能链路引擎层**白送**;缺"容器 + 写回工具 + 触发器"三块外围工程。

| 能力 | 现状 | 代码证据 / 说明 |
|---|---|---|
| 多步 insight + tool loop | ✅ 白送 | `packages/api/src/agents/run.ts`;LangGraph loop + `recursion_limit`(默认 50)+ subagents + edges(`agent.ts` schema) |
| 写回机制 | ✅ 有现成路径 | **① MCP**:自建 Notes MCP server 暴露写工具,agent 调用链通(`MCP.js:512-596` 构造、`:626-724` `_call`→`callTool`、`handleTools.js:347-381` 装配);**② OpenAPI Action**:支持 POST/PUT/PATCH/DELETE(`packages/data-provider/src/actions.ts:338-350`、`ActionService.js:378`) |
| 笔记存储容器 | ❌ 净新增 | 全 schema 无 user_note/wiki_page/document;memory 是 KV、Artifacts 是 AI 产出物、prompt 是模板。需新建 `Note` schema + collection + CRUD |
| 持久写内置工具 | ❌ 无 | Code Interpreter 写的是**临时沙箱**(`/mnt/data`,会话级,`tools.ts:105` 注释 `/tmp is per-call scratch`),不能当持久 wiki |
| 多模态文本化入料 | ✅ 可复用 | OCR / STT / vision / 文本抽取现成 |
| **后台自动触发** | 🟡 **唯一硬骨头** | agent 执行链硬绑 Express `req`/`res`(`initializeClient` 要 `req.config`/`req.user`,MCP 工具捕获 `res`);**无 `triggerAgentRun(userId, prompt)` 服务函数**。`ResumableAgentController` 已做"HTTP 响应与执行分离",写 ~200–400 行 `backgroundAgentRunner` 构造伪 req/res 绕过中间件即可 |

---

## 六、最小架构 + MVP 实现策略

```
存材料 → 多模态文本化(复用 OCR/STT/vision/文本抽取) → Note collection(新建)
                                                          ↑↓ Notes MCP: search / create / update / link
用户点"整理" 或 @我的笔记 → 对话式 agent run(引擎白送) → 读现有 wiki + 新材料 → 综合洞察 → 写回
检索问答 → agent 用 search_note 轻路由(关键词/标签) → 相关笔记整篇进 long-context
```

### ⭐ MVP 用"手动触发",绕开唯一硬骨头

后台自动 compile/lint 是 Wiki 完整形态,但它就是上面唯一的硬骨头(req/res 解耦)。**MVP 不必啃它**:

> 用户点"整理我的笔记"按钮 / 聊天里 `@我的笔记` 发起 → 走**正常对话式 agent 路径**(用户 req/res 天然就在)→ agent 当场读材料 → 综合 → 调 Notes MCP 写回。**完全避开后台 req/res 解耦那 ~400 行。**

这样 MVP 笔记第二大脑只需:**Note schema/CRUD + Notes MCP(或 Action)+ 多模态入料(复用)**,全在现成机制上拼装。后台自动维护留作第一个增量。对单人 10h/周是决定性的范围简化。

### ⚠️ 待决策 — 第二大脑是否 Pro 门控

[CLAUDE.md](../../../CLAUDE.md) 规定 agents + MCP **默认隐藏、Pro 门控**,但第二大脑底层要靠 agent 引擎 +(很可能)MCP 驱动。解法:把 **agent/MCP 当内部实现**,用户只看到"笔记"、看不到 agent/MCP 概念。但需拍板:第二大脑算 (a) 复用 agent 引擎但所有付费档可用的独立功能,还是 (b) 跟 agent 一起 Pro 门控?

---

## 七、待决策事项汇总

| # | 决策 | 选项 | 影响 |
|---|---|---|---|
| 1 | ~~第二大脑门控~~ ✅**已定(06-17)** | **Free 也给受限额度** — 所有档(含 Free)可用,靠配额递增区分;详见 [设计稿](2026-06-17-second-brain-design-draft.md) | plan 加 `quota.notes` 维度(非 feature flag) |
| 2 | 定价币种 | US$29.99 高端 / 对齐 use.ai ~HK$30 | 定价策略 |
| 3 | 基建必配 or 砍 | 向量 RAG / 对话搜索 / Code Interpreter 各自定 | 见 §3 决策表 |
| 4 | 容器对标档位 | 轻 Projects / 重 Board / 中间 | 笔记功能范围(当前定:轻容器 + Wiki 检索) |
