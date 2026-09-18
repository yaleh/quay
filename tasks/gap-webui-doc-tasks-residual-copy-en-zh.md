---
id: gap-webui-doc-tasks-residual-copy-en-zh
title: /doc 与 /tasks（含 /task/&lt;id&gt; 详情）残留的 5 处硬编码中文界面文案（读失败、缺少 id、解析失败、无
  worker 运行记录、进行中）—— 正文本地化系列，合并一条
status: todo
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

- [ ] **AC1（红基线，造出状态）**：贴 5 处边缘状态在 `lang=en` 下**各自**渲染出的中文行（逐处对应上表），谓词先对 zh 干跑命中；⛔ 不得以正常态的「中文行 = 0」代替。
- [ ] **AC2（en 清零）**：5 处边缘状态改后 en 下界面中文均 = 0（`{error}` 诊断串与任务标题除外，逐条归类）。
- [ ] **AC3（zh 零变化）**：5 处边缘状态改前后各抓 `lang=zh`，diff 为空（或逐条解释）。
- [ ] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [ ] **AC5（所有触发路径带语言）**：`/doc`、`/tasks`、`/task/<id>` 三个入口在 `?lang=zh` 下逐个断言 zh，`?lang=en` 下逐个断言 en。
- [ ] **AC6（因果对照）**：钳成恒 zh 后 5 处 en 断言变红，恢复复绿，两次读数并排贴出。
- [ ] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [ ] **AC8（真实形态核对）**：重启 serve，用 fixture 造出至少 2 个边缘状态（缺 id 任务、Runs 空态）在 headless Chrome 下截图 `?lang=en` 与 `?lang=zh`。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，边缘状态下选 EN 后这 5 处文案为英文，选中文后与改前一致。
1. 读数来自 HTTP 响应体，且**边缘状态确实被造出并触发**。
2. AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件；`/adr` 一字不动（源码无中文字面量）。
4. 重启 serve + 截图（AC8）。
5. 可回滚：还原 5 处取词调用、删 `DOC_TASK_*`。

## Touches

- tasks/gap-webui-doc-tasks-residual-copy-en-zh.md
- packages/quay/src/serve-doc.ts
- packages/quay/src/serve-task.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-doc-tasks-residual-i18n.test.mjs (new)
- packages/quay/test/serve-task.test.mjs
- packages/quay/test/serve-goal-doc.test.mjs
