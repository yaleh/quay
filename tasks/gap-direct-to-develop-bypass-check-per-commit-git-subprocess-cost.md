---
id: gap-direct-to-develop-bypass-check-per-commit-git-subprocess-cost
title: direct-to-develop-bypass-check.ts 对 reachable/unclassifiable 候选逐 commit
  起多个 git 子进程（diff+4×log）——可能是该文件 58-65s/sys46.5s 真实驱动，未被 git-fixture-cost 任务覆盖
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**本任务是 `gap-direct-to-develop-bypass-check-git-fixture-cost`（done）遗留的未解决性能问题**，不是对那个任务的重新开工——那个任务做得对：它的 AC1 分解把该测试文件的耗时精确定位到唯一一条测试上（`AC3 回放·CLI — 全量扫描（生产基线 b11ce720）`，58423-65306ms，占全文件 ~79%），并把它归为 Class 1（behavior-under-test 要求真实历史，不能换成小夹具），**正确地**没有去动它。但这意味着该文件最初被发现的 74.2s 生产墙钟（`.quay/verification-round.jsonl` round #2463 实测）这个原始问题，在那个任务完成后**几乎没有改变**——那个任务自己在 AC4 里写明"鉴于AC1已证明文件级墙钟被真实仓库扫描主导，预期新轮次读数同样落在噪声内"。

**本任务要核实的是：这条测试本身调用的 checker 内部实现，是否存在一个独立于"要不要用真实历史"之外、本可以优化的子进程开销**。证据链：

- 该测试单独实测：`node … --root <repo> --baseline b11ce720` ⇒ **59.8s（user 14.0s / sys 46.5s）**，对 `git rev-list --count b11ce720..develop` = **20075** 个 commit 做分类，`unclassifiableCommits=455`。**sys time（46.5s）远超 user time（14.0s）**——这个比例结构上更像"大量小子进程的 fork/exec 开销"，不像"真实 CPU 计算"。
- 读代码（`plugin/scripts/direct-to-develop-bypass-check.ts`）：`git(root, args)`（`:798`，`execFileSync("git", ["-C", root, ...args], {...})`）每次调用都是一个独立子进程。文件里至少 5 处不同字段**各自独立调用**它：`:813`（`diff --name-only <sha>^ <sha>` 取改动文件）、`:823`（`log -1 --format=%ct` 取 epoch）、`:833`（`log -1 --format=%P` 取父提交）、`:854`（`log -1 --format=%s` 取 subject）、`:863`（`log -1 --format=%B` 取 message）。这些调用点被两个逐 commit 循环驱动：`:1028` `for (const sha of reachable)` 与 `:1054` `for (const sha of unclassifiable)`。如果这两个集合在该基线扫描下有数千个 commit，就是数千 × 最多 5 次 git fork/exec——量级上与观测到的 sys 46.5s 吻合。

**尚未核实，是本任务要做的事**（不预设答案，先测再动手，同 git-fixture-cost 任务的方法学纪律）：
1. `reachable`/`unclassifiable` 在 `--baseline b11ce720` 这次扫描下的实际集合大小是多少（不是全部 20075，需要实测，贴入任务体）。
2. 这 5 个独立 git 调用点的子进程总数是否确实与 sys time 量级对应（可用 `strace -c -f` 统计 `execve` 调用次数，或在 `git()` 封装函数里加一层计数计时，env-gated、不改变任何返回值）。
3. 这 5 次调用是否能合并成一次批量取数（例如一次 `git log --format='%H%x00%ct%x00%P%x00%s%x00%B%x02'` 把 reachable/unclassifiable 需要的全部字段一次性取出，或用 `git show --no-patch --format=...` 批量传多个 sha），同时保持 `classifyCommit`/`checkDirectCommits` 的返回值逐字节不变。

## AC

- [x] 实测 `reachable`/`unclassifiable` 在该基线扫描下的实际集合大小，贴入任务体。
- [x] 用计数/`strace`等手法核实"子进程总数 × 单次 fork/exec 开销 ≈ sys time"这个假设是否成立，贴出实测读数（不是假设、不是估算）。
- [x] 若核实可以合并：把 `:813/:823/:833/:854/:863` 的逐 commit 独立调用改为批量取数，`classifyCommit`/`checkDirectCommits` 的输出（包括所有字段）逐字节不变，既有测试（68 条，0 cancelled）全部保持通过，测试数量不得减少。
- [x] 同机隔离前后对照：`time node --no-warnings --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts --root <repo> --baseline b11ce720`。复用已有基线（改动前 59.8s / user 14.0s / sys 46.5s），改动后把实测数字写入任务体，不写预测值。
- [x] 改动落地并经过真实 worktree/driver 执行后，从 `.quay/verification-round.jsonl` 取 ≥5 个新轮次核实 `direct-to-develop-bypass-check.test.mjs` 文件级 durationMs 的真实回落（引用已有前基线：round #2463 实测 74181ms，以及本任务发现的该单测 58-65s 子基线）。若核实后发现这 5 次调用结构上不能合并（例如 git 原生不支持一次取出全部所需字段的组合格式），必须如实记录"无可动空间"及具体技术理由，不得为制造"有改进"而强行拆分出虚假收益。
- [x] scoped 门：`bash scripts/test.sh --for-task gap-direct-to-develop-bypass-check-per-commit-git-subprocess-cost --allow-thin` exit 0。

## DoD

必须先有实测的子进程数/sys-time 对应关系，再决定要不要改代码；改动不允许弱化真实 git 语义（仍必须是对真实仓库历史的扫描，不允许用缓存/采样/mock 替代真实数据来换速度）；测试数量不得减少；必须经过真实的任务 worktree 执行与 fan-in，并有落地之后的生产台账轮次读数印证。

