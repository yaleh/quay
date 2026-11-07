---
id: gap-conflict-mechanical-resolver-not-wired
title: 把 conflict-resolution-rules 的机械消解接进 worker
  生产路径：resolveConflictMechanically 有行为测试但零生产调用，continue prompt 仍用 1842 字符教 agent
  手跑同样的 git 命令
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-prompt-string-assert-seven-rules-disposition
---
## Proposal

**来源**：`gap-prompt-string-assert-seven-rules-disposition` 的 `## 追加记录（落地后核出，未处理）`（该任务已 `done`）。本条是人为其解除 PARKED 后的后续动作，`depends_on` 指向它，⛔ 不是独立提议。

**发现**：`plugin/scripts/conflict-resolution-rules.ts:220` 的 `resolveConflictMechanically` 能真跑 `git checkout develop --` / `git rm` / dual-copy 字节同步，且有行为测试（`plugin/test/worker-driver-resident-s07.test.mjs:145`、`:245`）。但全仓调用点只有**该文件自己的 CLI 入口**（`:296`）与测试——**worker/driver 生产路径没有调用者**。

**影响**：`buildContinueWorkerPrompt` 的冲突消解块 = **1842 字符（冲突块占 continue prompt 约 34%）**，其中规则 (1) take-develop docs、(3) dual-copy 已是**机器可判**，prompt 却仍教 agent 手工执行同样的 git 命令。⇒ 生产路径绕过了可执行载体；这正是上一任务「可见性 ≠ 执行」的同一形态，只是这次的载体**已经存在且已测试**。

**基线**（P1 落地后）：`buildContinueWorkerPrompt` 渲染长度 = **6511**（fixture 见 P1 的 E1）；冲突块 **1842**；棘轮 `gap-worker-prompt-note-family-slimming` 当前 **8940**（阈值 9102）。

⛔ 不以 |D| 下降 / 原子数计数作为任何 AC 或 DoD 的证据。

## Plan

1. **确定接线点**：冲突发生在 worker 的 pre-merge 步（它在自己的 worktree 里 merge develop）。推荐做成**一条命令**：给 `conflict-resolution-rules.ts` 增加批量模式（例如 `--resolve-all <root>`），枚举 `git diff --name-only --diff-filter=U`，对每个文件调用既有的 `resolveConflictMechanically`，返回「已机械解决」与「仍需人工判断」两份清单。**保持既有单文件 CLI 与导出函数签名不变**。
2. **实现批量路径**：只对 `conflictAction` 返回非 `manual` 的文件执行；`manual` 文件**原样保留**并在输出里点名。⛔ 不得静默跳过、不得对 manual 文件擅自 `git checkout develop --`。
3. **改 prompt**：把 continue prompt 冲突块的机器可判规则 (1)/(3) 换成「跑这条命令 + 只处理它点名的人工文件」；保留判断型规则 (2) code union、(2b) task files、(5) modify/delete（含"先判哪边删"的语义）、(6) add+commit、FF 规则。
4. **测试**：真 git 仓库 fixture——take-develop（outline/tick doc）、dual-copy（两副本 byte-identical）、delete-side（DU/UD）各一条正臂；`manual` 文件一条负臂（未被改动且被点名）。⛔ 不许只断言返回字符串。
5. **读数**：用 P1 E1 的同一 fixture 重测 `buildContinueWorkerPrompt`，记录 before/after 与冲突块大小；确认棘轮 ≤9102 仍绿。

## Acceptance Criteria

