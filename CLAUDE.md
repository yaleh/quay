# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **本文件是唯一每会话自动注入的文档 —— 它的行数是本仓库最稀缺的资源。**
> 因此只放两类东西：**① 指向正本的指针；② 不随代码演化过期的纪律。**
> 任何清单、命令块、参数表都属于它们各自的正本，**在这里复制一份就是制造漂移**
> （实证 2026-08-10：`:204` 教了三天已被 `ruling F` 取代的做法，339 次绕过由此而来，
> 而没有任何检查发现——**覆盖率最高的位置，错误的杀伤力也最大**）。

## 每轮必经（只放指针，清单在正本里）

| 要做什么 | 正本（**不要在本文件复制其内容**） |
|---|---|
| 有哪些机件、各自回答什么问题 | `bash plugin/scripts/capability-catalog.sh`（182 条声明，**唯一清单**） |
| 驱动/投递到别的 Claude 会话 | `plugin/scripts/supervisor-deliver.sh <目标> <文本> --transcript <目标会话.jsonl>`（`--root` 只用于重生会话）；规程见 `orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md` |
| 三层每轮该做什么 | `orchestration/{manager,orchestrator,fast-mode}-tick-core.md`（各 ≤80 行，执行路径） |
| 判准 / 收尾 / 发消息形态 | `orchestration/manager-tick-{criteria,closing,sending}.md`（466 行；**停调 workflow 19 小时 ⇒ 这些全部缺席 ⇒ 8 条违规**） |
| 收件箱 delivered→consumed | `plugin/scripts/inbox-reader.sh`（**不是 `ls`**） |
| pane 状态 | `plugin/scripts/pane-state-classify.ts`（底部区域 + 枚举态，**不是整屏哈希**） |

## 认识论硬规则（不随代码过期；标注了各自靠什么保证）

1. **用机件，不手搓**——动作前先查 catalog 有没有同类工具。〔产物：投递工具名进记录 / `A16` 按位置计数〕
2. **按位置判定，不按关键词**——注释、字符串、消息正文里提到不算命中。〔产物：复用 `drive-contract-check.ts` / `test-framework-policy-check.ts` 的判定手法〕
3. **枚举，不布尔**——布尔化的存在性检查会把「对象没了」伪装成「检查失败」。〔产物：判准③ 要求写出条数与清单〕
4. **一个结构上不可能取假的量，不是测量**——恒等式、自证、回显都属此类。〔**无产物，靠自觉**〕
5. **来源完备性**：在某来源搜不到 X，只有当该来源对 X 完备时才等于「X 不存在」。〔**一般情形无产物，靠自觉**〕
   **最危险的实例是批量删除，它有产物**：删文档 ≥50 行前，必须先产出**落点映射**——
   被删内容的**每一个**独有词条 → 它的新正本路径，并把该映射贴进删除提交。
   **验证的是「全部有家」不是「抽查几个有家」**（2026-08-10 实证：我抽查 7 个确认有正本就删了 164 行，
   `ToolSearch` / `makeWorkspace` / `gate-gameability` 三条无家可归，事后才发现）。
6. **缺值 = 未查**，不是「为假」。〔产物：判定入口校验，缺键即拒出结论〕
7. **要求记录某动作，就不能把该动作排在记录之后**。〔产物：收尾顺序=先清扫后写日志〕
8. **编号/命名不得复用**——否则缺席被伪装成在场。〔产物：`甲乙丙丁戊` 与判准 `①-⑤` 分离〕
9. **可见性 ≠ 执行**：一条规则若「守」与「不守」在记录上无法区分，它就只能靠意志——**该给它造产物，不是把它写得更醒目**。
10. **延迟 MCP 工具必须先 `ToolSearch` 取 schema 再调**（`select:<name>` 或关键词；确认真返回了 schema 才调）。
    未取先调必 `InputValidationError`；`ToolSearch` 对预期存在的名字返回零结果**是真故障信号**（被改名/被删/skill 引用过期），**不要盲目重试**。
    适用本仓库全部 quay/meta-cc/archguard/playwright MCP 工具（exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN）。〔**无产物，靠自觉**〕

