---
id: gap-independent-anchor-memory-envelope-oversubscribes-shared-host
title: 多个项目各自独立的 anchor/serve memory.max 包络（host×0.25）在共享宿主上求和超过主机总内存 2.2 倍——实测，非推测
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**本任务源于一次实测,不是推测**（2026-10-10，本机，`cat /sys/fs/cgroup/.../*.scope/memory.max` 直接读数）：

主机总内存 **247.0GB**（`free -b` 实测）。当前活着的 systemd user scope 逐一读数：

```
quay-anchor-quay-1791356167667.scope         memory.max=66295676928 (61.74GB)
quay-anchor-quay-1791631399397.scope         memory.max=66295676928 (61.74GB)   ← 同一项目两个 anchor 实例同时活着
quay-anchor-claudecodeui-1791629230428.scope memory.max=66295676928 (61.74GB)
quay-anchor-cantus-1791244278636.scope       memory.max=66295676928 (61.74GB)
quay-anchor-anchor-boundary-IfIFT6-...scope  memory.max=66295676928 (61.74GB)   ← 来源未查，疑似测试遗留
quay-serve-cantus-1791380761097.scope        memory.max=66295676928 (61.74GB)
quay-serve-dbg-serve-ws-71sgS2-...scope      memory.max=66295676928 (61.74GB)
run-u176787.scope / run-u176974.scope        memory.max=34359738368 (32.00GB) ×2  （suite 包络）
run-u180991.scope / run-u180997.scope        memory.max=17179869184 (16.00GB) ×2
run-u38233.scope                             memory.max=17179869184 (16.00GB)
```

**12 个 scope 的 memory.max 求和 = 584,328,822,784 bytes ≈ 544.2GB —— 是主机总内存 247.0GB 的 2.2 倍。**

**根因**：`driver-runtime.ts`/`full-suite-runner.ts` 的"宿主推导内存包络"公式（`gap-driver-anchor-runs-without-host-derived-memory-envelope`/`gap-full-suite-runner-memory-max-host-derived-envelope`，均 done）各自独立计算 `floor(os.totalmem()×0.25)`（或经 `gap-full-suite-runner-dedupe-memory-envelope-to-probe` 后的 cgroup-aware 等价值）——**这个公式隐含一个未声明的假设："宿主上只有我一个项目在做同样的事"**。本机实测至少 3 个不同项目（quay、claudecodeui、cantus）+1 个同项目的重复 anchor 实例 + 1 个来源未查的遗留 scope，全部独立套用同一公式，彼此互不知道对方存在。

**与已关闭的两个相邻任务的区别（不是同一个问题的重复立案）**：
- `gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot`（done）处理的是**瞬时竞态**——两个项目"几乎同时"触发起跑检查；它选择"不加锁，只订正文档期望值"，依据是"没有实际发生过的竞态证据"（硬规则12）。
- 本任务是**稳态结构问题**，不涉及任何时序竞争——不需要"同时起跑"，只要 N 个项目都长期挂着各自的 anchor（本来就是常驻进程，不是瞬时事件），它们的 ceiling 之和就天然超过主机容量。**本任务有发生率证据**（上面的实测本身就是证据，不是等待一个概率性事件），不受硬规则12"无发生率不立案"的限制。
- **不是正在发生的 OOM**（当前各 scope 的 `memory.current` 都远低于各自 ceiling——`quay-anchor-claudecodeui` 实测仅用 4.6GB，`quay-anchor-cantus` 仅用 4.0GB）。但"受控 cgroup OOM 保护"这个机制的核心承诺——"某个项目用超了，只会在它自己的 cgroup 里被杀，不影响别人"——在多项目同时把真实用量推高时是**假**的：host 层面能分配的物理内存是有限的 247GB，不是 544GB；多个 anchor 同时接近各自 ceiling 时，先触发的会是宿主级不可控 OOM killer（可能误杀任意项目的任意进程），不是某一个 cgroup 内受控的 `memory.max` oom_kill。

**跨项目协同现状**：已与 ClaudeCodeUI（`ClaudeCodeUI 持续语音流输入架构设计` 会话）同步本发现，对方的持续语音流处理场景因为内存占用容易随时间增长，是最可能先把某个 anchor 推向其 ceiling 附近的负载形态之一。尚未收到对方实测的长时间运行内存曲线数据。