- [x] AC1 生产可达：批量机械消解从**真实 worker 使用的 prompt** 可达——prompt 里给出单一命令；在真 git fixture 上运行该命令，take-develop / dual-copy / delete-side 三类文件被真实解决（`git status` 无 UU；dual-copy 两副本 byte-identical）。负臂：一个 `manual` 文件被原样保留**且**在输出里点名（给出逐字读数）。
      读数（E1/E2）：prompt 里的单一命令 = `node --no-warnings --experimental-strip-types <plugin>/scripts/conflict-resolution-rules.ts --resolve-all <worktree>`（`--resolve-all` 在 prompt 中出现 **1** 次）。把**这条命令逐字**跑在真 merge 冲突仓库上：`conflict-resolve-all …: 5 unmerged path(s) — 4 machine-resolved, 1 need your judgment`；跑后 `orchestration/manager-tick-core.md`=`develop-v2`（take-develop）、两副本 md5 同为 `0efa55ec07365371ce2cf263c548a881`（dual-copy byte-identical）、`dead.md` 已不存在（delete-side）、`git status` 里该三类无 UU/DU。负臂逐字：`MANUAL packages/quay/src/code.ts — [UU] not a machine-decidable rule — resolve semantically`；该文件 md5 跑前跑后同为 `399440408f7b66fbf75c67d058a0c369`、仍 `UU`、`RESOLVED manual:` 命中 0 次、exit=1。
- [x] AC2 prompt 收缩：continue prompt 冲突块里规则 (1)/(3) 的机器可判指令**不再出现**（负臂：对应文本在 `buildContinueWorkerPrompt` 输出中的命中数为 0）；判断型规则 (2)(2b)(5)(6)+FF 仍在，且既有行为测试仍绿。
      读数（E3）：命中数 `git checkout develop`=0、`take the develop version (`（指令形态）=0、`byte-identical`=0、`do NOT take a semantic union`=0、`do NOT hand-merge the counts`=0。判断型仍在：`semantic union` / `per-hunk union` / `judge WHICH side deleted` / `git commit --no-edit` / `not fast-forward` / `never silently restore the deleted file` 全部 present=true。⚠️ `take the develop version` 短语本身仍出现 **1** 次——那是规则 (2b) 的**禁止句** `⛔ do NOT "take the develop version"`（任务文件恰恰不许取 develop 版），按指令形态计数，⛔ 不按短语计数。
- [x] AC3 长度读数：用 P1 E1 的同一 fixture 贴出 `buildContinueWorkerPrompt` 的 before（6511）与 after 逐字数字、冲突块 before（1842）与 after；棘轮 `gap-worker-prompt-note-family-slimming` ≤9102 仍绿（给出当前值）。
      读数（E4/E5）：`BEFORE create=4314 continue=6511 conflictBlock=1842` → `AFTER create=4314 continue=6483 conflictBlock=1814`（冲突块口径 = 元素边界 1840/1812 **+2** 两侧连接空格 ⇒ 与 P1 记录的 1842 逐字对齐）。棘轮 `RATCHET 8940 → 8846`，阈值 9102 ⇒ 绿，余量 256；`WORKER_PROMPT_SLIM_BASELINE` **未改**。
- [x] AC4 无回归：`plugin/test/worker-driver-resident-s07.test.mjs`（含 `resolveConflictMechanically` 的既有行为测试）与 `scripts/test.sh --for-task gap-conflict-mechanical-resolver-not-wired` 绿。
      读数（E6）：`s07` ⇒ `tests 17 / pass 17 / fail 0`（含 `resolveConflictMechanically` 的两条既有行为测试 + `gap-conflict-outline-half-only-in-prompt-prose` 的两条）；scoped 门 ⇒ `tests 172 / pass 172 / fail 0`，`DIRECT_EXIT=0`，静态检查 `task-contract-check: no violations` / `superseded-capability PASS` / `mirror-pair-drift-check: PASS`。

## Definition of Done

- 四条 AC 勾选，每条附可复跑命令与逐字读数。
- **生产路径的证据**：真实运行（不是测试里直接 import）批量命令解决真冲突的读数，贴进 `## Evidence`。
- prompt 改动写进任务体，不是只留在会话里。
- ⛔ 完成证据中不得出现「|D| 下降」或原子计数。

## Evidence

### E1 — 生产路径真跑（不是测试里直接 import）

fixture 造法（真 merge 冲突仓库，`/tmp/gapcmr/mkfixture.sh`）：develop 上 A 版 → 分支 `task/x` 改 5 个文件（含 `rm dead.md`）→ develop 再改成 B 版 → `git checkout task/x && git merge develop` ⇒ 真冲突。

