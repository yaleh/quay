---
id: gap-carrier-registry-declaration-with-unregistered-red-check
title: 载体注册表（仅声明）：.quay/* 持久载体名 → 声明所有者/种类，漏登记即红——让「谁写谁读」从词法猜测变成可核对的声明
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

背景（实测 2026-10-03，词法扫描 396 个非测试 .ts）：仓库里出现 84 个持久载体名（*.jsonl，以及 *-control/state/desired/takeover.json、anchor.json、server.json、full-suite-state.json 这几类 .json）。进程之间没有 RPC，耦合全经这些文件，静态 import 图看不见它们。只有 14 个在 plugin/scripts/driver-runtime.ts 的 DRIVER_KINDS 里有声明所有者（且其中 4 个的所有者源码里根本不出现该字面量，路径经 registry/argv 传入）；其余 70 个没有任何声明式所有者；26 个载体有 ≥2 个「可写方候选」（只是上界：非注释代码提到该载体且文件内有任一写 API，不代表真写）。结果是「谁写谁读」只能靠词法猜，架构不可观测。（注：初版读数 83 / 69 / 24 偏低，原因是扫描器的注释剥离用了朴素正则，被字符串里的 `/*` 与后面的 `*/` 错配，吞掉了其间的真实代码；已改用词法状态机重测得 84 / 70 / 26。DRIVER_KINDS 声明的 14 个不变。）

<!-- dedup-ref -->
相关但机制不同：DRIVER_KINDS.carriers 是 6 个 driver 的局部声明；goal-025 的 import-graph 仪器只看 import 边。本任务做**全局、仅声明**的注册表，**不改任何写者/读者行为**（零行为风险，先让结构可被机器读出）。

做法：
1. 新增 `docs/carrier-registry.json`：每个载体一条 `{name, kind: "jsonl-log"|"state-json"|"control-json"|"lock"|"other", owner: <声明写者模块的仓库相对路径> | "unowned-yet", readers: "unaudited"}`。DRIVER_KINDS 已声明的 14 个，owner 取其 driver 文件；其余先填 `unowned-yet`（诚实的「未评估」取值，**不得**伪造所有者；`unowned-yet` 与已声明所有者必须是不同取值，硬规则 3b）。
2. 新增测试 `plugin/test/carrier-registry-completeness.test.mjs`：按**位置**扫描 packages/*/src 与 plugin/scripts 下全部非测试 .ts（先抹掉注释，注释里提到不算命中——硬规则 2），用与下面相同的名字谓词抽取载体字面量，断言「出现在代码里的载体名集合 ⊆ 注册表」（漏登记即红，报出缺失名与首个出现位置），并断言注册表里没有「代码里已不出现」的陈旧条目（陈旧也红）。名字谓词：字符串/模板字面量内形如 `x.jsonl`、`x-control.json`、`x-state.json`、`x-desired.json`、`x-takeover.json`，以及固定名 anchor.json、server.json、full-suite-state.json、worker-dispatch.json。
3. 测试必须对一个**已知为真的样本**干跑一次（如 worker-outcome.jsonl 必须被抽到），样本不命中则整个测试报「谓词失效」而不是通过（硬规则 2 零计数配套动作）。

⛔ 不改任何 plugin/scripts/*.ts 或 packages/*/src 源码；不新增 plugin/scripts/*.ts（避免触发 capability-catalog 等多表登记）。注册表是数据文件 + 一个测试。

## AC

- [ ] 注册表覆盖当前全部载体：`scripts/test.sh plugin/test/carrier-registry-completeness.test.mjs` exit 0（意味着「代码里的载体名 ⊆ 注册表」且「无陈旧条目」）
- [ ] 漏登记即红（负对照）：把 docs/carrier-registry.json 临时删掉任一条目（先 cp 备份），重跑上条命令必须 exit 非 0 且输出里含被删的载体名；还原后 exit 0；两次 exit 码进 Evidence（⛔ 不用 git checkout 还原）
- [ ] 谓词对真样本命中：测试内含一条对 `worker-outcome.jsonl` 的「必须被抽到」断言；临时把名字谓词改坏（cp 备份）重跑必须 exit 非 0 且报「谓词失效」类原因，而不是通过
- [ ] 已声明所有者的 14 个载体与 DRIVER_KINDS 一致：测试从 plugin/scripts/driver-runtime.ts 的 DRIVER_KINDS 读出每个 kind 的 carriers+controlFile，断言注册表里对应条目的 owner 等于该 kind 的 driver 文件（不一致即红）
- [ ] `unowned-yet` 数量被读出并记录而不是被隐藏：`node -e` 一行统计 docs/carrier-registry.json 中 owner=="unowned-yet" 的条数，贴进 Evidence（不设阈值——此前从未测量，先出读数；若后续要设棘轮另立任务）

## DoD

真实落地 = 注册表进入 develop，且完整性测试进入 scripts/test.sh 常规套件：此后任何新增载体字面量而未登记的提交，在 fan-in 的 suite 里变红。Evidence 贴出负对照的两次 exit 码与 unowned-yet 的实测条数。只加数据文件与测试，生产源码零改动，所以不改变任何运行时行为。

## Touches

- tasks/gap-carrier-registry-declaration-with-unregistered-red-check.md
- docs/carrier-registry.json (new)
- plugin/test/carrier-registry-completeness.test.mjs (new)
