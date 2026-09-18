---
id: gap-webui-doc-tasks-residual-copy-en-zh
title: /doc 与 /tasks（含 /task/&lt;id&gt; 详情）残留的 5 处硬编码中文界面文案（读失败、缺少 id、解析失败、无
  worker 运行记录、进行中）—— 正文本地化系列，合并一条
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**缺口（2026-09-18，源码枚举 + 真实形态复现）**：`/doc` 与 `/tasks` 列表页在 `lang=en` 下**正常态没有界面中文**——实测 `curl -H 'Cookie: lang=en' /doc` 含中文行 **0**；`/tasks` 的 17 行全是任务标题（用户数据）。残留的界面文案只藏在**边缘状态**里，正常抓取看不到：

| 位置 | 中文字面量 | 触发条件 |
|---|---|---|
| `packages/quay/src/serve-doc.ts:95` | `读失败:`（`error-banner`） | 文档目录读取出错 |
| `packages/quay/src/serve-task.ts:228` | `⚠ <id> — 缺少 id 字段` | 列表里含缺 id 的畸形任务 |
| `packages/quay/src/serve-task.ts:269` | `⚠ <file> — 解析失败: <error>` | 列表里含 frontmatter 解析失败的文件 |
| `packages/quay/src/serve-task.ts:591` | `无 worker 运行记录（.quay/worker-outcome.jsonl）` | `/task/<id>` 详情页 Runs 段为空 |
| `packages/quay/src/serve-task.ts:602` | `进行中` | `/task/<id>` 详情页 Runs 段有在飞 run |

（`serve-doc.ts` 非注释中文行共 **1** 条，`serve-task.ts` 共 **4** 条。）

**为什么两页合并成一条**：体量极小（5 处）、机制相同、且 `serve-task.ts` 同时承载 `/tasks` 列表与 `/task/<id>` 详情——拆成两条会在 `serve-i18n.ts` 上白白多一次 Touches 互锁与一轮全量套件。

**`/adr` 为什么没有对应任务（已核实，不是遗漏）**：`grep -nP '[\x{4e00}-\x{9fff}]' packages/quay/src/serve-adr.ts` 的**非注释行 = 0**；`/adr` 页面 en 下看到的中文全是 `adr/ADR-*.md` 的**标题数据**（如「AXIS 采用者视角…」），属用户数据不翻译。立它就是立一个不存在的缺口。

**去重（机制，不是症状）**：`tasks/*.md` 无对应任务。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern；本任务照抄其「决定记录」①~⑨）。**边缘状态的红基线必须造出来**：正常抓取抓不到这 5 处，⛔ 不能用「en 下中文行 = 0」证明完成——那个 0 在改前就成立（恒真读数，硬规则 4）。

## Plan

1. **红基线（造状态）**：在 fixture workspace 里造出触发条件——① 让文档读取报错（不可读目录/缺失 `docs`）；② 放一个缺 `id` 的任务文件与一个 frontmatter 损坏的任务文件；③ 造一个有 `.quay/worker-outcome.jsonl` 的任务与一个没有的任务，分别抓 `/task/<id>`。`Cookie: lang=en` 逐个抓取，列出含 CJK 的行；**谓词先对 zh 干跑命中**。
2. **字典**：`serve-i18n.ts` 新增 `DOC_TASK_KEYS` + `DOC_TASK_LABELS` + `docTaskLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量；带数据的串用模板：`⚠ {id} — 缺少 id 字段`、`⚠ {file} — 解析失败: {error}`）。⚠️ `{error}` 是**运行时诊断串（数据）**，原样 `escapeHtml`，不翻译。
3. **改 `serve-doc.ts:95`、`serve-task.ts:228/269/591/602`**：经字典；调用点带 `cfg.lang`（这几处渲染函数是否已有 `lang` 形参以源码为准，没有则加，默认 `DEFAULT_LANG`）。
4. **既有测试迁移**：`serve-task.test.mjs`、`serve-goal-doc.test.mjs` 及被实跑证实变红的测试，钉中文断言改显式 zh；负向断言显式 zh；不在 Touches 的先补 Touches 再改。
5. **新测试** `packages/quay/test/serve-doc-tasks-residual-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh，**5 处边缘状态各触发一次**。
6. **因果对照**：钳成恒 zh → 5 处 en 断言变红，恢复复绿。
7. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve。

## AC