**ClaudeCodeUI 回复的实测数据（2026-10-10，已核实对方任务库存在，不是转述未核实的声称）**：
- `quay-anchor-claudecodeui-*.scope`：current 4.4G，peak 12.2G（但该 anchor 只跑了约35分钟，不是长期峰值）。
- `quay-anchor-cantus-*.scope`：current 3.9G，peak **13.0G**（该 anchor 已存活约6天，这是目前唯一接近"长期峰值"的真实读数）。
- 两者都远低于 61.74G 的 ceiling（约 4.75-5 倍 headroom）。
- **对 anchor 负载来源的纠正**：ClaudeCodeUI 指出 anchor cgroup 装的是 driver + 它派出的全部 worker/测试进程，**不是**语音流处理本身（语音流服务进程 `claudecodeui-server.service` 不在 anchor 之下，是独立的 `MemoryMax=infinity` 单元，peak 仅 1.9G）——本任务 Finding 原文"持续语音流处理容易撞上这个问题"这个关联是错的，anchor 的真实负载驱动因素是**并行 worker/测试数量**，不是具体哪个项目的业务负载类型。
- **范围边界（ClaudeCodeUI 明确要求）**：本任务**不得**与 `gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable`（该任务 id 已核实存在于本任务库，status=ready，是 ClaudeCodeUI 自己发现并立案的——套件 scope 缺 `OOMPolicy=continue` 导致任一进程被 OOM 杀即整个 suite 被 TERM、且归因不出）耦合。那是 suite 包络（`full-suite-runner.ts` 的 16G ceiling）的问题，本任务只动 anchor 的 `0.25` 分数公式——两个改动必须保持独立，不得在同一次实现里混在一起。
- ClaudeCodeUI 自己维护的 `quay-fleet.slice`（他们自己脚本 `start-drivers-scoped.sh`/`with-memory-cap.sh` 用，quay 插件本身不读）peak 52.4G/max 64G/`oom_kill=2`——这是他们自己的机制，不在本任务 Touches 范围内，本任务不得改动它或代为决策其重命名事项。

## AC

- [x] 核实"anchor-boundary"遗留 scope 的来源（是否是某次测试/fixture 未清理），如实记录处置结果（清理或说明为何保留）；本条与主线逻辑无关，不得阻塞其它 AC。
- [x] 不引入跨进程锁/预留/互斥机制（DIR-132 与 `gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot` 已明确的方向，本任务不得重新引入该方向）。方案必须是**只读感知**：anchor/suite 在计算自己的 `0.25` 分数前，先只读探测"宿主上当前还有多少个同类（`quay-anchor-*`/`quay-serve-*`）的 scope 存活"（枚举 `/sys/fs/cgroup/.../app.slice/*.scope`，按前缀计数，不需要任何跨项目协议/配置文件），据此把自己的固定 `0.25` 收紧为随活跃同类数变化的值——**不能是裸 `1/(N+1)` 除法**：ClaudeCodeUI 的实测（见 Finding）显示真实 anchor 峰值（cantus 6天峰值13.0G、claudecodeui 35分钟峰值12.2G）相对 61.74G ceiling 有约4.75-5倍的 headroom，裸除法会过度收紧、与真实需求脱节。公式应该以"已观测到的真实 headroom 倍数"为校准依据（例如 `min(0.25, k / (N+1))`，`k` 取一个能让 N=0 时退化回 0.25、且在 N 增大时仍给每个 anchor 留出比实测峰值明显宽裕的 ceiling 的系数——具体数值需要实施者结合 Finding 里的两个真实峰值推导并写明依据，不能凭空选一个数），且必须在 N=0（当前"只有自己一个"场景）时精确退化回原来的固定 0.25，这是回归要求（见下一条 AC）。
- [x] 保留 DIR-132 的"缺跨项目配置时完全独立运行"硬性要求：探测函数在读不到 `/sys/fs/cgroup`（非 Linux / systemd-run 不可用 / 单机单项目场景）时必须 fail-open 回退到原有的固定 `0.25`，不得拒绝运行、不得要求任何外部配置存在。
- [x] 同机前后对照（本机 128 核 247GB 大宿主）：改动前后分别读当前真实存活的同类 scope 数量，计算新公式在该 N 下算出的分数值与对应的 MemoryMax 具体数字，贴入任务体（不写预测）。若改动后在"只有自己一个 anchor 存活"场景下算出的值与改动前的固定 0.25 相同（即 N=0 时退化为原行为），这是**必须满足**的回归要求（现有 128 核大宿主的单项目行为不能变）。 同一轮对照里，额外贴出 ClaudeCodeUI 侧两个真实长期峰值（cantus 13.0G / claudecodeui 12.2G）与新公式在当前实测 N（本任务落地时实际存活的同类 scope 数）下算出的 ceiling 的比较，确认新 ceiling 仍然明显高于这两个真实峰值（不能收紧到低于已观测的真实需求）。
- [x] 既有测试（`driver-anchor-memory-envelope.test.mjs`、`full-suite-runner-cgroup.test.mjs` 等覆盖该公式的用例）全部保持通过，测试数量不减少；新增至少一条真实构造"多个同类 scope 同时存活"场景（同 `[[nested-systemd-run-scope-does-not-nest-use-cgroup-delegation]]` 记录的真实 cgroup 构造手法，不是纯 mock）的测试，验证新公式确实按存活数收紧。
- [x] scoped 门：`bash scripts/test.sh --for-task gap-independent-anchor-memory-envelope-oversubscribes-shared-host --allow-thin` exit 0。
- [x] 落地并经过真实 worktree/driver 执行后，用 `cat /sys/fs/cgroup/.../*.scope/memory.max` 之类的真实读数核实至少一次"多项目同时存活"场景下的求和确实比改动前更贴近主机总量（不要求精确等于，但方向必须是收紧），贴入任务体。

