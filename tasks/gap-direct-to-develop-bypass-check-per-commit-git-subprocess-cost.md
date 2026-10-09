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

- [ ] 实测 `reachable`/`unclassifiable` 在该基线扫描下的实际集合大小，贴入任务体。
- [ ] 用计数/`strace`等手法核实"子进程总数 × 单次 fork/exec 开销 ≈ sys time"这个假设是否成立，贴出实测读数（不是假设、不是估算）。
- [ ] 若核实可以合并：把 `:813/:823/:833/:854/:863` 的逐 commit 独立调用改为批量取数，`classifyCommit`/`checkDirectCommits` 的输出（包括所有字段）逐字节不变，既有测试（68 条，0 cancelled）全部保持通过，测试数量不得减少。
- [ ] 同机隔离前后对照：`time node --no-warnings --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts --root <repo> --baseline b11ce720`。复用已有基线（改动前 59.8s / user 14.0s / sys 46.5s），改动后把实测数字写入任务体，不写预测值。
- [ ] 改动落地并经过真实 worktree/driver 执行后，从 `.quay/verification-round.jsonl` 取 ≥5 个新轮次核实 `direct-to-develop-bypass-check.test.mjs` 文件级 durationMs 的真实回落（引用已有前基线：round #2463 实测 74181ms，以及本任务发现的该单测 58-65s 子基线）。若核实后发现这 5 次调用结构上不能合并（例如 git 原生不支持一次取出全部所需字段的组合格式），必须如实记录"无可动空间"及具体技术理由，不得为制造"有改进"而强行拆分出虚假收益。
- [ ] scoped 门：`bash scripts/test.sh --for-task gap-direct-to-develop-bypass-check-per-commit-git-subprocess-cost --allow-thin` exit 0。

## DoD

必须先有实测的子进程数/sys-time 对应关系，再决定要不要改代码；改动不允许弱化真实 git 语义（仍必须是对真实仓库历史的扫描，不允许用缓存/采样/mock 替代真实数据来换速度）；测试数量不得减少；必须经过真实的任务 worktree 执行与 fan-in，并有落地之后的生产台账轮次读数印证。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts
- plugin/test/direct-to-develop-bypass-check.test.mjs
- tasks/gap-direct-to-develop-bypass-check-per-commit-git-subprocess-cost.md