## What this repo is

`quay` is a **provider-agnostic task board**: a small **Core** CLI/MCP client + a pluggable
**Provider ABI** for where tasks actually live. This same repo is ALSO the live workspace of a BAIME
(Bootstrapped AI Methodology Engineering) research experiment where quay's own backlog is driven by
an autonomous loop under `experiments/`. Both layers coexist — the `packages/` code is the product;
`experiments/` + `tasks/` + `docs/proposals/` are the methodology/research layer.

## Commands

无 `package.json` scripts、无构建步骤（纯 ESM，Node ≥20；开发机 Node 25）。根目录 `npm install`（npm workspaces, `packages/*`）。

- **跑 CLI**：`node packages/quay/bin/quay.js <cmd>`（版本探测入口，源码路径需 Node ≥22.6）；
  provider 直连：`node --experimental-strip-types packages/quay-native/bin/quay-native.ts <cmd>`
- **跑测试**：`scripts/test.sh`（唯一入口，ADR-019/DIR-109）。**它的头注释 120 行是唯一正本**——
  glob、三条泳道（main/serial/lowconc）、并发推导与预算、`--for-task` scoped 静态检查分层、
  `--test-concurrency=` 的 `=` 写法、`QUAY_TEST_LIVE_GITHUB`、`@test-group`/`@static-tier` 标注，
  **全部读脚本，不要在此处复制一份**（本节曾复制 144 行，占本文件 49%，正是漂移之源）。
- **Web UI**：`node --experimental-strip-types packages/quay/bin/quay.ts serve --host <ip> --port <p>`
- **两条没有别处正本、故留在此**：①测试要用真 `.quay/config.yml` 建临时 workspace（见某测试文件里的
  `makeWorkspace()`）——**裸 tasks 目录不是合法 workspace**，config 是 provider map 不是扁平路径；
  ②**覆盖率不是目标**：从未被测量、可被刷（本仓库自带 `gate-gameability.test.mjs`）、
  且要紧的分支密集决策函数都已有直接 `import` 单测——**若要看覆盖率，它是参考不是指标**。
- **`scripts/test.sh` 覆盖不到的**（正本 `.github/workflows/ci.yml`）：`dist-verify-node-floor`
  （真 npm-pack 产物在 Node 底线上跑）、以及里程碑节奏的浏览器/agent e2e
  （`adr/ADR-010-scheduled-milestone-e2e-incl-browser-tests.md`，status: proposed）。
  **一次绿的 `scripts/test.sh` 不是这两类的证据。**
## Architecture — the product (`packages/`)

Three packages, one ABI:

| Package | Role |
|---|---|
| `packages/quay` | **Core** — provider-agnostic CLI + web UI (`src/serve.ts`) + MCP client/server (`src/mcp-server.ts`). Talks to whichever provider is `enabled` in `.quay/config.yml` over the Provider ABI. |
| `packages/quay-native` | **Native provider** (reference) — a **markdown+YAML-frontmatter task store on local disk** (`tasks/*.md` ARE the data). CLI + MCP server. |
| `packages/quay-github` | **GitHub provider** — maps GitHub Issues onto the same task view-model. Proves the ABI transfers. |

