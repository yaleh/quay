---
id: gap-ac255-driver-internalization-pid-le2-six-kinds-fresh
title: GOAL-017/AC-255：driver 内收 —— `.quay/*-driver*.pid` ≤2 且六个 kind 的 round
  心跳全新鲜（SPEC 阶段 C1+C2 / §6.10）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac251-unified-server-web-control-same-process
  - gap-ac252-control-plane-hoist-to-layer0
  - gap-ac254-partial-stop-web-driver-round-record
goal_ac: AC-255
---
## Proposal

**AC-255 现状（立案当轮实测 2026-09-13T15:2xZ，取假形态）**：逐字跑 AC-255 的 criterion ⇒ exit 1：

```
AC-255: 12 driver pid file(s) still present (goal-driver-supervisor.pid,goal-driver.pid,meta-driver-supervisor.pid,meta-driver.pid,outer-driver-supervisor.pid,outer-driver.pid,promotion-driver-supervisor.pid,promotion-driver.pid) => processes not converged (stage C not landed)
exit=1
```

实测读数（同轮，非印象）：`.quay/*-driver.pid` + `.quay/*-driver-supervisor.pid` = **12**（六个 kind promotion/worker/outer/goal/quality/meta 各一对 {driver, supervisor}）。⛔ `suite-load-*.jsonl.pid`（约百个）与 `.quay/worker-driver-inflight.pid` **不匹配** criterion 的那两个 glob（它们结尾是 `.jsonl.pid` / `-inflight.pid`），不计入——宽松 glob 会数出 130+。长驻进程：上述 12 + `quay serve`（立案当轮 pid 3157065，`node --watch --experimental-strip-types packages/quay/bin/quay.ts serve --host 0.0.0.0 --port 4173`）= **13**，与 GOAL-017「现状实测」逐字一致。六个 kind 的心跳立案当轮都新鲜：promotion 0min / worker 1min / outer 1min / goal 11min / quality 0min / meta 0min。

**⚠️ 立案当轮发现的结构性缺口（会让 AC-255 在【完全收敛之后】仍然取假）**：criterion 对 `meta` 读的是 `.quay/meta-round.jsonl`，而 meta kind 的载体实际写作 `.quay/meta-driver-round.jsonl` —— `plugin/scripts/driver-runtime.ts:207` 的 `carriers: ["meta-driver-round.jsonl"]`，并导出为 `plugin/scripts/meta-driver.ts:69` 的 `ROUND_CARRIER_REL`。另外五个 kind 全是 `<kind>-round.jsonl`（promotion/worker/outer/quality/goal），**只有 meta 带 `-driver-` 中缀**。⇒ 即使进程收敛到 0 个 pid 文件，criterion 仍会 exit 1 报 `meta:no-carrier`。**这一半必须与收敛同时解决**，否则本任务「做完」而判据恒红。该载体名的既有消费者（改名需逐一处理，⛔ 不是只改 `driver-runtime.ts` 一处）：`plugin/scripts/meta-driver.ts:69`、`plugin/scripts/driver-runtime.ts:207`、`plugin/scripts/goal-driver.ts:79`（注释）、`plugin/probes/meta-driver.md:40`、`plugin/test/meta-driver.test.mjs:1446`、`plugin/test/driver-config.test.mjs:138`、`goals/AC-181-meta-driver.md:7-8`（**一条 active goal 判据正在读旧名**）。

**为什么这是 SPEC 阶段 C、不是新功能**：`orchestration/SPEC-unified-quay-server-2026-09-13.md` §7 阶段 C 两步——**C1** 例程型（outer/goal/quality/meta，无 spawn、无并发，风险最低）内收，进程数 **12 → 8**，四种例程的 round 心跳不中断；**C2** 任务处理型（promotion/worker）多进程 supervisor 退役为**一个**外层 anchor，进程数 **→ 2（server + anchor）**。AC-255 的 `≤2` 要求 **C1 与 C2 都落地**。§5 的目标架构把执行面（drivers）画在 `quay server` 进程框内；§6.1 的对策是「每个 kind 循环用**独立错误边界 + 重启计数（把 respawn 从 OS 进程层降到事件循环层）**，剩余的不可恢复故障（OOM、段错误）由**一个**外层 anchor 兜（不是六个 supervisor）」。⇒ 这是**进程边界**的改动，⛔ 不是重写判定逻辑。

**AC-255 的判据形状（决定本任务不能只数进程）**：§6.10 记的是**合并【引入】的新风险**——13 个进程时 `ps` 能看出哪个 driver 死了；合并后 `ps` 只剩一行 ⇒「进程活着」与「六个 driver 都在转」在外部不可见（§6.7 禁止的那种折叠）。所以 criterion 两个条件**必须同时成立**：pid 文件 ≤2 **且** 六个 kind 的 round 心跳都在 60 分钟内被写过。**⇒ 本任务最危险的取假形态是「把 pid 文件改成不匹配 glob 的名字」**（criterion 的 `≤2` 只数文件名，改名即得 0，而进程一个没少）——本任务自己的 AC 因此必须另配**进程数直接量**（AC1），并用收敛前后 `ps` 对照钉死。

**基线（收敛前，用于零回退对照）**：六个 kind 心跳全新鲜（上列）；`quay driver <verb> --kind X` 的六 kind 动词表在 `packages/quay/src/cli/driver-vocab.ts`（`VERBS`/`KINDS` 零依赖叶模块，`packages/quay/src/cli/driver.ts:39` re-export，⛔ 不手抄）。

