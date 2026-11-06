---
id: gap-ci-self-hosted-runner-shares-fleet-host
title: self-hosted CI runner 与 quay fleet 同机跑同一 repo 的 suite（第 4 个并发源）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**实测（2026-11-06，同一台 128 vCPU / 246 GB 共享机）**：`gh-runner-quay.service`（`yaleh/quay` 的 Ephemeral GitHub Actions self-hosted runner）与 quay driver fleet **跑在同一台宿主上**。`/proc` 里能看到一个 docker scope（`/system.slice/docker-…scope`）在跑

```text
/_work/quay/quay/scripts/test.sh --static-checks-doc
/_work/quay/quay/plugin/scripts/full-suite-runner.ts
```

且与本地 fleet 的套件**并发**进行，占用 **3.9–5.7 核**（uid 0 / 容器 cgroup），某次采样里同时有 **19 个 `node --test` worker**。

关键点：这是套件并发的**第四个独立来源**，而 per-repo 的 suite 锁（`suite-lock-slots.ts`）**看不见它** —— 不同的 checkout、不同的 cgroup，锁根本没在同一个作用域里。于是即使前三个来源（工作区自身的套件、宿主的多个项目根、driver 的 tick 派生）都被约束住，CI 仍会在同一台机器上无上限地再开一组。

> 判读：这是「**有并发源不在任何预算之内**」的形态，而不是「CI 配置错了」。它不会自己变红：没有任何读数会因为第 4 个并发源而失败，只有 `loadavg` 与 OOM kill 会 —— 而那两个是宿主级代理量，追不到 CI 身上（硬规则 4b）。

### Proposed fix

先**决定放置**（⛔ 不要默认「就这样」）：

1. 换宿主 / 换 runner（CI 不再与 fleet 共享）；
2. 或把 CI job **钉到一个有界的 `--test-concurrency`** + 独立的 cgroup/slice；
3. 或让它与 fleet **串行**（在 fleet 的锁作用域里排队）。

无论选哪条，都要把这个选择**记录在 fleet 宿主预算被声明的那一处**（今天那份声明不存在，见 Touches 里的新文档）。

### Dedup / merge 决定

按机制去重：`gh-runner` / `self-hosted` / `GitHub Actions` / `runner` 在 todo/ready 池内命中均为 **0** ⇒ 无 open peer。merge-candidate：`.github/workflows/ci.yml` 无其它 open 任务声明为 Touches ⇒ **独立立案**（与 `gap-ci-dist-verify-node-floor` 一类的 CI 任务不同载体：那些在 workflow 内部，本条问的是**宿主机层面 CI 与 fleet 争资源**）。

## AC

> 行号皆指 worktree HEAD `5c192989d`（= develop 已合入）的 `ci.yml`/`host-budget.md`。

