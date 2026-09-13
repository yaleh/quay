---
id: gap-verify-deliver-coldstart-ac4-rerun-serializes-spawn
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

full suite 与 bucket M 的墙钟时间相比几天前明显增加,已用 `.quay/verification-round.jsonl`(生产台账,直接实测 durationMs,非代理量)核实为真实回归,非宿主噪声。

**实测数据(bucket M 纯净轮次,按日中位数)**:

| 日期 | n | wall-clock 中位数 |
|---|---|---|
| 09-08 | 38 | 234.5s |
| 09-09 | 24 | 197.6s |
| 09-10 | 23 | 243.8s |
| 09-11 | 31 | 244.5s |
| 09-12 | 14 | 266.5s |
| 09-13 | 7 | 532.5s(约2倍于09-08~11基线) |

full(无限制)轮次同形:325-462s(09-08~11)→494s(09-12)→832s(09-13,n=2但同方向)。

**根因(已用对照实验/commit边界确认)**:`plugin/test/verify-deliver-coldstart.test.mjs`(805行,25个test()用例,22处spawnSync(bash …)调用点)是bucket M的单一长尾文件,其durationMs在commit `3daf9d3433c5145ade82d3fa4fd72c1bead801cb`(2026-09-12T14:45:07Z,"feat(verify-deliver-coldstart): AC 载体记录字段清单收成单一真源 + 产出时 fail-closed + 落账后复跑判据")前后出现台阶式跳变:该commit不是round 1596/1598验证commit祖先时,该文件durationMs为2.7万~23万ms(中位数约8-13万);该commit是round 1600起验证commit祖先后,跳到34万~70万ms并维持。

该commit为12+个AC记录写入点各自增加了"写入后立即同步复跑真实判据"的逻辑(AC4:"落账后自动复跑判据"),使原本一次spawnSync变成两次(写+复核),文件内22个调用点因此翻倍为40+次bash冷启动(该sh脚本约6860行,每次调用需重新解析全文件)。由于bucket M的墙钟时间在LPT调度下约等于其中最慢单文件的耗时(22-28条lane可用,其余文件都能提早跑完),这个单文件的膨胀直接决定了整个bucket M乃至full suite的墙钟。

**已排除的对立假设(负控制)**:
- 宿主竞争:09-12/09-13较慢轮次的load反而更低(4.3-9.4 vs 09-10/11的15-37),且有效并行度(cpu_time_s/wall)在lane更多的情况下反而下降——与竞争假说方向相反
- AC-247/248/249/250新增的lowconc重量测试:这些轮次的lowconc_phase_ms在整个窗口基本持平(约54-56k ms),不是驱动因素
- 单纯文件数增长:bucket_files仅增长约10%(275→305),而墙钟增长3-5倍,CPU秒/文件(已按文件数归一)也增长约80%——增长是集中的,不是弥散的

次要、未完全归因的信号(不作为结论,仅记录):`worker-driver-fan-in.test.mjs`、`full-suite-runner-phases.test.mjs`、`promotion-driver.test.mjs`等其它大文件在09-11→09-13也有约1.3-1.8倍的温和增长,弱于verify-deliver-coldstart.test.mjs的4-6倍,未深挖,可能是worktree并发数等次要因素。

**已确认的前提事实**:verify-deliver-coldstart.test.mjs 内25个test()用例各自用 `fs.mkdtempSync(path.join(os.tmpdir(), ...))` 建立独立临时目录,彼此不共享固定路径/状态——已验证并发执行是安全的。已有任务 `gap-m-bucket-long-tail-lpt-scheduling`(done)解决的是调度顺序问题,不能解决本场景(单文件内部无法并行、自身耗时已超过total/lanes),这是同类问题的新实例,换了文件,需要新任务。

**⚠️ 不建议的方向**:弱化AC4"写入后立即同步复核"的语义(改成异步/抽样/批量)——除非核实过AC4原始设计意图允许这样做,否则这是拿正确性保证换速度,不应默认采纳,实施者需先读AC4背后的原始任务/commit意图再决定。

**建议的修复方向(按优先级,供实施参考,不是强制方案)**:
1.(最高优先级、低风险)把该测试文件内部25个用例改为并发执行(node:test `{concurrency:true}`),或按AC分组拆分为3-4个独立.test.mjs文件,让LPT调度器把内容分散到空闲lane上
2. 减少每次spawnSync的固定开销:量化bash冷启动+source 6860行脚本的固定成本占比;如果占大头,考虑把AC4的复核逻辑做成同进程函数调用而非再spawn一次bash,或至少抽出复核所需的最小逻辑为独立轻量脚本
3.(增量,可延后)审查22个spawnSync调用点里有多少是在重复测试同一重路径而非新增行为本身,评估是否可以把部分下沉为直接函数调用的单元测试

## AC

- [ ] verify-deliver-coldstart.test.mjs 单次运行durationMs中位数从当前约34-70万ms降到≤15万ms(对照基线:09-08~09-11约8-13万ms),以`.quay/verification-round.jsonl`中**实现落地之后**的perFile[]记录为准(至少N≥5个轮次,时间窗口限定在本任务实现落地commit之后,避免历史轮次污染判据)
- [ ] bucket M整体wall-clock中位数回落到250s量级(对照09-08~09-11基线197-245s),同样以实现落地之后的`.quay/verification-round.jsonl`记录为准
- [ ] 拆分/并发化后原有25个test()断言全部保持通过,判定逻辑不变(回归控制:`node --test plugin/test/verify-deliver-coldstart*.test.mjs` 或等价命令 exit 0)
- [ ] 负控制:AC4"写入后同步复核"的调用时序未被改变——复核仍紧跟在对应写入之后同步执行,不是改成异步/抽样/延迟批量(除非任务体中明确记录了确认过设计意图允许弱化的证据)

## DoD

实现必须在真实的 `.quay/verification-round.jsonl` 生产台账里留下落地后的轮次记录,证明 verify-deliver-coldstart.test.mjs 的 durationMs 与 bucket M 的整体耗时确实回落(不是靠 fixture/单测断言自证——参考 CLAUDE.md 硬规则推论三:一个只能被 fixture 满足的判据不是测量)。落地方式为该测试文件被实际拆分/并发化后的代码变更,并经过至少一次真实 full suite 或 bucket M 轮次验证。

## Touches

- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/scripts/verify-deliver-coldstart.sh
- tasks/gap-verify-deliver-coldstart-ac4-rerun-serializes-spawn.md
