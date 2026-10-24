---
id: gap-fan-in-suite-skip-quoted-nonascii-doc-path
title: fan-in-step-trace.jsonl 的 suite-skip 读数恒暗：非 ASCII 文档路径被 git C-quote 后判成
  code delta ⇒ doc-only fan-in 永不进 skip 分支（同窗口 4 次全量 suite 白跑）
status: ready
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

prior-claim:
- `gap-ff-merge-quotepath-breaks-inert-retry`（done）—— 同一缺陷类的上一处；它自己声明余下 37 个调用点留给后续任务，本条是那两个闸门调用点的后续。
- `gap-fan-in-step-trace-suite-step-stopped-writing`（done）—— 修的是 writer-split（suite 决策步只写 per-run 日志）；该腐烂已消失（`ac-precheck`/`suite-start`/`suite-end` 现均在共享载体里持续写入），本条是**另一个成因**的缺席。
- `gap-fan-in-step-trace-rate-stopped-adjudication`（done）—— 为 5 个其它分组建了机器可读裁定；`suite-skip` 当时不在 `decayed[]`，故未被它覆盖。
- `gap-fan-in-delta-scope-doc-only-skip`（done）—— doc-only 跳过路径的作者。
- `gap-doc-surfaces-missing-meta-prefix`（done）—— `meta/` 文档面的作者；本条证明词表修好后仍被判 code。

## AC