- [x] CI 的 suite 调用带**显式有界并发**：`grep -n 'test-concurrency' .github/workflows/ci.yml` 命中 ≥1，且该值不来自 nproc（贴行号与实际内容，⛔ 不是断言）。**Evidence:** 命中 6 行，执行行是 `406:              exec bash scripts/test.sh --test-concurrency=16`（其余 5 行是注释/历史，判定不按 grep 而按**解析后的 YAML 步骤文本**取，见下条）；值是字面量 16，⛔ 非 `$(nproc)`。另加两条 phase 车道 `382: QUAY_SERIAL_CONCURRENCY: "4"` / `383: QUAY_LOWCONC_CONCURRENCY: "4"` —— 只钉 main 会让 serial/lowconc 仍按宿主派生（本机 64 + 64）。三者合计 24 个并发测试 worker。
- [x] CI job 的 cgroup/slice 与 fleet **可区分**：workflow 里能读到具名 scope/slice（`systemd-run --slice=` 或等价），或在文档里记录它跑在独立的容器 scope 内并给出可核的读法（贴逐字配置 + 一次 `cat /proc/<pid>/cgroup` 的真实输出）。**Evidence:** 取第一条（具名 scope）。verbatim `ci.yml:392-403`：`QUAY_CI_SCOPE_UNIT="quay-ci-suite-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"` → `systemd-run --user --scope --collect --quiet --unit="${QUAY_CI_SCOPE_UNIT}" -p MemoryAccounting=yes -p OOMPolicy=continue bash -c '… cg="$(cat /proc/self/cgroup)"; case "${cg}" in *"/${QUAY_CI_SCOPE_UNIT}.scope"*) ;; *) exit 1 ;; esac; exec bash scripts/test.sh --test-concurrency=16'` —— 没进 scope 就 **exit 1**（⛔ 不是「跑完再说」）。真实 `/proc/self/cgroup` 读数（本机 user manager，systemd 255 = 容器同版本，2026-11-06）：`0::/user.slice/user-1004.slice/user@1004.service/app.slice/quay-ci-suite-probe-1.scope`；同一谓词在不套 scope 的进程上 exit 1（`…/quay-anchor-quay-1793946889475.scope` ⇒ 不匹配 ⇒ FAIL）。⚠️ 该 probe 在**宿主** user manager 上跑（`user-1004`），不是容器的 `user@0`；容器的实证留给 DoD 的真实 run。
- [x] 宿主预算文档把 CI 列为消费者：`docs/operations/host-budget.md` 里有一行点名该 runner（service 名或 job 名）以及它被授予的预算（贴逐字行）。**Evidence:** `docs/operations/host-budget.md:51`：`| CI (`gh-runner-quay.service`, runner `tokyo-alpha-1`, job `test`) | `.github/workflows/ci.yml` job `test` → step `Run tests` → `quay-ci-suite-<run-id>-<attempt>.scope` | **16** main + **4** serial + **4** lowconc = **24** concurrent `node --test` workers | literals in `.github/workflows/ci.yml`, guarded by `plugin/test/ci-bounded-concurrency.test.mjs` |`。该文档同时记录放置决定（任务三选项中的**第 2 条**）、四条并发源、以及为何第 1/3 条不可用。
- [x] 位置判据能取假（mutation 负控）：把 CI 的并发去掉（改回默认）⇒ 上条静态判据必须**变红**；恢复后变绿。红/绿两次读数都贴出来 —— 否则那条判据只是回声（硬规则 4 推论三）。**Evidence:** 判据 = `plugin/test/ci-bounded-concurrency.test.mjs`（9 个 case，其中 5 个是 mutation 负控）。**红**：把 `exec bash scripts/test.sh --test-concurrency=16` 改回 `exec bash scripts/test.sh` ⇒ `ℹ pass 4 / ℹ fail 5`，首条 `main-concurrency-missing: no --test-concurrency in the executed shell`（连带 AC3 的 doc 判据也红：`host-budget-doc: the workflow it certifies is not bounded`）。**绿**：恢复后 `ℹ pass 9 / ℹ fail 0`。恢复前后 `sha256sum .github/workflows/ci.yml` 同为 `0d4d3fd45fc267a7d567739f9d6c1c1a6db981edc44925e2cd616a0b11074290`（证明「恢复」是真的恢复，不是改成了别的形态）。另有四条 mutation：把字面量换成 `$(nproc)`、把 flag 挪进注释行（位置判据，⛔ 文本命中不算）、删掉 phase 车道、删掉 `--unit=` —— 各自在对应判据上变红。
- [x] `bash scripts/test.sh --for-task gap-ci-self-hosted-runner-shares-fleet-host --allow-thin` exit 0。**Evidence:** 在 worktree（HEAD `5c192989d`）跑，`EXIT=0`；输出含 `PASS: no new task-file bypass`、`PASS — every suite-slot SSoT invariant holds (0 RED)`、`PASS — every concurrency literal is at a QUAY_MAX_* definition point or a declared fallback (0 violations)`、`PASS: all 21 violation(s) are baselined in plugin/test-isolation-violations.txt`，并以本任务自己的 9/9 绿收尾；`worker-driver --verify-run` 复跑同一条命令为 `exitCode=0 / classification=green / mustFix=[]`（wallMs 109585）。scoped-gate cache 已写（`developSha=3bfecfdf3d166b29f0bf748621550d830f779538`）。
- [x] 全量 `bash scripts/test.sh` 绿（由 driver 机械 fan-in 验证）（待外部）
  **Evidence:** 本 worker 不跑全量套件（SPEC-worker-driven-inner §5 阶段 2 分工）—— 由 fan-in 机械验证；红则由它拒绝 done 翻转。

## DoD

一次**真实** GitHub Actions run（贴 run URL）里能看到该 job 的有界 `--test-concurrency` 以及它所在的 cgroup/slice（job log 里逐字出现），且宿主预算文档已把 CI 计为一个消费者。⛔ 只改 YAML 文本、没有一次真实 run 的读数不算（DIR-026 Reading A）；⛔ 也不接受「改完等它下次跑再说」——落地判据是本任务落地后时间窗内的真实 run。

## Evidence

> **PARKED** — DoD 的唯一未达项是一次**真实 CI run**，而 CI 通道此刻被运维决定关闭（见下）；这是**裁定/运维依赖型**，不是实现缺口。实现与静态判据已落地且互锁；按 `unsatisfiable-ac-annotate-park-or-reword` + `postlanding-observation-window-park-instead-of-redispatch` 的约定 park，⛔ 不宣称 done。
>
> **Unpark 判据（可跑，一条命令）**：
> `gh api repos/yaleh/quay/actions/runners --jq '.runners[]|select(.name=="tokyo-alpha-1")|.status'` → 输出 `online` ⇒ 解除 park。