<!-- dedup-ref -->
**关联（仅追溯，不构成本任务的阻塞声明）**：本 GOAL 阶段 A/B 的三件——`gap-ac251-unified-server-web-control-same-process`（`status --json` + `.quay/server.json` 进程自发布 + web/control 合进程）、`gap-ac252-control-plane-hoist-to-layer0`（`serveControlPlane` 上收 Layer 0，六 kind 都从共享骨架获得控制面）、`gap-ac254-partial-stop-web-driver-round-record`（服务独立起停 + `.quay/unified-server-verification.jsonl`）——与本任务机制不同、Touches 相交但层不同；SPEC §7 的硬顺序决定本任务排在其后（见 frontmatter `depends_on`）。`gap-ac253-session-primitives-shared-layer-adoption`（会话原语统一到共享层）与本任务**正交**，可并行。全仓 `grep -rn '^goal_ac: AC-255' tasks/*.md` = **0**（立案当轮实测），无重复立案。

## Plan

1. **先解决 meta 载体命名（判据可行性的前置，⛔ 不是收尾项）**：在 C1 落地前定夺并记录——(a) 把 meta kind 的 round 载体统一为 `.quay/meta-round.jsonl`（与另外五个 kind 同形），同时更新上列**全部**消费者，并为 `goals/AC-181-meta-driver.md:7-8` 那条仍在读旧名的 active 判据给出处置（过渡期双写两个名字 / 同一次改动内更新该判据 —— **必须二选一并写进结果段**）；或 (b) 修订 AC-255 的 criterion 使其读 `meta-driver-round.jsonl`（改 goal 判据需授权，须先取得）。⛔ **不得留着 `meta:no-carrier` 让判据恒假而任务宣称完成**。落笔当轮取一次真实读数：criterion 的六个 kind 都能被读到。

2. **C1 例程型内收**：把 outer/goal/quality/meta 四个无 spawn、无并发的循环收进宿主进程（按 §5 目标架构即统一 server；若实际落在独立 anchor，须在结果段写明并给出与 §5/§7 的对齐理由），循环用**事件循环层**的独立错误边界 + 重启计数（§6.1），退役这四对 driver+supervisor 进程。⇒ 匹配 criterion glob 的 pid 文件 12 → 8 方向下降；四种例程的 `<kind>-round.jsonl` 心跳**不中断**（收敛窗口内连续新鲜）。

3. **C2 任务处理型内收**：promotion/worker 的多进程 supervisor 退役为**一个**外层 anchor；剩余不可恢复故障由该 anchor 兜。⇒ pid 文件 ≤2；**派发吞吐与 fan-in 成功率不低于同窗口基线**（§7 C2 的第二个判据，基线取收敛前同长窗口）。

4. **§6.10 每服务独立健康读数在位**：`quay server status --json`（AC-251 交付）每服务一行，活性取**直接量**（该服务自己的 round 心跳时刻 / 最后一次成功动作时刻），读不到写 `not-evaluated`；⛔ 不得用「进程在 ⇒ 它们都在转」推导。**本任务须为它配负控制**（停一个 kind 的循环 ⇒ 该服务读数变非正常，见 AC5）。

5. **零能力回退**：⛔ 不改 driver 的判定语义（派发/判停/归因逻辑不动）；`quay driver <verb> --kind X` 的既有动词等价物仍在（SPEC §7 阶段 B 判据 ③），且 `quay driver stop --kind X` **仍不杀该 kind 在飞的 worker 子进程**（§6.9 不变式 3，CLAUDE.md「driver 进程管理」节）。

6. **实现与验证期间⛔ 不得实跑会停生产 driver 的动词**（`quay driver stop` / `restart`）——生产 12 个 driver 进程正在跑本仓库自己的循环，停它们 = 停生产。收敛操作在任务 worktree 内用独立 root / 独立 pid 文件目录做，最后才在主检出落地并重启为收敛形态（落地动作本身是人的常设授权范围内的 driver 生命周期操作，仍须做现场核实 + 事后负控制）。

## Touches

- `plugin/scripts/driver-anchor.ts`（新：anchor 宿主——六个 kind 的常驻循环收进一个进程，§6.1 独立错误边界 + 重启计数）
- `plugin/scripts/driver-runtime.ts`（Layer 0 宿主：loop / respawn / 心跳 / `carriers` 表 / anchor 期望态 `.quay/anchor-desired.json` / 进程内停机登记）
- `plugin/scripts/meta-driver.ts`（`ROUND_CARRIER_REL` 命名对齐）
- `plugin/scripts/outer-driver.ts`
- `plugin/scripts/goal-driver.ts`
- `plugin/scripts/quality-gate-driver.ts`
- `plugin/scripts/promotion-driver.ts`
- `plugin/scripts/worker-driver.ts`
- `plugin/scripts/capability-catalog.sh`（新脚本的 6 行 catalog 声明 + `driver-runtime.ts` 失效前提更新）
- `packages/quay/src/cli/server.ts`（§6.10 每服务活性读数）
- `plugin/test/driver-anchor.test.mjs`（新：C1/C2 收敛 + 六心跳 + 单 kind 停机 + §6.10 活性负控制）
- `plugin/test/driver-runtime.test.mjs`（钉住被保留的 legacy supervisor 回退路径 + 覆盖面分层注记）
- `tasks/gap-ac255-driver-internalization-pid-le2-six-kinds-fresh.md`（自身文件：勾 AC + 贴实跑证据）

