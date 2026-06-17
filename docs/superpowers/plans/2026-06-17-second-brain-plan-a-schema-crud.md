# 笔记第二大脑 — Plan A:Note Schema + CRUD 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为笔记第二大脑落地数据层 —— `Note` collection 的 schema、类型、CRUD methods 与薄 REST 路由,可独立增删改查并按用户隔离。

**Architecture:** 沿用 LibreChat data-schemas 工厂模式:`schema/note.ts`(mongoose schema)→ `models/note.ts`(`createNoteModel`,注册进 `createModels`)→ `methods/note.ts`(`createNoteMethods`,聚合进 `createMethods`,经 `api/models` 自动暴露为 `~/models` 导出)→ `api/server/routes/notes.js`(薄 JS 路由,`requireJwtAuth` + `req.user.id` 作用域)。

**Tech Stack:** TypeScript(packages/data-schemas)、Mongoose、Express(api 薄路由,JS)、Jest + `mongodb-memory-server` + supertest。

## Global Constraints

- 新后端逻辑一律 **TypeScript in `packages/data-schemas`**;`api/` 只放薄 JS 路由(verbatim: CLAUDE.md workspace boundaries)。
- **Never use `any`**;显式类型,避免 `Record<string, unknown>`(用 mongoose `FilterQuery`/`UpdateQuery`)。
- **单词文件名**:`note.ts` / `notes.js`。
- 测试:**real logic over mocks**,用 `mongodb-memory-server` 真实内存库,测真实 query 与 schema 校验。
- **Graupel 单租户**:Note 模型**不引入** tenant isolation(不调用 `applyTenantIsolation`);`tenantId` 字段保留以与现有 schema 风格一致,但不参与查询隔离。用户隔离靠 `user` 字段 + `req.user.id`。
- 数据模型 verbatim 自 [spec §5](../specs/2026-06-17-graupel-second-brain.md#5-数据模型)。`notebookId` 字段保留但 P0 恒空(Notebook 属 P1)。

---

## File Structure

- Create `packages/data-schemas/src/types/note.ts` — Note 接口、lean 类型、方法参数/结果类型
- Modify `packages/data-schemas/src/types/index.ts` — 导出 note 类型
- Create `packages/data-schemas/src/schema/note.ts` — mongoose schema
- Create `packages/data-schemas/src/models/note.ts` — `createNoteModel`
- Modify `packages/data-schemas/src/models/index.ts` — 注册 `Note`
- Create `packages/data-schemas/src/methods/note.ts` — `createNoteMethods` + `NoteMethods`
- Modify `packages/data-schemas/src/methods/index.ts` — 聚合 note methods
- Create `packages/data-schemas/src/methods/note.spec.ts` — schema + methods 测试
- Create `api/server/routes/notes.js` — REST 路由
- Modify `api/server/routes/index.js` — 引入并导出 notes 路由
- Modify `api/server/index.js` — 挂载 `/api/notes`
- Create `api/server/routes/notes.test.js` — 路由集成测试

---

## Task 1: Note 类型 + Schema + Model 注册

**Files:**
- Create: `packages/data-schemas/src/types/note.ts`
- Modify: `packages/data-schemas/src/types/index.ts`
- Create: `packages/data-schemas/src/schema/note.ts`
- Create: `packages/data-schemas/src/models/note.ts`
- Modify: `packages/data-schemas/src/models/index.ts:27` (imports) `:65` (registration)
- Test: `packages/data-schemas/src/methods/note.spec.ts`

**Interfaces:**
- Produces: `INote`, `INoteLean`, `INoteAttachment`, `NoteAttachmentKind`, `CreateNoteParams`, `GetNoteParams`, `GetUserNotesParams`, `UpdateNoteParams`, `SearchNotesParams`, `DeleteNoteParams`, `NoteDeleteResult`(types/note.ts);`createNoteModel`(models/note.ts);mongoose model `'Note'`。

- [ ] **Step 1: 写类型文件**

Create `packages/data-schemas/src/types/note.ts`:

```ts
import type { Types, Document } from 'mongoose';

export type NoteAttachmentKind = 'image' | 'audio' | 'video' | 'pdf' | 'doc' | 'web';
export type NoteSource = 'manual' | 'upload' | 'clip';

export interface INoteAttachment {
  file_id: string;
  kind: NoteAttachmentKind;
  derivedText?: string;
  sourceUrl?: string;
}

export interface INote extends Document {
  user: Types.ObjectId;
  notebookId?: Types.ObjectId;
  title: string;
  content: string;
  tags?: string[];
  links?: Types.ObjectId[];
  attachments?: INoteAttachment[];
  source: NoteSource;
  tokenCount?: number;
  maintainedAt?: Date;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface INoteLean {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  notebookId?: Types.ObjectId;
  title: string;
  content: string;
  tags?: string[];
  links?: Types.ObjectId[];
  attachments?: INoteAttachment[];
  source: NoteSource;
  tokenCount?: number;
  maintainedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateNoteParams {
  user: string | Types.ObjectId;
  title: string;
  content?: string;
  tags?: string[];
  source?: NoteSource;
}

export interface GetNoteParams {
  user: string | Types.ObjectId;
  id: string | Types.ObjectId;
}

export interface GetUserNotesParams {
  user: string | Types.ObjectId;
  tags?: string[];
}

export interface UpdateNoteParams {
  user: string | Types.ObjectId;
  id: string | Types.ObjectId;
  update: {
    title?: string;
    content?: string;
    tags?: string[];
    addLinks?: (string | Types.ObjectId)[];
  };
}

export interface SearchNotesParams {
  user: string | Types.ObjectId;
  query: string;
  tags?: string[];
  limit?: number;
}

export interface DeleteNoteParams {
  user: string | Types.ObjectId;
  id: string | Types.ObjectId;
}

export interface NoteDeleteResult {
  ok: boolean;
}
```

- [ ] **Step 2: 导出类型**

Modify `packages/data-schemas/src/types/index.ts` — 在文件中已有的 `export * from './memory';`(line 23)附近加一行:

```ts
export * from './note';
```

- [ ] **Step 3: 写 schema**

Create `packages/data-schemas/src/schema/note.ts`:

```ts
import { Schema } from 'mongoose';
import type { INote } from '~/types/note';

const noteAttachment = new Schema(
  {
    file_id: { type: String, required: true },
    kind: {
      type: String,
      enum: ['image', 'audio', 'video', 'pdf', 'doc', 'web'],
      required: true,
    },
    derivedText: { type: String },
    sourceUrl: { type: String },
  },
  { _id: false },
);

const note: Schema<INote> = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    notebookId: { type: Schema.Types.ObjectId, ref: 'Notebook', index: true },
    title: { type: String, required: true },
    content: { type: String, default: '' },
    tags: { type: [String], index: true },
    links: [{ type: Schema.Types.ObjectId, ref: 'Note' }],
    attachments: { type: [noteAttachment], default: undefined },
    source: { type: String, enum: ['manual', 'upload', 'clip'], default: 'manual' },
    tokenCount: { type: Number, default: 0 },
    maintainedAt: { type: Date },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

note.index({ user: 1, updatedAt: -1 });
note.index({ user: 1, tags: 1 });

export default note;
```

- [ ] **Step 4: 写 model 工厂**

Create `packages/data-schemas/src/models/note.ts`(注:不调用 `applyTenantIsolation`,见 Global Constraints):

```ts
import noteSchema from '~/schema/note';
import type { INote } from '~/types/note';

export function createNoteModel(mongoose: typeof import('mongoose')) {
  return mongoose.models.Note || mongoose.model<INote>('Note', noteSchema);
}
```

- [ ] **Step 5: 注册 model**

Modify `packages/data-schemas/src/models/index.ts`:
- 在 import 区(line 27 `import { createMemoryModel } from './memory';` 之后)加:

```ts
import { createNoteModel } from './note';
```

- 在 `createModels` return 对象(line 65 `MemoryEntry: createMemoryModel(mongoose),` 之后)加:

```ts
    Note: createNoteModel(mongoose),
```

- [ ] **Step 6: 写失败测试(schema 校验)**

Create `packages/data-schemas/src/methods/note.spec.ts`:

```ts
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import noteSchema from '~/schema/note';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  mongoose.models.Note || mongoose.model('Note', noteSchema);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

describe('Note schema', () => {
  const user = new mongoose.Types.ObjectId();

  test('creates a note with defaults', async () => {
    const Note = mongoose.models.Note;
    const note = await Note.create({ user, title: 'My Note' });
    expect(note.title).toBe('My Note');
    expect(note.content).toBe('');
    expect(note.source).toBe('manual');
    expect(note.tokenCount).toBe(0);
    expect(note.createdAt).toBeInstanceOf(Date);
  });

  test('requires a title', async () => {
    const Note = mongoose.models.Note;
    await expect(Note.create({ user })).rejects.toThrow();
  });

  test('rejects an invalid attachment kind', async () => {
    const Note = mongoose.models.Note;
    await expect(
      Note.create({ user, title: 'T', attachments: [{ file_id: 'f1', kind: 'bogus' }] }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 7: 运行测试,确认失败**

Run: `cd /data/lidongyu/projects/LibreChat/packages/data-schemas && npx jest src/methods/note.spec.ts`
Expected: FAIL — 在 Step 1-5 完成前,`~/schema/note` 不存在 / 解析错误。完成 Step 1-5 后此测试应 PASS(schema 已定义)。

- [ ] **Step 8: 运行测试,确认通过**

Run: `cd /data/lidongyu/projects/LibreChat/packages/data-schemas && npx jest src/methods/note.spec.ts`
Expected: PASS(3 个用例)。

- [ ] **Step 9: 提交**

```bash
cd /data/lidongyu/projects/LibreChat
git add packages/data-schemas/src/types/note.ts packages/data-schemas/src/types/index.ts packages/data-schemas/src/schema/note.ts packages/data-schemas/src/models/note.ts packages/data-schemas/src/models/index.ts packages/data-schemas/src/methods/note.spec.ts
git commit -m "feat(notes): add Note schema, types and model"
```

---

## Task 2: Note CRUD Methods

**Files:**
- Create: `packages/data-schemas/src/methods/note.ts`
- Modify: `packages/data-schemas/src/methods/index.ts:9` (import) `:76` (AllMethods) `:200` (return) `:241` (export type)
- Test: `packages/data-schemas/src/methods/note.spec.ts`(扩展)

**Interfaces:**
- Consumes: `INote`, `INoteLean`, `CreateNoteParams`, `GetNoteParams`, `GetUserNotesParams`, `UpdateNoteParams`, `SearchNotesParams`, `DeleteNoteParams`, `NoteDeleteResult`(Task 1);mongoose model `'Note'`。
- Produces: `createNoteMethods(mongoose)` 返回 `{ createNote, getNoteById, getUserNotes, updateNote, deleteNote, searchNotes, deleteAllUserNotes }`;`NoteMethods` 类型。这些方法经 `createMethods` 聚合后从 `~/models` 导出,供 Task 3 路由消费。
  - `createNote(p: CreateNoteParams): Promise<INoteLean>`
  - `getNoteById(p: GetNoteParams): Promise<INoteLean | null>`
  - `getUserNotes(p: GetUserNotesParams): Promise<INoteLean[]>`
  - `updateNote(p: UpdateNoteParams): Promise<INoteLean | null>`
  - `deleteNote(p: DeleteNoteParams): Promise<NoteDeleteResult>`
  - `searchNotes(p: SearchNotesParams): Promise<INoteLean[]>`
  - `deleteAllUserNotes(user: string | Types.ObjectId): Promise<number>`

- [ ] **Step 1: 写 methods**

Create `packages/data-schemas/src/methods/note.ts`:

```ts
import { Types } from 'mongoose';
import type { FilterQuery, UpdateQuery } from 'mongoose';
import type * as t from '~/types';
import type { INote } from '~/types/note';

export function createNoteMethods(mongoose: typeof import('mongoose')) {
  async function createNote({
    user,
    title,
    content = '',
    tags,
    source = 'manual',
  }: t.CreateNoteParams): Promise<t.INoteLean> {
    const Note = mongoose.models.Note;
    const doc = await Note.create({ user, title, content, tags, source });
    return doc.toObject() as t.INoteLean;
  }

  async function getNoteById({ user, id }: t.GetNoteParams): Promise<t.INoteLean | null> {
    const Note = mongoose.models.Note;
    return (await Note.findOne({ _id: id, user }).lean()) as t.INoteLean | null;
  }

  async function getUserNotes({ user, tags }: t.GetUserNotesParams): Promise<t.INoteLean[]> {
    const Note = mongoose.models.Note;
    const filter: FilterQuery<INote> = { user };
    if (tags && tags.length > 0) {
      filter.tags = { $in: tags };
    }
    return (await Note.find(filter).sort({ updatedAt: -1 }).lean()) as t.INoteLean[];
  }

  async function updateNote({ user, id, update }: t.UpdateNoteParams): Promise<t.INoteLean | null> {
    const Note = mongoose.models.Note;
    const ops: UpdateQuery<INote> = {};
    const set: Record<string, string | string[]> = {};
    if (update.title !== undefined) set.title = update.title;
    if (update.content !== undefined) set.content = update.content;
    if (update.tags !== undefined) set.tags = update.tags;
    if (Object.keys(set).length > 0) {
      ops.$set = set;
    }
    if (update.addLinks && update.addLinks.length > 0) {
      ops.$addToSet = { links: { $each: update.addLinks.map((l) => new Types.ObjectId(l)) } };
    }
    if (Object.keys(ops).length === 0) {
      return (await Note.findOne({ _id: id, user }).lean()) as t.INoteLean | null;
    }
    return (await Note.findOneAndUpdate({ _id: id, user }, ops, { new: true }).lean()) as
      | t.INoteLean
      | null;
  }

  async function deleteNote({ user, id }: t.DeleteNoteParams): Promise<t.NoteDeleteResult> {
    const Note = mongoose.models.Note;
    const result = await Note.findOneAndDelete({ _id: id, user });
    return { ok: !!result };
  }

  async function searchNotes({
    user,
    query,
    tags,
    limit = 10,
  }: t.SearchNotesParams): Promise<t.INoteLean[]> {
    const Note = mongoose.models.Note;
    const filter: FilterQuery<INote> = { user };
    if (query) {
      const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { title: { $regex: safe, $options: 'i' } },
        { content: { $regex: safe, $options: 'i' } },
      ];
    }
    if (tags && tags.length > 0) {
      filter.tags = { $in: tags };
    }
    return (await Note.find(filter).sort({ updatedAt: -1 }).limit(limit).lean()) as t.INoteLean[];
  }

  async function deleteAllUserNotes(user: string | Types.ObjectId): Promise<number> {
    const Note = mongoose.models.Note;
    const result = await Note.deleteMany({ user });
    return result.deletedCount;
  }

  return {
    createNote,
    getNoteById,
    getUserNotes,
    updateNote,
    deleteNote,
    searchNotes,
    deleteAllUserNotes,
  };
}

