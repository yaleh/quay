---
id: gap-fan-in-suite-skip-quoted-nonascii-doc-path
title: fan-in-step-trace.jsonl 的 suite-skip 读数恒暗：非 ASCII 文档路径被 git C-quote 后判成
  code delta ⇒ doc-only fan-in 永不进 skip 分支（同窗口 4 次全量 suite 白跑）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现状读数（2026-10-25T00:50Z 前后，主检出 `/data/home/yale/work/quay`，HEAD `efd47e697`）**：

```
node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --carrier fan-in-step-trace.jsonl --json --no-block
=> evaluated:true, totalRecords:20001, freshest:"2026-10-24T17:01:23.918Z", decayedCount:1
   decayed[] = [{group:"suite-skip", kind:"rate-stopped", count:79, lastWrite:"2026-10-23T08:42:04.648Z"}]
```

载体本身仍在写（`merge-develop` / `ff` 的最后写入是 2026-10-24T17:01:23Z），只有 `suite-skip` 分组约 38h 未写。**这不是写手腐烂**：写手在 HEAD 上仍在（`plugin/scripts/worker-fan-in.ts:3259` 的 `traceSuiteEvent("suite-skip", …)`，位于 `:2710` `needSuite` 为假的 `else` 分支）。**也不是按设计罕见**：trigger 在最后一次写入之后确实发生过（见下），是机制把它错判掉了。

**trigger 发生过但被误路由（决定性现场）**：最后一次 `suite-skip` 之后（>2026-10-23T08:42:04Z）共有 22 次 fan-in 运行。其中 `gap-ac920-criterion-pipe-swallows-exit-code` 的 4 次尝试（17:09:35Z / 17:54:27Z / 18:50:50Z / 19:37:20Z）每一次的 delta 步都写着：

```
code delta ("meta/META-017-\350\257\267...sup.md") → run suite
```

随后全部 `suite-start` → 全量 suite（其中一轮 OOM-killed，recovery ladder 64/48/32 全部烧完），**0 条 `suite-skip`**。但该任务分支上的提交只触及文档面（`meta: META-017 create …` 提交 `d7d93b693` 是落地翻转 `7b3c7f66a` 的祖先；其余分支提交只改 `tasks/gap-ac920-….md`）。分类器返回的**代码子集恰好只有那一个 C-quoted 的 meta 路径**——若它被判成 doc，代码子集就是空 ⇒ `codeDelta === ""` ⇒ `needSuite` 为假 ⇒ 应写 `suite-skip`。

**根因（按位置）**：`plugin/scripts/worker-fan-in.ts:2684` 用 `git diff --name-only` 取 delta 列表，**没有 `-c core.quotepath=false`**；git 默认把非 ASCII 路径输出成 C-quoted 形态（前导 `"` + 八进制转义），原样进 `:2688` 的 `--classify-delta`。分类器的 `isDocPath`（`plugin/scripts/select-static-checks-for-touches.ts:444`）对原始串做前缀匹配：`"meta/…` 不以 `meta/` 开头 ⇒ unknown path ⇒ 按 fail-closed 判 code。同一缺陷在本文件还有第二处 `:2702`（`prevCommit..HEAD` 的 reuse-advance 判定，同样喂给 `--classify-delta`）。

**复现（本轮实测，硬规则 4 推论四的对照：唯一变量是引号形态）**：

```
isDocPath(plain  "meta/META-017-请裁定-….md")  = true
isDocPath(quoted  "\"meta/META-017-\\350\\257\\267….md\"") = false
classifyDeltaPaths(root, [plain]).codePaths.length  = 0
classifyDeltaPaths(root, [quoted]).codePaths.length = 1
```

**为什么不是 `gap-doc-surfaces-missing-meta-prefix` 的余波**：该任务（`9b12db8d0`，2026-10-23T18:38:40Z 落到 develop）刚把 `meta/` 加进 `DOC_SURFACES`；18:50Z 与 19:37Z 两次运行已经带着这个修复（merge-develop 已把它并入），**仍然**把同一路径判成 code。⇒ 这是 C-quote 层，不是词表层。

**硬规则 5b 定位**：`gap-ff-merge-quotepath-breaks-inert-retry`（done，落地 `c8359f300`）修过同一缺陷类（`packages/quay/src/fan-in/ff-merge.ts`），并在其 AC4 产物里**明确留下 37 个同类调用点 / 19 个文件**未一并修、留给后续机械展开；`worker-fan-in.ts:2684/:2702` 正是其中两个，且它们恰好是 `suite-skip` 的闸门。