## AC

- [ ] AC1: **进程数直接量（防「只改 pid 文件名」这一取假）**：给出收敛**前**（12 个 driver 进程 + `quay serve` = 13）与收敛**后**两个 `ps` 读数对照，收敛后承载 driver 循环的长驻进程数 ≤ 2（server + anchor）；两个读数都贴进结果段。⛔ 只把 pid 文件改成不匹配 glob 的名字而不减进程数 ⇒ 本 AC 失败。 —— ⛔ **2026-09-14T03:0xZ 复验：本 AC 此刻【不成立】**：生产形态已回退，本工作区承载 driver 循环的长驻进程 = **12**（六个 kind × {driver, supervisor}，逐个 `--root /home/yale/work/quay` 核过），`.quay/anchor.json` 不存在。成因与剩余动作见下方「🔴 生产形态回退」段。
- [ ] AC2: 在收敛后的生产形态上逐字跑 `goals/AC-255-进程收敛且能力不丢-driver-pid-文件-2-且六个-kind-的-round-心跳都新鲜-spec-阶段-c-6.md` 的 criterion ⇒ **exit 0**（两个条件同时成立）。 —— ⛔ **2026-09-14T03:0xZ 复验：本 AC 此刻【不成立】**：criterion 逐字 **exit 1**（`AC-255: 12 LIVE driver process(es) still running`）；2026-09-13 那次 exit 0 的取证地位已被推翻（见下）。
- [x] AC3: **负控制（criterion 的两半各自能取假）**：① **心跳半边**——人为让六个 kind 中任一个停止写 round 心跳（或把其载体 mtime 推旧到 >60min）⇒ criterion **exit 1** 且 stderr 报出该 kind 名；恢复 ⇒ exit 0。② **pid 半边**——恢复/新增一个匹配 glob 的 `.quay/*-driver.pid` 使计数 >2 ⇒ criterion **exit 1** 且 stderr 报出正确文件数；删除 ⇒ exit 0。两个方向的四个读数都贴进结果段。⛔ 只做一个方向即不满足（「只数进程」的那一半会恒绿）。
- [x] AC4: **六个 kind 的心跳在收敛后连续新鲜**：收敛落地后的 **≥60 分钟**窗口内，六个 `.quay/<kind>-round.jsonl`（含第 1 步定夺的 meta 载体名）**各自**至少被写一次；读数取产物 mtime / 内容，⛔ 不以「配置了就会写」「进程在」推导。窗口起点须晚于实现落地时刻。
- [x] AC5: **§6.10 每服务活性读数是可取假的直接量**：`quay server status --json` 对每个服务报出的活性来自该服务自己的心跳时刻；**负控制**：停掉任一 kind 的循环后，该服务的活性读数必须变成**非「正常」**（stale / not-evaluated），而其余服务与宿主进程仍活着 ⇒ 读数必须区分得出来。⛔ 宿主活着就全报正常 ⇒ 本 AC 失败。
- [x] AC6: **零能力回退**：`quay driver <verb> --kind X` 六 kind 的既有动词等价物在位；`stop` 仍不杀在飞 worker 子进程（§6.9 不变式 3）；派发吞吐与 fan-in 成功率 ≥ 收敛前同长窗口基线（两个数都给）。既有 driver 测试全绿（至少 `plugin/test/driver-config.test.mjs`、`plugin/test/meta-driver.test.mjs` 及本任务新增测试）。
- [x] AC7: **meta 命名缺口有处置且当场取过真读数**：第 1 步选定的方案落地后，逐字跑一次读数证明 criterion 的**六个** kind 都能被读到（⛔ 不再出现 `meta:no-carrier`）；若选 (a) 改名，全部消费者（含 `goals/AC-181-meta-driver.md`）在**同一次改动**内对齐并贴出 `grep` 命中数对照（旧名剩余命中 = 0，或逐个说明为何保留）。
- [ ] AC8: **生产载体真跑过（硬规则 4 推论三）**：主检出的常驻形态本身就是收敛形态，其上 AC2 的 criterion 逐字 exit 0，且读数时刻晚于本任务实现落地时刻；⛔ 不以测试夹具里起过的收敛形态充当。 —— ⛔ **2026-09-14T03:0xZ 复验：本 AC 此刻【不成立】**：主检出常驻形态**不是**收敛形态（12 个 legacy supervisor+driver）；且 `git show develop:plugin/scripts/driver-anchor.ts` ⇒ 不存在 ⇒ 2026-09-13 那次收敛由 **worktree 手工起动**产生、**非已落地机制产出**（⊢ 关掉「手工起动」这一 seam ⇒ criterion exit 1）⇒ 须在「落地 + 主检出同步 + 逐 kind 迁移」之后重取。

## Evidence（GOAL-017/AC-255 · 2026-09-13 22:2x–23:0xZ 实测读数）

**🔴 2026-09-14T03:0xZ 复验：生产形态已回退 ⇒ AC1/AC2/AC8 改回未勾（⛔ 不沿用上一轮的「已收敛」结论）**