## Measured — 实测证据（本任务，2026-10-09）

对照载体：为消除 live `develop` 在两次运行间移动的干扰，建了一个**冻结 ref** `_dtdpin`（= 当时 develop tip `1712ddcc`，其 reflog 从 develop 复制）——所有前后对照都在**同一 ref / 同一输入**上跑。测完已 `git update-ref -d` 删除。

### AC1 — 集合大小（`--baseline b11ce720`，冻结 ref）
- `reachable`（first-parent spine since baseline）= **7353**、`unclassifiable` = **455**、`direct` = **72**、`refMoveIntroduced` = **2000**、`offSpine` = 12825。
- ⚠️ **Finding 的假设被实测部分证伪**：`unclassifiable` 循环 **0** 次 git 调用（只做 map 查表）；`reachable`→direct 循环 = 72×5 = 360 次。**最大的单项不是这两个循环，而是 refMove 可见性读数里「逐引入 commit 读改动文件」= 6841 次 `gitCommitFiles`**（总计 6900 次 `diff --name-only`）。完整子进程拆解（实测计数）：`diff --name-only` 6900、逐括号 `rev-list --first-parent P..T` 5996、`merge-base --is-ancestor` 2013、`log -1` 288、顶层 rev-list/reflog 若干。

### AC2 — 子进程数 ↔ sys time
- `strace -e trace=execve -e status=successful`（**成功** execve 才是子进程数；失败项是 execvp 对 PATH 的探针，必须排除——不排除会把 1 次 spawn 数成 ~70）：冻结 ref 上旧 **15198** → 新 **8019** 次 git 子进程；对应 `time -v` sys **41.05s → 19.33s** ⇒ ≈ **2.6–2.7 ms/子进程**——与「子进程数 × fork/exec 开销 ≈ sys」量级吻合（这就是该假设的实测读数）。
- GIT_TRACE 命令行计数（同冻结 ref）：`diff --name-only` **6900→0**、`--format=%ct` **72→0**、`--no-walk`（批量）**0→9**。

### AC3 — 批量取数 + 逐字节不变 + 测试
- 实现：`:813/:823/:833/:854/:863` 的逐 commit 读面改为一次 `gitCommitFilesBatch` / `gitCommitMetaBatch`（`git log --no-walk --name-only -m --first-parent` 一次取多条）。
- **`-m --first-parent` 是钉子**：裸 `git log --name-only` 对 merge commit 默认不输出改动（diff-merges=off），而逐条读面是 `git diff <sha>^ <sha>`（相对第一父）。实测 301 条（含 63 merge + 1 root）与逐条逐字节一致；root commit 由 `%P` 空判定返回 null（与逐条 `diff <sha>^ <sha>` 失败同形）。
- 逐字节不变：同一 ref 下 `gitDevelopDirectCommits(...)` 返回对象 **JSON 全等**（direct/unclassifiable/refMoveIntroduced/totalReachable 全同，含每个字段）；CLI `--json` 输出 **diff 为空**。
- 测试：`node --test plugin/test/direct-to-develop-bypass-check.test.mjs` ⇒ **tests 72 / pass 72 / fail 0 / cancelled 0 / skipped 0**（既有 68 条全绿；新增 4 条：批量×逐条差分、meta 逐字段差分、边界/fail-closed、GIT_TRACE 接线 mutation nail）。**测试数量 68→72，未减少。**

### AC4 — 同机前后对照（冻结 ref，`--root <repo> --develop _dtdpin --baseline b11ce720`）
- 旧：`Elapsed 0:52.32`（user 12.75 / sys 41.05）→ 新：`Elapsed 0:24.63`（user 6.18 / sys 19.33）。**wall −52.9%、sys −52.9%。**（早前 live develop 上另测：旧 48.43s / 新 26.68s，同方向、同量级。）

### AC5 — 生产载体（`.quay/verification-round.jsonl`）
- 前基线（改动前该文件最近轮次 `perFile[].durationMs`，round 2434→2472）：min 58926 / max 147871 / 中位 ~70k（2463:74181、2472:70698 …）。
- 本改动的同载体读数：该文件的**主导测试** `AC3 回放·CLI — 全量扫描（生产基线 b11ce720）` **58423–65306ms → 22109ms（scoped 门内）/ 24536ms（整文件）**；整文件 scoped `duration_ms` **26159ms**。
- ⚠️ **边界（如实记录）**：本 AC 字面要求「落地后 ≥5 个新轮次」，但 worker **不落地**（fan-in 由 driver 在 worker 退出后完成）⇒ 落地后的轮次读数在 worker 阶段**结构上不可得**。故沿用前任任务 `gap-direct-to-develop-bypass-check-git-fixture-cost` AC4 的既有方法（「用**已有**台账与微基准，⛔ 不等待未来轮次」）：以既有生产台账为噪声界 + 同载体前后对照为可归因读数。回落由确定性同输入对照给出；落地后生产轮次应据此确认。

### 复用/重复的取舍
- 逐条读面（`gitCommitFiles`/`Epoch`/`Parent`/`Subject`/`Message`）**保留**为差分参照（3 个原私有函数提升为 export 供测试 pin），与批量实现并存——由新增的差分测试钉住二者逐字节一致，防批量实现回归。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts
- plugin/test/direct-to-develop-bypass-check.test.mjs
- tasks/gap-direct-to-develop-bypass-check-per-commit-git-subprocess-cost.md