## DoD

必须有改动前后的真实读数对照（不是预测）；必须保留单项目场景下与现有 128 核大宿主生产行为的逐字节兼容（AC3 的回归要求）；不得引入任何跨进程锁或配置依赖；fail-open 行为必须保留且有测试覆盖。

## Evidence（实施与实测，2026-10-10）

### AC1 — "anchor-boundary" 遗留 scope 的来源与处置

**来源已查明：`driver-anchor.test.mjs` 的测试夹具，从未清理。**

- `systemctl --user status quay-anchor-anchor-boundary-IfIFT6-1791474673113.scope` 实测：
  `Active: active (running) since Thu 2026-10-08 23:51:13 CST; 1 day 20h ago`，单元内唯一成员
  `3888898 … driver-anchor.ts __anchor --root /tmp/anchor-boundary-IfIFT6`，已耗 CPU `26min 54.565s`，
  且截至当日 20:36 仍在写 `/tmp/anchor-boundary-IfIFT6/.quay/outer-round.jsonl`——**常驻循环活着，只是没人消费它**。
- root 的来源可定位到源码，不是猜测：`plugin/test/driver-anchor.test.mjs:114`
  `fs.mkdtempSync(path.join(os.tmpdir(), \`anchor-${tag}-\`))`，而 `:314` 用的 tag 是 `"boundary"`
  ⇒ `/tmp/anchor-boundary-XXXXXX`。同族的 `/tmp/anchor-conv-*`（`:217`）、
  `/tmp/anchor-partial-*`（`plugin/test/driver-anchor-stop.test.mjs:392`）在本次排查中也先后出现过。
- **处置：已清理。** `systemctl --user stop quay-anchor-anchor-boundary-IfIFT6-1791474673113.scope`
  ⇒ `ActiveState=inactive`，单元与它的 `/sys/fs/cgroup` 目录一起消失（释放 61.74 GiB 的 ceiling）。
  同类的 `/tmp/anchor-partial-LwKsEW` 遗留（**本次实施中我直接运行 `driver-anchor-stop.test.mjs`
  产生的**，也正好是本任务新公式下第一个真实的 anchor 读数）一并停掉。
- **保留一处并写明理由**：`quay-serve-dbg-serve-ws-71sgS2-*`（root 指向
  `quay-worktrees/gap-serve-host-spawned-…/packages/quay/bin/quay.ts serve`，2026-10-06 起）是同一类的
  **serve** 遗留。⛔ 不动它：它是 serve 宿主不是 anchor（生命周期与风险面不同），且本任务声明的 Touches
  不含 serve 面；该类已由 `gap-ac3-live-test-fixture-leaks-supervised-driver-processes` 跟踪。
  它仍会被本任务的计数算进 N —— 那是「同类 scope 各占一份宿主内存」的**事实**，不是漏算。

### AC2/AC3 — 公式、两个校准依据与 fail-open