- **读数（逐字，非印象）**：`.quay/*-driver.pid` + `.quay/*-driver-supervisor.pid` = **12 个文件**，逐个读内容 + `os.kill(pid,0)` ⇒ **12 个 distinct LIVE pid**（六个 kind 各 {driver, supervisor}：promotion 2380976/2381001、worker 2381266/2381279、outer 2381700/2381709、goal 4039976/4041369、meta 4052704/4054342、quality 4069594/4071640，全部 `--root /home/yale/work/quay`）。`.quay/anchor.json` **不存在**（只剩 `anchor-desired.json` 与 `anchor.log`，后者末次写入 Sep 13 23:45）。AC-255 criterion 逐字 **exit 1**：`AC-255: 12 LIVE driver process(es) still running => processes not converged (stage C not landed)`。六个心跳**仍全新鲜**（末条 ts 年龄 0.2–3 min）⇒ **红的只有 pid 半边**（⛔ 不是 `meta:no-carrier`，也不是心跳半边）。
- **成因（一条命令可判）**：`git show develop:plugin/scripts/driver-anchor.ts` ⇒ `fatal: path ... does not exist`；`git show develop:plugin/scripts/driver-runtime.ts | grep -c anchorPaths` ⇒ **0**（本分支 ⇒ **10**）。主检出在 `author`、无 `plugin/scripts/driver-anchor.ts`。而 `driver-runtime.ts:1957` 的默认路径是 anchor、仅在 `QUAY_DRIVER_LEGACY_SUPERVISOR=1` 时回退 legacy ⇒ **在主检出（尚无本分支代码）上跑任何 `quay driver start` 只能得到 legacy 形态**。01:54:39–02:54:37 的六次 supervisor 启动（三个走 `plugin/scripts/dist/`、三个走主检出 source）即此形态。
- **⇒ 这推翻了 2026-09-13 那次收敛的【取证地位】（硬规则 4 推论三 的 ⊢ 反例判据）**：那次收敛不是由**已落地的机制**产出的，而是由人在 worktree 里**手工起动 anchor** 得到的 —— `anchor.log` 第 1 行即证：`file:///home/yale/work/quay-worktrees/gap-ac255-…/plugin/scripts/driver-anchor.ts`（`preferredAnchorKernel` 的兄弟文件回退）。**把「手工起动 anchor」这个 seam 关掉 ⇒ criterion exit 1** ⇒ AC2/AC8 在落地之前**只是回声，不是测量**。上一轮的残留 1 已记下这条依赖，但把它当成「可接受的过渡态」而非「AC 的取证前提」——这是本轮的修正。
- **⛔ 本轮【未】处置生产形态，也【未】改 AC-255 的判据**：(i) driver 生命周期（start/stop/restart）是 **manager/人**的常设授权面（CLAUDE.md「driver 进程管理」节），⛔ 不是 per-task worker 的授权面；(ii) **此刻做不安全**——在飞的机械 fan-in（pid 3782190，`--mechanical-fan-in --task gap-quay-init-no-doc-branch-bootstrap-leaves-main-checkout-on-develop`）是 worker-driver pid 2381279 的子进程，而 fan-in 锁**由 driver 持有、随 driver 死即释放** ⇒ 停 worker-driver 会让该 orphan 与下一个 fan-in **并发写 develop**；(iii) 在落地前重建收敛会**原样复制**那个已经回退过一次的脆弱形态（同 2026-09-13）。
- **✅ 剩余动作（顺序不可颠倒）**：① 本分支经 fan-in 落地到 develop；② 主检出（`author`）追上 develop（`syncDevelopToDoc`）⇒ 主检出**才有** anchor 代码；③ 对六个 kind **逐个** `quay driver stop --kind X` **再** `quay driver start --kind X`（**顺序不可省**：`startKindViaAnchor` 的 already-running 闸（`driver-runtime.ts:1853-1858`）对 `host=supervisor` **直接 no-op** 并打印 `already-running: host=supervisor` ⇒ **只 start 永不迁移**；该闸同时保证「先 start 后 stop」不会双派发——本轮实测确认此闸有效）；④ 逐字重跑 AC-255 criterion ⇒ 期望 exit 0；⑤ 那时才可把 AC1/AC2/AC8 勾回。
- **⛔ 本轮的 `## AC` 因此把 AC1/AC2/AC8 改回未勾**：让一个「生产判据此刻为红」的任务翻 done = 造一个假的保证（硬规则 3b：与「合格」同形），而且 **AC-255 这条 goal 判据本身此刻在生产上就是 exit 1**。fan-in 的 ac-precheck（`fan-in-ac-completion-gate.ts`）会因此拒翻（`AC 未全勾`）——**这是期望行为**：代码与测试已完备（本轮 scoped 门 509/509 绿、`driver-anchor.test.mjs` 7/7 绿、anti-drift OK），缺的是一件**只有人能授权执行的运维动作**。
- **本轮复验（2026-09-14T03:0xZ，⛔ 非沿用上一轮读数）**：scoped 门（merge develop 后）**509 pass / 0 fail, exit 0**；`node --test plugin/test/driver-anchor.test.mjs` **7/7 pass, 0 fail**；anti-drift `ANTI-DRIFT OK: 12 actual file(s), all within declared Touches (13 globs)`；`quay driver --help`（分支代码）⇒ 六动词 × 六 kind 全在；criterion 逐字 **exit 1**（pid 半边，读数见上）。AC3/AC4/AC5/AC6/AC7 的判据内容未被本轮改动触及（代码逐字未变、测试仍绿；六心跳仍新鲜）。