Key cross-cutting facts (require reading several files to see):
- **Core is written against the task view-model only**, never a specific backend. A task = `{id, title, status, role (primitive|compound), labels, parent/children, body}`; the `body` markdown carries `## Proposal / ## Plan / ## Acceptance Criteria / ## Definition of Done` sections. Providers translate to/from this shape.
- **`.quay/config.yml`** (per-workspace) is the provider map: which provider is enabled, its `path`, `tasks_dir`, `mcp_entry`, `env`. `QUAY_NATIVE_TASKS_DIR` selects the native store's directory.
- **Core CLI `task edit` is status-only in v1** (QN-024) for backward compat unless full flags are given — for a body/extra/labels write, prefer MCP `task_write` or the native provider's own richer `quay-native task edit`. (Full-field parity was later added — see `packages/quay/bin/quay.ts` help; when in doubt check which surface you're on.)
- **Gate engine ("QENG")** — `packages/quay/src/gate/{engine,registry,gate-event-store,gate-log,acceptance-runner,lifecycle,driver}.js`, exposed as verb-less CLI commands `gate` / `gate-log` / `complete` / `adjudicate` / `promote` / `retreat` / `run`. Gates evaluate a named check and append an immutable **GateEvent** to `<workspaceRoot>/.quay/gate-events.jsonl` (gitignored). `quay gate <task>` defaults to the `acceptance` gate (runs `task.extra.acceptance` as a shell command, fail-closed if unset); lifecycle transitions live in `lifecycle.ts` (`todo→ready→done`, terminal `needs-human`). "The meter is runnable, not asserted."
- **Author→ready promotion gate is SHAPE-AWARE — the unified task-shape judgment across projects (gap-todo-shape-mismatch-author-gate, 2026-08-09).** The todo→ready gate (`ready-pool-check.ts`'s `artifactsComplete`) does NOT require a literal `## Contract` on every task: it dispatches on the task body's registered shape (contract → finding → plan), and a task is four-artifacts-complete when its OWN shape's sections are present and, at each author→ready gate evaluation (每轮判定时), ≥40 non-whitespace chars. A `contract`-shape task uses `## Contract` as its plan artifact; a `finding`-shape task uses `## Finding` and has NO plan dimension; a `plan`-shape task uses `## Plan`. Unknown shape fails closed. Since 2026-08-09 the `finding` shape ALSO recognizes the draft-heading AC/DoD variants (`## AC（draft）` / `## DoD（draft）`, and their half-width-paren forms) — a `（draft）` suffix is a heading-label convention, not an absent section. **This is the single judge quay and meta-cc must share**: a todo that carries its shape's four artifacts IS author→ready-eligible even without a `## Contract` heading, and a task whose artifacts are genuinely missing must be completed (or its shape recognized) rather than having a fabricated Contract pasted on. A task-shape-vs-gate mismatch (todos that look complete but carry an unrecognized shape/heading form) is a MECHANISM defect to fix in the gate or the task's shape — not a pool-number problem to paper over by promoting regardless of artifacts.

## Architecture — the methodology layer (`experiments/`, `tasks/`, `docs/`)

- **RETIRED (ADR-022, 2026-08-03): the classic milestone loop — `OUTER-LOOP.md` + `prepare-milestone.js` + `execute-milestone.js` + the `composite-*` phases + `milestone-preparation-check.ts` + `diagnose-verify-failure.ts` — is retired.** The **two-layer fast mode is the sole development mode**. The gap tasks below that described `execute-milestone.js`/`prepare-milestone.js` as current mechanisms now describe **retired** mechanisms: those workflow files and the composite pipeline were physically deleted at `gap-retire-the-prepare-execute-pipeline-cluster` (2026-08-03). The surviving pieces of that cluster are `workflow-metadata-conformance.mjs` (shelled out to by `it0-dod-check.ts` clause 14) and the fast-mode-reused pure functions that were extracted into their consumers (`computeTouchesExpansion` → `concurrent-batch-scheduler.ts`; `parsePlanStages`/`validatePlanStructure` → `prepare-admission-check.ts`; `mapEvidenceToTasks` + composite types → `build-evidence-manifest.ts`). The mechanics below that reference the deleted files are kept as historical record of WHY the two-layer mode exists; the live driver for new work is the two-layer fast mode (fast-mode telemetry aggregated under `milestones/fast-mode-telemetry/<date>.json` — the old `.quay/fast-mode-telemetry.jsonl` path was drifted/never-existing, fixed 2026-08-05 by manager finding; `## Contract` six-key + `task-contract-check.ts` replacing ProposalReview/PlanCheck, subagent REFUTE rounds replacing the Audit phase).
- **`experiments/quay-perpetual-stream/`** is the active BAIME experiment (exp5): an autonomous outer loop that builds quay one milestone at a time. **`OUTER-LOOP.md` was the classic-loop driver document** (retired under ADR-022 — see the notice above); `inherited-core.md` is the pinned methodology; `dashboard.md` is mutable outer state; `scripts/it0-*.{sh,mjs}` are the mechanical gates (notably `it0-dod-check.sh` — the **DoD meta-enforcer**, Clauses 0-9, fixture-pinned by `dod-fixture-selfcheck.sh`).
- **The loop ran directly on `master`** (there is no driver branch — DIR-027 retired it) **under the RETIRED classic loop** (ADR-022). The worktree-isolation mechanics below are kept as historical record of the classic loop's concurrency design; the two-layer fast mode isolates per-task via `git worktree add /tmp/quay-wt-<task>` directly (no `milestone-worktree.ts` — that tool was retired after the 2026-08-03 reclaim). **Default (no-isolation) path — strictly serial:** with no `isolationMode` arg, `execute-milestone.js`'s Build phase edits "in place, commit, done" directly in the shared working tree, so **two default `execute-milestone` dispatches must never run concurrently against this repo, regardless of whether their tasks' own `## Touches` are disjoint** — the risk is the shared working tree itself (uncommitted Build-phase state colliding), not task-level file overlap; wait for one milestone's Land commit before dispatching the next. **Opt-in concurrent-safe path (DIR-123, 2026-07-31):** passing `$a.isolationMode: 'worktree'` routes Build/Audit/Gate through a REAL per-milestone `git worktree` (`milestones/M<NN>/worktrees/iteration-0`, created by `scripts/milestone-worktree.ts` before Build), so a file-disjoint dispatch's uncommitted state lives in its own worktree, NOT the shared checkout. **Land is the SOLE phase that touches the shared checkout, and it is serialized by a single-flight Land lock (`.quay/land-locks/shared-checkout.lock`) held for the ENTIRE Land phase** — not just the merge: in the SERIAL path the lock is acquired before the real `git merge --no-ff` of the worktree branch + `git worktree remove`/`git branch -d` and released only AFTER the CAPTURE commits, the dashboard.md `## Log` append, the `milestone_counter` increment, and the `it0-backlog-regen.ts` regeneration, so two concurrent worktree Lands serialize over EVERY shared-checkout mutation (no lost-update on `milestone_counter`/`dashboard.md`/`backlog.md`, no git-index/HEAD race on CAPTURE). In the CONCURRENT (`mode:'concurrent'`) path the workflow merges NOTHING — it returns `buildBranch` and the fan-in (`OUTER-LOOP.md` step g) is the SOLE merge owner, doing each survivor's merge + CAPTURE + worktree-remove under that same Land lock. The lock uses the atomic `wx`-create grant with an `rmSync` + retry-`wx` bounded-loop stale reclaim (mirroring `proposal-convergence.ts`'s hardened epoch lock — never a plain overwrite, never a permanent lockout). A crashed dispatch that stranded a worktree was recovered by `milestone-worktree.ts --clean-stale` (retired 2026-08-03 after the reclaim; cleans only a branch with ZERO commits ahead of master; a branch WITH commits fails closed to needs-human, never discarded). Pre-dispatch eligibility for concurrent dispatch REUSES the existing `concurrent-batch-scheduler.ts`'s `assembleBatch` → `touches-orthogonality-check.ts`'s `checkTouchesPair` as the real production eligibility mechanism (the named `worktreeDispatchEligibility` is a thin TEST-FACING wrapper over `assembleBatch` that additionally tags same-file conflicts — it has no separate production callers). Same-file overlap → rejected pre-dispatch and serialized, never left to collide at Land; a real merge conflict that nonetheless reaches Land is auto-aborted + needs-human, never a blanket --ours/--theirs. A requested-but-unusable isolation (unknown mode, or no numeric milestone) FAILS CLOSED rather than silently falling back to the shared tree. Omitted/empty `isolationMode` is byte-for-behavior the old direct-on-`master` path (golden-replay-proven; the only legacy delta is Land's corrected step-1 prompt text). **HARD PRECONDITION (mixed modes):** the default (no-isolation) path takes NO Land lock and commits directly to master in Build, so it is NOT serialized against worktree Lands — therefore a no-isolation dispatch must NEVER overlap a concurrent batch against the same checkout; concurrent batches are worktree-isolated BY CONSTRUCTION (`OUTER-LOOP.md` step a always passes `isolationMode:'worktree'`). **Status (RETIRED under ADR-022):** mechanism + concurrency-safety fixes were implemented and real-git fixture/golden-replay/lock tested; the "two genuinely concurrent real milestone journals" proof never ran because the classic loop was retired before it. The two-layer fast mode is the sole mode.
- **`prepare-milestone.js` also supported the SAME opt-in `isolationMode: 'worktree'`** (gap-prepare-milestone-no-worktree-isolation, M252) — **RETIRED under ADR-022** (the file is deleted; kept as historical record): a per-milestone `git worktree` (`milestones/M<NN>/worktrees/iteration-0`, branch `milestone/M<NN>/iteration-0` — the SAME path/branch convention execute-milestone's Build worktree uses) was created via `milestone-worktree.ts --add` BEFORE the Admission lease is acquired; coordination primitives (Admission lease, epoch records, generation telemetry, split-decision records) stayed in the primary checkout while CONTENT outputs (task Proposal/Plan edits, `docs/plans/*.md`, receipt/ledger/inventory files, ProposalReview checkpoints) happened EXCLUSIVELY in the worktree. Content-agent prompts carried a single module-level `_worktreeIsolationNote` prefix (empty string when isolation is off → byte-for-behavior golden replay) that routed agents to `cd <worktree>` and use Bash `cat`/`>>` instead of the MCP `task_get`/`task_write` (which resolve against the primary checkout). Every terminal return was wrapped by `_wtRet`, adding `worktreeRel` so a stranded worktree was discoverable by the caller. **prepare-merge** (AFTER Receipt success + lease release): commit worktree changes (`git add -A && git commit`) → `milestone-worktree.ts --merge` (real `git merge --no-ff`) → `--remove`; a merge conflict auto-aborts leaving master clean and the worktree intact, returning needs-human `prepare-merge-conflict` + the conflict file list (the lease is already released, so a merge failure never strands it). In CONCURRENT mode (`$a.mode === 'concurrent'`, AC8), prepare-merge COMMITS-ONLY on the branch and returned `{ outcome: 'building', buildBranch, worktreeRel }` — it did NOT merge/remove/take the Land lock; the fan-in (`OUTER-LOOP.md` concurrent_execute step g) was the SOLE merge owner of prepared worktrees before any execute-milestone dispatch. The concurrent prepare dispatch proof (two file-disjoint tasks on `master`) was task #22's scope; the mechanism was opt-in, not the default, and never became it.
- **`.halt` sentinel** — pauses the loop at the next milestone boundary. **Correction (2026-07-27, `gap-halt-sentinel-path-mismatch`):** the real, mechanically-checked location is the **repo root** (`<repo-root>/.halt`, workspace-root-relative — matches `plugin/skills/loop-driver/SKILL.md`'s documented convention and `select-preflight.ts`'s actual `checkHalt()` implementation). A previous version of this file incorrectly documented `experiments/quay-perpetual-stream/.halt`; that path is NOT read by any live code path. **When editing while the loop may run, follow DIR-027 human-steering hygiene: pause via a root-level `.halt`, OR work in a private git worktree off `master` and fast-forward at a clean window** — never race the loop on `master`. Before REMOVING `.halt` to un-pause, run
  `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh` (fixed to check this same
  repo-root path at M187) — the mechanical go/no-go for whether `master` is safe to hand back to
  the loop (clean tree, no mid-flight merge, `master` not checked out in a stray worktree, etc.).
  **This is a manual, human-invoked check, not CI/loop-wired** (`gap-orphaned-check-scripts-not-
  wired`, M-DIR119-C-CANARY, 2026-07-27, explicit decision) — nothing runs it for you automatically
  before an un-halt; run it yourself.
- **Directives are TASK-CANONICAL** (DIR-028 / "Plan A", the single-source-of-truth principle): a directive is a `label:directive` quay task (`tasks/DIR-NNN.md`) and nothing else — there is no `directives/*.md` file, no projection, no anti-drift check (all retired). Create/steer via the `quay-directive` skill. Milestone candidates are `label:milestone-candidate` tasks; `backlog.md`/`dashboard.md` are **generated views** of the task store, not hand-edited sources.
- Recurring design principle enforced across this repo (see `docs/proposals/exp5-crystallization-strategy.md`): **single source of truth + executable invariants over prose.** When you find content living in two places (a file + a task copy; a charter copying a task's AC/DoD; a status in a field AND a body line), that is drift — fix the SOURCE (usually a doc/skill/template that generated it), not just the artifact.

## Reference docs

- `README.md` — install/usage + the three-package overview.
- `packages/quay/DESIGN.md`, `docs/proposals/quay-proposal.md` — Core architecture + Provider ABI rationale.
- `docs/proposals/exp5-crystallization-strategy.md` — the current "molten prose → executable single-source" direction (canonical task schema, formalized prompt-doc style).
- `adr/ADR-*.md` — first-class decision records (`quay-native adr list`). ADR-004..010 (status: proposed) crystallize the GIT-lens program; read them before extending it.
- `docs/references/` — the GIT framework (goal-closure `L_T..L_S`, 硬形变/Π_{S→E}, two-phase breathing) AND its limits: the continuous math (Fisher/natural-gradient/intrinsic-dim/ρ) is NOT rigor (ADR-006).

## Tools

- **archguard** (MCP) — static architecture analysis: the `L_D`/`L_G` instrument (dependency structure/cycles, god-packages, duplicated/reinvented abstractions) per ADR-007. Consult it before calling a milestone done.
- **meta-cc** (MCP) — search Claude Code session history (past errors, edit sequences, work patterns).
- BOTH are maintained by the repo owner, so bugs get fixed fast — use them aggressively and report/fix issues rather than working around them.
- **tmux remote-drive** (→ ADR-016) — to drive a FOREIGN workspace's Claude Code session (e.g. run archguard's `/loop` from here): **deliver via `bash plugin/scripts/supervisor-deliver.sh <tmux目标> <文本> --transcript <目标会话 .jsonl>`** (`--root` only for re-spawned sessions), then read the RESULT from the filesystem/`git`/meta-cc — never parse the TUI. Do **not** hand-write tmux send-keys sequences and do **not** use `send-keys-verified.sh` (superseded; its md5 pane-hash criterion is ADR-016-forbidden). The screen-use carve-out is pinned in ADR-016's `## Amendment 2026-08-04`: only the bottom region (input box + status line), only the enumerated states (waiting-input / permission-prompt / busy / error-banner / unknown), and never a whole-screen equality/hash of `capture-pane` (enforced by `plugin/scripts/adr016-screen-use-check.ts`). One driver per session (never race a human typing there; beware gray ghost-suggestions). This is how cross-workspace proofs (DIR-048/049/051) can run without a human round-trip.

**跨会话驱动/状态读取的四条硬规则**（机件清单只存在于 `bash plugin/scripts/capability-catalog.sh`，任何地方不得复制——catalog 头注释钉死「The field lives IN A SCRIPT, never in the README」）：
1. 驱动/投递到别的 Claude 会话：`supervisor-deliver.sh <目标> <文本> --transcript <目标会话.jsonl>`（`--root` 只用于重生会话）；禁止手工拼 tmux send-keys；`send-keys-verified.sh` 已 superseded。
2. 收件箱 delivered→consumed：`inbox-reader.sh`，不是 `ls`。
3. pane 状态：`pane-state-classify.ts`，不是整屏哈希（ADR-016 禁）。
4. outer→inner 驱动文本契约：`drive-contract-check.ts`。

## Process

- Development is driven via **background Claude Code workflows at milestone granularity** (→ ADR-009), with a **scheduled milestone e2e incl. browser tests** (Playwright/chrome-devtools) that keeps `L_T` on the real product surface (→ ADR-010). Follow DIR-027 steering hygiene (`.halt` or private worktree; never race the loop on `master`).

## Split-decision routing policy

**正本已搬回任务体**：`tasks/gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode.md`
（四个 code 的路由表、split 落实的四项验证、`> 2` 阈值裁定，全在那里）。
**状态：reference/manual，NOT mechanically enforced** —— `checkSplitRecommendation` 零非测试调用者，
没有任何 fast-mode 派发或任务撰写路径调它。**别把它当生效的机制用。**
## GIT review checklist

- Before calling a milestone done, ask **which of `L_T`/`L_C`/`L_D`/`L_G`/`L_S` is still dark** (ADR-006/007) and prefer **hard checks over prose** (ADR-004 — prose gets paraphrased away). See `docs/references/` for the framework and its limits (the continuous math is not rigor).

## Workflow resume anti-pattern (M144, 2026-07-25)

When a workflow Verify phase fails and the fix is to **external state** (gap-list.md, charter file, script on disk), do NOT resume with `resumeFromRunId`. The resume cache keys on (prompt, opts) only — it cannot see that external files changed. The cached failure returns instantly (~60ms, 0 tokens) and the Verify phase fails again with the same stale result.

**Rule:** if the fix touches anything OTHER than the workflow script's own agent prompt strings, re-run the workflow from scratch (`Workflow({script: ...})` without `resumeFromRunId`). Resume is safe ONLY when the fix is a prompt-text edit within the workflow script itself.

**Extension (M176, 2026-07-26, gap-workflow-name-dispatch-stale-script-cache):** the same staleness
class also hits plain `Workflow({name: "<saved-workflow>"})` calls, with NO `resumeFromRunId`
involved at all. Within one long-running session, a `name:`-based dispatch made AFTER the first
`name:`-based dispatch of that same workflow can still materialize the **old** script body, even
minutes after the underlying checked-in file (e.g. `.claude/workflows/execute-milestone.js`) was
edited and committed to `master` in between — confirmed via `diff` against the materialized script
under `~/.claude/projects/.../workflows/scripts/`. This is undocumented behavior (confirmed via
Claude Code's own docs/changelog — no mention of `name:`-resolution caching), not a repo bug.

**Rule:** in a session where a checked-in workflow script may have changed since the session
started (e.g. this session is itself implementing/patching that very script), always dispatch it
via `Workflow({scriptPath: "<absolute path to the real checked-in file>", ...})`, never
`Workflow({name: ...})` — `scriptPath` reliably re-reads the current on-disk content;
`name` may not. If the staleness is suspected but unconfirmed, diff the materialized script
(printed in the tool result / notification) against the real checked-in file before trusting a run's
outcome.

## Glob tool unavailable in subagent sessions (M148, 2026-07-25)

The `Glob` tool is **not available in subagent sessions**. Calling `Glob` from a subagent produces "Error: No such tool available: Glob". This has been observed in meta-cc session history as a recurring error pattern.

**Rule:** when you need file-pattern matching in a subagent, use `find` via Bash instead of `Glob`. Example: `find . -name '*.js' -not -path '*/node_modules/*'` instead of `Glob({pattern: '**/*.js'})`. All Bash tools (including `find`, `grep`, `ls`) work normally in subagent sessions.

## Pre-Edit freshness check (M150, 2026-07-25)

78% of Edit errors are stale `old_string` matches — the file has changed since you last read it, and the string you are trying to replace no longer exists at the expected location.

**Rule:** before calling `Edit` with an `old_string`, re-read the target region of the file with `Read` to confirm the string you intend to replace is still present exactly as you expect. Do not construct `old_string` from memory or from a stale read earlier in the conversation. A fresh read immediately before the edit is the only reliable source of the current file state.