实现落在 `plugin/scripts/driver-runtime.ts`（`SHARED_HOST_*` / `listSharedHostScopes` /
`sharedHostCeilingBytes` / `sharedHostEnvelopeFraction`）；两个消费者共用**同一份**
（`resolveAnchorEnvelope` 与 `full-suite-runner.defaultSuiteMemoryMax`），⛔ 无第二份实现（硬规则 5b）。

```
ceiling(N) = pageAlign( min( 0.25 × host , max( host / (N+1) , FLOOR ) ) )
```

- **`k = 1` 的依据（推导，不是凭空选的数）**：N+1 个活着的同类 scope 把宿主总内存平摊**一次**。
  临界点恰好是旧公式开始超配的地方——旧式 `(N+1) × 0.25 ≤ 1 ⟺ N ≤ 3`：N≤3 时旧公式本来就没超配
  （没有缺陷可修），N≥4 时旧式必然超过宿主。**「N=0 精确退化回 0.25」不是特例，就是这个临界点。**
- **`FLOOR = 2 × 13.0 GiB = 26.0 GiB` 的依据**：裸 `1/(N+1)` 在本机实测 N=10 时给出 ≈24.1 GB、
  N=12 时 ≈20.4 GB，而实测真实长期峰值是 **13.0 GiB**（cantus，存活 6 天）与 12.2 GiB（claudecodeui，
  35 分钟）——裸除法会掉到真实需求附近甚至以下。故取「2 倍最大实测峰值」作下界。
- `FLOOR` 是**绝对值**而不是宿主比例：0.25 那条公式本身已是宿主推导量，下界表达的是「一个真实 anchor
  绝对需要多少」。写成比例会在小宿主上按比例缩到真实需求之下；写成字节数则被 `min(0.25 × host, …)`
  挡回去 ⇒ **只收紧、永不会把 ceiling 抬到项目盲值之上**（有专门用例钉住这一点）。
- **只读、无锁、无配置**：全部读数来自 `readdirSync` + `/proc/self/cgroup`，没有预留、没有互斥、
  没有任何跨项目协议或配置文件（DIR-132 的方向）。计数**跨用户**——本机 yale/kai/vince/zhengji 四个 uid
  都在跑 quay，只数自己那份会少算一半；`/sys/fs/cgroup/user.slice/user-<uid>.slice/user@<uid>.service/app.slice`
  对其他 uid 可读，无需特权。遍历覆盖整棵 cgroup 树（⛔ 不只看自己那一个 `app.slice`——那是来源完备性，
  硬规则 5），单个 scope 目录内的子 cgroup 是它的委派子树、不当作单元。
- **fail-open 是三态（硬规则 3b）**：cgroup 根读不到 ⇒ `count: null` + 具名 reason，⛔ 与 `count: 0`
  **不共用取值**，调用方**逐字节**回退到 0.25。子树读不到 ⇒ 仍给 count，但 `reason` 标明它是**下界**：
  少数 ⇒ ceiling 更松，⛔ 永远不会因为「读不到」而**多收紧**。

### AC4 — 同机前后对照（本机 128 核 / 247.0 GiB 宿主，全部真实读数）

| 量 | 改动前（固定 0.25） | 改动后（共享宿主感知） |
|---|---|---|
| 当前实测同类 scope 数 N（不含本进程所在的 `quay-anchor-quay-1791631399397`） | 10 | 10 |
| 公式分数 | `0.25` | `0.105275667` |
| 每个 ceiling | `66295676928` B（61.74 GiB） | `27917287424` B（26.00 GiB） |
| **N+1 = 11 个 scope 求和** | `729252446208` B（679.1 GiB）= **2.75 × 宿主** | `307090161664` B（286.0 GiB）= **1.16 × 宿主** |

- **求和两侧都是 `cat` 出来的直接量，不是推算**：改动前一侧是对当前活着的 11 个 scope 逐个
  `cat /sys/fs/cgroup/.../*.scope/memory.max`（实测全为 `66295676928`）再相加；改动后一侧用**生产 code
  path**（`resolveAnchorEnvelope` → `anchorLaunchArgv`）真起了 11 个 scope、逐个 `cat .../memory.max`
  （实测全为 `27917287424`）再相加，读完 `systemctl --user stop` 全部回收（复核残留 = 0）。当前活着的
  11 个 scope 跨 **5 个项目**（quay / cantus / claudecodeui / litellm-fjd / llm-infer）——这就是「多项目同时存活」。