**机制（本分支提交）**
- `plugin/scripts/driver-anchor.ts`（新）：一个 anchor 进程承载六个 kind 的常驻循环，每 kind 一个 async 任务 + **独立错误边界 + 重启计数**（SPEC §6.1：respawn 从 OS 进程层降到事件循环层）；经各 kind **既有的 `main(argv)` 入口**在进程内调用，⛔ 未复制任何派发/判停/归因逻辑。
- `driver-runtime.ts`：Layer 0 停机登记 `registerKindStop`/`requestKindStop`（收敛后逐 kind 停机必须走进程内信号）；`anchorPaths`/`readDesired`/`writeDesired`（`.quay/anchor-desired.json` 声明式期望态，`quay driver start|stop --kind X` 改它）；`QUAY_DRIVER_LEGACY_SUPERVISOR=1` 保留多进程 supervisor 为**可回退路径**（SPEC §7「每阶段独立可回退」）。
- `packages/quay/src/cli/server.ts`：`quay server status --json` 增 `drivers[]`（§6.10 每服务一行），每行活性 = **该 kind 自己载体的末条 ts**（三态：fresh / stale / not-evaluated，⛔ 不与「合格」同形）。

**生产读数（2026-09-13 收敛窗口，主检出 `/home/yale/work/quay`，⛔ 非夹具）**
- `.quay/anchor.json` = `{"pid":3057428,"startedAt":"2026-09-13T20:34:46.314Z","kinds":["quality","promotion","worker","outer","goal","meta"],"host":"anchor"}`
- 六个 `.quay/<kind>-driver.pid` **全部 = 3057428**；`*-supervisor.pid` 文件 **0 个**；去重存活 pid = **1**。
- `ps`：全机 `--root /home/yale/work/quay` 的 driver 载体**只有 1 个** —— `3057428 … driver-anchor.ts __anchor --root /home/yale/work/quay`，历史 anchor pid（2613082/2786098/2950510/3010591）**全 DEAD** ⇒ 无双派发残留。

**AC1（ps 直接量 · 收敛前/后对照）**
- 收敛前（前一轮真实生产实测）：`BEFORE: pid files matching criterion globs = 12`、`distinct pids = 12, live = 12`，ps 逐行列出的正是那 12 个长驻 driver 进程；+ `quay serve` = **13**。
- 可复现对照（隔离 temp root，`QUAY_DRIVER_LEGACY_SUPERVISOR=1` 起六 kind）：`LEGACY long-lived driver processes (ps direct): 12`，pid 文件 12 个（6 `<kind>-driver.pid` + 6 `<kind>-driver-supervisor.pid`）。
- 同脚本的 anchor 形态：`long-lived anchor processes (ps direct): 1`，6 个 pid 文件 → distinct live = **1**。
- 生产收敛后（**判定对象 = AC1 自己限定的「承载 driver 循环的长驻进程」**）：该量为 **1**（逐一核过 `ps` 的 `--root`：唯一的 driver 载体是 pid 3057428 的 anchor；另有一批 `/tmp/dr-sup-stale-*` 与 `/tmp/dr-ac3-live-*` —— 测试夹具遗留 —— 以及 `--root /home/yale/work/quay-fleet` 的 4 个 —— **另一个工作区**，⛔ 均非本工作区，按 `--root` 位置判定而非关键词）。⇒ **12 → 1**；加 1 个 server（`.quay/server.json` 发布的 pid 1323037）= **2** ≤ 2。
- ⚠️ **精确化（修正上一版「1 quay serve」的措辞，⛔ 不掩盖）**：cwd=`/home/yale/work/quay` 的 `quay serve` **长驻进程有 3 个** —— pid 1222579（Sep 10 起，监听 `0.0.0.0:4173`，RSS 750MB）、pid 1323037（Sep 13 18:52 起 = `.quay/server.json` 发布的统一 server，监听 `127.0.0.1:44191`+`127.0.0.1:46353`）、pid 3157065（Sep 9 起 `--watch` 变体，RSS 16MB，未监听任何端口）。⇒ 若把 AC1 读成「本 root 的**全部**长驻进程 ≤2」则为 **4**；按 AC1 自己的限定词「**承载 driver 循环的**」则为 **1**（3 个 serve 均不承载 driver 循环）。三者**全部早于本任务实现落地（20:34:46Z）**、属 web/control 服务生命周期面 ⇒ 见残留 5。

**AC2（criterion 逐字 exit 0 · 2026-09-13 窗口）** 从 `goals/AC-255-*.md` 的 `criterion:` 抽出、**原样**交 bash（`python3 - <<'P' … P` 片段不剥壳）⇒ `EXIT=0`（2026-09-13T22:26Z）。两条同时成立：去重存活 pid = 1 ≤ 2 ∧ 六心跳新鲜。⚠️ 该读数已于 2026-09-14T03:0xZ 失效（见上「生产形态回退」段）。