- [x] **AC1（红基线，造出状态）**：贴 5 处边缘状态在 `lang=en` 下**各自**渲染出的中文行（逐处对应上表），谓词先对 zh 干跑命中；⛔ 不得以正常态的「中文行 = 0」代替。
- [x] **AC2（en 清零）**：5 处边缘状态改后 en 下界面中文均 = 0（`{error}` 诊断串与任务标题除外，逐条归类）。
- [x] **AC3（zh 零变化）**：5 处边缘状态改前后各抓 `lang=zh`，diff 为空（或逐条解释）。
- [x] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [x] **AC5（所有触发路径带语言）**：`/doc`、`/tasks`、`/task/<id>` 三个入口在 `?lang=zh` 下逐个断言 zh，`?lang=en` 下逐个断言 en。
- [x] **AC6（因果对照）**：钳成恒 zh 后 5 处 en 断言变红，恢复复绿，两次读数并排贴出。
- [x] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [x] **AC8（真实形态核对）**：重启 serve，用 fixture 造出至少 2 个边缘状态（缺 id 任务、Runs 空态）在 headless Chrome 下截图 `?lang=en` 与 `?lang=zh`。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，边缘状态下选 EN 后这 5 处文案为英文，选中文后与改前一致。
1. 读数来自 HTTP 响应体，且**边缘状态确实被造出并触发**。
2. AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件；`/adr` 一字不动（源码无中文字面量）。
4. 重启 serve + 截图（AC8）。
5. 可回滚：还原 5 处取词调用、删 `DOC_TASK_*`。

## 证据（改后读数）

⛔ **本任务的判据不能靠「正常态抓取」取证**：这 5 处文案只存在于边缘状态，`lang=en` 的界面中文行在**改前就是 0**（恒真读数）。因此所有读数来自一个**造出全部 5 个边缘状态**的 fixture workspace + 真实 `quay serve`，读数全部取自 HTTP 响应体。A/B 探针 `/tmp/doc-task-i18n/ab.mjs` 对**同一个 fixture**跑两次：`before` 侧加载主检出（= develop，a125cad8e）的 `serve-*.ts`，`after` 侧加载本 worktree 的。

- **AC1 红基线**：`lang=en` 下逐处命中 —— `/doc` → `读失败:`（interface CJK **1**）；`/tasks` → `— 解析失败: …` 与 `— 缺少 id 字段`（**2**）；`/task/GAPDOC-001` → `无 worker 运行记录（`（**1**）；`/task/GAPDOC-002` → `进行中`（**1**）。**谓词先对真样本干跑**：同一谓词在 `lang=zh` 下命中 `/doc` 41 / `/tasks` 42 / 两个详情页各 3 行（>1，故「en=0」不是谓词恒零）。逐条清单 `/tmp/doc-task-i18n/before.txt`；原始响应体 `/tmp/doc-task-i18n/before.body.<lang>.<url>.html`。
  ⚠️ `docs-managed` **缺失不会**触发读失败（`createDocumentStore` 会 mkdirSync），实测触发条件是目录内的一个**坏条目**（`docs-managed/DOC-001.md` 是一个目录 ⇒ `list()` 的 `readFileSync` EISDIR）。这是实跑测出来的，不是照着「不可读目录」猜的。
