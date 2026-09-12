---
id: gap-ac250-web-observe-tailscale-progress-record
title: AC-250 没有生产者：载体里没有 ac=GOAL-016-AC-250 记录 —— serve 必须真绑目标机 tailscale0
  IP、由另一台机器发起探测、且两点观察的同一任务状态不相等（⛔ 不判单点渲染）
status: ready
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac247-stalled-project-clean-takeover-record
goal_ac: AC-250
---
## Proposal

**症状（机械可复算，2026-09-12 实测）**：GOAL-016 的 AC-250 要求载体 `.quay/productization-verification.jsonl` 里存在一条 `ac=GOAL-016-AC-250` 记录，且该记录同时满足「绑对地址 ∧ 跨机真可达 ∧ 反映进展」三层。三条读数今天全为零：

```
载体：82 条记录；ac 取值集合 = {AC85, AC86, AC88×18, AC104, AC105, AC106, AC107×4, AC108×2,
  AC118×2, AC119, AC168-marketplace×2, GOAL-009-AC-201×12 / 203×3 / 204×7 / 205×3 / 206×7 /
  207×3 / 232×5 / 238×4 / 239, GOAL-015-AC-234×3}
  ⇒ 含 GOAL-016 的 = 0；逐字取 goals/AC-250-*.md 的判据干跑 ⇒ exit 1（可评估、红）
生产者：七个字段名 bind_host / tailscale0_ip / probe_from_host / observed_status_before /
  observed_status_after / store_status_after / observed_task_id，在【goals/ 之外】零命中
  （`grep -rn '<七名>' . | grep -v node_modules | grep -v '^goals/'` 输出为空）；
  `grep -rn 'tailscale' plugin/` ⇒ 0 命中（仓库里没有任何 tailscale 感知代码）
无人认领：`grep -rn '^goal_ac: AC-250' tasks/*.md` ⇒ 0
```

⚠️ **该计数我第一遍读成 13，是我自己的过滤器 bug**：`grep -v '/goals/'` 匹配不到无前导 `./` 的 `goals/…` 路径 ⇒ 把 goals/ 内的 13 条命中全数留下。打印前 20 条实际命中才暴露（全部在 `goals/` 内）。照实记下——这正是硬规则 2「引用计数前先打印前 3 条实际内容」要挡的假阳性。

**不是「有生产者但没跑」，是步骤缺失 + 机制空缺**：最近的近亲生产者是 AC-234（done，`plugin/scripts/verify-deliver-coldstart.sh:2446` `write_ac234_record()`），它写 `ac="GOAL-015-AC-234"` 记录（载体实证：`{"ac":"GOAL-015-AC-234","host":"orangevps","project_root":"/home/yale/quay-verify-…","tasks_rendered":1,…}`）。但它的形态与 AC-250 **逐条相反**：

- 它 `--host 127.0.0.1`（`:2487`）⇒ `bind_host` 结构上不可能等于 tailscale0 IP（**这同时是一条现成的负控制**）；
- 它**只读一次**页面（单点计数）⇒ 没有 before/after 差分，而 AC-250 正文逐字「⛔ 不判单点渲染」——**该句正是把 AC-234 那种机制排除在外**；
- 它全程在同一台机器内 curl 自己 ⇒ 无 `probe_from_host`，无跨机可达性证据。

⇒ AC-234 的绿**不携带** AC-250 的任何信息，本任务不是它的重复。

**目标态的判据要求（逐字取自 `goals/AC-250-*.md`，⛔ 本任务不改判据文件）**：`host` 非空且 ≠ 本机 ∧ `project_root` realpath ∉ 本仓库 ∧ `bind_host` 非空 == `tailscale0_ip` 且非 `127.`/`0.0.0.0`/`::`/`localhost` ∧ `probe_from_host` 非空且 ≠ `host` ∧ `http_status == 200` ∧ `observed_task_id` 非空 ∧ `observed_status_before`/`observed_status_after` 均非空且**互不相等** ∧ `store_status_after == observed_status_after`；缺 ⇒ exit 1，载体缺失 ⇒ exit 3（NOT-EVALUATED，⛔ 不与合格同形）。

**为什么三层缺一不可（GOAL-016 风险 3 同源陷阱）**：「serve 起来了 / 端口在听 / HTTP 200」三样加起来仍只证明**有个 web 活着**——绑回环时人在别的机器上根本看不到（违背「便于观察」这个目的）；页面上有一行任务 id 不证明它反映的是**目标项目**；单点渲染不证明它跟随**进展**更新。⇒ 判据用三个独立的直接量逐层堵死：**绑定的真实地址**（不是 `--host` 实参，是 `ss -ltnp` 看到的监听地址）== **该机 tailscale0 的真实地址**；**探测由另一台机器发起**（`probe_from_host` = 判读侧自己的 hostname，⛔ 不采信目标机 curl 自己）；**同一任务在两个时刻的状态不相等** 且 与**直接读 store 得到的真值**一致（⛔ 非陈旧缓存）。**第③层是灵魂**：一个只渲染一次的页面、一个缓存过期的页面，都能满足①②而在③上失败。

**与 AC-247 的分工（GOAL-016 逐字）**：AC-247 判 driver 真活（后台执行面），AC-250 判 web 真反映（观察面）；driver 活着而 web 显示不动、或 web 好看而 driver 没活，两条各自独立取假。第③层（反映进展）只能在有真实进展之后才能取到读数。

**今天的结构性取假（2026-09-12 本会话实测，⛔ 非转述）**：

```
判读侧（本机）：hostname=boheidc；本机 tailscale0 = 100.78.206.100 ⇒ 探测侧是一台已有的、独立可达的机器
目标侧（ssh ad-arm1，BatchMode）：hostname=instance-20221019-1509；tailscale0 inet 100.100.148.48
  ss -ltnp | grep 4173           ⇒ NO_LISTENER_4173
  pgrep -af 'quay.*serve'        ⇒ 唯一命中是【这条探测命令自己的 bash -c 行】（pgrep 自匹配陷阱）
                                    ⇒ 真读数 = 0 个 serve 进程
  /home/yale/work/archguard 存在，master @ 14ea9e63
从本机探测：curl --max-time 5 http://100.100.148.48:4173/ ⇒ http=000（无监听）
```

⇒ 本 AC 今天结构上不可能为真，与我方读法无关。

<!-- dedup-ref -->
**与既有任务的关系（仅追溯，不构成任何依赖声明）**：`gap-ac234-web-third-party-renders-carriers-and-round-records`（done）是最近的近亲（web 渲染第三方项目载体 + 写记录），差别见上；`gap-serve-task-list-dies-on-one-malformed-task` 与 `gap-web-cannot-show-what-the-loop-is-doing-now`（均 done）源自 2026-08-03 人令「在 tailscale IP 上起 web server 持续观察」——它们修的是**那个观察面的可用性/信息量**，既没有生产者、也没有差分判据；`gap-ac244-freshness-subject-set-mechanically-derived`（done）里的 tailscale 是**端口碰撞**（tailscaled 占高端口 vs `freePort()` 只探回环），与地址绑定方向相反。以上都不产出本任务要的七个字段。

## Plan

1. **先定读数，再写代码** —— 七个字段各定一个**直接量**来源，全部是运行时读数（⛔ 无字面量、无默认值）：
   - `host` ← 目标机 `hostname`（经 ssh 读）。
   - `tailscale0_ip` ← 目标机 `ip -4 addr show tailscale0` 解出的地址（**推导，⛔ 不硬编码 `100.100.148.48`**——判据正文逐字「推导而非复制副本」）。
   - `bind_host` ← 目标机 `ss -ltnp` 上该 serve 端口的**真实监听地址**（⛔ 不是 `--host` 实参——实参是意图，监听地址是观测值；硬规则 4b）。
   - `probe_from_host` ← **判读侧**自己的 `hostname`（探测必须由非目标机发起）。
   - `http_status` ← 判读侧对 `http://<tailscale0_ip>:<port>/…` 的真实 HTTP 状态码（JSON 数字）。
   - `observed_task_id` / `observed_status_before` / `observed_status_after` ← **判读侧**从取回的真实 HTML 里解析出的任务行（该行渲染的 id 与状态）。
   - `store_status_after` ← **直接读目标 store**（ssh 读 `tasks/<id>.md` 的 `status:` 字段，或 native provider CLI），⛔ 不以页面缓存为准。
2. **两层判读结构（⛔ 不采信目标机自述）**：目标侧（ad-arm1）只提供两件事——读自己的 tailscale0 地址并据此起 `quay serve --host <该地址> --port <p>`（cwd=目标项目根）、以及暴露 store 真值；**探测、页面解析、记录组装都在判读侧（另一台机器）完成**，使 `probe_from_host ≠ host` 成为机制的结构性质，而不是靠自觉。
3. **差分必须是【同一任务的两次读数】（anti-gaming）**：`observed_task_id` 在两点观察中为**同一个 id**，`observed_status_before`/`after` 是该 id 在两个时刻的真实状态。⚠️ 判据只要求 before≠after；若两次读的是**不同任务**的行，会得出一条「状态不同」而**没有观察任何进展**的假记录（不同任务天然不同）⇒ 生产者必须要求同一 id。这是对判据的**加强**，⛔ 不改判据文件。
4. **观察窗口内要有真进展**：等待目标项目里**真实任务**发生状态变化（driver 在跑 ⇒ promotion/worker 翻转），两点读数间隔内确实翻转；状态变化必须由真实驱动产生，⛔ 不许「等两秒再看一眼」式伪差分。取不到 ⇒ **不写记录** + 可区分的 `NOT-EVALUATED`（未测量 ≠ 不合格；硬规则 3b：给「未评估」独立取值，⛔ 不与合格同形）。**⚠️ 同时也要与「查过且未变化」区分**：窗口内观察到状态**相等**是「测量了、没进展」，与「没测成」是两种不同的失败，输出词表必须能区分。
5. **store 交叉核对**：`store_status_after` 必须 == `observed_status_after`；不等（陈旧缓存 / 渲染错行）⇒ 不写记录。这一步堵的正是「页面显示了一个静态快照」那一类。
6. **写入与传输**：写入必须走既有唯一补锚 choke point `ac89_append_goal009`（`plugin/scripts/verify-deliver-coldstart.sh:618`，统一补 `ts`/`build_sha`）——⛔ 不在新写入点再写一份 `build_sha` 字面量（既有注释逐字禁止：多一个补锚点 = 下次改锚格式必漏一处）。新增 `write_ac250_record()` 用自己的 `AC250_*` 变量（⛔ 不借 `AC234_*`/`AC207_*`，否则两条 AC 无法分别 pass/fail）。载体落点 = 判据求值所在的**生产 root** `/home/yale/work/quay/.quay/productization-verification.jsonl`；记录在目标侧组装时经既有 `transport_evidence_append`（`plugin/scripts/develop-deliver-tgz.sh:477`，按 `(ts, ac, host, project_root)` 去重）搬回，在判读侧组装则直接写生产 root 载体。⛔ 不手写/注入记录（GOAL-016 风险 6）。
7. **字段形态 fail-closed（JSON 类型即判据的一部分）**：`http_status` 必须是 JSON 数字（判据 `int(r.get("http_status") or 0) != 200`）；`observed_status_*`/`store_status_after` 必须是非空字符串；`bind_host == tailscale0_ip` 必须字符串相等；缺任一 ⇒ **不写** + `NOT-EVALUATED` + 退出非 0。
8. **负控制（逐条能取假，绝大多数现成）**：a) **绑回环**——直接复用 AC-234 段（`--host 127.0.0.1`）⇒ `bind_host≠tailscale0_ip` ⇒ 零记录；b) **自探**——目标机自己 `curl` 自己（`probe_from_host==host`）⇒ 零记录；c) **无进展**——两点状态相等 ⇒ 零记录 + 可区分的 NOT-EVALUATED，且与「没测成」形态不同；d) **陈旧**——`store_status_after` 与 `observed_status_after` 不等 ⇒ 零记录；e) **读不出**——tailscale0 网卡不在/IP 为空 ⇒ 不写 + NOT-EVALUATED；f) **判据三态**：载体副本删该记录 ⇒ exit 1、移走载体 ⇒ exit 3，与 exit 0 并列留档。
9. **真跑一次（唯一能产出记录的路）**：只能在 ad-arm1 的 `/home/yale/work/archguard` 上起 serve（绑该机 tailscale0）、由本机探测、且窗口内目标项目真实任务状态翻转，才可能产出合格记录。若为此需要在目标项目里新建驱动任务，其正文只给症状 + 复现入口 + 期望行为（GOAL-016 风险 4：写进根因/修法 ⇒ 测到的是「能驱动施工」而非「能驱动开发」）。
10. **夹具与自检**：新步骤要有 hermetic 正/负控制并进套件；正控制直接调**产品函数** `write_ac250_record()`（⛔ 不让夹具复刻判定逻辑，硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。

## Acceptance Criteria

- [x] **AC1 生产者存在且 fail-closed（能取假）**：`grep -c 'GOAL-016-AC-250' plugin/scripts/verify-deliver-coldstart.sh` ≥ 1，且七个字段名在该脚本内各 ≥ 1 命中（**引用计数前先打印前 3 条实际内容**，硬规则 2）；hermetic 自检打印正/负两组读数原文——正控制：七件齐备 ∧ before≠after ∧ store 一致 ⇒ 写出 1 条；负控制：逐个把任一件置为读不出/两点相等/回环绑定/自探 ⇒ **零记录** + 可区分的 NOT-EVALUATED + 退出非 0。
- [x] **AC2 七个字段都是直接量（⛔ 无字面量/默认值）**：grep 证明写入路径上不存在任何字段的硬编码默认值（尤其：不得写死 `100.100.148.48`；`bind_host` 不得写成 `127.0.0.1` 或任何字面量；`probe_from_host` 不得写死）；`bind_host` 取自目标机真实监听地址（`ss -ltnp` 输出原文落档，⛔ 不是 `--host` 实参）；`tailscale0_ip` 取自 `ip -4 addr show tailscale0` 输出原文；把读数命令与前 3 条命中一起贴进记录。
- [x] **AC3 差分是同一任务的真进展（anti-gaming）**：留档证明两点观察是**同一个 `observed_task_id`**（打印两次页面读取里该行的原文），且窗口内确有**驱动产生**的状态变化（附目标侧 driver/gate 读数或 git 时间线），⛔ 不是「等两秒再读一次」的伪差分、⛔ 不是两个不同任务行天然不同冒充进展。
- [x] **AC4 真跑真驱动（生产载体上的判据翻转）**：`/home/yale/work/quay/.quay/productization-verification.jsonl` 里存在该记录（打印该行原文 + 行数）；逐字段满足 criterion：`host`=ad-arm1 ≠ 本机 ∧ `project_root`=ad-arm1 的 archguard ∉ 本仓库 ∧ `bind_host==tailscale0_ip` 且非 `127.`/`0.0.0.0`/`::`/`localhost` ∧ `probe_from_host` 非空 ≠ `host` ∧ `http_status=200` ∧ `observed_task_id` 非空 ∧ before≠after ∧ `store_status_after==after`。随后在**生产 root** 下逐字取 `goals/AC-250-*.md` 的判据干跑：改前 exit 1、改后 exit 0，两条读数并列（翻转的成因是载体内容，⛔ 不是环境）。
- [x] **AC5 外部交叉核对（硬规则 4b）**：经 ssh 在 ad-arm1 上独立复核 `bind_host` 与 `tailscale0_ip`（`ss -ltnp` / `ip -4 addr show tailscale0` 输出原文）并与记录逐字比对；独立读取目标 store 复核 `store_status_after`（`git -C /home/yale/work/archguard show` 或直接读 `tasks/<id>.md`，输出原文落档）——⛔ 不采信载体自述。并留档「探测确实由本机发起」（本机 `hostname` + curl 输出原文）。
- [x] **AC6 未测量 ≠ 不合格，且三态可区分**：任一读数读不出 ⇒ **零记录** + NOT-EVALUATED + 退出非 0；留档证明写入器拒收缺字段/空值/类型不符（打印被拒输入与返回码）；且**「没测成」与「测了但状态未变」在输出上可区分**（两种都不得写成合格记录）；载体副本删记录 ⇒ exit 1、移走载体 ⇒ exit 3，与 exit 0 并列留档。
- [ ] **AC7 全量套件绿 —— 外层 verification-round 验证**（本条的量产生在 fan-in / 外层 suite 轮，⛔ 不是 worker 自己的读数；scoped 门绿不等于全量绿）

## Definition of Done

**AC-250 criterion 在生产载体上 exit 0**，且该记录是一次**真安装、真绑定、真跨机探测、真进展**的产物：`bind_host` 是 ad-arm1 上 `quay serve` 的**真实监听地址**且等于该机 `tailscale0` 的真实地址（推导而非复制副本）；`probe_from_host` 是**另一台机器**（判读侧）自己的 hostname，HTTP 读数由该机发起；`observed_status_before ≠ observed_status_after` 是**同一个任务**在两个时刻的真实状态（页面两次读取原文落档），且 `store_status_after` 由直接读目标 store 得到并与之一致；`host`/`project_root` 都指向外部项目，经 ssh 外部可核。任一读数读不出 ⇒ **不写记录**（未测量 ≠ 不合格）。

⛔ 以下不算达成：

- 只证明「serve 起来了 / 端口在听 / HTTP 200」——单点读数与「有个 web 活着」同形（GOAL-016 风险 3），正是判据正文排除的对象；
- 绑回环（`127.0.0.1`）却把 `bind_host` 写成 tailscale0 IP（值必须是真实监听地址这一直接量）；
- 由目标机自己 curl 自己（`probe_from_host==host`），或把判读侧 hostname 写成目标机；
- 用两个**不同任务**行的状态差冒充「观察到进展」（同一 id 是真差分的必要条件）；
- 用「等两秒再读一次」造出差分，而窗口内没有任何真实驱动产生的状态变化；
- 硬编码 `100.100.148.48`（判据要求 `bind_host==tailscale0_ip`，推导而非复制副本）；
- 把「没跑成 / 只读到一侧」伪装成合格记录，或把「测量了、状态未变」与「没测成」写成同一个取值（硬规则 3b：读不懂输入不得返回与合格同形的值）；
- 手写/注入一条记录，或搬运自坏构建的记录（GOAL-016 风险 6）；
- 只在 worktree 的 `.quay/` 里自证，而生产 root 的载体上没有该记录。

## Evidence（本次运行的直接读数，2026-09-12）

**① 生产载体上判据翻转（AC4）** —— `/home/yale/work/quay/.quay/productization-verification.jsonl` 记录原文：

```json
{"build_sha":"919656b167d6be6053112742387ec2581fbb407f","ts":"2026-09-12T11:47:26Z","ac":"GOAL-016-AC-250","host":"instance-20221019-1509","project_root":"/home/yale/work/archguard","bind_host":"100.100.148.48","tailscale0_ip":"100.100.148.48","probe_from_host":"boheidc","http_status":200,"observed_task_id":"AC250PROBE-3","observed_status_before":"todo","observed_status_after":"ready","store_status_after":"ready", …}
```

载体行数 90 → 91；判据逐字干跑：**改前 exit 1 → 改后 exit 0**（「改前」= 生产载体的前 90 行，
已逐字节比对确认与删掉该记录后的副本相同 ⇒ 翻转的成因是载体内容，⛔ 不是环境）。

**② 三层读数各自的直接量来源（AC2/AC3）** —— 本次运行 `verify-deliver-coldstart.sh --ac250-web-observe`
的留档（`[⑩*]` 行）：

```
[⑩a] target ssh=ad-arm1 host=instance-20221019-1509 root=/home/yale/work/archguard probe_from=boheidc
      ip -4 addr show tailscale0 原文: inet 100.100.148.48/32 scope global tailscale0
      ⇒ tailscale0_ip=100.100.148.48（推导，⛔ 非硬编码）
[⑩b] node=/home/yale/.local/opt/node-v24.19.0/bin/node
      quay=/home/yale/quay-verify-takeover-1d916698.npm/lib/node_modules/quay/dist/quay.js (0.6.1, sha256 7c386737…)
[⑩c] ss -ltnp 该端口原文: LISTEN 0 511 100.100.148.48:4173 0.0.0.0:* users:(("MainThread",pid=3384816,fd=22))
      ⇒ bind_host=100.100.148.48（观测值，⛔ 非 --host 实参）；且 == tailscale0_ip
[⑩d] T1 from boheidc GET http://100.100.148.48:4173/tasks?pageSize=500 → http=200 bytes=64904
      T1 row 原文: AC250PROBE-3	todo
[⑩f] T2 row 原文: AC250PROBE-3	ready  （T1 行与它是【同一个 id】：AC250PROBE-3）
      store_status_after=ready source=abi:task-view
[⑩h] ac250 record written ✓  AC250_OUTCOME=ok  AC250_EVALUATED=1  AC250_WRITTEN_THIS_RUN=1
```

**③ 窗口内确有【驱动产生】的变化（AC3）** —— 目标项目自己的 promotion driver
（`promotion-round.jsonl` round 7）留档：

```json
{"ts":"2026-09-12T11:39:50.489Z","round":7,"action":"promote","promoted_ids":["AC250PROBE-2"],
 "applied":[{"id":"AC250PROBE-2","ok":true,"from":"todo","to":"ready","committed":true}]}
```

本次记录观察的 `AC250PROBE-3` 同形：由同一个 promotion driver 在窗口内把 `todo` 翻成 `ready`
（`seconds_to_change=13`）。⛔ 不是「等两秒再读一次」：驱动是目标项目自己的常驻进程，
`todo→ready` 由它机械判定并提交。

**④ 外部交叉核对（AC5）** —— 经 ssh 在 ad-arm1 上独立重读（⛔ 不采信载体自述）：

```
ip -4 addr show tailscale0        → inet 100.100.148.48/32 scope global tailscale0
ss -ltnp | grep 4173              → LISTEN 100.100.148.48:4173 users:(("MainThread",pid=3385661,…))
grep '^status:' tasks/AC250PROBE-3.md        → status: ready
git show develop:tasks/AC250PROBE-3.md       → status: ready
hostname                          → instance-20221019-1509
判读侧（本机）hostname            → boheidc，curl http://100.100.148.48:4173/tasks?pageSize=500 → http=200
```

与记录逐字比对：`bind_host`/`tailscale0_ip`/`host`/`probe_from_host`/`store_status_after` 全部一致。

**⑤ 三态可区分（AC6）** —— 三组并列读数：

```
生产 root 干跑（有记录）                    → exit 0
载体副本删掉该记录                          → exit 1  （"carrier holds no qualifying GOAL-016-AC-250 record"）
载体移走（空目录）                          → exit 3  （NOT-EVALUATED）
--selfcheck 正控制（七件齐备）              → wrote=1
--selfcheck 负控制（19 条，逐件置为缺件/回环/自探/类型不符/两点相等/store 不一致） → all_refused=1 accepted=0
--selfcheck 结构性                          → build_sha-literal-hits=0 addr-literal-hits=0 choke-point-hits=1
窗口内【无变化】的真跑（window=30）         → AC250_OUTCOME=no-change，载体行数仍 91（零记录）
```

⇒ 「没测成」(`not-evaluated:*`) 与「测了但状态未变」(`no-change`) 是两个不同的取值，
⛔ 都不写成合格记录。

**⑥ 实现期被检查抓到的两处真缺陷（如实留档）**：

- `ac250_read_store_status` 原有一条「猜 `tasks/<id>.md` 路径」的退回分支 ⇒ 被 `task-file-bypass-check`
  当场判 `NEW bypass site`（ABI 绕过；且 `tasks_dir` 是项目 config 的可配置项）⇒ 已删除，只走目标项目
  自己的 Provider ABI。
- 起 serve 的那次 ssh 因远端后台进程继承 ssh 的 stdout 管道而【永不返回】⇒ 脚本停在 ⑩b 之后、
  日志不再增长（而目标机上 serve 确实已在听——「卡住」与「在跑」同形）。修法：重定向挂在子 shell
  分组上 + 给 `ac250_target` 加硬 `timeout`。

**⑦ 目标项目侧的状态（如实说明）**：观察用的 `AC250PROBE-1/2/3` 是本任务为产生这次翻转而经
Provider ABI 写入目标项目的探针任务，取证结束后已全部置为 `superseded`；两个 driver 已 resume
回原状态；`quay serve` 按 AC-250 origin 逐字要求（「便于人观察」）**留在 ad-arm1 的
100.100.148.48:4173 上继续运行**。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/develop-deliver-tgz.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- plugin/test/ac250-web-observe-progress-record.test.mjs (new)
- tasks/gap-ac250-web-observe-tailscale-progress-record.md