# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **本文件是唯一每会话自动注入的文档 —— 它的行数是本仓库最稀缺的资源。**
> 因此只放两类东西：**① 指向正本的指针；② 不随代码演化过期的纪律。**
> 任何清单、命令块、参数表都属于它们各自的正本，**在这里复制一份就是制造漂移**
> （一条被复制的过时做法在常驻文件里存活三天、诱导 339 次绕过而无任何检查发现
> → `casebook#why-no-copy`）。

## 每轮必经（只放指针，清单在正本里）

| 要做什么 | 正本（**不要在本文件复制其内容**） |
|---|---|
| 有哪些机件、各自回答什么问题 | `bash plugin/scripts/capability-catalog.sh`（**唯一清单**；声明数看它自报——`summary: N scripts`，不要硬记数字，会随脚本增删漂移） |
| 驱动/投递到别的 Claude 会话 | **默认：`ListAgents` → `SendMessage`**（人 2026-08-12 裁定；需 Claude Code 2.1.224 或更新）。到达形态 `<cross-session-message from=… from-name=… from-mode=…>`，**身份由平台标注而非发送方自称**；平台强制 peer 不能代替人许可/改配置/**执行斜杠命令**。**旧机件保留可用但非默认路径**（人 2026-08-12「还保留原实现和测试,但尽量减少对其使用」）：`supervisor-deliver.sh` / `send-keys-reliable.sh` / `drive-target-check.sh` / `transcript-delivery-check.ts`。**保留的两个不可替代用途**：①**控制面**——`/clear` 等斜杠命令原生通道办不到,只能走 tmux 输入；②**下游交付面**——Claude Code <2.1.224 / Bedrock·AWS·GCP·Foundry / native Windows。**手工拼 tmux send-keys 仍禁止。**（完整裁定链 + 收件箱退役 → `casebook#sendmessage-ruling-chain`） |
| 三层每轮该做什么 | `orchestration/{manager,orchestrator,fast-mode}-tick-core.md`（执行路径；**强制判据是 `tick-core-static-check.ts` 的 (src:N) 覆盖率=100%，不是行数**；「各 ≤80 行」判据退役 → `orchestration/archive/AC58-retired-clauses.md#R17`）。**⚠️ 读这三份正本前先查角色状态：inner(fast-mode) 已退役（由 worker-driver 取代）；outer 作为独立会话角色亦已退役**（2026-09-04，职能并入 manager 直接 subagent 派发，`orchestration/SPEC-tmux-retirement-2026-09-03.md §8`）——**不要照单全收文件自己的横幅**。 |
| 判准 / 收尾 / 发消息形态 | `orchestration/manager-tick-{criteria,closing,sending}.md`（**停调 workflow 19 小时 ⇒ 这些全部缺席 ⇒ 8 条违规**） |
| pane 状态 | `plugin/scripts/pane-state-classify.ts`（底部区域 + 枚举态，**不是整屏哈希**）。**⚠️ 它是【被 import 的判定库】，不是每轮直接调的命令**——真实消费者是 C 类投递 fallback 链与 `inner-blocked-signal.ts`（`session-liveness.sh` 已退役）。**manager 直接调用那一条（旧 A4）已于 2026-08-14 退役** → `orchestration/archive/AC58-retired-clauses.md#R28`。**pane 忙闲是代理量**：pane 进程存在 ≠ 会话在处理；**判层活性的正本是直接量**（`git log` 提交时刻 / worktree 内活进程）。 |
| **诊断「空槽 + 池里有货 + 就是不派」** | **先查 subagent 预算,不要先怀疑机制** —— harness 有**会话级累计** spawn 上限，触顶后**静默降级为主线程串行**，三层执行核都不写它。识别：目标会话 transcript 里搜 `Subagent spawn limit reached`；实测燃烧率 ~60 次/天 ⇒ 默认额度约 **3 天**寿命。数值、环境变量名、两个易混旋钮（会话累计 vs 并发）——**正本在 `tasks/gap-inner-subagent-budget-invisible.md`，不在此处复制**。**第二种成因**：inner 长时间占用回合做【主线程编辑】，同样表现为空槽+有货+不派而预算正常 ⇒ **识别靠查 slot-refill 调用间隔**，不是查预算。（误诊代价 → `casebook#empty-slot`） |

## 认识论硬规则（不随代码过期；标注了各自靠什么保证）

> 每条 = **规则 + 一句 why + 产物/检查器 + 事故档案锚点**。日期、实例、代价、复盘在
> `docs/epistemology-casebook.md`（锚点与之同名），**不在此处常驻**。规则编号一律保留、不复用。
> 下面出现的锚点形如「casebook」+「#」+节标题（例：`casebook#rule-1`），指向该文件的 `## <节标题>` 节。

1. **用机件，不手搓**——动作前先查 catalog 有没有同类工具。〔产物：投递工具名进记录 / `A16` 按位置计数〕
   **最高频的一个实例，单列**：**任何「查会话历史 / 读 transcript / 统计 agent 用量」都先用 `meta-cc` MCP，不要手搓 `python`/`grep` 解析 `*.jsonl`。**
   **为什么单列而不靠上一句涵盖**：上一句是通则，而通则在动手那一刻不会浮现；这条此前只写在管理者自己的核（C15，且窄——只禁 `capture-pane` 回滚）与台账里，**不在唯一会被自动注入的本文件中** ⇒ 每次都要靠当场想起来。〔**无产物，靠自觉**〕
   **⚠️ `meta-cc` 返回空 ≠ 没有数据**（硬规则 5）：`query_session_content` **只读【主会话 jsonl】**——**直属 `subagents/` 与 `workflows/` 都不递归**；`include_subagents` 参数**存在、默认 true、但不生效**，参数名会让人以为它管用（同 3b）。
   **正确做法（三步，缺一不可）**：① `grep -rl '<针>' ~/.claude/projects/<hash>/`（**范围必须覆盖两层**：主会话 + 直属 `subagents/` + `workflows/`）；② `meta-cc inspect_session_files --files <显式路径>` 取元数据；③ `grep -r` 搜内容（meta-cc 无此能力）。
   ⇒ **别用「总 token」判贵贱，要拆出 `cache_read` 再谈**（轮次数才是成本驱动量）。→ `casebook#rule-1`
2. **按位置判定，不按关键词**——注释、字符串、消息正文里提到不算命中。〔产物：复用 `drive-contract-check.ts` / `test-framework-policy-check.ts` 的判定手法〕
   **给临时 `grep`/`wc -l` 补的产物（动作，不是提醒）：引用一个计数之前，先打印它匹配到的前 3 条实际内容。**
   **零计数的配套动作是另一半：把谓词对着一个【已知为真】的样本干跑一次。**
   **两半是同一条纪律：非零查「命中的是不是我要的」，零查「谓词对真样本命不命中」；只做一半就只防一个方向。** → `casebook#rule-2`
3. **枚举，不布尔**——布尔化的存在性检查会把「对象没了」伪装成「检查失败」。〔产物：判准③ 要求写出条数与清单〕
   **3b（镜像半边）：判定机件在【读不懂输入】时，不得返回与【合格】同形的值**——「读不懂 ⇒ 伪装成检查通过」比上半条更危险。
   **共同修法**：**给"无法评估"一个独立取值**（`sectionFound:false` / `NOT-EVALUATED` + `evaluated:false`），不与"合格"共用输出。**不是一律 fail-closed**——"说实话"零代价（`exit 0` 但取值可区分），fail-closed 留到该判据真正具备输入之后。
   **判据：一个判定的输出词表里，若没有"未评估"这一态，它就无法区分"查过且合格"与"没查成"。**
   〔**无产物，靠自觉**；发生率已 3，若再现 ≥2 次则应造检测器〕→ `casebook#rule-3`
4. **一个结构上不可能取假的量，不是测量**——恒等式、自证、回显都属此类。〔**无产物，靠自觉**〕
   **推论：成本结构未知前不要设数值阈值**（为一个从未被测量的量设目标同理）——**先分解成本，再谈指标**；端到端耗时若依赖外生变量 N，它不是指标，只能当同 N 下的前后对照基线。
   **推论二：「在本机等价于无限制」的字面值，不是无限制**——它是一个依赖宿主的常量，换台机器就变成真限制，且静默。**要表达「不限制」，就在机制上不设那个限制**——`nproc`/`availableParallelism()` 这类**读宿主**的表达式可以，字面值不行。同族：任何写死的 `MemoryMax`/`TasksMax`/并发数/超时秒数。
   **推论二的检测半边〔有产物〕**：**按 comm 精确匹配的计数为零、而按 cmdline 匹配的计数非零 ⇒ 报【仪器故障】，不是报「机器空闲」。** 该自检不需要知道正确字面量是什么 ⇒ 换机换版本继续有效。一般形态：**恒零/恒真的读数携带零信息，且与「一切正常」同形。**
   **推论三：一个只能被 fixture / 注入数据满足的判据，不是测量**——它证明「能产出」，不证明「已产出」。**〔产物〕任何以「产出某读数」为目标的任务，AC 必须至少有一条【读生产载体】**（形如「载体中满足 X 的记录数 ≥ N」，**且 N 只计【实现落地之后】的时间窗**）。**⊢ 反例判据(一条命令可查)**：若一条 AC 在把 fixture/注入 seam 关掉后仍能通过，它才是测量；否则它只是回声。**与 C29 的分工**：C29 = 执行了、报了、但没留痕；本条 = 实现了、测试绿了、但生产没跑过。
   **推论四：一个能【解释】现象的说法，不是一个被【检验】的结论。** **⇒ 判据（动作）**：任何「我认为 X 是因为 Y」的结论投递前，**必须附一个若 Y 为假则结果会不同的对照**；给不出 ⇒ **降为假说，不得作为结论投递**（与硬规则 12 同形，换了一个维度）。→ `casebook#rule-4`
4b. **代理量会与实际偏离——优先观测直接量，不要叠加未经测试的过滤/派生**（人 2026-08-13 逐字裁定）。〔**无产物，靠自觉**〕
   **与 4 的分工**：4 管「结构上不可能取假」的量；**本条管「本来能取假、但因为中间隔了一层未经验证的过滤而不再反映实际」的量**。
   **操作含义**：判「某层是否在干活」用 **git 提交时间戳 / `git worktree list` / `/proc/<pid>/cwd`** 这类**外部可核**的量，**不要用它自己写的心跳、自己维护的在飞集合、自己解析出的计数**——后者在它停摆时恰好也停止更新，**与「一切正常」同形**。
   **最省事的自检**：一个量若由被测对象自己产生，它就不能用来判断被测对象是否活着（循环论证）。→ `casebook#rule-4b`
4c. **写判据时：那个量必须【穿过所有中间层】还取得到**（4b 的**撰写侧**镜像半边，2026-08-23 立）。
   〔**产物**：判据落笔前，把「从量的产生处到读取处」之间的每一层列出来，逐层问「它会不会改写/抹掉这个量」；列不出这条链 ⇒ 判据还没写完〕
   **⊢ 与 4b 的分工**：4b 管**观测时**（别用代理量看系统）；本条管**撰写时**（判据点名的量，到验收那一刻还在不在）。
   **⊢ 两种失败形态都要认**：**恒假**（正确实现被判失败）与**空转**（判据恒真但什么也没验到）——后者更危险，因为它**与「验过了」同形**（同硬规则 3b）。
   ⇒ **判据若声称「与 X 一致」或「某字段应为 Y」，落笔当轮就要取一次真实读数**；取不出可比形态 ⇒ 判据没写对。→ `casebook#rule-4c`
5. **来源完备性**：在某来源搜不到 X，只有当该来源对 X 完备时才等于「X 不存在」。〔**一般情形无产物，靠自觉**〕
   **最危险的实例是批量删除，它有产物**：每次删文档 ≥50 行前，必须先产出**落点映射**——被删内容的**每一个**独有词条 → 它的新正本路径，并把该映射贴进删除提交。
   **验证的是「全部有家」不是「抽查几个有家」**。→ `casebook#rule-5`
5b. **在某处修好 X ≠ X 只在那一处**（5 的镜像半边）。
   〔**产物**：修完一个实例后，**在同一载体里 grep 该原则的其它适用点，把命中数与前 3 条贴进提交**；写不出这个数 ⇒ 视为只修了被报出来的那一个〕
   **⊢ 共同形态**：修的人只盯着被报出来的那一个，**而缺陷是成簇的、且兄弟实例常在同一文件甚至同一行**。→ `casebook#rule-5b`
6. **缺值 = 未查**，不是「为假」。〔产物：判定入口校验，缺键即拒出结论〕
7. **要求记录某动作，就不能把该动作排在记录之后**。〔产物：收尾顺序=先清扫后写日志〕
8. **编号/命名不得复用**——否则缺席被伪装成在场。〔产物：`甲乙丙丁戊` 与判准 `①-⑤` 分离〕
9. **可见性 ≠ 执行**：一条规则若「守」与「不守」在记录上无法区分，它就只能靠意志——**该给它造产物，不是把它写得更醒目**。
10. **延迟 MCP 工具必须先 `ToolSearch` 取 schema 再调**（`select:<name>` 或关键词；确认真返回了 schema 才调）。
    未取先调必 `InputValidationError`；`ToolSearch` 对预期存在的名字返回零结果**是真故障信号**（被改名/被删/skill 引用过期），**不要盲目重试**。
    适用本仓库全部 quay/meta-cc/archguard/playwright MCP 工具。〔**无产物，靠自觉**〕
11. **`git add` 与 `git commit` 之间不许有等待**——三层共用一个检出，**索引是跨层共享的可变状态，不是谁的私有暂存**。
    提交被 `precommit-guard` 挡住（轮在跑）时，**立刻 `git reset`**（只取消暂存，改动全留工作树），窗口开了再一次性 `add && commit`。
    〔产物：本轮若 `git diff --cached` 非空而未提交，即违规——一条命令可查〕
    **11b 同源，换对象：工作树本身就是生产输入。** 派发计算（`ready-pool-check` 等）读的是**盘上的 `tasks/*.md`，不是 git** ⇒ **谁改了盘上的任务体，谁就【立即】改变了另外两层的派发计算——不需要提交，也没有任何守卫拦。**
    ⇒ **危险是它的镜像形态：「已生效而未记录」**——未提交的改动正在影响生产，而对任何读 git 的人不可见；**一次 `git checkout -- tasks/` 或"清理工作树"就会静默回退它，且 git 历史里没有任何痕迹。**
    〔无独立产物；靠 11 的 `git diff --cached` 与「改了盘上任务体就当场提交」共同覆盖〕→ `casebook#rule-11`
12. **要求一个新前置/新机制之前，先给出它【已经发生过几次】——给不出就降为观察项，不作阻塞。**
    〔产物：任何「必须先 X 才能 Y」的投递必须带 X 的**实际发生率读数**；无该读数的前置一律记为观察项，不得阻塞〕
    **一般形态：每个前置单看都成立，合起来就是「永远差最后一步」。**
    **这与硬规则 4 推论同源，但方向不同**：那条禁的是"凭空设阈值"，本条禁的是**"凭空设前置"**——前者让判据不可信，**后者让目标不可达**。
    **12b：「已经发生过几次」默认查历史，不是等下一轮。** 能查历史（会话记录、git log、任务/文档存量）就必须先查历史；**只有历史数据结构上不可得（全新场景、此前无载体记录）时，才退回"观察下一轮"**。「等下一轮」是后备取证法，不是默认动作。
    → `casebook#rule-12`

## What this repo is

`quay` is a **provider-agnostic task board**: a small **Core** CLI/MCP client + a pluggable
**Provider ABI** for where tasks actually live. This same repo is ALSO the live workspace of a BAIME
(Bootstrapped AI Methodology Engineering) research experiment where quay's own backlog is driven by
an autonomous loop under `experiments/`. Both layers coexist — the `packages/` code is the product;
`experiments/` + `tasks/` + `docs/proposals/` are the methodology/research layer.

## Commands

无 `package.json` scripts、无构建步骤（纯 ESM，Node ≥20；开发机 Node 25）。根目录 `npm install`（npm workspaces, `packages/*`）。

- **跑 CLI**：`node packages/quay/bin/quay.js <cmd>`（版本探测入口，源码路径需 Node ≥22.6）；
  provider 直连：`node --experimental-strip-types packages/quay-native/bin/quay-native.ts <cmd>`
- **跑测试**：`scripts/test.sh`（唯一入口，ADR-019/DIR-109）。**它的头注释 120 行是唯一正本**——
  glob、三条泳道（main/serial/lowconc）、并发推导与预算、`--for-task` scoped 静态检查分层、
  `--test-concurrency=` 的 `=` 写法、`QUAY_TEST_LIVE_GITHUB`、`@test-group`/`@static-tier` 标注，
  **全部读脚本，不要在此处复制一份**（本节曾复制 144 行，占本文件 49%，正是漂移之源）。
- **Web UI**：`node --experimental-strip-types packages/quay/bin/quay.ts serve --host <ip> --port <p>`
  - **开发模式**：`node --watch --experimental-strip-types packages/quay/bin/quay.ts serve --host <ip> --port <p>`
    —— Node ≥18 `--watch` 对 import 模块变更自动重启进程（改 `packages/quay/src` 立即生效），
    **不新增 `--dev`/`--watch` CLI 入口**（`node --watch <既有入口>` 直接可用，零产品表层；人 2026-08-24 裁定）。
- **两条没有别处正本、故留在此**：①测试要用真 `.quay/config.yml` 建临时 workspace（见某测试文件里的
  `makeWorkspace()`）——**裸 tasks 目录不是合法 workspace**，config 是 provider map 不是扁平路径；
  ②**覆盖率不是目标**：从未被测量、可被刷（本仓库自带 `gate-gameability.test.mjs`）、
  且要紧的分支密集决策函数都已有直接 `import` 单测——**若要看覆盖率，它是参考不是指标**。
- **`scripts/test.sh` 覆盖不到的**（正本 `.github/workflows/ci.yml`）：`dist-verify-node-floor`
  （真 npm-pack 产物在 Node 底线上跑）、以及里程碑节奏的浏览器/agent e2e
  （`adr/ADR-010-scheduled-milestone-e2e-incl-browser-tests.md`，status: proposed）。
  **一次绿的 `scripts/test.sh` 不是这两类的证据。**
- **driver 进程管理**（`quay driver <start|stop|drain|status|restart> --kind <promotion|worker>`——
  **`liveness` 只有直调 `plugin/scripts/driver-runtime.ts` 才有**，`quay driver`（`cli/driver.ts:27`
  `VERBS`）未收录，2026-08-24 outer 核实的一个 CLI 表层缺口；正本仍是 kernel `--help`，**不要在此处复制参数表**）：
  `stop`/`restart` 只杀 supervisor+driver 自身，⛔ 不碰 worker kind 的在飞子进程（设计如此，见脚本注释）；
  worker kind 独有 `drain`（挡新派发、不杀在飞，写 `.quay/worker-control.json` `halted:true`）。
  **⛔ 已知缺口状态（2026-08-24 起，读下面两行别读旧结论）**：冷启动 worker 的**假在飞**两个方向
  都已修复——restart 不会重派仍存活的 worker；冷启动 worker 结束后 task 会离开排除集、下一轮重新可派
  （`gap-worker-driver-cold-start-inflight-blind` / `-refresh`，均 done）。**手工 restart 后仍建议核对
  一次** `ps aux | grep quay-task-worker`（按 task 名去重）作为习惯性负控制，但不再是必须的救火步骤。
  **manager 对 driver 生命周期（start/stop/restart）持人 2026-08-24 明确授权的常设控制权**（本项目后期
  开发阶段内），无需逐次请示；执行前仍应做上述现场核实（避免过期判断），执行后仍应做负控制确认。
## Architecture — the product (`packages/`)

Three packages, one ABI:

| Package | Role |
|---|---|
| `packages/quay` | **Core** — provider-agnostic CLI + web UI (`src/serve.ts`) + MCP client/server (`src/mcp-server.ts`). Talks to whichever provider is `enabled` in `.quay/config.yml` over the Provider ABI. |
| `packages/quay-native` | **Native provider** (reference) — a **markdown+YAML-frontmatter task store on local disk** (`tasks/*.md` ARE the data). CLI + MCP server. |
| `packages/quay-github` | **GitHub provider** — maps GitHub Issues onto the same task view-model. Proves the ABI transfers. |

Key cross-cutting facts (require reading several files to see):
- **Core is written against the task view-model only**, never a specific backend. A task = `{id, title, status, role (primitive|compound), labels, parent/children, body}`; the `body` markdown carries `## Proposal / ## Plan / ## Acceptance Criteria / ## Definition of Done` sections. Providers translate to/from this shape.
- **`.quay/config.yml`** (per-workspace) is the provider map: which provider is enabled, its `path`, `tasks_dir`, `mcp_entry`, `env`. `QUAY_NATIVE_TASKS_DIR` selects the native store's directory.
- **Core CLI `task edit` is status-only in v1** (QN-024) for backward compat unless full flags are given — for a body/extra/labels write, prefer MCP `task_write` or the native provider's own richer `quay-native task edit`. (Full-field parity was later added — see `packages/quay/bin/quay.ts` help; when in doubt check which surface you're on.)
- **Task mutation → route to the `quay:quay-task` subagent**（`plugin/agents/quay-task.md`）— the single ABI-only entry point for task CRUD/lifecycle. Its `tools:` allowlist is harness-enforced to the MCP task/lifecycle verbs + `Read`（no `Bash`/`Write`/`Edit`/`Grep`/`Glob`）, so it cannot hand-edit `tasks/*.md` — file/create/edit/promote/complete tasks through it rather than direct `task_write`/`Edit`.
- **Gate engine ("QENG")** — `packages/quay/src/gate/{engine,registry,gate-event-store,gate-log,acceptance-runner,lifecycle,driver}.js`, exposed as verb-less CLI commands `gate` / `gate-log` / `complete` / `adjudicate` / `promote` / `retreat` / `run`. Gates evaluate a named check and append an immutable **GateEvent** to `<workspaceRoot>/.quay/gate-events.jsonl` (gitignored). `quay gate <task>` defaults to the `acceptance` gate (runs `task.extra.acceptance` as a shell command, fail-closed if unset); lifecycle transitions live in `lifecycle.ts` (`todo→ready→done`, terminal `needs-human`). "The meter is runnable, not asserted."
- **Author→ready promotion gate is SHAPE-AWARE — the unified task-shape judgment across projects (gap-todo-shape-mismatch-author-gate, 2026-08-09).** The todo→ready gate (`ready-pool-check.ts`'s `artifactsComplete`) does NOT require a literal `## Contract` on every task:
  it dispatches on the task body's registered shape (contract → finding → plan), and a task is four-artifacts-complete when its OWN shape's sections are present and, at each author→ready gate evaluation (每轮判定时), ≥40 non-whitespace chars.
  A `contract`-shape task uses `## Contract` as its plan artifact; a `finding`-shape task uses `## Finding` and has NO plan dimension; a `plan`-shape task uses `## Plan`. Unknown shape fails closed.
  Since 2026-08-09 the `finding` shape ALSO recognizes the draft-heading AC/DoD variants (`## AC（draft）` / `## DoD（draft）`, and their half-width-paren forms) — a `（draft）` suffix is a heading-label convention, not an absent section.
  **This is the single judge quay and meta-cc must share**: a todo that carries its shape's four artifacts IS author→ready-eligible even without a `## Contract` heading, and a task whose artifacts are genuinely missing must be completed (or its shape recognized) rather than having a fabricated Contract pasted on. A task-shape-vs-gate mismatch (todos that look complete but carry an unrecognized shape/heading form) is a MECHANISM defect to fix in the gate or the task's shape — not a pool-number problem to paper over by promoting regardless of artifacts.

## Architecture — the methodology layer (`experiments/`, `tasks/`, `docs/`)

- **RETIRED (ADR-022, 2026-08-03): classic milestone loop → `orchestration/archive/AC58-retired-clauses.md#R18`.** The **two-layer fast mode is the sole development mode**（fast-mode telemetry under `milestones/fast-mode-telemetry/<date>.json`；`## Contract` 六键 + `task-contract-check.ts` 取代 ProposalReview/PlanCheck，subagent REFUTE 轮取代 Audit phase；`OUTER-LOOP.md` 曾是经典循环驱动文档，见 `experiments/quay-perpetual-stream/`）
- **`experiments/quay-perpetual-stream/`** is the active BAIME experiment (exp5): an autonomous outer loop that builds quay one milestone at a time. `inherited-core.md` is the pinned methodology; `dashboard.md` is mutable outer state; `scripts/it0-*.{sh,mjs}` are the mechanical gates (notably `it0-dod-check.sh` — the **DoD meta-enforcer**, Clauses 0-9, fixture-pinned by `dod-fixture-selfcheck.sh`).
- **Two-layer per-task worktree isolation（取代 RETIRED classic-loop 工作树机制，后者历史细节 → `orchestration/archive/AC58-retired-clauses.md#R19`）**: 两层模式用 plain `git worktree add` 按任务直接隔离（无 `milestone-worktree.ts`）。**path 约定 `/home/yale/work/quay-worktrees/<task-id>`，不在 `/tmp`**（`/tmp` 会被系统清理、且本机已实测积压 3389 个测试遗留目录/1.1G）。
  **🔴 在飞任务数的读法（2026-08-16 更正，原写作「唯一正确读法」而它在两个方向上都高估）**：`git worktree list | grep -c quay-worktrees` **①把非任务 worktree（`verify-round-<ts>-<hash>`）也数进去**（实测裸 `grep -c` 得 4 而真实任务 worktree = 3；`slot-refill` 自己是过滤掉它的）**②把死任务算成产能**（worktree 存在 ≠ 有人在干活）。
  **⇒ 它测的是【占着锁的 worktree 数】，这个量本身是对的、且判「该不该再派」时正是要它。⛔ 但不要用它回答「有几个任务在干活」——那要配一个活性直接量**（worktree 末次提交时刻 / 该路径下活进程数）。**⊢ 同硬规则 4b：worktree 数是代理量，`git log` 时刻与活进程是直接量。**
- **`prepare-milestone.js` worktree-isolation 支持（已随 ADR-022 退役）→ `orchestration/archive/AC58-retired-clauses.md#R20`**（文件已删，机制细节与理由档案见归档）
- **暂停/恢复（driver control-state）**：晋升/执行暂停已迁 driver control-state（`.quay/worker-control.json` / `.quay/promotion-control.json`, `driver-shared.ts` `isHalted`；旧 `.halt` 哨兵的 promotion/execution 角色已退役 2026-08-29, `gap-retire-halt-file-driver-based`——**manager 层跨项目 `.halt` 停泊态观察仍活**，归 `manager-tick-readings.ts`）。**编辑时仍遵循 DIR-027 人导卫生：在私有 worktree off `master` 工作，clean window 快进——不 race the loop on `master`。** `quay driver resume` 前跑 `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh`（manual，非 CI/loop-wired）——git 树安全 go/no-go（clean tree / 无 mid-flight merge / master 无 stray worktree）。
- **Directives are TASK-CANONICAL** (DIR-028 / "Plan A", the single-source-of-truth principle): a directive is a `label:directive` quay task (`tasks/DIR-NNN.md`) and nothing else — there is no `directives/*.md` file, no projection, no anti-drift check (all retired). Create/steer via the `quay-directive` skill. Milestone candidates are `label:milestone-candidate` tasks; `backlog.md`/`dashboard.md` are **generated views** of the task store, not hand-edited sources.
- Recurring design principle enforced across this repo (see `docs/proposals/exp5-crystallization-strategy.md`): **single source of truth + executable invariants over prose.** When you find content living in two places (a file + a task copy; a charter copying a task's AC/DoD; a status in a field AND a body line), that is drift — fix the SOURCE (usually a doc/skill/template that generated it), not just the artifact.
- **单任务派发记录接口 = `plugin/scripts/dispatch-record.ts --add --task-id <id> --reason "<一句为什么选它>"`**（fail-closed：理由<8 非空白字符 exit 1 不写不派；指纹自动 `git hash-object`，算不出写 null 由 `dispatch-record-fingerprint-reason-check` 报红；正本 `fast-mode-tick-core.md` A16b）。**派发(机械)=内层（`fast-mode-tick-core.md:83`）——外层/非-inner 不手搓 Python 写 `orchestration/dispatch-record.jsonl`**（2026-08-20 外层 B9 手搓三键 `{ts,taskId,reason}` 漏指纹，已删；inner A16b 已记同一次派发，勿扩豁免名单）。同款先例：manager 语义派发 `semantic-face-dispatch-record.ts --add --kind <八类> --reason "..."`（`manager-tick-core.md` C30/AC145）。

## Reference docs

- `README.md` — install/usage + the three-package overview.
- `packages/quay/DESIGN.md`, `docs/proposals/quay-proposal.md` — Core architecture + Provider ABI rationale.
- `docs/proposals/exp5-crystallization-strategy.md` — the current "molten prose → executable single-source" direction (canonical task schema, formalized prompt-doc style).
- `docs/epistemology-casebook.md` — 认识论硬规则的事故档案（日期/实例/代价/复盘），以及本轮 P1 上下文瘦身迁出内容的存档。
- `adr/ADR-*.md` — first-class decision records (`quay-native adr list`). ADR-004..010 (status: proposed) crystallize the GIT-lens program; read them before extending it.
- `docs/references/` — the GIT framework (goal-closure `L_T..L_S`, 硬形变/Π_{S→E}, two-phase breathing) AND its limits: the continuous math (Fisher/natural-gradient/intrinsic-dim/ρ) is NOT rigor (ADR-006).
- `docs/references/task-schema-canonical.md` — canonical task frontmatter schema (readable view of `plugin/scripts/task-schema.ts`): `depends_on` top-level vs legacy `extra: { depends_on: [...] }`, and `task_write` usage.
- `docs/references/quay-as-self-improving-engineering-system.md` — Quay 的长期身份（Builder/Subject/Validator 三位一体）+ GOAL-030~035 可追踪案例索引 + 分级的 as-is/future 评价指标；与 `docs/references/harness-semantic-compression-and-meta-driver-builder.md` 互补、互相引用，读前者不代替读后者。
- **Split-decision 路由表** → 正本 `tasks/gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode.md`。**STATUS: reference/manual，非生效机制**——`checkSplitRecommendation` 零非测试调用者，没有任何 fast-mode 派发或任务撰写路径调它。**别把它当生效的机制用。**（完整存档 → `casebook#moved-split-decision-status`）

## Tools

- **archguard** (MCP) — static architecture analysis: the `L_D`/`L_G` instrument (dependency structure/cycles, god-packages, duplicated/reinvented abstractions) per ADR-007. Consult it before calling a milestone done.
- **meta-cc** (MCP) — search Claude Code session history (past errors, edit sequences, work patterns).
- BOTH are maintained by the repo owner, so bugs get fixed fast — use them aggressively and report/fix issues rather than working around them.
- **tmux remote-drive**（→ ADR-016，**降为非默认路径，人 2026-08-12「尽量减少对其使用」**）— 驱动别的工作区的 Claude 会话**默认用 `ListAgents` + `SendMessage`**。**tmux 输入路径保留，因为它是【控制面】的唯一通道**——`/clear` 这类斜杠命令 SendMessage 不执行。**ADR-016 全部约束继续有效**：**永不解析 TUI**（结果一律从文件系统/`git`/meta-cc 读）；**禁手工拼 send-keys**；屏幕使用只限底部区域 + 枚举态、禁整屏哈希（`adr016-screen-use-check.ts` 强制）。`pane-state-classify.ts` 的屏幕使用限制**对仍存在的 pane 观测用途继续有效**——它不是消息通道。

**跨会话驱动/状态读取的四条硬规则**（机件清单只存在于 `bash plugin/scripts/capability-catalog.sh`，任何地方不得复制——catalog 头注释钉死「The field lives IN A SCRIPT, never in the README」）：
1. 驱动/投递到别的 Claude 会话：**默认 `ListAgents` → `SendMessage`**（同「每轮必经」表第一行；完整裁定链 → `casebook#sendmessage-ruling-chain`）。
2. ~~收件箱~~：**机制已删除**（人 2026-08-20 裁定范围A）→ `orchestration/archive/AC58-retired-clauses.md#R35`。其教训已一般化为**硬规则 5**（来源完备性），不再需要专门条目。
3. pane 状态：`pane-state-classify.ts`，不是整屏哈希（ADR-016 禁）。
4. 驱动文本契约：`drive-contract-check.ts`。

## Process

- Development is driven via **background Claude Code workflows at milestone granularity** (→ ADR-009), with a **scheduled milestone e2e incl. browser tests** (Playwright/chrome-devtools) that keeps `L_T` on the real product surface (→ ADR-010). Follow DIR-027 steering hygiene (private worktree; never race the loop on `master`).
- **后台会话编辑共享检出的正确姿势**：直接 Edit/Write 主检出会被 harness 的 worktree-isolation guard 拦（未 `EnterWorktree` 不可写）。任务体用 `task_write` MCP（Provider ABI 写 `tasks/*.md`）、代码改动进 worktree（`EnterWorktree` 或任务 worktree）。worker（`claude -p`）不撞 guard 是因 cwd 虽主检出、dispatch prompt 强制 file_path 用 worktree 绝对路径。⛔ 不要 Bash/Python 手搓硬插（2026-08-29 实证：Python 锚点插入吞 `/**` 留 orphan 注释）。
- **subagent 会话里没有 `Glob` 工具**（调用报 `Error: No such tool available: Glob`）——文件模式匹配改用 Bash `find`（`find . -name '*.js' -not -path '*/node_modules/*'`）；`find`/`grep`/`ls` 等 Bash 工具在 subagent 里正常可用。（详版已迁出 → `casebook#moved-glob-tool-rule`）
- **Workflow 恢复的两条坑（⛔ 详版已迁出 → `casebook#moved-workflow-resume`）**：
  - 修复落在**工作流脚本自身 prompt 之外**的外部状态上时，**不要** `resumeFromRunId`（缓存只按 (prompt, opts) 键，看不见外部文件变化，会秒回旧失败）；改完外部状态就**从头重跑**。
  - 本会话内该脚本本身可能已变（含 `Workflow({name: …})` 无 `resumeFromRunId` 的情形）⇒ **一律用 `Workflow({scriptPath: "<绝对路径>"})` 派发，不用 `name:`**（`scriptPath` 稳定重读盘上内容）。
- **分支同步（author ↔ develop）**：正本 = `plugin/scripts/driver-filters.ts`（`propagateDocBranchToDevelop` / `commitTaskFile` 调用点）+ `tasks/gap-doc-develop-sync-semantic-conflict-resolution.md`（语义兜底，核心）+ `tasks/gap-main-manager-doc-doc-only-ff-only-tracking.md`（ff-only + guard）。`gap-ff-propagate`（直落 develop 写侧）已按人 2026-08-31 裁定退役。角色与不随代码过期的纪律如下，机制细节读代码。
  - **角色**：`develop` = 权威基线（任务状态唯一正源、worktree 分叉点、fan-in 快进目标）；`author` = doc-only 工作分支（主检出所在），**非权威**。
  - **写面保留 author（人 2026-08-31 裁定，反转此前「任务状态直落 develop」方向）**：状态翻转（立案/todo→ready/needs-human 等）继续落在主检出，develop 靠同步收敛；⛔ 不做 inert 面 ref-level 直落 develop——主检出是自然写面，直落会让主检出读到的状态与 develop 分叉。同步点保留在两个 *-driver 现有处（`ready-pool-check.ts:2522` promotion 翻转 / `driver-filters.ts:301` needs-human 翻转的 `if (committed) propagateDocBranchToDevelop(root)`）。
  - **可靠同步（必须同步成功）**：doc→develop 由 `propagateDocBranchToDevelop` 在每次 driver 翻转提交后触发；propagate 必须返回 boolean + 失败落痕（消除静默失败，硬规则 3b——2026-08-31 分叉直接根因是 `:207` void + catch 全吞）。判据能取假：同步失败留痕 ∧ `git rev-list --count develop..author` 非空 ⇒ 报「未同步」，不静默。
  - **语义兜底（Claude Code，机械失败后）**：ff 非快进 / 冲突 / 周期核对发现遗留分叉时，由 Claude Code 做语义同步——`git diff develop...author` 分叉清单 → develop 权威 wins；任务状态按确定性优先级 `done>needs-human>ready>todo` 对齐（永不交 LLM）；代码/文档/配置 Claude Code 语义合并 → merge 进 author + ref-level ff develop + 事件记录。**第 1 层流程（merge -X theirs + status 对齐 + 双向计数归 0）为模板**；因为允许损失 doc 侧变更，「取 develop」永远是有效解 ⇒ 语义同步必成功、永不卡死。落点 = `tasks/gap-doc-develop-sync-semantic-conflict-resolution.md`。周期核对：`git rev-list --count develop..author` 非空 ⇒ 同步待办 → 机械 → 语义。
  - **纪律（不随代码过期）**：写面在主检出，但**状态/任务文件变更必须以 develop 为终点**——翻转后核 `git show develop:tasks/<id>.md` 可见；同步失败 ⇒ 升级语义兜底，不静默。⛔ **主检出（author）落后 develop 时生产跑的是旧代码**（promotion-driver 常驻从主检出工作树加载）——需定期 `syncDevelopToDoc`（driver-filters.ts，机械 `git merge --ff-only develop` + 分叉 guard，非 ff 报「无法 ff-only 同步」；promotion-driver 每轮启动前调用——gap-main-manager-doc-doc-only-ff-only-tracking AC4）追上（或语义兜底），否则 AC6（晋升读 develop）在生产上不生效（2026-08-30 实证：主检出停 10:40、落后 14 提交；2026-08-31 复现：落后 53 提交）。

## GIT review checklist

- Before calling a milestone done, ask **which of `L_T`/`L_C`/`L_D`/`L_G`/`L_S` is still dark** (ADR-006/007) and prefer **hard checks over prose** (ADR-004 — prose gets paraphrased away). See `docs/references/` for the framework and its limits (the continuous math is not rigor).

## Pre-Edit freshness check (M150, 2026-07-25)

78% of Edit errors are stale `old_string` matches — the file has changed since you last read it, and the string you are trying to replace no longer exists at the expected location.

**Rule:** before calling `Edit` with an `old_string`, re-read the target region of the file with `Read` to confirm the string you intend to replace is still present exactly as you expect. Do not construct `old_string` from memory or from a stale read earlier in the conversation. A fresh read immediately before the edit is the only reliable source of the current file state.