**修法方向**：① 给 `:2684` 与 `:2702` 的 `git diff --name-only` 加 `-c core.quotepath=false`（与已修的四处同款）；② 加一条**修复前必红**的守卫用例：delta 只含一个非 ASCII 文档面路径 ⇒ 必须写 `suite-skip` 且不跑 suite；③ 按硬规则 5b 重跑同族扫描并把命中数 + 前 3 条实际内容写进提交（⛔ 不给只做非空判定的调用点加 flag，例如 `:3717` 的 `--diff-filter=U` 输出只用于 `!== ""`）。

<!-- dedup-ref --> 合并判断 = **separate**：open `gap-instrument-decay-dedup-reader-round-log-path`（todo）改的是 `quality-gate-driver.ts` 的立案去重读侧路径，与本条无共享机制；本条的写面是 `worker-fan-in.ts` 的 delta 分类输入。

**prior-claim**：
- `gap-ff-merge-quotepath-breaks-inert-retry`（done）—— 同一缺陷类的上一处；它自己声明余下 37 个调用点留给后续任务，本条是那两个闸门调用点的后续。
- `gap-fan-in-step-trace-suite-step-stopped-writing`（done）—— 修的是 writer-split（suite 决策步只写 per-run 日志）；该腐烂已消失（`ac-precheck`/`suite-start`/`suite-end` 现均在共享载体里持续写入），本条是**另一个成因**的缺席。
- `gap-fan-in-step-trace-rate-stopped-adjudication`（done）—— 为 5 个其它分组建了机器可读裁定；`suite-skip` 当时不在 `decayed[]`，故未被它覆盖。
- `gap-fan-in-delta-scope-doc-only-skip`（done）—— doc-only 跳过路径的作者。
- `gap-doc-surfaces-missing-meta-prefix`（done）—— `meta/` 文档面的作者；本条证明词表修好后仍被判 code。

## AC

- [ ] AC1（现状复现）在主检出跑 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --carrier fan-in-step-trace.jsonl --json --no-block`：`evaluated===true` 且 `decayed[]` 含 `{group:"suite-skip", kind:"rate-stopped"}`，并贴出 `count` / `lastWrite` / `freshest`。判据可假：出现一条新的 `suite-skip` 写入即改变该读数。
- [ ] AC2（写手与分支都在 HEAD 上，按位置判定）读 `plugin/scripts/worker-fan-in.ts`：`traceSuiteEvent("suite-skip", …)` 位于 `needSuite` 为假的 `else` 分支，且 `needSuite` 由 `codeDelta` 派生；贴出行号与 argv 片段（⛔ 不以注释/字符串命中计数）。同时贴出 `git ls-files` 对该文件的 HEAD 状态。
- [ ] AC3（现场实例）贴出 `.quay/fan-in-gap-ac920-criterion-pipe-swallows-exit-code-wk-prod-anchor.log` 里 4 条带 C-quoted `meta/META-017-…` 的 `delta` 记录及其后的 `suite-start`/`suite-end`，并断言该时间窗内 `suite-skip` 记录数 = 0；同时断言 `d7d93b693` 是 `7b3c7f66a` 的祖先（文档面提交在任务分支上）。
- [ ] AC4（负控制，修复前必红）新增用例：构造"delta 只含一个非 ASCII 文档面路径"的 fan-in，断言写出 `suite-skip` 且 suite 命令未执行。并排贴出修复前（红：判成 code、suite 执行）与修复后（绿：skip）两次读数。
- [ ] AC5（修复）`:2684` 与 `:2702` 的 argv 数组按位置都带 `-c core.quotepath=false`；并用生产实际形态重放一次分类：同一 C-quoted 路径在修复前 → 1 个 code path，修复后 → 0 个。贴出两条命令与 stdout。
- [ ] AC6（硬规则 5b 产物）在 `plugin/**` 与 `packages/quay/src/**` 重扫"git 路径列表输出进入路径谓词"的调用点：把命中数与前 3 条实际内容写进提交信息；明确列出**本次修了哪几个**、**余下几个**（与 `gap-ff-merge-quotepath-breaks-inert-retry` 的 37 个基数对齐）。

## DoD

- [ ] AC1–AC6 全绿；`bash scripts/test.sh --for-task gap-fan-in-suite-skip-quoted-nonascii-doc-path` 通过并贴出输出。
- [ ] 修复后**真实生产读数**：下一次 doc-only fan-in 在 `.quay/fan-in-step-trace.jsonl` 里写出 `step:"suite-skip"`，且该次运行的 per-run 日志里没有 `suite-start`/`suite-end`；贴出记录的时间戳与 task/runId（DIR-026 Reading A：不是"flag 在文件里"，是分支真的被走到）。
- [ ] 在 `.quay/fan-in-step-trace.jsonl` 上重跑检测器：`decayed[]` 不再含 `suite-skip`（若其它分组仍暗，逐条说明，⛔ 不得用本条掩盖它们）。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/test/worker-driver-fan-in-s09.test.mjs
- tasks/gap-fan-in-suite-skip-quoted-nonascii-doc-path.md（self-touch）