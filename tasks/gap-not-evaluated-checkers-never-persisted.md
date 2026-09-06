---
id: gap-not-evaluated-checkers-never-persisted
title: 检查器「读不懂输入」只写 stderr、从不落库——惰性守卫成为结构上不可发现的失效类（bypass-check 已惰性且无人知晓）
status: ready
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra: {}
---
## Finding

**结论**：一个检查器「今天读不懂输入」这件事，**在全项目任何载体上都不可见**——信息被诚实地产生，然后在 stderr 边界被扔掉。这使「惰性守卫」成为一个**结构上不可发现**的失效类，而它已经造成了实际损害。

**证据链（逐条实测）**：

1. `checker-cost-lib.sh:158-159` 对 exit 3 的处理是**正确且诚实**的：
   `echo "STATIC_CHECK_NOT_EVALUATED: ${_name}" >&2`，注释写明「counted separately, never conflated with a pass」。
2. 但 `STATIC_CHECK_NOT_EVALUATED` **只出现在 `checker-cost-lib.sh` 一个文件里**（全仓 grep 4 处命中，全在该文件）——`full-suite-runner.ts` 从不解析它，`full-suite-state.json` 从不记录它。
3. 而它的**兄弟行是落库的**：`full-suite-runner.ts:547` 的 stderr 捕获表含 `/^STATIC_CHECK_FAILED:/`，`:556` 的 `STATIC_CHECK_FAILED_RE` 解析出 name+exit 写进 `staticCheck.failedCheckers`（实测 `full-suite-state.json` 当前就带着 `failedCheckers:[{"name":"quay-init-closure-ratchet","exitCode":1,...}]`）。
   ⇒ **红的检查器留痕，读不懂的检查器不留痕。** 两者只差一行解析。

**已经造成的损害（本轮实测的完整因果链）**：
`direct-to-develop-bypass-check` 以生产参数（`--root <主检出> --baseline b11ce7202b…`）跑出
`{"evaluated":false,"ok":true,"reason":"unclassifiable-commits-in-range","unclassifiableCommits":3627}`、**退出码 0**，
且不可分类样本里**恰好含有它要抓的六个 `meta-driver:` 提交**（经手工 worktree 分支双亲合并 `125ba19ff` 直接 ff 进 develop）。
⇒ 该守卫已惰性了不知多久，**没有任何载体记录过这件事**，所以没有任何人、任何机制能发现它。
⇒ 后果沿链传导：守卫沉默 → 那批改动没跑全量 suite → `quay-init-closure-ratchet` 从未对它们跑过 → laydown 涨 3146 字节（`plugin/probes/meta-driver.md` 12672→15818，与棘轮超出量逐字节相等）→ 由**无关任务**的 fan-in 替它挨红。

**为什么这是「载体缺失」而不是「缺一个 driver」**：产生信号的机件已经存在且工作正常；缺的只是把它写下来。⛔ 不要为此新建 driver 或新建周期性检查器——那会重复本仓已经付过学费的膨胀。

**同形先例（说明这是个反复出现的形状，不是孤例）**：
- `meta-driver.ts` 的 `interpretations` 曾只写条数、丢弃 20 条解读正文（2026-09-06 已修）；
- `evidenceRestored` 只写数字而 `kept/skipped` 写清单。
- probe 规格自己的原话：「an observation that only gets printed is indistinguishable from one that was never made」——而本条比它更彻底：**连打印都只到 stderr，没有任何持久载体**。

## AC

- [ ] `STATIC_CHECK_NOT_EVALUATED: <name>` 被 `full-suite-runner.ts` 解析并写入 `full-suite-state.json`（字段与 `failedCheckers` 并列，例如 `notEvaluatedCheckers: [{name}]`）。判据：构造一个 stderr 含该行的输入喂给解析路径，断言该字段非空；⛔ 判据须走解析函数本身，不得 grep 源码。
- [ ] 能取假：同一判据在**不含**该行时，`notEvaluatedCheckers` 必须为空数组（⛔ 不是 undefined——「本轮没有未评估项」与「本轮没记录这个维度」必须可区分）。
- [ ] `failedCheckers` 的既有行为不变：`plugin/test/full-suite-runner.test.mjs` 全绿，且其中关于 `STATIC_CHECK_FAILED` 的既有断言未被放宽。
- [ ] meta-driver 读得到：`collectReadings` 增一项 `inertCheckers`（**逐条枚举 name，⛔ 不是计数**——SPEC §5.3「原始工具输出的裸标量不得单独 gate 流水线；不枚举环/不给文件/不给修法，零指引价值」），并进 `readingsDigest`（否则新出现的惰性守卫不改变摘要 ⇒ 语义半永不被唤醒）。判据：喂一个含 `notEvaluatedCheckers` 的 state 文件，断言读数里逐条出现。

## DoD

- [ ] 上述判据本轮实跑并贴出输出，⛔ 不是转述。
- [ ] 用真实数据验证一次：当前 `direct-to-develop-bypass-check` 若以 exit 3 收场（见 `gap-bypass-check-unclassifiable-exits-zero`），它必须出现在 `notEvaluatedCheckers` 里并被 meta-driver 读到。若那条任务尚未落地，则以构造输入验证，并在任务体写明这一依赖。
- [ ] ⛔ 未新建 driver、⛔ 未新建周期性检查器——本条只是把一个已经产生的信号写下来并让既有消费者读到。
- [ ] 惰性守卫这一类从此**可被发现**：说得出「今天有几个检查器读不懂输入、分别是哪些」，且该答案来自载体而非临时 grep。

## Touches

- `plugin/scripts/full-suite-runner.ts`
- `plugin/scripts/meta-driver.ts`
- `plugin/test/full-suite-runner.test.mjs`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-not-evaluated-checkers-never-persisted.md`
