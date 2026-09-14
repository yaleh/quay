---
id: gap-perfile-memory-cost-collection-missing
title: 逐文件内存成本采集缺失——per-file-cpu-report.mjs 只报 CPU,verification-round.jsonl
  的内存字段只有整轮粒度
status: todo
labels:
  - gap
  - mechanism
  - observability
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

当前测试基础设施(`plugin/scripts/per-file-cpu-report.mjs`,通过 `NODE_OPTIONS=--require` 注入每个隔离的测试文件子进程,由 `gap-perfile-cpu-cost-collection`/`gap-suite-scheduler-perfile-cpu-emitter-missing` 两个已 done 任务落地)只采集 CPU 用量(`process.cpuUsage()` + 已回收子进程的 cutime/cstime,写入 `cpuMs` 字段,最终落进 `.quay/verification-round.jsonl` 的 `perFile[].cpuMs`),**完全没有逐文件的内存数据**。

`.quay/verification-round.jsonl` 里确实有 `mem_peak_mb`/`swap_peak_mb` 字段(`gap-verification-round-load-fields-from-systemd` 落地,读 systemd scope 退出行 `Consumed ... memory peak ...`),但只在**整轮**粒度记录——查了历史数据,没有任何窄范围(几个文件)的轮次带内存数据,结构上无法把某次内存峰值归因到具体某个测试文件。这在系统频繁 OOM(swap 一度占用超 80%)、需要定位内存热点测试时是一个明确的可观测性缺口——只能退而用逐文件 CPU 用量做代理指标,而 CPU 高不等于内存高(尤其是纯 I/O/子进程等待型的测试,这类文件的体质判别正是 `gap-perfile-cpu-cost-collection` 里 Type 2 类别关心的对象,而 CPU 代理对这类文件恰恰最没有分辨力)。

**关联(相关但不同机制,非重复)**:
- `gap-perfile-cpu-cost-collection`(done)/`gap-suite-scheduler-perfile-cpu-emitter-missing`(done)——同一套子进程自报 seam(`per-file-cpu-report.mjs`),但只报 CPU,本任务是它的内存镜像半边。
- `gap-verification-round-load-fields-from-systemd`(done)——整轮粒度的 `mem_peak_mb`/`swap_peak_mb`,读的是 systemd scope 退出行,不是逐文件,且该字段本身也只在近全量套件轮次(589-652 个文件)出现过,窄范围轮次结构上没有该数据。

## Proposal

照抄 `per-file-cpu-report.mjs` 已经验证过的"子进程自报"手法(同一个 exit 钩子里顺带做,不需要新的注入点):

1. 在同一个 `process.once("exit", ...)` 钩子里,除了现有的 `cpuMs` 计算,额外读:
   - 本进程自身:`process.resourceUsage().maxRSS`(单位 KB,内核记录的**整个进程生命周期内的峰值** RSS)——优先于 `process.memoryUsage().rss`(那是退出那一刻的快照,会因退出前的 GC/释放而低估峰值)。
   - 子进程内存覆盖是结构性难点:`cutime`/`cstime` 那一路只能算 CPU 时间,算不出内存——子进程(如 `worker-driver-fan-in.test.mjs` 这类会 spawn 真实 quay task worker 子进程的文件)的内存需要每个被 spawn 的子进程各自也在退出时上报(如果它们也是 node 进程且可控),或者退化为"仅覆盖本进程自身"并在文档里如实标注这个覆盖边界(不得假装覆盖了子进程内存——呼应硬规则 3b)。
