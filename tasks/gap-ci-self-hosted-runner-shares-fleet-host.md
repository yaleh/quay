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

- [ ] CI 的 suite 调用带**显式有界并发**：`grep -n 'test-concurrency' .github/workflows/ci.yml` 命中 ≥1，且该值不来自 nproc（贴行号与实际内容，⛔ 不是断言）。
- [ ] CI job 的 cgroup/slice 与 fleet **可区分**：workflow 里能读到具名 scope/slice（`systemd-run --slice=` 或等价），或在文档里记录它跑在独立的容器 scope 内并给出可核的读法（贴逐字配置 + 一次 `cat /proc/<pid>/cgroup` 的真实输出）。
- [ ] 宿主预算文档把 CI 列为消费者：`docs/operations/host-budget.md` 里有一行点名该 runner（service 名或 job 名）以及它被授予的预算（贴逐字行）。
- [ ] 位置判据能取假（mutation 负控）：把 CI 的并发去掉（改回默认）⇒ 上条静态判据必须**变红**；恢复后变绿。红/绿两次读数都贴出来 —— 否则那条判据只是回声（硬规则 4 推论三）。
- [ ] `bash scripts/test.sh --for-task gap-ci-self-hosted-runner-shares-fleet-host --allow-thin` exit 0。
- [ ] 全量 `bash scripts/test.sh` 绿（由 driver 机械 fan-in 验证）（待外部）。

## DoD

一次**真实** GitHub Actions run（贴 run URL）里能看到该 job 的有界 `--test-concurrency` 以及它所在的 cgroup/slice（job log 里逐字出现），且宿主预算文档已把 CI 计为一个消费者。⛔ 只改 YAML 文本、没有一次真实 run 的读数不算（DIR-026 Reading A）；⛔ 也不接受「改完等它下次跑再说」——落地判据是本任务落地后时间窗内的真实 run。

## Touches

- .github/workflows/ci.yml
- plugin/scripts/full-suite-runner.ts
- plugin/test/ci-bounded-concurrency.test.mjs (new)
- docs/operations/host-budget.md (new)
- tasks/gap-ci-self-hosted-runner-shares-fleet-host.md

> `plugin/test/ci-bounded-concurrency.test.mjs` 是对 workflow YAML 的静态断言（⛔ 不是新增 `plugin/scripts/*.ts`，故不触发 capability-catalog / outline / laydown 三道登记闸）；`full-suite-runner.ts` 是 fleet 侧宿主预算的声明点（若实际预算声明落在别处，执行器按实情补进本节）。