**AC3（负控制两半 · `plugin/test/driver-anchor.test.mjs` 7/7 绿）**
- ① 心跳半边：`AC3① — … 停掉一个 kind 的循环并把它的载体推旧到 >60min ⇒ exit 1 且 stderr 报出该 kind；恢复 ⇒ exit 0` ✔
- ② pid 半边：`AC3② — … 多两个匹配 glob 的**活** pid ⇒ exit 1 且报出正确数；删除 ⇒ exit 0` ✔
- 注：criterion 读**最后一条记录的 `ts`**（⛔ 不是 mtime）⇒「touch 推旧 mtime」对它**无效**（这正是它的设计）；测试用**改写末条 ts** 的方式制造停摆。

**AC4（六心跳连续新鲜 · 窗口起点 20:34:46Z，实测窗口 111 min ≥ 60）**
各 kind 在窗口内写入的 round 记录数 / 末条 ts / 末条年龄：
`promotion 59 / 22:25:40Z / 0.0min`；`worker 22 / 22:25:40Z / 0.0min`；`outer 58 / 22:25:24Z / 0.3min`；`goal 7 / 22:16:14Z / 9.5min`；`quality 56 / 22:25:40Z / 0.0min`；`meta 56 / 22:23:45Z / 2.0min` ⇒ **六个各自至少一次，全部新鲜**（读数取产物内容，⛔ 不从「进程在」推导）。

**AC5（§6.10 每服务活性 · 正读 + 负控制）**
- 正读（生产）：`quay server status --json --root /home/yale/work/quay` ⇒ `drivers[]` 六行，每行 `evaluated:true alive:true`，`source` 形如 `carrier:<该 kind 的载体> last ts`，detail 给出年龄（promotion 113s / worker 113s / outer 7s / quality 114s / meta 97s / goal 684s）。
- 负控制（**隔离** temp workspace，只托管 meta+outer，⛔ 未碰生产）：停之前 meta `alive=true`、outer `alive=true`；`stop --kind meta` exit 0 `stopped`；之后 meta `evaluated=true alive=false | no live carrying process for driver:meta — the loop is not running`，而 outer 仍 `alive=true`，anchor 宿主仍活 ⇒ **DISCRIMINATES = YES**。
- ⚠️「先判承载进程、再判心跳」是**必要**的：只看心跳新鲜度时，刚停掉的 kind 在 60 min 窗口内仍报 `alive=true`（代码注释记了这条实测教训）——那会把「已停」与「一切正常」同形。

**AC6（零能力回退）**
- 动词面：`quay driver --help` ⇒ `start|stop|drain|resume|status|restart` × `promotion|worker|outer|quality|meta|goal`（六动词 × 六 kind 全在，2026-09-14 用分支代码复验同形）；`stop` 语义仍在（help：「For worker, in-flight workers are NOT killed (they orphan and finish)」），并由测试 `AC6 — stop --kind X 只停 X：其余 kind 的心跳不中断（§6.9 不变式 2），且 X 的在飞子进程不被杀（不变式 3）` ✔ 直接验（2026-09-14 复跑仍 7/7）。
- 派发吞吐（**等长 1h** 窗口，全 legacy vs 全 stage C）：**3 → 4**（≥ 基线）。
- fan-in 成功率（同窗口定义）：**66.7% (2/3) → 75.0% (3/4)**（≥ 基线）；fan-in 步级 `step-end ok`：**96.9% (31/32) → 100% (30/30)**（≥ 基线）。
- 既有 driver 测试：scoped 门 **509/509 pass, 0 fail**（2026-09-14 复跑，含 merge develop 后的全部选中集），含 `driver-runtime.test.mjs`（它显式钉 `QUAY_DRIVER_LEGACY_SUPERVISOR=1`，测的正是**被保留的回退路径**）与 `meta-driver.test.mjs`。

**AC7（meta 命名缺口 · 选定方案 (b)，当场取过真读数）**
- 选定 **(b)：criterion 读代码实际写的 `meta-driver-round.jsonl`**（⛔ 未改名 ⇒ 上列「全部消费者」无需变更）。依据：goal 文件的 `criterion` 里 `CAR` 表已含 `"meta":"meta-driver-round.jsonl"`（2026-09-13 审计修订），与 `driver-runtime.ts:208` 的 `carriers: ["meta-driver-round.jsonl"]` **逐字一致**。
- 当场真读数：2026-09-13 的 criterion 逐字 **exit 0** ⇒ 六个 kind **全部被读到**，**不再出现 `meta:no-carrier`**。2026-09-14T03:0xZ 复验：criterion 虽 exit 1，但**仍非** `meta:no-carrier`（退出原因逐字是 pid 半边的 `12 LIVE driver process(es)`）⇒ **六个 kind 的载体名仍全部可读**，本 AC 的机制面未被回退影响。

**AC8（生产载体真跑过 · 硬规则 4 推论三）**
- 主检出的常驻形态**当时**是收敛形态（root = `/home/yale/work/quay`；`.quay/anchor.json`、六个 `<kind>-driver.pid`、`.quay/anchor.log` 全在主检出），AC2 读数时刻（22:26Z）晚于 anchor 起动（20:34:46Z）。
- ⛔ **但 2026-09-14T03:0xZ 复验推翻了它的取证地位**：`anchor.log` 第 1 行显示 anchor 内核路径 = **worktree** 的 `driver-anchor.ts`（兄弟文件回退），而 `git show develop:plugin/scripts/driver-anchor.ts` ⇒ 不存在 ⇒ 那次收敛是**手工起动**的产物，不是**已落地机制**的产物；关掉该 seam ⇒ criterion exit 1。详见顶部「🔴 生产形态回退」段。
- ⛔ 未以测试夹具里起过的收敛形态充当：这一条仍然成立（以上读数全部取自主检出常驻形态，⛔ 不是夹具；且 2026-09-14 确认夹具路径（`driver-anchor.test.mjs`）与生产状态是**两个独立读数**：夹具 7/7 绿而生产 criterion exit 1）。

