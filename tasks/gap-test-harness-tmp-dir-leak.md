---
id: gap-test-harness-tmp-dir-leak
title: 测试 harness 泄漏临时目录：/tmp 积压 46,218 个 quay-*（15,278 个超 7 天）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**实测（2026-11-06，同一台 128 vCPU / 246 GB 共享机）**：

```text
$ find /tmp -maxdepth 1 -name 'quay-*' | wc -l
46218
# 另有 /var/tmp 下 717 个
```

其中 **15,278 个超过 7 天**。抽样尺寸：200 个目录 = 24.8 MB，300 个最老的 = 3.6 MB ⇒ 全量**数 GB**。它们由套件/测试运行（`mkdtemp` / `/tmp/quay-*` 夹具）与被 kill 的套件留下；留存本身又制造 inode/元数据压力，并让 `/tmp` 扫描变慢。

2026-11-06 已做过一次**一次性**清理，删掉 15,364 个陈旧条目（清单留在 `~/tmp-quay-cleanup-20261106.list`）。⚠️ 一次性清理**不是修复**：产生源仍在，下一轮套件会重新积回来 —— 这正是本任务要修的那一半。

> 判读：这是「每次运行都泄漏一点点、且没人报告」的典型形态。它不会自己变红：没有读数会因为 `/tmp` 里有 46,218 个目录而失败，所以缺陷**与一切正常同形**（硬规则 3b）。修复的判据必须是一个**计数**（created / reaped / leaked），不是一个布尔。

### Proposed fix

给套件/测试 harness 一条**退出路径上的清理**（`trap` / `afterAll`）覆盖它自己创建的临时根；再加一个有界年龄的清扫器，且**永不删除活进程的 cwd**。把 created / reaped / leaked 三个计数报出来，而不是静默泄漏。

### Dedup / merge 决定

按机制去重：`/tmp/quay` / `mkdtemp` / `临时目录` / `leak` / `cleanup` / `残留` 在 todo/ready 池内命中均为 **0** ⇒ 无 open peer。merge-candidate：`scripts/test.sh` 与 `plugin/scripts/full-suite-runner.ts` 无其它 open 任务声明为 Touches ⇒ **独立立案**。

## AC

- [ ] 夹具套件跑完零新增：跑一条会创建 temp root 的 scoped 夹具套件，退出前后各取一次 `find /tmp -maxdepth 1 -name 'quay-*' | wc -l`，**两个数相同**（两个数都贴进任务体）。
- [ ] 信号路径同样清理：向同一夹具套件发 `SIGTERM` ⇒ 同样零新增（证明清理挂在 trap/退出路径上，而不是只在 happy path 的 `afterAll` 里）。
- [ ] 清扫器双向控制：一个**被活进程持有为 cwd** 的 `/tmp/quay-*` 目录在清扫中**存活**；一个无人持有且超龄的被清掉。两个方向都断言（只测一个方向等于没测）。
- [ ] 遥测行报告三个计数（created / reaped / leaked），且**零泄漏时可与「没统计」区分**（硬规则 3b：`leaked=0` 与 `leaked=null`/字段缺席 不得同形）。
- [ ] 清扫器有干跑模式：输出将删除的条目清单而不直接删（贴一次干跑读数，含条目数与前 3 条路径）。
- [ ] `bash scripts/test.sh --for-task gap-test-harness-tmp-dir-leak --allow-thin` exit 0。
- [ ] 全量 `bash scripts/test.sh` 绿（由 driver 机械 fan-in 验证）（待外部）。

## DoD

真实跑一轮全量套件后，`/tmp` 的 `quay-*` **净增量为 0**（或 ≤ 遥测行自己声明的 leaked 计数，且该数必须为 0 才算过），并贴出跑前/跑后两次 `find /tmp -maxdepth 1 -name 'quay-*' | wc -l` 的真实读数与遥测行原文。只证明「清理代码存在」或只跑单测不算（DIR-026 Reading A）；⛔ 用一次性 `rm -rf` 把计数清零不算修复 —— 判据是**下一轮跑完仍为零**。

## Touches

- scripts/test.sh
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/temp-root-reaper.ts (new)
- plugin/scripts/temp-root-reaper.sh (new)
- plugin/scripts/suite-temp-root.sh (new)
- plugin/test/temp-root-reaper.test.mjs (new)
- plugin/scripts/capability-catalog-declarations.json
- plugin/scripts/overhead-instrument.sh
- plugin/sh-census-baseline.json
- tasks/gap-test-harness-tmp-dir-leak.md

> Touches 里 `temp-root-reaper.ts` 是拟新增的载体；执行器若判定应复用/扩展现有的临时根 helper，按实情把真实路径登记进本节并留痕（⛔ 不要为了迁就本节另造一个文件）。
>
> **实际落地时的登记（留痕，2026-11-06）**：`temp-root-reaper.ts` 按原计划新增；但它不能由 `scripts/test.sh` 直接调用——`sh-census-check` 的 `embeddedInterpreterLines` 是【文件级】棘轮，`.sh` 里只要出现一个 `node` 就整文件计行，直接内联会是 +57。故拆成 `temp-root-reaper.sh`（2 行薄 wrapper，承担计数）+ `suite-temp-root.sh`（57 行逻辑，无内嵌解释器 ⇒ 不计入）。`capability-catalog-declarations.json`（新脚本必须声明）、`overhead-instrument.sh`（它的 `trap … EXIT` 会覆盖早先装的 trap，必须链式而非替换）、`sh-census-baseline.json`（+3 的 committed re-anchor）随之进入 Touches。
