# ChatGPT 网页版功能对标 & LibreChat 能力盘点

> **日期**: 2026-06-05 ｜ **作者**: 小天 ｜ **类型**: 竞品研究 / 能力盘点
>
> **目的**: 为 Graupel 回答两个问题 —— (1) ChatGPT 网页版有哪些功能、Graupel MVP 如何取舍;(3) LibreChat 现有代码已经实现了哪些、缺哪些。并参考 [youmind.com](https://youmind.com/),以"让用户体验接近 ChatGPT"为目标给出对齐建议。
>
> **方法**: 11 个功能领域各派只读 agent 逐文件核验(Explore),交叉比对 [MVP 设计](../specs/2026-05-21-graupel-mvp-design.md) 与 [stage-1~5 specs](../specs/);youmind 部分基于公开评测(官网 WebFetch 被网络策略拦截)。证据为代码盘点时点 `main @ 08cf714e9` 的实际文件,引用具体功能前请复核文件仍存在。
>
> **图例**: 状态 ✅完整 / 🟡有但需配置或半成品 / ❌缺失 ｜ Graupel 态度 【核心】【保留·Pro门控】【砍】【缺·需决策】【v2差异化】

---

## 一句话结论

**LibreChat 在"能力"维度已是 ChatGPT 网页版的超集 —— 几乎每个 ChatGPT 功能都有代码实现。差距全在"UX 维度":它是开发者/管理员导向(功能默认关闭、暴露技术抽象、入口埋得深),而 ChatGPT 是消费级零配置。** 因此"让 Graupel 像 ChatGPT"约 80% 是配置 + 美化 + 改默认值,仅约 20% 是真缺口需要新建。对 10h/周的单人项目,这是极好的消息。

---

## 目录

- [二、逐功能对标矩阵](#二逐功能对标矩阵)
- [三、让它"像 ChatGPT"的 4 个 UX 病灶](#三让它像-chatgpt-的-4-个-ux-病灶)
- [四、真缺口清单(按性价比排序)](#四真缺口清单按性价比排序)
- [五、youmind 的差异化弹药](#五youmind-的差异化弹药)
- [六、下一步建议](#六下一步建议)
- [附录:Graupel MVP 范围速查](#附录graupel-mvp-范围速查)

---

## 二、逐功能对标矩阵

### 1. 模型与多 Provider —— LibreChat 最强项

| ChatGPT 功能 | 现状 | Graupel | 关键差距 / 动作 |
|---|---|---|---|
| 模型切换 picker | ✅ | 【核心】 | 默认暴露 raw model id + provider 分组,像开发者工具。**必须用 `modelSpecs` 做策展好的命名模型卡**(标签/描述/图标),藏掉 provider 层 |
| 推理模型(o系列/thinking) | ✅ | 【核心】 | 能力超 ChatGPT(全 provider),但 effort/budget 旋钮在右侧参数面板,发现性差 |
| 参数面板(温度等) | ✅ | 【保留·隐藏】 | 反 ChatGPT(ChatGPT 不给用户)。MVP 默认隐藏 `interface.parameters` 正确 |
| 预设 presets | ✅ | 【保留·隐藏】 | 用户级 preset 菜单偏工具感;`modelSpecs` 才是对标 ChatGPT 模型卡的正确原语 |
| 多 provider 后端 | ✅ | 【核心·砍部分】 | 砍 Bedrock/Vertex/Ollama/Assistants(保留 `EModelEndpoint` enum) |

**关键代码**: `client/src/components/Chat/Menus/Endpoints/ModelSelector.tsx`、`packages/api/src/modelSpecs/index.ts`、`packages/data-provider/src/parameterSettings.ts`(推理旋钮)、`packages/data-schemas/src/schema/preset.ts`。

**takeaway**: 立身之本(多模型)恰恰最成熟。核心工作不是开发,是**写一份漂亮的 modelSpecs**,把"openAI → gpt-4o-2024…"变成"GPT-5 · 旗舰"。

### 2. 对话管理 —— ChatGPT 体验骨架,基本齐全

| 功能 | 现状 | 关键差距 |
|---|---|---|
| 历史侧栏(按日期分组+无限滚动) | ✅ | 完全对齐,分组逻辑(Today/Yesterday/…)就是抄 ChatGPT(`client/src/utils/convos.ts` `groupConversationsByDate`) |
| 搜索对话 | 🟡 | **依赖自建 MeiliSearch**(`SEARCH=true` + `MEILI_HOST`),无 MongoDB 兜底 —— 不部署就完全没有搜索框 |
| 文件夹 / Projects | 🟡 | 只有扁平 tag/书签(`conversationTag.ts`、`BookmarkMenu.tsx`),**没有 ChatGPT Projects**(项目级指令+文件+分组) |
| 归档 | ✅ | 有,入口埋在 Settings > General 而非侧栏 |
| 公开分享链接 | ✅ | 完整(`share.js`、`SharedLink` schema),还多了二维码 |
| 临时/无痕对话 | ✅ | `client/src/components/Chat/TemporaryChat.tsx`,服务端 TTL(非纯客户端) |
| 编辑消息+重新生成 | ✅ | 完整,还多了"只存不重生成"选项 |
| 分支/fork/多版本切换 | ✅ | 比 ChatGPT 更强(显式 fork 模式 DIRECT_PATH/INCLUDE_BRANCHES/TARGET_LEVEL) |
| 重命名/删除 | ✅ | 完整;**置顶单条会话没有**(只能 pin 模型/agent) |

**takeaway**: 骨架很稳。两个决策:(a) 搜索要不要付 MeiliSearch 运维成本(ChatGPT 搜索零配置);(b) Projects 是差异化点,见第五节。

### 3. 多模态:视觉 & 图像生成 —— 有大坑 ⚠️

| 功能 | 现状 | 关键差距 |
|---|---|---|
| 图片输入(vision) | ✅ | 接近 ChatGPT,但只在选了 vision 模型时生效,选错模型图片被静默忽略(`api/server/services/Files/images/encode.js`) |
| 图像生成(DALL-E/gpt-image) | 🟡 | **致命:只能作为 _Agent 工具_ 调用**(`OpenAIImageTools.js` 显式 `throw 'only available for agents'`),普通聊天里"画只猫"不工作。要建 agent→开工具→配 key |
| 图像编辑/迭代 | 🟡 | gpt-image-1/Gemini 支持,但无蒙版/区域选、无画布,且同样 agent-only;`// TODO: mask support` 未做 |

**takeaway**: ⚠️ **MVP 隐藏雷区**。spec 把"图像生成"列为核心 plan-gated 功能,但现状要求用户懂 agents,与"像 ChatGPT 随手画图"相悖。**需专门做 plain-chat 图像生成入口**(ephemeral agent 自动挂载 image 工具)—— 实打实开发工作,非配置。

### 4. 文件上传 & RAG

| 功能 | 现状 | 关键差距 |
|---|---|---|
| 文件上传(PDF/Office/代码) | ✅ | 格式覆盖 ≥ ChatGPT(`packages/data-provider/src/file-config.ts`) |
| 文档问答/检索(RAG) | 🟡 | 真向量 RAG 完整,但**依赖独立 RAG_API + pgvector 服务**;不部署退化成"把文本塞进 context" |
| 会话/agent 级文件作用域 | ✅ | 比 ChatGPT 更强(`tool_resources` 按 file_search/code/context 分桶) |

**takeaway**: 上传有个反 ChatGPT 点:回形针菜单**让用户选"按文本/按RAG/按代码"上传**,ChatGPT 自动决定 —— 需默认收起。RAG 同样是"要不要付运维"的决策。

### 5. 工具:代码执行 / 联网搜索

| 功能 | 现状 | 关键差距 |
|---|---|---|
| Code Interpreter | ✅ | 渲染接近 ChatGPT,但**依赖 LibreChat 官方付费 sandbox API**(`LIBRECHAT_CODE_API_KEY`)或自建 |
| 联网搜索+引用 | ✅ | **做得很好**,引用 UI(`client/src/components/Web/Citation.tsx`)几乎照搬 ChatGPT;但需配 provider key,否则开关静默隐藏 |
| 插件框架 | 🟡 | 老 gptPlugins 商店已删;现代化为内置工具+MCP+Actions,无消费级"插件市场" |

**takeaway**: web search 是亮点,能力和视觉都到位,主要是配 key + 默认开。code interpreter 要么接官方付费 sandbox 要么自建。

### 6. Artifacts / Canvas

| 功能 | 现状 | 关键差距 |
|---|---|---|
| Canvas 协作编辑面 | 🟡 | 有可编辑 Monaco 面板(`client/src/components/Artifacts/`),但**不协作** —— 模型看不到画布修改,不能"选中段落让 AI 改写" |
| 代码实时预览(React/HTML) | ✅ | 用 Sandpack,能力 ≥ ChatGPT(预装 shadcn/ui 全套 + three/recharts) |
| 版本管理 | 🟡 | "版本"只是不同 artifact 块跳转,**非单文档编辑历史,存了就覆盖,无 diff/回滚** |

**takeaway**: 预览能力强,但 Canvas 的"人机协同改写"灵魂没有。短期可接受(用对话改写),真对标 ChatGPT Canvas 是中等开发量。

### 7. Agents / 自定义 GPT / Store

| 功能 | 现状 | 关键差距 |
|---|---|---|
| 自定义 GPT(指令+工具+知识) | ✅ | 能力 ≥ ChatGPT GPTs;但右侧面板手填,**无 ChatGPT 对话式 GPT Builder** |
| GPT Store(分类/搜索) | 🟡 | `client/src/components/Agents/Marketplace.tsx` 存在但**默认关闭**(`interface.marketplace.use=false`),分类是 B2B 那套(HR/财务/IT),无评分/榜单/公开发布流 |
| 分享 agent | ✅ | ACL 权限系统比 ChatGPT 强但更像企业 IT,偏复杂 |
| Deep Research / Operator | 🟡 | 引擎能跑多步 subagent,但**无一键"深度研究"/Operator 打包入口** |

**takeaway**: 与 MVP【agents 保留·Pro·默认隐藏】一致,本就不在消费主线。Deep Research 已被 spec 列为 v2 差异化。

### 8. 记忆与个性化 —— 招牌功能缺失 ⚠️

| 功能 | 现状 | 关键差距 |
|---|---|---|
| Memory(跨会话记忆) | 🟡 | CRUD/开关/inline 提示都有(`api/server/routes/memories.js`),但**①管理面板 admin-only**(普通用户只能开关,看不到/改不了自己的记忆)**②自动抽取默认关**(`memory.agent.enabled`)**③只在 agents 端点生效**,直连 OpenAI/Claude 不自动更新 |
| **账号级 Custom Instructions** | ❌ | **完全没有**。ChatGPT 招牌"关于你/希望我如何回应"两个框零实现;只有 _每会话_ 的 `promptPrefix`,`User.personalization` 仅含 `{ memories?: boolean }` |
| Prompt 库 | ✅ | 实现丰富(变量 `{{x:a|b}}`/版本/斜杠命令),但完整编辑器也是 admin-only |

**takeaway**: ⚠️ MVP 写了"memory 保留"但**漏了三个限制**:普通用户摸不到记忆管理、不自动、非 agent 端点失效。而**账号级 Custom Instructions 是 ChatGPT 用户肌肉记忆,却 ❌** —— 强烈建议纳入,成本不高(User schema 加字段 + 设置页两个框 + 注入 system prompt)。

### 9. 语音

| 功能 | 现状 | 关键差距 |
|---|---|---|
| 语音输入(STT) | ✅ | `AudioRecorder.tsx`,默认关;默认走浏览器引擎(质量看浏览器) |
| 朗读(TTS) | ✅ | provider 比 ChatGPT 多(OpenAI/Azure/ElevenLabs/LocalAI);默认关、默认机器音 |
| **实时语音对话** | ❌ | **完全没有**。无 WebRTC/realtime session,"对话模式"只是 STT 自动发送的拼接,不能打断、每轮要手动点麦 |

**takeaway**: 基础 STT/TTS 够用(配 provider + 默认开)。**ChatGPT 全屏实时语音是最大单点缺口**,要新建 realtime 管线 + 全屏 UI,工作量大,建议 defer。

### 10. MCP / 连接器

| 功能 | 现状 | 关键差距 |
|---|---|---|
| MCP 服务器集成 | ✅ | 技术深度**超过** ChatGPT(PKCE OAuth/per-user/UI资源渲染,`packages/api/src/mcp/`),但加服务器要填裸 URL,无市场 |
| 外部连接器(Google Drive 等) | 🟡 | **只有 SharePoint/OneDrive 且仅限 Entra ID 登录**;无 Google Drive,无"已连接"管理页 |

**takeaway**: 与 MVP【MCP·Pro·默认隐藏】+【connector marketplace 列 v2】一致,短期不用管。

### 11. 定时任务(Tasks)

| 功能 | 现状 | 关键差距 |
|---|---|---|
| 定时/重复任务 | ❌ | **代码库零实现**(无调度器依赖、无 schema、无路由、无 UI)。spec 任何 stage 都没提 |

**takeaway**: 净新增功能,不在 MVP。ChatGPT 有 Tasks,但可放心 defer。

---

## 三、让它"像 ChatGPT"的 4 个 UX 病灶

所有差距收敛成 4 个反复出现的模式:

**病灶① 默认关闭 / 依赖外部基建** —— search(MeiliSearch)、RAG(RAG_API)、code interpreter(sandbox)、web search(key)、voice(provider)、image(key)、memory 自动抽取、marketplace,**默认全是黑的**。ChatGPT 零配置开箱即用。
→ **对齐**: 做"上线必配清单",每个功能定"部署基建 or 砍";能开的全默认开。

**病灶② 暴露技术抽象** —— provider/endpoint 概念、raw model id、参数面板、上传时选 OCR/RAG/code、MCP 裸 URL。
→ **对齐**: ① modelSpecs 策展模型卡(藏 provider);② 参数面板默认隐藏(MVP 已规划 ✓);③ 上传菜单默认只留"上传文件",自动决定处理方式。

**病灶③ 发现性差 / 入口埋太深 / admin-only** —— 归档在 Settings、memory 面板 admin-only、prompt 编辑器 admin-only、工具藏在 + 菜单。
→ **对齐**: memory 管理对**普通用户**开放(当前 `isAdmin` 门控是体验级 bug);核心功能上浮到显眼位置。

**病灶④ 半成品 & 真缺口** —— 见下一节。

---

## 四、真缺口清单(按性价比排序)

| 缺口 | 类型 | 建议 |
|---|---|---|
| **账号级 Custom Instructions** | ❌ 真缺 | ⭐ **强烈建议纳入 MVP** —— 招牌功能、成本低 |
| **图像生成的 plain-chat 入口** | 🟡 agent-only | ⭐ **MVP 必修** —— 否则"图像生成"核心卖点形同虚设 |
| **Memory 对普通用户开放 + 打通直连端点** | 🟡 受限 | ⭐ MVP 应修 —— 否则"memory 保留"名不副实 |
| 对话搜索(MeiliSearch) | 🟡 需基建 | 决策:部署 or 接受降级 |
| RAG / Code Interpreter / Web search 基建 | 🟡 需基建/key | 决策:配 or 砍(都在 plan-gated 范围) |
| Canvas 协同改写 | 🟡 半成品 | 可 defer,先用对话改写 |
| 实时语音对话 | ❌ 真缺 | defer(工作量大) |
| Projects(项目级上下文) | ❌/v2 | v2 差异化,见第五节 |
| 定时任务 Tasks | ❌ 真缺 | defer(不在 MVP) |
| Deep Research / Operator | 🟡/v2 | v2 差异化 |

---

## 五、youmind 的差异化弹药 —— 正好填补 v2 的"Projects"

[youmind.com](https://youmind.com/) 定位 **"学习+创作合一的工作台"(Input→Process→Output)**,本身建在 ChatGPT/Claude 之上,**不是 ChatGPT 竞品而是上层**。最值得借鉴、且恰好对应 spec 里 defer 到 v2 的 "Projects" 的机制:

1. **Board/Project = 持久项目级上下文容器**(最高杠杆):把"源材料+对话+草稿"绑在一个项目里,AI 把整个项目当环境上下文。把无状态聊天升级成有状态工作台,而不抛弃聊天范式。
2. **`@项目` 寻址上下文** —— `@ThisBoard` 让用户显式把问题限定到"这个项目的全部材料"。
3. **Ask / Agent 双模式** —— 轻量问答 vs 重型多步创作,**天然对应配额/成本门控边界**(轻的便宜、重的 Pro)。
4. **AI 输出即可编辑文档**(非冻结聊天气泡)—— 增强拥有感,和 Canvas 方向一致。
5. **一键从一句话起项目** —— 自动找源、搭报告骨架,降低空白工作台门槛。

**怎么用**: 短期(MVP)目标是"**像 ChatGPT**",应优先做 ChatGPT 的 **Projects 简化版**(项目=会话分组+项目级指令+项目级文件),**而非**直接上 youmind 重型创作流。v2 做差异化时,再把 youmind 的 Board 持久上下文 + Ask/Agent 双模式作为蓝图,具象化 spec 里的 "Projects / Deep Research" v2 差异化。

> ⚠️ 事实更正:youmind 的核心原语是 **Board**,未发现叫 "BENCH" 的功能。官网 WebFetch 被网络策略拦截,以上源自搜索结果与多篇评测,准确度以官网为准。

---

## 六、下一步建议

1. **最该立刻进 MVP 待办的 3 件小事**(高性价比、强对齐 ChatGPT):账号级 Custom Instructions、图像生成 plain-chat 入口、Memory 对普通用户开放。三件 spec 都漏了,但都是 ChatGPT 用户核心预期。
2. **一份"上线必配 vs 砍"决策表**:search / RAG / code interpreter / web search / voice / image —— 逐个定"部署基建 or 砍",因为它们默认全黑。
3. **modelSpecs 策展**:把"开发者工具感"变"ChatGPT 感"的最大单点杠杆,且零开发(写配置)。

---

## 附录:Graupel MVP 范围速查

来源:[graupel-mvp-design](../specs/2026-05-21-graupel-mvp-design.md) 及各 stage spec。

**纳入 MVP**: 多 LLM 5 provider(OpenAI/Anthropic/Google/xAI/DeepSeek)+ 自定义 OpenAI 兼容端点、Web Search(plan-gated)、文件/RAG、图像生成(plan-gated)、语音 TTS/STT(plan-gated)、Memory、邮箱 magic-link 登录(stage 2)、Google/GitHub/本地密码登录、Plan/Quota/Gating(stage 3,无支付)、营销页 SSG(stage 4)、监控/邮件自动化/备份(stage 5)、Graupel 全面换肤。

**砍掉**: Stripe/支付(→ stage 6)、Bedrock/Vertex/Ollama/OpenAI-Assistants 端点、Discord/Apple/Facebook/SAML/LDAP/OpenID 登录、token 余额展示。

**保留但默认隐藏/Pro 门控**: Agents + MCP(power-user 特性)。

**v2 差异化(defer)**: Deep Research、Projects、connector marketplace。

**ChatGPT 有但 spec 未覆盖(本报告新发现,需决策)**: 账号级 Custom Instructions(❌)、定时任务 Tasks(❌)、实时语音对话(❌)、图像生成的非-agent 入口(🟡)、Memory 的普通用户可见性与直连端点生效(🟡)。

**Plan 档位**: Free($0,仅便宜模型,3 条试用,高级功能全关) / Trial($1·7天,全功能,100 条) / Pro($29.99/mo 起,全功能,2000 条)。成本分层:cheap(<$1/1M) / mid($1-10) / expensive(>$10)。