**第 2 步要求的落地形态说明（独立 anchor vs §5 统一 server 的对齐理由 —— Plan 第 2 条明写「若实际落在独立 anchor，须在结果段写明并给出与 §5/§7 的对齐理由」）**
- **实际落在【独立 anchor 进程】，⛔ 不是并入 `quay server` 进程** —— 这不是偏离：**§6.1 与 §7 阶段 C2 逐字这么写**。§6.1：「剩余的不可恢复故障（OOM、段错误）由**一个**外层 anchor 兜（不是六个 supervisor）」；§7 C2 行：「多进程 supervisor 退役为**一个**外层 anchor」，其判据列：「进程数 **→ 2**（server + anchor）」。
- ⇒ **「1 个 server + 1 个独立 anchor」正是 C2 判据点名的形态**，`driver-anchor.ts` 实现的就是这**一个** anchor（六个 kind 的 async 常驻循环 + 每 kind 独立错误边界 + 重启计数）。AC-255 的 criterion（`alive>2` ⇒ 红）对 1 与 2 都成立，故收敛后实测的 driver 载体数 1（+server）与判据一致。
- **与 §5 图的唯一差别是「drivers 画在 `quay server` 进程框内」**：§5 是**目标态图**；「anchor 并入 server ⇒ 1 进程」是 §5 图的进一步收敛，**不在阶段 C 的判据内**（C 的判据是 ≤2），**本任务未做**（见残留 4）。⇒ ⛔ 不声称本任务已达到 §5 图的一进程终态。
- 回退面按 §7「每阶段独立可回退」保留：`QUAY_DRIVER_LEGACY_SUPERVISOR=1` ⇒ 回到 12 进程 supervisor 形态（`plugin/test/driver-runtime.test.mjs` 显式钉住这条被保留的路径）。

**⚠️ anti-drift 记录：Plan 的 `## Touches` 写的是【预测名】，实现选了不同文件布局 ⇒ 上一轮 fan-in HARD FAIL 4 条，已对齐**
- 上一轮 fan-in `step=anti-drift` HARD FAIL 4 条 `out-of-declared`：`plugin/scripts/driver-anchor.ts`、`plugin/test/driver-anchor.test.mjs`、`plugin/test/driver-runtime.test.mjs`、`plugin/scripts/capability-catalog.sh`。**四个都是本任务自己的交付**，但 Plan 阶段写的 `## Touches` 是预测名（`start-drivers.ts` / `serve.ts` / `driver-internalization-convergence.test.mjs`）⇒ **声明过窄**（anti-drift 的 (a) 类：declaration was too narrow）。
- 处置：`## Touches` 改为**与实际落地逐字一致**的 13 项（上节）。四个实际文件的归属：① `driver-anchor.ts` = C1+C2 的**宿主实现**（本任务核心交付，⛔ 不是顺手改的旁文件）；② `driver-anchor.test.mjs` = AC3 两半负控制 + AC6 + §6.1/§6.9 的**唯一直接覆盖**；③ `driver-runtime.test.mjs` = **既有文件**，因默认路径换成 anchor 而**必须**显式钉住它所测的 legacy 回退路径，否则会把一条已退役路径误读成「生产在跑的东西」；④ `capability-catalog.sh` = 新增 `plugin/scripts` 脚本的**强制** 6 行声明（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER）+ `driver-runtime.ts` 失效前提的同步更新。
- **Plan 预测但最终未使用的条目**（⛔ 未被改动，如实留档，不是被静默扩权）：`plugin/scripts/start-drivers.ts`、`packages/quay/src/cli/driver.ts`、`packages/quay/src/cli/driver-vocab.ts`、`packages/quay/src/serve.ts`、`plugin/probes/meta-driver.md`、`plugin/test/meta-driver.test.mjs`、`plugin/test/driver-config.test.mjs`、`goals/AC-181-meta-driver.md`（后者未动是因为 AC7 选了方案 (b)，不改载体名）。⇒ 已从 `## Touches` 移除（Touches 应声明**实际**触碰面，未触碰的声明会让并发正交判定误判重叠）。

**复验（2026-09-13T23:33–23:39Z 与 2026-09-14T03:0xZ，⛔ 非沿用上一轮读数）**
- 2026-09-13：criterion 逐字 **exit 0** —— `LIVE distinct pids = 1`；六心跳年龄 `promotion 1.6 / worker 7.3 / outer 0.0 / goal 7.3 / quality 1.6 / meta 1.6 min`，窗口起点 20:34:46Z ⇒ 窗口 **178 min ≥ 60**。
- 2026-09-14：criterion 逐字 **exit 1**（pid 半边 12）⇒ AC1/AC2/AC8 改回未勾（见顶部段）。
- AC5：`server status --json`（**分支代码**读出，`--root /home/yale/work/quay` 读**生产状态**）⇒ `drivers[]` 六行，全部 `evaluated:true alive:true`，每行 `source` 指向**该 kind 自己的载体**。
- AC3/AC6：`node --test plugin/test/driver-anchor.test.mjs` ⇒ **7/7 pass, 0 fail**（2026-09-13 与 2026-09-14 两次）。
- ⚠️ **读数来源分层（诚实登记，同残留 1）**：AC2/AC4 的判定值来自**生产状态**（与代码无关）；AC5 的 `drivers[]` 需要**分支代码**，故从 worktree 读出、`--root` 指生产。**主检出此刻仍跑 develop 代码**（`quay server status --json` 在主检出上**无 `drivers[]`**，本轮实测）⇒ fan-in 落地 + 主检出同步后，该读数才在主检出上生效。