```
$ git -C <fixture> status --porcelain          # BEFORE
UU .claude/workflows/x.js
DU dead.md
UU orchestration/manager-tick-core.md
UU packages/quay/src/code.ts
UU plugin/workflows/x.js

$ node --no-warnings --experimental-strip-types <worktree>/plugin/scripts/conflict-resolution-rules.ts --resolve-all <fixture>
conflict-resolve-all <fixture>: 5 unmerged path(s) — 4 machine-resolved, 1 need your judgment
  RESOLVED dual-copy-sync: .claude/workflows/x.js — re-synced .claude/workflows/x.js ↔ plugin/workflows/x.js byte-identical from develop
  RESOLVED delete-side: dead.md — accepted the deletion of dead.md (DU)
  RESOLVED take-develop: orchestration/manager-tick-core.md — restored orchestration/manager-tick-core.md from develop
  RESOLVED dual-copy-sync: plugin/workflows/x.js — re-synced plugin/workflows/x.js ↔ .claude/workflows/x.js byte-identical from develop
  MANUAL packages/quay/src/code.ts — [UU] not a machine-decidable rule — resolve semantically
  NOTE accepted deletion(s): dead.md — develop's version is still at `git show develop:<file>`; if your branch deleted it intentionally, apply rule (5)'s absorb-then-rm judgment.
  ⇒ handle ONLY the MANUAL files above (code semantic union / task-file per-hunk union / modify-delete judgment), then `git add` + `git commit --no-edit`.
EXIT=1

$ git -C <fixture> status --porcelain          # AFTER
M  .claude/workflows/x.js
M  orchestration/manager-tick-core.md
UU packages/quay/src/code.ts
M  plugin/workflows/x.js

$ cat orchestration/manager-tick-core.md   -> develop-v2
$ md5sum .claude/workflows/x.js plugin/workflows/x.js
0efa55ec07365371ce2cf263c548a881  .claude/workflows/x.js
0efa55ec07365371ce2cf263c548a881  plugin/workflows/x.js
$ ls dead.md -> No such file or directory
```
幂等复跑：第二次 `--resolve-all` 只剩 `1 unmerged path(s) — 0 machine-resolved, 1 need your judgment`（已解决的不再出现）。

### E2 — AC1 负臂（manual 文件：字节不变 + 被点名 + 不与「已解决」同形）

```
$ md5sum packages/quay/src/code.ts     # 跑 batch 前后
399440408f7b66fbf75c67d058a0c369       # BEFORE
399440408f7b66fbf75c67d058a0c369       # AFTER（字节完全不变；仍 UU，冲突标记仍在）
$ grep -c 'MANUAL packages/quay/src/code.ts'            -> 1
$ grep -c 'RESOLVED manual: packages/quay/src/code.ts'  -> 0
$ git status --porcelain -> UU packages/quay/src/code.ts   （仍是未合并路径）
EXIT=1                                                     （⛔ 不与「全部解决」=0 同形）
```
硬规则 3b 臂——读不懂冲突集时**不得**报「0 unmerged」：
```
$ node …/conflict-resolution-rules.ts --resolve-all <非 git 目录>
conflict-resolve-all <dir>: NOT EVALUATED — git status --porcelain failed (exit 128): fatal: not a git repository …
EXIT=1
```

### E3 — AC2 逐字命中数（读 `buildContinueWorkerPrompt` 的输出，⛔ 不读源码注释）

