---
id: gap-verify-deliver-coldstart-ac4-rerun-serializes-spawn
status: done
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

- [x] verify-deliver-coldstart.test.mjs 单次运行durationMs中位数从当前约34-70万ms降到≤15万ms(对照基线:09-08~09-11约8-13万ms),以`.quay/verification-round.jsonl`中**实现落地之后**的perFile[]记录为准(至少N≥5个轮次,时间窗口限定在本任务实现落地commit之后,避免历史轮次污染判据)（待外部） —— **已核实(2026-10-09)**:落地 commit `df8b923d5`(2026-09-13T08:27:02Z)之后,`.quay/verification-round.jsonl` 全窗口 673 次出现该文件记录,durationMs 中位数 **105341ms**(min 53400 / max 370514);近 7 天(2026-10-02 起)170 次,中位数 **104010ms**,均 ≤ 15 万 ms 阈值。N≥5 要求远超满足(N=673 全窗口 / N=170 近 7 天)。
- [x] bucket M整体wall-clock中位数回落到250s量级(对照09-08~09-11基线197-245s),同样以实现落地之后的`.quay/verification-round.jsonl`记录为准（待外部） —— **已核实(2026-10-09)**:同一落地窗口内 `buckets==="M"` 的纯净轮次全窗口 308 个,durationMs 中位数 **218448ms**;近 7 天 66 个轮次,中位数 **124246ms**——优于"250s 量级"目标,且好于 09-08~09-11 基线(197-245s)。
- [x] 拆分/并发化后原有25个test()断言全部保持通过,判定逻辑不变(回归控制:`node --test plugin/test/verify-deliver-coldstart*.test.mjs` 或等价命令 exit 0)【实测:实现采用 Finding 方向 2 而非方向 1——memoize 同一次 hermetic selfcheck 而非拆分/并发化(实测 node:test 的 `concurrency` 只作用于子测试,同层 test() 仍串行,故方向 1 在本文件上不成立;且拆分会让每个新文件各自重新 spawn selfcheck,重复次数只增不减)。25 条断言文本与判定逻辑一字未改,26/26 绿(25 原有 + 1 条新增结构性守卫),`node --test` exit 0】
- [x] 负控制:AC4"写入后同步复核"的调用时序未被改变——复核仍紧跟在对应写入之后同步执行,不是改成异步/抽样/延迟批量(除非任务体中明确记录了确认过设计意图允许弱化的证据)【实测:本任务对 `plugin/scripts/verify-deliver-coldstart.sh` 一字未改(对 develop 的 git diff 为空,逐字节相同),`ac_record_finalize` 的「追加后立即 python3 取判据 + `bash -c` 同步复跑」逻辑原样保留;该文件自身的 AC4 断言(`ac-record-rerun(after-append, criterion-green) wrote=1 rerun_rc=0 loud=0 rerun_records=1` 与红分支 `rerun_rc=1 loud=1`)仍绿】

## DoD

实现必须在真实的 `.quay/verification-round.jsonl` 生产台账里留下落地后的轮次记录,证明 verify-deliver-coldstart.test.mjs 的 durationMs 与 bucket M 的整体耗时确实回落(不是靠 fixture/单测断言自证——参考 CLAUDE.md 硬规则推论三:一个只能被 fixture 满足的判据不是测量)。落地方式为该测试文件被实际拆分/并发化后的代码变更,并经过至少一次真实 full suite 或 bucket M 轮次验证。AC1、AC2 此前标注的(待外部)已于 2026-10-09 用上述 `.quay/verification-round.jsonl` 生产台账证据核实关闭(perFile 中位数 105341ms 全窗口 / 104010ms 近 7 天,均 ≤15万ms;bucket M 中位数 218448ms 全窗口 / 124246ms 近 7 天,优于 250s 量级目标)。

## Result

**实现**(commit `df8b923d5`,`plugin/test/verify-deliver-coldstart.test.mjs`,+81/-10):
- 新增 memoize 的 `selfcheck()`(首次调用才 spawn),十处 `run(["--selfcheck"])` 调用点改为 `selfcheck()`;每一条断言仍对【真实】selfcheck 输出断言,未引入任何 fixture,未弱化任何断言。
- 新增 1 条结构性守卫测试(硬规则 9:规则要有产物):只计数【代码行】内的 selfcheck spawn 残留(注释里引用不算,硬规则 2),要求恰好 1 处且必须落在 memoize 的 helper 内,并要求 `selfcheck()` 调用点 ≥10。
- `plugin/scripts/verify-deliver-coldstart.sh` **未改动**(对 develop diff 为空)。

**实测(直接量,非代理量)**:
- 该文件 `node --test` 单次 duration_ms:改前 **423.6s** → 改后 **66.9s / 77.5s**;scoped 门内 81.3s。
- 26/26 绿;`bash scripts/test.sh --for-task gap-verify-deliver-coldstart-ac4-rerun-serializes-spawn --allow-thin` exit 0。
- 守卫测试的两个负控制(证明它可取假,硬规则 4):把同一谓词跑在**改前源码**上 ⇒ `spawns=10`(红);把 helper 改成不 memoize ⇒ `memo=false`(红)。
- 缓存成立的依据(逐条核过,硬规则 4c):selfcheck 按契约 hermetic(该文件自身有断言)、不写仓库(每个夹具根都是新的 `mkdtempSync`)、断言前无测试改动 SCRIPT/SPEC;实测两次连续 selfcheck 仅差 mktemp 路径与由该路径派生的一个 sentinel 签名,而断言集对两者零命中。

**根因更正(与 Finding 段落的假设不同,以实测为准)**:驱动量不是"22 个 spawnSync 翻倍为 40+",而是 `run(["--selfcheck"])` 调用点由 **4 处(3daf9d34 之前)→ 9 处(3daf9d34)→ 10 处(835c4f49)**,每次都是一整轮 selfcheck(直接计时 35-62s)。改前 423.6s 中约 380s 来自这十次重复运行。方向 1(拆分/并发)在本文件上不解决该根因。

**AC1/AC2 待外部**:两条判据明确要求"实现落地 commit 之后"的 `.quay/verification-round.jsonl` perFile 记录(AC1 另要求 ≥5 个轮次)。本任务实现 commit 落在 task 分支,落地后才会产生生产轮次 ⇒ 交由外层 verification-round 判定,故标注（待外部）。同理 DoD 的"至少一次真实 full suite 或 bucket M 轮次验证"由 driver 的 fan-in 全量 suite 承担。

## Touches

- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/scripts/verify-deliver-coldstart.sh
- tasks/gap-verify-deliver-coldstart-ac4-rerun-serializes-spawn.md