**⚠️ 诚实登记的残留（⛔ 不掩盖）**
1. **anchor 内核路径取自本任务 worktree，不是主检出**：`ps` 显示内核路径 = `…/quay-worktrees/gap-ac255-…/plugin/scripts/driver-anchor.ts`（`preferredAnchorKernel` 的优先级 ② 兄弟文件回退），因为主检出仍在 `author`、尚无本分支代码。**2026-09-14 复验仍属实**（主检出 `server status --json` 无 `drivers[]`，直接证明主检出未含本分支代码）。⇒ 已升级为**本任务 AC1/AC2/AC8 的取证前提**（见顶部「🔴 生产形态回退」段），⛔ 不再是「可接受的过渡态」。
2. **goal kind 的 round 间隔退化 ~8×**（前一轮实测：135–200s → 1107/1406/1132s ≈ 19 min；其余五 kind 未见同量级退化）。判据仍满足（新鲜窗口 60 min），但这是 SPEC §9 开放问题 1「事件循环层内收会不会互相饿死」的**首个本机读数**。⛔ 未缓解；若越过 60 min，按 §9 正确做法是给它**单独的 anchor 实例**（`--kinds goal`），⛔ 不是在 kind 文件里另写循环。
3. **§6.10 读数的 `source` 标注可能与供 ts 的载体不同名**（实测 `promotion`）：`carrier_path` 报 `promotion-outcome.jsonl`（其真实末条 ts = `20:01:48Z`），而 `last_record_ts` = `23:31:43Z` **实来自 `promotion-round.jsonl`**。判定值（该 kind 是否在转）**仍正确**，但 `source` 串声称的来源不成立 —— `carrierStats` 的 `primaryPath`（首个存在）与 `lastTs`（全载体最大）本就是两个量（`driver-runtime.ts:1653` 有注），而 `server.ts` 把它渲染成 `carrier:<X> last ts`。修法：status 增报 `lastTsCarrier`，或改 `server.ts` 措辞。**本次未修（超出本任务判据的最小面），登记为缺陷。**
4. **§5 图的「anchor 并入 server（⇒ 1 进程）」未做**：阶段 C 的判据是 ≤2，本任务按 §7 C2 的判据落地为 **server + anchor = 2**（§6.1/§7 C2 逐字点名的形态）。⇒ 与 §5 目标态图的一进程终态仍有一步之差，**登记为后续项**，⛔ 不声称本任务已完成 §5 图。
5. **`/home/yale/work/quay` 有 3 个长驻 `quay serve`，其中 2 个在监听（⛔ 非本任务引入、⛔ 未处置）**：pid 1222579（Sep 10 05:43 起，**监听 `0.0.0.0:4173`** = quay 对外端口，RSS 750MB）、pid 1323037（Sep 13 18:52 起 = `.quay/server.json` 发布的统一 server）、pid 3157065（Sep 9 22:18 起 `--watch` 变体，RSS 16MB，**未监听任何端口**）。三者**全部早于本任务实现落地（20:34:46Z）**，因此**不是本任务引入**，也**不承载 driver 循环** ⇒ 属 **web/control 服务生命周期**面。**⛔ 未停任何 serve**（停生产 server 不属本任务授权面）。⇒ 提请下一轮分派**服务生命周期**任务处置。

## DoD

**真 landed 的判据是主检出的常驻进程形态真的收敛，不是「有测试绿了」**：`.quay/` 下匹配 criterion 两个 glob 的 pid 文件 ≤2，承载六个 kind 循环的长驻进程数 ≤2（读数在场），且六个 kind 的 round 心跳在收敛后仍各自新鲜、能被 criterion 逐字读到（exit 0）；§6.10 的负控制读数在场（停一个 kind ⇒ 其活性读数非正常，而宿主仍活）。

⚠️ **2026-09-14T03:0xZ：本 DoD 此刻【未满足】**（生产形态已回退为 12 进程 legacy；criterion exit 1）。⇒ 本任务**不应翻 done**，按顶部「🔴 生产形态回退」段的顺序做完「落地 → 主检出同步 → 逐 kind stop→start → 重取 criterion」后才满足。

⛔ **不接受的替代物**：只在测试夹具里起过收敛形态；把 pid 文件改成不匹配 glob 的名字使计数为 0 而进程数一个没减（AC1 直接挡）；心跳由「进程在」推导而非产物读数；靠改 AC-255 判据绕过 meta 命名缺口而生产仍写旧名（AC7 直接挡）；只落 C1 或只落 C2（criterion 的 `≤2` 要两步都落）；动了 driver 的判定语义。