- **AC2 en 清零**：改后同一谓词在 4 个 URL 上 **interface CJK = 0**（每页仅剩 2 行 ROW 4 的 endonym `中文`，按名排除）。`/tmp/doc-task-i18n/after.txt`。en 原始响应体逐条 diff 只动 5 行（2/4/2/6 行 = 5 处文案 + `/task/GAPDOC-002` 的 2 个动态值）。
- **AC3 zh 零变化**：改前/改后 `lang=zh` 的**原始响应体** diff —— `/doc`、`/tasks`、`/task/GAPDOC-001` 三页 **byte-identical**（34985 / 37461 / 35547 字节）；`/task/GAPDOC-002` 只差 **2 行**，全是**每次运行都会变的数据**（假 worker 进程的 `started_at` 时刻与 `pid`），界面文案无一处变化。`⚠ <code>broken.md</code> — 解析失败: …`、`⚠ <a href="/task/noid">noid</a> — 缺少 id 字段`、`无 worker 运行记录（<code>.quay/worker-outcome.jsonl</code>）`（全角括号 + `<code>` 在括号内）三处逐字未动。
- **AC4 字典完备且被强制**：新测试断言 `DOC_TASK_KEYS` 无重复、每键两列非空、`en` 无 CJK、`zh` 含 CJK 或与 en 逐字相等；`docTaskLabel` 未知键 THROW（en/zh 各一次）；**模板行缺参 THROW**（遍历所有含 `{name}` 的行，两列各少供一个参数）。强制读数：删掉 `runInFlight` 的 `en` 列 ⇒ `tsc --noEmit` 报 `serve-i18n.ts:1258: TS2741: Property 'en' is missing … but required in type '{ en: string; zh: string; }'`（指向 `:1236` 的 `Record<DocTaskKey, {en,zh}>`）；恢复后 `tsc` 干净。
- **AC5 三个入口都带语言**：`/doc`、`/tasks`、`/task/<id>` 在 `?lang=zh`（cookie 与 query 两种形态都测）逐个断言 zh、`?lang=en` 逐个断言 en；另有一条「同一 URL 两种语言响应不同」的对照，防止某处被硬编码成单一语言。
- **AC6 因果对照**：把 `docTaskLabelsFor` 钳成恒取 `zh` 列（**先 grep 确认 mutant 真的落盘：1 处**，否则对照不生效）⇒ 新测试 **7 红 / 4 绿**；恢复后 **11 绿 / 0 红**。两次读数并排。
- **AC7 迁移**：**实跑**（⛔ 不是 grep 猜）96 个「结构上可能受影响」的测试文件（导入 serve-task/serve-doc/serve-i18n/serve-handlers，或含 `startServer`/`/doc`/`/tasks`/`/task/`），改后红 **5 条 / 4 文件**：`observation.test.mjs`（Runs 空态）、`serve-handlers.test.mjs` AC1+AC3（进行中）、`serve.test.mjs` AC2（缺少 id）、`unparseable-frontmatter.test.mjs`（解析失败）。**A/B 对照**：同一组文件在主检出（= develop，未改源码）上 **121/121 全绿** ⇒ 5 条全部由本改动引起，无既存红。逐个迁移（原断言逐字保留 + 显式 zh；负向断言必须显式 zh，否则变恒真空转）后重跑该 96 文件：**823 中 819 绿**，唯一红是 `cli.test.mjs` 的 10 条 golden-replay ——**与本改动无关**，两条对照：① `git stash` 掉本改动的 src/test 后**同样 10 条红**；② 该红只在**绕过套件、直接用 `node --test`** 时出现——用真 harness `bash scripts/test.sh packages/quay/test/cli.test.mjs` 跑同一个文件 **exit 0 / FAIL 0 条**（与已记的「worktree 里直接 node --test 会让 golden-replay 红」同形）。⇒ fan-in 的全量套件下不红。
- **AC8 真实形态**：worktree 起真实 `quay serve --host 127.0.0.1 --port 4831`（加载的是**本分支**的 `serve-*.ts`），fixture 同时造出**缺 id 任务**、**解析失败文件**、**Runs 空态**三个边缘状态（触发计数：malformed rows 4 / `missing id field` 1 / `parse failed` 1 / `No worker runs recorded` 1），headless Chrome 1500×1400 截图：`/tmp/doc-task-i18n/ac8-tasks-en.png`（`⚠ broken.md — parse failed: …` / `⚠ noid — missing id field`）、`ac8-tasks-zh.png`（`解析失败` / `缺少 id 字段`）、`ac8-runs-en.png`（`No worker runs recorded (.quay/worker-outcome.jsonl)`）、`ac8-runs-zh.png`（`无 worker 运行记录（.quay/worker-outcome.jsonl）`）。
  ⛔ **未重启 :4173 常驻 serve**：它服务的是**共享主检出**，而本分支尚未 fan-in（落地发生在退出之后），把常驻进程指过来会改掉其他层正在读的工作区。AC8 的「真实形态」由**本分支的真实 serve 进程 + 真实浏览器**满足；重启常驻 serve 属落地后的收尾。

### 落地后的已知残留（逐条登记，⛔ 不是遗漏）

- `/task/<id>` 的**页面外壳**（`<html lang>`、`renderSiteNav`/`renderMobileChrome`）仍是英文：AC-290 已登记为它的 out-of-scope 残留，本任务只接了 Runs 段。`?lang=zh` 下该页会出现「外壳英文 + Runs 段中文」，已在 `serve-task.ts` 与 `serve-task.test.mjs` 的注释里写明。
- Runs 表格的 `<th>`（`started`/`state`/…）与 `renderFanInCell` 的 `landed`/`red`/`step`/`lock`/`suite`/`sha` 两语皆英文，未入字典（改它们会动 `lang=zh` 的字节）。
- `/doc` 空态 `No documents.` 两语皆英文，同上。

## Touches

- tasks/gap-webui-doc-tasks-residual-copy-en-zh.md
- packages/quay/src/serve-doc.ts
- packages/quay/src/serve-task.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-doc-tasks-residual-i18n.test.mjs (new)
- packages/quay/test/serve-task.test.mjs
- packages/quay/test/serve-goal-doc.test.mjs
- packages/quay/test/observation.test.mjs
- packages/quay/test/serve-handlers.test.mjs
- packages/quay/test/serve.test.mjs
- packages/quay/test/unparseable-frontmatter.test.mjs