### DoD 未达成的确切原因（可核，不是推诿）

2026-11-06 17:37 (+0800)，**在本 worker 启动之前**，另一个宿主施救会话执行了 `systemctl --user stop` + `disable gh-runner-quay.service`（该会话逐字：「gh-runner-quay：已停且不再接活…fork 率从 ~12,000/s 降到 ~1,500/s… 代价：当时正在跑的 CI job 被杀」）。本 worker 启动后的现场读数：

```text
$ systemctl --user status gh-runner-quay.service
  Active: failed (Result: exit-code) since Fri 2026-11-06 17:38:12 CST（disabled）
$ gh api repos/yaleh/quay/actions/runners
  tokyo-alpha-1 … "status":"offline","busy":true
$ gh run list --limit 3
  pending  develop push  42196917121   ← 后续 develop push 在排队，无 runner 可接
```

⇒ **此刻不可能产出真实 run**：`yaleh/quay` 名下只有这一个 runner，它离线。而且**把它拉起来本身就是本任务要消除的伤害** —— 排队中的 develop run 会以**旧的无界 ci.yml**（`max_oversubscription: 1` ⇒ 125 main + 64 + 64）立刻开跑，正是当天 88 次 cgroup OOM kill 的负载形态。所以本 worker **没有**重启 runner。

**解除后的取证步骤**（三步，写明以便一次做完）：
1. `git push origin task/gap-ci-self-hosted-runner-shares-fleet-host`（本仓远端已有 16 个 `task/*` 分支，属常规形态）；
2. `gh workflow run ci.yml --ref task/gap-ci-self-hosted-runner-shares-fleet-host`；
3. 从 `test` job 日志取两行逐字读数回填本节并贴 run URL：
   `CI_SCOPE_CGROUP: 0::/user.slice/user-0.slice/user@0.service/app.slice/quay-ci-suite-<run-id>-<attempt>.scope`
   与 node 进程行上的 `--test-concurrency=16`。

**本任务的真实价值**恰好是**让重新启用变安全**：`docs/operations/host-budget.md` 开头已把这件事写成 STATUS 行（含恢复命令），使下一个人不会在无界状态下把它拉起来。

### 放置决定（任务三选项 → 选第 2 条）

记在 `docs/operations/host-budget.md`（本仓第一份宿主预算声明）：**有界并发（16/4/4）+ 具名 cgroup scope**。第 1 条（换宿主）不可用 —— 7 个 job 正是因 GitHub 账单闸被迁到这台 runner 的（`tasks/gap-metered-hosted-runner-jobs-to-self-hosted.md`）；第 3 条（进 fleet 锁作用域）要求容器参与一个它没有的 checkout 里的锁文件。

值的依据不是拍脑袋：`docs/analysis/suite-perfile-duration-baseline.json`（949 文件 / Σ 10,658 s）的 LPT makespan —— c=16 ⇒ **666 s**，c=24 ⇒ 444 s，c=123 ⇒ **283 s**，而 283 s 是**下界**（最长单文件 `ready-pool-check` 本身就是 283 s）。24 车道之后基本买不到时间；旧的无界读数约 125+64+64。

### ADR-007 暗轴记录

- L_D archguard: cycles=0, maxScc=1, entities=6177（package scope，`archguard_analyze` + `archguard_detect_cycles`，worktree HEAD `5c192989d`，`evaluated=true`）
- 同一读数下 `bridges=[]`，`edgeDeletions` 全部 `delta=0`（本次改动未移动任何依赖边：`ci.yml` 与 `docs/` 不在依赖图内，`full-suite-runner.ts` 只增注释，新文件在 `plugin/test/`）。

### 改动清单（commits on `task/gap-ci-self-hosted-runner-shares-fleet-host`）

- `1d3fa0a22` ci: bound the suite's concurrency and give it a named cgroup scope（`ci.yml` + `docs/operations/host-budget.md` + `plugin/test/ci-bounded-concurrency.test.mjs` + `full-suite-runner.ts` 注释指针）
- `5c192989d` Merge branch 'develop'（pre-merge 步）

## Touches

- .github/workflows/ci.yml
- plugin/scripts/full-suite-runner.ts
- plugin/test/ci-bounded-concurrency.test.mjs (new)
- docs/operations/host-budget.md (new)
- tasks/gap-ci-self-hosted-runner-shares-fleet-host.md

> `plugin/test/ci-bounded-concurrency.test.mjs` 是对 workflow YAML 的静态断言（⛔ 不是新增 `plugin/scripts/*.ts`，故不触发 capability-catalog / outline / laydown 三道登记闸）；`full-suite-runner.ts` 是 fleet 侧宿主预算的声明点（本次按实情只加「CI 消费者不在此处收敛」的注释指针，指向 `docs/operations/host-budget.md`）。