```
count("git checkout develop")                = 0
count("take the develop version (`")         = 0     # 机器可判的【指令形态】
count("take the develop version")            = 1     # = 规则 (2b) 的禁止句 ⛔ do NOT "take the develop version"
count("byte-identical")                      = 0
count("do NOT take a semantic union")        = 0
count("do NOT hand-merge the counts")        = 0
present("semantic union")=true  present("per-hunk union")=true  present("judge WHICH side deleted")=true
present("git commit --no-edit")=true  present("not fast-forward")=true  present("never silently restore the deleted file")=true
```

### E4 — prompt 改动（写进任务体，⛔ 不只留在会话里）

冲突块新形态（`worker-driver.ts` `continueConflictResolutionNote(worktree)`，命令从 `RESOLVE_ALL_FLAG` 渲染 ⇒ 与 CLI 同一真相源）：

```
CONFLICT RESOLUTION — … ⛔ never exit while unmerged paths remain.
(1) run the mechanical resolver FIRST — ONE command: `node --no-warnings --experimental-strip-types <plugin>/scripts/conflict-resolution-rules.ts --resolve-all <worktree>` — it solves the machine-decidable conflicts (take-develop docs, dual-copy, modify/delete) and PRINTS what it left MANUAL; ⛔ hand-run nothing it covers — handle ONLY the files it names (rules 2/2b/5).
(2) code files: … semantic union …
(2b) task files (`tasks/<id>.md`): … per-hunk union …（逐字保留）
(5) modify/delete CONFLICT: first judge WHICH side deleted …（逐字保留）
(6) `git add <resolved files>` then `git commit --no-edit` …（逐字保留）
FF NOT FAST-FORWARD — … ⛔ do NOT re-implement.（逐字保留）
```
删掉的正是旧 (1) take-develop docs 与 (3) dual-copy 两条**手跑 git 命令**的散文（它们现在由那条命令**执行**）。
`kernelSiblingArgv` 解析不出该 sibling 时，prompt **如实说跑不了**（⛔ 不假装跳过），判断型规则仍完整给出。

### E5 — 长度读数与棘轮（P1 E1 的同一 fixture；`QUAY_PLUGIN_ROOT` 钉成同一串，⛔ 不混用两个长度量）

```
BEFORE  create=4314 continue=6511 conflictBlock=1842   (元素边界 1840 + 2 两侧连接空格)
AFTER   create=4314 continue=6483 conflictBlock=1814   (元素边界 1812 + 2)
RATCHET 8940 → 8846   threshold=9102   (WORKER_PROMPT_SLIM_BASELINE=12137 未改，余量 256)
```

### E6 — 无回归

- `node --test plugin/test/worker-driver-resident-s07.test.mjs` ⇒ `tests 17 / pass 17 / fail 0`。
- `bash <worktree>/scripts/test.sh --for-task gap-conflict-mechanical-resolver-not-wired --allow-thin` ⇒ `tests 172 / pass 172 / fail 0`，`DIRECT_EXIT=0`；静态检查 `task-contract-check: no violations`、`superseded-capability check: PASS`、`mirror-pair-drift-check: PASS`。
- 新增行为臂（⛔ 不是只断言返回字符串）：正臂从**真实 prompt 里逐字抠出那条命令**再当子进程跑在真 merge 冲突仓库上（证明「prompt 给的那条命令真能解决冲突」）；负臂把 manual 文件的前后字节、UU 状态、被点名次数、退出码一起判。

### E7 — ADR-007 暗轴记录

- L_D code:doc ratio: codeLines=431, docLines=0, ratio=0, verdict=PASS（`node experiments/quay-perpetual-stream/scripts/git-lens-instrument.mjs ld --numstat-file .quay/ac-cmr-numstat.txt --json`；numstat 取数时点 = 代码提交 `c5fb3184c`，3 个代码/测试文件 = `151/8`、`22/10`、`222/18`。任务体写入只增加 `.md` 行 ⇒ 只会把 ratio 推向更小，不改变 PASS。）
（L_G 侧未取到读数：`git-lens-instrument.mjs lg --work-dir .` 返回 `NOT-EVALUATED(scope-not-evaluated: cannot read query manifest …)` —— worktree 无 archguard query 产物 ⇒ 目录级 cycles **未评测**，⛔ 不是 cycles=0。）

## Touches

- plugin/scripts/conflict-resolution-rules.ts
- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- plugin/test/worker-driver-resident-s07.test.mjs
- tasks/gap-conflict-mechanical-resolver-not-wired.md
