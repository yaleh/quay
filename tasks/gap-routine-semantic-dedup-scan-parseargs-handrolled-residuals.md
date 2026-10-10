---
id: gap-routine-semantic-dedup-scan-parseargs-handrolled-residuals
title: "semantic-dedup-scan: A spec-driven parser exists in gate-script-base.ts
  and several scripts import it, but a residual set still hand-rolls generic
  flag loops."
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
A spec-driven parser exists in gate-script-base.ts and several scripts import it, but a residual set still hand-rolls generic flag loops.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791631645924` · ts `2026-10-10T11:27:25.924Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseArgs`
- 涉及文件：
- `plugin/scripts/obligation-ledger.ts:306`
- `plugin/scripts/checked-in-write-check.ts:374`
- `plugin/scripts/start-drivers.ts:674`
- `plugin/scripts/suite-scheduler.ts:457`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
unify

## Disposition — 修掉（四条全部收敛），不是「已注意到」

处置 = **unify**，分两部分落地（与同族先例 commit `0f32d205e` 同形：Part A 先在共享 parser 里
解除阻塞，Part B 再收敛调用方）。实跑提交：`abdcba1bb`。

**Part A —— `plugin/scripts/gate-script-base.ts` 的 `parseArgs` 补齐三个 spec 键（全部 opt-in，
既有调用方输入语言逐字节不变）**：

- `FlagSpec.type: "string[]"`，两个 flavor：`greedy: true` = 一次出现带 N 个值（`--files a b c`）；
  默认 arity-1 = 每次出现一个值、**重复出现累加**（`--test-name-pattern a --test-name-pattern b`）。
  后者单值 `flags` map 结构上表达不了（后写覆盖先写）。值是新增的 `ParsedArgs.lists` 映射，所以既有
  调用方的 `flags` 类型一点没动。两条 arm 在一个输入上**故意**不同：greedy 遇 `--flag` 停，arity-1
  无条件取下一 token —— 与既有 scalar `type:"string"` 的取值规则一致，是各自还原被吸收调用方的输入
  语言，不是疏忽。
- `CliSpec.unknown: "accept" | "skip" | "reject"`（`strict: true` 保留为 `"reject"` 的旧拼写）。
  新增的第三个取值 `"skip"` = 丢弃该 token 且**不消费**其后 token —— 给 argv sink 用：被测的不是
  这个未知 flag 的值，下一个 token 属于真正的消费者。缺它就只能用 `"accept"`，而 `"accept"` 实测会把
  `["--bogus","--json"]` 读成 `{bogus:"--json"}` 并静默丢掉 `--json`。
- `CliSpec.errors: "exit" | "return"` + `ParsedArgs.error`。`help:"return"` 此前只覆盖 `--help`
  一条 arm，两条 usage-error 路径（reject / minArgs）仍由 parser 自己 `process.exit(2)`，调用方无法
  自己报错并返回自己的退出码。

**Part B —— 四个残余载体全部改调共享 parser**，各自只保留一个把原始 flag 串映射到本命令类型形状的
薄适配器（数值校验与默认值留在调用点）：

| 文件 | 收敛前的阻塞（实测，非印象） | 收敛后 |
|---|---|---|
| `checked-in-write-check.ts` | `--files a b c` 是 GREEDY list；共享 parser 读成 `files:"a"` 并把 `b`,`c` 漏进 `args` —— 会把 3 个输入静默降成 1 个还照常出 verdict（硬规则 3b） | `{type:"string[]", greedy:true}`；该文件自己写在注释里的那段测量，现在是 `gate-script-base-arg-modes.test.mjs` 的正控制 |
| `suite-scheduler.ts` | ARGV SINK：`test.sh` 把自己的 argv 透传给 `node --test`，未知 flag 必须跳过且**不吃**其值；`--test-name-pattern` 还需重复累加 | `unknown:"skip"` + `{type:"string[]"}`；`--help` 文本仍在本命令（`help:"return"`），检测归共享 parser |
| `start-drivers.ts` | 自定义 `--help` 打印多行 usage 后返回（不能被杀进程）；未知参数要返回自己的退出码 2 | `help:"return"` + `errors:"return"`；错误消息逐字节不变（`start-drivers: unknown argument: --bogus`） |
| `obligation-ledger.ts` | 私有 `--key value` 循环，任何键都收 | 声明式 spec；未知 flag 改为 **reject**（旧循环把 typo 静默吞掉、命令随后用 `?? default` 顶上 —— 硬规则 3b 禁止的替换） |

**可核（每条都能独立复跑）**：

1. `plugin/test/gate-script-base.test.mjs` 新增三条 ratchet：四个载体**不得**再出现手搓 flag 循环
   （`for (let i = [02]; i < argv.length; i++)`）、**必须** import 且调用 `baseParseArgs`、以及
   「删掉共享导出 ⇒ 消费者 import 失败」的 mechanism-is-real 控制。谓词已对**收敛前**的源码干跑过
   （四条全 true / 全 false），故它取得到真值，不是恒真谓词。
2. `plugin/test/gate-script-base-arg-modes.test.mjs`（新，12 例）逐条钉住三个新键，且每条都配一个
   **同一 argv 上的默认 arm 对照**（例如 `unknown:"skip"` vs 默认 `"accept"` 在同一
   `["--bogus","--json"]` 上给出不同读数），退出码 arm 在子进程里跑。
3. 受影响套件实跑：`gate-script-base`(62) / `gate-script-base-help-mode`(5) / `gate-script-base-arg-modes`(12)
   / `checked-in-write-check`(12) / `obligation-ledger`(11) / `manager-obligation-ledger` / `obligation-ledger-check`
   / `suite-scheduler`(14) / `suite-lpt-order` / `start-drivers`+`start-drivers-cli-resolution`(31)
   —— 合计 171/171 绿；`help-contract-incompatible-behaviors` 全量 `-check.ts` `--help` 扫描 4/4 绿；
   收尾的 scoped 门 `scripts/test.sh --for-task … --allow-thin` **exit 0 / 175 通过 0 失败**
   （含上面两条 ratchet 与全部变更相关静态检查）。
4. `laydown-set-check.sh --list` 在收敛前后同为 `scripts_derived: 121` —— 证明 `start-drivers.ts`
   新增的 sibling import **没有**改变派生落盘集合（`gate-script-base.ts` 本就是 `deriveLoopScriptsOnce`
   source (c) 的既成成员），所以该文件「保持无 sibling import」的旧注释所指的约束未被违反。
   （该文件入口原先传 `process.argv.slice(2)`，与共享 parser 内部再 `slice(2)` 相撞 —— 收敛过程中实测到
   `--help`/`--bogus` 被整个吞掉、命令直接去拉 driver；已改为传完整 argv。）

**输入语言差异（enumerable，不是「行为不变」的空话）**：(a) 尾部无值的 string flag（如把 `--port` 放在
最后）此前经 `Number(undefined)=NaN` 走数值校验报错，现按「未提供」落到默认值 —— 与同族先例适配器同一
读法；(b) `obligation-ledger` 的未知 flag 由静默接收改为 exit 2；(c) `obligation-ledger --help`
由此前的「usage + exit 2」变为「usage + exit 0」。三者都写进了各自适配器的注释。

**AC 逐条复核读数（收敛后，四条载体各自）**：`import=1 / baseParseArgs( 调用=1 / 手搓循环=0`。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `parseargs-handrolled-residuals`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791631645924`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/obligation-ledger.ts`
- `plugin/scripts/checked-in-write-check.ts`
- `plugin/scripts/start-drivers.ts`
- `plugin/scripts/suite-scheduler.ts`
- `plugin/test/gate-script-base.test.mjs`
- `plugin/test/gate-script-base-arg-modes.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-parseargs-handrolled-residuals.md`