- [x] AC1（现状复现）在主检出跑 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --carrier fan-in-step-trace.jsonl --json --no-block`：`evaluated===true` 且 `decayed[]` 含 `{group:"suite-skip", kind:"rate-stopped"}`，并贴出 `count` / `lastWrite` / `freshest`。判据可假：出现一条新的 `suite-skip` 写入即改变该读数。
  - 实测（2026-10-25，主检出 HEAD `efd47e697`）：`evaluated:true`,`totalRecords:20001`,`freshest:"2026-10-24T17:01:23.918Z"`,`decayedCount:1`，`decayed[0]={group:"suite-skip",kind:"rate-stopped",count:79,lastWrite:"2026-10-23T08:42:04.648Z"}`。
- [x] AC2（写手与分支都在 HEAD 上，按位置判定）读 `plugin/scripts/worker-fan-in.ts`：`traceSuiteEvent("suite-skip", …)` 位于 `needSuite` 为假的 `else` 分支，且 `needSuite` 由 `codeDelta` 派生；贴出行号与 argv 片段（⛔ 不以注释/字符串命中计数）。同时贴出 `git ls-files` 对该文件的 HEAD 状态。
  - 位置（修复后行号；注释使原 `:2684`/`:2702` 分别后移到 `:2688`/`:2708`）：`:2688` = `["git","-C",worktree,"-c","core.quotepath=false","diff","--name-only",<fork>,"HEAD"]`；`:2708` = 同款 argv，range 为 `<prevCommit>..HEAD`。
  - 派生链：`:2693` `codeDelta = classifyDeltaOutcome(cd.ok, cd.stdout || "")` → `:2716` `const needSuite = opts.forceSuite === true || codeDelta === CLASSIFY_FAILED || (codeDelta !== "" && !reuseSkip)` → `:2875` `if (needSuite) { … } else {` → `:3265` `traceSuiteEvent("suite-skip", {exit:0, wall_ms:0, ok:true, reason: reuseSkip ? "develop-advance-doc-only-reuse" : "doc-only-delta"})`（else 支内）。
  - `git ls-files -s plugin/scripts/worker-fan-in.ts` ⇒ `100644 0b6115900518f2a19782d4c1351fd700cba44e95 0	plugin/scripts/worker-fan-in.ts`；`git ls-tree develop plugin/scripts/worker-fan-in.ts` 同 blob ⇒ 写手在 HEAD 上。
- [x] AC3（现场实例）贴出 `.quay/fan-in-gap-ac920-criterion-pipe-swallows-exit-code-wk-prod-anchor.log` 里 4 条带 C-quoted `meta/META-017-…` 的 `delta` 记录及其后的 `suite-start`/`suite-end`，并断言该时间窗内 `suite-skip` 记录数 = 0；同时断言 `d7d93b693` 是 `7b3c7f66a` 的祖先（文档面提交在任务分支上）。
  - 4 条 delta（该日志第 4/21/38/53 行，逐字同形）：`{"ts":"2026-10-23T17:09:35.500Z","step":"delta",…,"reason":"code delta (\"meta/META-017-\\350\\257\\267….md\") → run suite"}`（其余 ts 17:54:27.407Z / 18:50:50.134Z / 19:37:20.559Z）；其后 `suite-start`（第 10/27/44/59 行）→ `suite-end`（第 11/28/45/60 行，`reason:"suite red"`，其中一轮带 `suite-incomplete reason:"oom-killed (3)"` + recovery 64/48/32）。
  - 同窗口 `suite-skip` 计数：`grep '"step":"suite-skip"' .quay/fan-in-step-trace.jsonl | awk -F'"ts":"' '{split($2,a,"\"")} a[1] > "2026-10-23T08:42:04.648Z"' | wc -l` ⇒ **0**（最后一条 suite-skip 是 2026-10-23T08:42:04.648Z，task `gap-goal911-exit-condition3-unencapsulated-e2e-uncovered`）。
  - `git merge-base --is-ancestor d7d93b693 7b3c7f66a` ⇒ exit 0（是祖先）。
- [x] AC4（负控制，修复前必红）新增用例：构造"delta 只含一个非 ASCII 文档面路径"的 fan-in，断言写出 `suite-skip` 且 suite 命令未执行。并排贴出修复前（红：判成 code、suite 执行）与修复后（绿：skip）两次读数。
  - 用例：`plugin/test/worker-driver-fan-in-s09.test.mjs` 的 `AC4 (负控制, 修复前必红)` —— hermetic 树，任务分支唯一提交落在 `meta/META-017-请裁定-…-已-sup.md`；suite 命令一旦执行就写 marker 文件。
  - 修复前（红）：`✖ AC4 …  AssertionError [ERR_ASSERTION]: suite 命令必须【一次都没执行】（执行过 ⇒ 留下 marker） true !== false`（suite 真的跑了 ⇒ 判成 code）。
  - 修复后（绿）：`✔ AC4 (负控制, 修复前必红) — delta 只含一个 C-quoted 非 ASCII 文档面路径 ⇒ suite-skip 且 suite 未执行`；marker 不存在，共享载体恰好一条 `suite-skip(reason=doc-only-delta)`，per-run 载体同形。
- [x] AC5（修复）`:2684` 与 `:2702` 的 argv 数组按位置都带 `-c core.quotepath=false`；并用生产实际形态重放一次分类：同一 C-quoted 路径在修复前 → 1 个 code path，修复后 → 0 个。贴出两条命令与 stdout。
  - 修复后 argv 见 AC2（`:2688` / `:2708`），均在 `git -C <worktree>` 之后、子命令 `diff` 之前带 `-c core.quotepath=false`。
  - 重放（scratch repo 内提交同一非 ASCII 路径，root 带 registry stub）：
    `RAW=$(git diff --name-only HEAD^)` ⇒ `"meta/META-017-\350\257\267….md"`，`select-static-checks-for-touches.ts --classify-delta --root <D> "$RAW"` 打印该路径 ⇒ **codePaths=1 → RUN-SUITE**；
    `PLAIN=$(git -c core.quotepath=false diff --name-only HEAD^)` ⇒ 原始 UTF-8 串，同一命令 stdout 为空 ⇒ **codePaths=0 → SKIP-SUITE**。
- [x] AC6（硬规则 5b 产物）在 `plugin/**` 与 `packages/quay/src/**` 重扫"git 路径列表输出进入路径谓词"的调用点：把命中数与前 3 条实际内容写进提交信息；明确列出**本次修了哪几个**、**余下几个**（与 `gap-ff-merge-quotepath-breaks-inert-retry` 的 37 个基数对齐）。
  - 今日命中：**46 个残留调用点 / 24 个文件**（本次修复前 **48 / 24**）；本次修 **2**（`worker-fan-in.ts:2688`、`:2708`）；余 **46**。分档：27 处已结构免疫（`core.quotepath=false` 或 `-z`）、17 处只做计数/空串判定、另单列 14 处 `worktree list --porcelain` 解析器（不同消费者）。
  - 前 3 条实际内容（逐字）：`plugin/scripts/checker-mutation-check.ts:687  run(["diff", "--name-only", `${base}...HEAD`]),` / `:688  run(["diff", "--name-only", "HEAD"]),` / `:689  run(["ls-files", "--others", "--exclude-standard"]),`。完整清单与口径写在提交 `4e9db98eb` 的提交信息里。
  - 与 37 基数对齐：基数只留计数、未留逐点清单 ⇒ 不可逐点相减。可核差异来源 = 基数（`c8359f300`，2026-09-17）之后的新增调用点：今日 24 个文件里 3 个在该提交时不存在（`checker-mutation-check.ts` / `integration-batch-merge.ts` / `task-status-events-reconcile.ts`），且这 24 个文件的 path-list 调用行合计 `77 (c8359f300) → 82 (HEAD)`。余 46 处横跨 24 文件，超出本任务三文件 Touches 写面（scoped 门/anti-drift 会报红）⇒ 按基数先例留给后续任务机械展开。

## DoD

- [x] AC1–AC6 全绿；`bash scripts/test.sh --for-task gap-fan-in-suite-skip-quoted-nonascii-doc-path` 通过并贴出输出。
  - 本轮实跑（worktree 内，`--allow-thin` 与 driver fan-in 同款）：`bash scripts/test.sh --for-task gap-fan-in-suite-skip-quoted-nonascii-doc-path --allow-thin` ⇒ `EXIT=0`；scoped static checks 全 PASS（含 `PASS: no checked-in-tree writes … delta against develop (1 of 2 delta path(s) judged)`），scoped tests `16 pass / 0 fail`（含新增 AC4 用例）。
- [ ] 修复后**真实生产读数**：下一次 doc-only fan-in 在 `.quay/fan-in-step-trace.jsonl` 里写出 `step:"suite-skip"`，且该次运行的 per-run 日志里没有 `suite-start`/`suite-end`；贴出记录的时间戳与 task/runId（DIR-026 Reading A：不是"flag 在文件里"，是分支真的被走到）。（待外部）
- [ ] 在 `.quay/fan-in-step-trace.jsonl` 上重跑检测器：`decayed[]` 不再含 `suite-skip`（若其它分组仍暗，逐条说明，⛔ 不得用本条掩盖它们）。（待外部）

## Dark axis (ADR-007)

该轴仍暗,理由:本任务只改 `plugin/scripts/worker-fan-in.ts` 的两个 git argv（加 `-c core.quotepath=false`）与一条测试用例，不新增/移动模块、不改任何 import 依赖边，L_D/L_G 结构面没有可归因于本任务的可取假读数（delta 为空 ⇒ 任何结构读数都恒为零、不携带信息）。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/test/worker-driver-fan-in-s09.test.mjs
- tasks/gap-fan-in-suite-skip-quoted-nonascii-doc-path.md（self-touch）