2. 输出字段命名为 `memPeakKb`(内存不是时间单位,不沿用 `*Ms` 命名风格),写进同一份 `<cpuDir>/<key>.cpu` 文件,或新增 `<key>.mem` 文件——两种都可以,由实现者根据 `measure-suite-reporter.mjs` 现有的读取契约决定哪种改动更小。
3. `measure-suite-reporter.mjs` 对应读出这个新字段,追加到 `__PERFILE__` 行(如 `__PERFILE__ duration_ms=... passed=... cpu_ms=... mem_peak_kb=...`),并写进 `.quay/verification-round.jsonl` 的 `perFile[].memPeakKb`。**已知同族缺陷**:`gap-suite-scheduler-perfile-cpu-emitter-missing` 实证过 `__PERFILE__` 有**两处独立发射代码**(`measure-suite-reporter.mjs:196` 的 legacy 路径 + `suite-scheduler.ts:343` 统一调度器路径,后者才是 2026-08-31 起的生产默认入口),只改一处会导致生产从未产出——本任务落地后必须在**统一调度器路径**(`QUAY_SUITE_SCHEDULER=1`)下端到端复现,不能只验 legacy 路径。
4. 如实标注覆盖边界:只覆盖"被 node:test 隔离出的这一个测试文件自己的进程",不覆盖它 spawn 出的、且不受这套机制控制的外部子进程(除非那些子进程本身也是可控的、可以注入同一份 preload 的 node 进程——需要实现者核实哪些子进程满足这个条件)。

## Touches

- plugin/scripts/per-file-cpu-report.mjs
- plugin/scripts/measure-suite-reporter.mjs
- plugin/scripts/suite-scheduler.ts(统一调度器路径的独立 `__PERFILE__` 发射代码,需实现者核实并同步接线,勿重蹈 `gap-suite-scheduler-perfile-cpu-emitter-missing` 的覆辙)
- plugin/scripts/measure-trend-check.ts(parsePerFileLines 若需解析新字段)
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/pre-verified-round-record.ts(以上两个是 round-record writer,若字段需落进 perFile 记录成形面,两处都要带,不得只改一边)
- plugin/test/measure-suite.test.mjs
- plugin/test/measure-suite-reporter.test.mjs
- plugin/test/suite-scheduler.test.mjs(对应现有测试覆盖,需实现者先核实 per-file-cpu-report 机制自己的测试落在哪些文件)
- tasks/gap-perfile-memory-cost-collection-missing.md(自身)

## Acceptance Criteria

- [ ] AC1:新字段(`memPeakKb` 或等价命名)真实来自 `process.resourceUsage().maxRSS` 或等价的内核峰值读数,不是 `process.memoryUsage().rss` 的退出时快照——需实测两者在同一个人为分配大对象又释放的夹具上的差异,证明选用的是真峰值读数(不是退出时快照,后者会因 GC/释放低估峰值)。
- [ ] AC2:`.quay/verification-round.jsonl` 的 `perFile[]` 条目真实出现新字段,贴一条真实生产轮次(落地提交时刻之后)的记录作证据,非 fixture/单测数据(硬规则 4 推论三)。
- [ ] AC3:覆盖边界如实写进代码注释和本任务的 Evidence——明确说明是否覆盖子进程内存,如果不覆盖,说明为什么以及后续如果要覆盖需要什么(呼应硬规则 3b:不得把"部分覆盖"伪装成"全覆盖")。
- [ ] AC4:负控制——一个几乎不分配内存的测试文件(如纯断言测试)报出的 `memPeakKb` 应该明显低于一个故意分配大对象(如几十 MB 数组)的夹具测试文件,证明该读数真的能取假、不是恒定值。
- [ ] AC5:落地后必须核实统一调度器路径(`QUAY_SUITE_SCHEDULER=1`,生产默认入口)与 legacy 路径**都**产出该字段——不得重复 `gap-suite-scheduler-perfile-cpu-emitter-missing` 那次"只验了一条路径就标 done,另一条路径生产从未产出"的缺陷;贴两条路径各自的端到端复现证据。
- [ ] AC6:`scripts/test.sh` 对应泳道绿。

## Definition of Done

逐文件内存峰值读数真实落进 `perFile[]` 记录(两条 `__PERFILE__` 发射路径都接上、两个 round-record writer 若涉及都带上该字段);AC1-AC6 全部勾选且勾选状态与本 DoD 文字一致;生产载体(非 fixture)贴出至少一条落地后的真实记录;覆盖边界(是否含子进程内存)如实写进代码与 Evidence,不伪装成全覆盖;负控制证明该读数有分辨力、非恒定值;全量测试绿。