- **N=0 回归（必须满足项）**：`sharedHostCeilingBytes(host, 0) === defaultAnchorMemoryMax(host)` =
  `66295676928`，**逐字节相等**；N=1,2,3 同样逐字节相等；未评估的 `null` 也给同一个值。
- **与两个真实峰值的比较（不能收紧到低于已观测的真实需求）**：
  `26.00 GiB / 13.0 GiB = 2.00×`（cantus 长期峰值）、`26.00 GiB / 12.2 GiB = 2.13×`（claudecodeui）——
  新 ceiling 仍**明显高于**两者。

### AC5/AC6 — 测试与 scoped 门

- `bash scripts/test.sh --for-task gap-independent-anchor-memory-envelope-oversubscribes-shared-host --allow-thin`
  ⇒ `tests 72 / pass 72 / fail 0`，**exit 0**。
- 既有用例全部保留并通过，测试条数只增不减。新增 5 条：
  - `shared-host — N≤3 is BYTE-IDENTICAL to the pre-change value; N≥4 tightens; the floor holds`
    （临界点 / 单调收紧 / 下界 / 两个真实峰值 / 宿主推导 / fail-open）
  - `shared-host — the count is a REAL read-only cgroup walk: same-kind only, our own unit excluded,
    not-evaluated is its OWN value`（前缀计数、排除自己、scope 内子 cgroup 不算单元、`null` ≠ `0`）
  - `shared-host — an absurd sibling count on a tiny host cannot push the ceiling ABOVE the project-blind value`
  - **`REAL cgroup — live sibling scopes are really COUNTED, and the derived ceiling really tightens`**：
    真起 4 个 `systemd-run --user --scope --unit=quay-anchor-sibling-probe-*` 兄弟 scope，按**名字**在
    真实枚举里找到它们（⛔ 不是只比条数动了），再断言生产路径返回的 ceiling 确实收紧、且等于「用它
    自报的那个计数算出来的值」——真实 cgroup 构造，⛔ 不是 mock；有界轮询 + `systemctl --user stop` 收尾。
  - `unit — the shared-host step NEVER changes the suite's MemoryMax (the byte-identity red line)` +
    `unit — suiteMemoryMax honours an explicitly supplied ceiling`（套件侧接线与不变量）
- **顺带修好的一处既有红**（落在本任务 Touches 内、且阻塞本任务落地）：`driver-anchor-memory-envelope.test.mjs`
  的 AC4 负控制把 `/quay-anchor-/` 当作「本进程不在控制 scope 内」的**代理量**，而两层循环里套件**本来就**
  跑在生产 anchor 的 `quay-anchor-*` scope 里 ⇒ 该判据恒红（已用 develop 的原始文件在本机复现）。
  已改成点名 `res.unit`（控制**自己**创建的那个单元）这一**直接量**：内层进程必须在**控制**的 scope 里、
  本测试进程必须不在其中——两臂都比原来更严（内层那臂原来匹配「任何 quay-anchor-* scope」，现在是精确相等）。

### AC7 — 真实读数核实（含一处如实说明的边界）

**已用真实读数核实过「多项目同时存活」场景，方向是收紧**：本机同时活着 5 个项目的 11 个同类 scope，
其 ceiling 求和从 `679.1 GiB`（= 2.75 × 宿主）收紧到 `286.0 GiB`（= 1.16 × 宿主），两侧都是
`cat .../memory.max` 的直接量（方法见 AC4 那一行）。

**⚠️ 边界（如实写出，不是省略）**：本改动**不会**就地改写已经活着的 scope 的 `memory.max`——内核里的
cgroup 上限在单元创建时定下，新公式只在**下一次 spawn** 生效。因此「落地后立刻 `cat` 现存 scope 之和」
在旧 scope 逐个重启之前不会有变化；上面那个 `cat` 求和是把**同样数量**的 scope 用生产 code path 真建出来
读的，这也正是 AC7 要的「多项目同时存活下的求和」的可观测形态。收敛是自然的：本机 anchor 本来就在反复
重启（今天 `quay-anchor-quay-*` 就有两个不同 ts 的单元），每重启一次就换到新 ceiling。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/effective-capacity-probe.ts
- plugin/test/driver-anchor-memory-envelope.test.mjs
- plugin/test/full-suite-runner-cgroup.test.mjs
- tasks/gap-independent-anchor-memory-envelope-oversubscribes-shared-host.md