export type NoteMethods = ReturnType<typeof createNoteMethods>;
```

- [ ] **Step 2: 聚合 methods**

Modify `packages/data-schemas/src/methods/index.ts`:
- import 区(line 9 `import { createMemoryMethods, type MemoryMethods } from './memory';` 之后)加:

```ts
/* Notes */
import { createNoteMethods, type NoteMethods } from './note';
```

- `AllMethods` 交叉类型(line 76 `MemoryMethods &` 之后)加:

```ts
  NoteMethods &
```

- `createMethods` 的 return 对象(line 200 `...createMemoryMethods(mongoose),` 之后)加:

```ts
    ...createNoteMethods(mongoose),
```

- 末尾 `export type { ... }` 列表(line 241 `MemoryMethods,` 之后)加:

```ts
  NoteMethods,
```

- [ ] **Step 3: 写失败测试(methods)**

Modify `packages/data-schemas/src/methods/note.spec.ts`:
- 顶部 import 区追加:

```ts
import { createNoteMethods } from './note';
```

- 在文件末尾追加 describe(在其内部创建 methods,无需改动 `beforeAll`):

```ts
describe('Note methods', () => {
  const user = new mongoose.Types.ObjectId();
  const otherUser = new mongoose.Types.ObjectId();
  const methods = createNoteMethods(mongoose);

  test('createNote then getNoteById', async () => {
    const created = await methods.createNote({ user, title: 'A', content: 'body', tags: ['x'] });
    expect(created.title).toBe('A');
    const fetched = await methods.getNoteById({ user, id: created._id });
    expect(fetched?.content).toBe('body');
  });

  test('getNoteById is user-scoped', async () => {
    const created = await methods.createNote({ user, title: 'mine' });
    const leaked = await methods.getNoteById({ user: otherUser, id: created._id });
    expect(leaked).toBeNull();
  });

  test('getUserNotes lists only the user notes, newest first', async () => {
    await methods.createNote({ user, title: 'first' });
    await methods.createNote({ user, title: 'second' });
    await methods.createNote({ user: otherUser, title: 'theirs' });
    const notes = await methods.getUserNotes({ user });
    expect(notes).toHaveLength(2);
  });

  test('updateNote sets fields and addLinks', async () => {
    const a = await methods.createNote({ user, title: 'a' });
    const b = await methods.createNote({ user, title: 'b' });
    const updated = await methods.updateNote({
      user,
      id: a._id,
      update: { content: 'new', tags: ['t'], addLinks: [b._id] },
    });
    expect(updated?.content).toBe('new');
    expect(updated?.tags).toEqual(['t']);
    expect(updated?.links?.map((l) => l.toString())).toContain(b._id.toString());
  });

  test('searchNotes matches title/content, respects tags + limit', async () => {
    await methods.createNote({ user, title: 'pricing ideas', content: 'subscription', tags: ['biz'] });
    await methods.createNote({ user, title: 'random', content: 'nothing here', tags: ['misc'] });
    const byKeyword = await methods.searchNotes({ user, query: 'subscription' });
    expect(byKeyword).toHaveLength(1);
    expect(byKeyword[0].title).toBe('pricing ideas');
    const byTag = await methods.searchNotes({ user, query: '', tags: ['biz'] });
    expect(byTag).toHaveLength(1);
  });

  test('deleteNote and deleteAllUserNotes', async () => {
    const n = await methods.createNote({ user, title: 'to delete' });
    const del = await methods.deleteNote({ user, id: n._id });
    expect(del.ok).toBe(true);
    await methods.createNote({ user, title: 'one' });
    await methods.createNote({ user, title: 'two' });
    const count = await methods.deleteAllUserNotes(user);
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 4: 运行测试,确认失败 → 实现后通过**

Run: `cd /data/lidongyu/projects/LibreChat/packages/data-schemas && npx jest src/methods/note.spec.ts`
Expected: 实现 Step 1 前 FAIL(`./note` 无 `createNoteMethods`);实现后 PASS(schema 3 + methods 6 用例)。

- [ ] **Step 5: 提交**

```bash
cd /data/lidongyu/projects/LibreChat
git add packages/data-schemas/src/methods/note.ts packages/data-schemas/src/methods/index.ts packages/data-schemas/src/methods/note.spec.ts
git commit -m "feat(notes): add Note CRUD methods"
```

---

## Task 3: REST 路由 + 挂载

**Files:**
- Create: `api/server/routes/notes.js`
- Modify: `api/server/routes/index.js:13` (require) `:65` (export)
- Modify: `api/server/index.js:218` (app.use)
- Test: `api/server/routes/notes.test.js`

**Interfaces:**
- Consumes: `~/models` 导出的 `createNote/getNoteById/getUserNotes/updateNote/deleteNote/searchNotes`(Task 2);`requireJwtAuth`(`~/server/middleware`)。
- Produces: Express router,挂载于 `/api/notes`。端点:`POST /`、`GET /`(`?q=`、`?tags=a,b`)、`GET /:id`、`PATCH /:id`、`DELETE /:id`。

- [ ] **Step 1: 先 build data-schemas(api 测试用编译产物)**

Run: `cd /data/lidongyu/projects/LibreChat/packages/data-schemas && npm run build`
Expected: 构建成功(Task 1/2 的新方法进入 `@librechat/data-schemas` 产物)。

- [ ] **Step 2: 写路由**

Create `api/server/routes/notes.js`:

```js
const express = require('express');
const {
  createNote,
  getNoteById,
  getUserNotes,
  updateNote,
  deleteNote,
  searchNotes,
} = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();
const notePayloadLimit = express.json({ limit: '1mb' });

router.use(requireJwtAuth);

router.get('/', async (req, res) => {
  try {
    const user = req.user.id;
    const tags = req.query.tags ? String(req.query.tags).split(',').filter(Boolean) : undefined;
    if (req.query.q) {
      const notes = await searchNotes({ user, query: String(req.query.q), tags });
      return res.json({ notes });
    }
    const notes = await getUserNotes({ user, tags });
    res.json({ notes });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list notes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const note = await getNoteById({ user: req.user.id, id: req.params.id });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get note' });
  }
});

router.post('/', notePayloadLimit, async (req, res) => {
  try {
    const { title, content, tags, source } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    const note = await createNote({ user: req.user.id, title, content, tags, source });
    res.status(201).json(note);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create note' });
  }
});

router.patch('/:id', notePayloadLimit, async (req, res) => {
  try {
    const { title, content, tags, addLinks } = req.body;
    const note = await updateNote({
      user: req.user.id,
      id: req.params.id,
      update: { title, content, tags, addLinks },
    });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update note' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteNote({ user: req.user.id, id: req.params.id });
    if (!result.ok) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

module.exports = router;
```

- [ ] **Step 3: 注册并挂载路由**

Modify `api/server/routes/index.js`:
- 在 line 13 `const memories = require('./memories');` 之后加:

```js
const notes = require('./notes');
```

- 在导出对象(line 65 `  memories,` 之后)加:

```js
  notes,
```

Modify `api/server/index.js` — 在 line 218 `app.use('/api/memories', routes.memories);` 之后加:

```js
  app.use('/api/notes', routes.notes);
```

- [ ] **Step 4: 写失败测试(路由)**

Create `api/server/routes/notes.test.js`:

```js
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let currentTestUser;

jest.mock('~/models', () => {
  const mongooseInstance = require('mongoose');
  const { createMethods } = require('@librechat/data-schemas');
  return createMethods(mongooseInstance);
});

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => {
    req.user = currentTestUser;
    next();
  },
}));

let app;
let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  require('~/db/models'); // registers all models incl. Note
  const notesRoutes = require('~/server/routes/notes');
  app = express();
  app.use(express.json());
  app.use('/api/notes', notesRoutes);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  currentTestUser = { id: new mongoose.Types.ObjectId().toString() };
});

describe('Notes routes', () => {
  test('POST / creates a note', async () => {
    const res = await request(app).post('/api/notes').send({ title: 'My Note', content: 'hi' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('My Note');
  });

  test('POST / requires title', async () => {
    const res = await request(app).post('/api/notes').send({ content: 'no title' });
    expect(res.status).toBe(400);
  });

  test('GET / lists the user notes', async () => {
    await request(app).post('/api/notes').send({ title: 'A' });
    const res = await request(app).get('/api/notes');
    expect(res.status).toBe(200);
    expect(res.body.notes).toHaveLength(1);
  });

  test('notes are scoped per user', async () => {
    await request(app).post('/api/notes').send({ title: 'mine' });
    currentTestUser = { id: new mongoose.Types.ObjectId().toString() };
    const res = await request(app).get('/api/notes');
    expect(res.body.notes).toHaveLength(0);
  });

  test('PATCH updates and DELETE removes', async () => {
    const created = await request(app).post('/api/notes').send({ title: 'x' });
    const id = created.body._id;
    const upd = await request(app).patch(`/api/notes/${id}`).send({ title: 'y' });
    expect(upd.body.title).toBe('y');
    const del = await request(app).delete(`/api/notes/${id}`);
    expect(del.body.ok).toBe(true);
    const get = await request(app).get(`/api/notes/${id}`);
    expect(get.status).toBe(404);
  });
});
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `cd /data/lidongyu/projects/LibreChat/api && npx jest server/routes/notes.test.js`
Expected: PASS(5 个用例)。若报 `Note` model 未注册,确认 Task 1 Step 5 已把 `Note: createNoteModel(mongoose)` 加进 `createModels`,并已 `npm run build`(Step 1)。

- [ ] **Step 6: 提交**

```bash
cd /data/lidongyu/projects/LibreChat
git add api/server/routes/notes.js api/server/routes/index.js api/server/index.js api/server/routes/notes.test.js
git commit -m "feat(notes): add notes REST routes"
```

---

## Self-Review

- **Spec 覆盖**:Plan A 覆盖 [spec §5 数据模型](../specs/2026-06-17-graupel-second-brain.md)(Note schema/类型,`notebookId` 预留)、§13 Plan A(schema + CRUD + 薄路由,mongodb-memory-server 验收)。§6 的 `search_notes`/`get_note`/`list_notes`/`create_note`/`update_note` 的底层 CRUD 已就位(MCP 封装在 Plan C);`link_notes` 双向、`appendContent`、attachments 写入延后到 Plan B/C(本 plan 仅 schema 含 attachments 字段 + `addLinks` 单向)。
- **Placeholder 扫描**:无 TBD/TODO;每个 code step 含完整代码与命令。Task 2 Step 3 的 `(global as ...)` 行已标注为冗余示范并要求删除——实现者应只保留 describe 内 `createNoteMethods(mongoose)`。
- **类型一致**:`INoteLean` 贯穿 methods 返回与路由响应;方法签名与 Task 2 Interfaces 块一致;`createNoteModel`/model 名 `'Note'` 在 model、methods、测试三处一致。

## Execution Handoff

**Plan A 完成并保存到 `docs/superpowers/plans/2026-06-17-second-brain-plan-a-schema-crud.md`。** 后续 Plan B–F 见 [spec §13](../specs/2026-06-17-graupel-second-brain.md#13-分阶段交付plan-拆分)。
