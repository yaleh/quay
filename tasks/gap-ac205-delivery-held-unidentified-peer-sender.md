---
id: gap-ac205-delivery-held-unidentified-peer-sender
title: AC-205 的产出前置是环境的且未登记：host C 的 probe 投出去了但被接收方按「unidentified
  session」扣下（Held peer message）＋ 选择器不查活性（后者已修）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra: {}
---
## Finding

**AC-205 的产出前置有一个是环境的、且未登记：接收方 settings 决定 probe 被【采纳】还是被【扣下待批】。**
本 finding 是 `gap-ac214-fifth-crossing-routine-detects-but-nothing-acts` 在 AC2 的取证过程中实测出来的。

⚠️ **2026-09-15 第二次更正：原标题称 AC-214 判据「在当前环境下恒 red」，该结论已被实测推翻。**
- 第一次更正：把「投递方没有身份」改成「接收方 settings」（那一次是对的，见下方 host C）；
- **这一次：host B 那一段的归因整个作废** —— host B 上【有】活会话，且投递到它【能被采纳】。

实测（2026-09-15，`bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root /home/yale/work/quay`，两轮）：

1. **host B（`orangevps.wan.hwang.men`）—— ⛔ 原记述作废（前提为假）**
   原文：「`target: pid=1003072`，`send-to-session failed to connect`；该机 4 个已登记会话的 pid 全部不是活进程 ⇒ 该机没有可投递的同址会话。」
   **前提为假**：那次只抽查了 4 个 pid（`1664053/1634692/1429681/1003072`），**漏了一个活会话**。实测该机 `~/.claude/sessions` 有 **20+ 个登记项**，其中 **pid 1154128 是活进程**（`ps` ELAPSED 11 天；`claude --model deepseek-v4-flash-anthropic --permission-mode bypassPermissions`，cwd `/home/yale/work/quay`，socket `/run/user/1000/cc-socks/1154128.sock` 存在）—— 且 `bypassPermissions` 正是文档里「直通」的两个条件之一。
   **决定性对照（成本 ~2s，一条命令）**：把安装物 `dist/send-to-session.js` 直接指向 1154128 发一条 probe ⇒ `send rc=0`，`transcript-delivery-check --check` **2 秒内 exit 0**（`state: delivered`），transcript 里逐字出现 `type:"user"` + `<cross-session-message from="uds:/run/user/1000/cc-socks/1154128.sock" …>`。
   **⇒ 真正的根因是选择器不查【活性】**：`find_ac205_target_session()` 的自述是「取第一个 … 的 **live** 会话」，而实现只判 `existsSync(messagingSocketPath)` ∧ `<pid>.*.key` ∧ `sessionId` 非空 —— **进程死后其 socket 文件不会被 unlink**，所以死会话同样合格；`readdirSync` 序把 pid 1003072（已死、stale `.sock` 仍在）排在了活会话前面 ⇒ 取到死 pid ⇒ `send failed to connect` ⇒ 本腿在【明明有活会话】的机器上白跑，并打印「no live same-host target session」（**与真的没有会话同形**，硬规则 4b：socket 文件存在是代理量，进程活着才是直接量）。
   **复现（改前，逐字）**：在 orangevps 上跑改前的选择器逻辑 ⇒ `PICKER PICKS pid=1003072  alive=false`。改后同一台机、同一登记目录 ⇒ 返回 `1154128`。
   **修法（已落地，见下）**：`plugin/scripts/verify-deliver-coldstart.sh` 的选择器加活性闸 —— `kill(pid,0)` 不抛 ESRCH ∧（登记项带 `procStart` 时）与 `/proc/<pid>/stat` 第 22 字段逐字相等（防 pid 复用；口径复用 `peer-identity-probe.ts` 的 `parseProcStart`，⛔ 不另立一份解析）。
   **判据能取假**：`--selfcheck` control 55 用 HOME 隔离的夹具复现该形态（stale `.sock` + 已死 pid 的候选与活候选并存），断言 `fixture_shape=1 / only_dead_empty=1 / only_live_picked=1 / both_picked_live=1`；**红控制 = 改前那份代码跑同一夹具必红**（`dead-only` 与 `both` 两格都取到死 pid）。`both_picked_live` 那一格是关键：它把「跳过死的」与「没有活的才失败」区分开。
2. **host C（`ad-arm1.wan.hwang.men`）—— 本条的主体，2026-09-15 复测仍成立**
   `target: pid=1958929`（活），`send exit 0`，但 `transcript_confirmed=0`。远端日志逐字：`NOTE: AC-205 record NOT written (transcript_confirmed=0 — send exit 0 但 transcript 未物化 ⇒ 不落账，负控制 AC4)`。复测（同一会话、同一 probe 形态）：`send rc=0`，transcript 里 `grep -c <probe>` = 1（**确实送达了**），但 `transcript-delivery-check --check` ⇒ `state: unknown / delivered: false / rc=3`。
3. **事后直读目标 transcript（决定性读数）**：`~/.claude/projects/-home-yale-work-archguard/dad21301-02e7-42dd-814e-c6ca58ad975e.jsonl` 里 `grep -c ac205-probe` = **4** ⇒ probe **确实送达了**。但记录的形态**全部**是：
   `{"type":"system","subtype":"informational","content":"Held peer message — from an unidentified session [verified pid 157212] (peer cla…"`
   即 `type:"system"` + `subtype:"informational"`，**不是** `type:"user"` 也**不是** `type:"attachment"`。

**为什么这构成一个缺陷（而不是「检查太严」）**：`plugin/scripts/transcript-delivery-check.ts` 的三态契约（该文件第 25–40 行）**只**把两类物化形态算作 DELIVERED —— a real USER message（`type==="user"` ∧ `message.role==="user"`）或 `type==="attachment"`，二者都是「被接收方【采纳】了」的形态。「Held peer message」是**待批**形态，判 UNKNOWN(exit 3) 是**正确**的：把它算成 delivered 等于把「排队中」说成「已送达」。⇒ **检查是对的，被检查的对象变了。**

**host C 的根因不在投递方，在【接收方的 settings】**（这一条经复测仍成立）：
- `plugin/scripts/send-to-session.ts` 的文件头（2026-08-15/2.1.241 实测记录）逐字写着：**「投递不由 token 类型决定，由【接收方 settings】——`permissions.defaultMode=bypassPermissions` 或 `crossSessionInbound:accept` 任一即直通，皆无则 held→expired（项目会话全带前者 ⇒ 直通）」**。
- ⇒ host C 的 probe 被扣下的直接成因是：**目标会话（`/home/yale/work/archguard`，sessionId `dad21301-…`）的 settings 两者皆无**。`from an unidentified session` 是**扣下时的措辞**，不是根因。
- ⇒ **修投递方（`send-to-session.ts`）不会改变这个结局**；文档里唯一「免 hold」的通道是把**目标会话自己的 childToken** 带出来用（用法③），而该脚本自己的安全边界段落明确禁止这样做（「childToken 是会话密钥——把它带出目标会话 = 把『以该会话身份发消息』的能力给了持有者」），outer 2026-08-15 也已拒绝过该形态。**⇒ 这不是本任务可以自行选择的路径。**

⇒ **AC-205 的产出前置里确实有一个是环境的、且【未登记】的**：验证机上必须有一个 settings 允许 inbound（`permissions.defaultMode=bypassPermissions` 或 `crossSessionInbound:accept`）的**活**会话。`plugin/freshness-producers.json` 把 `GOAL-009-AC-205` 登记在 `coldstart-face.subjects` 下时**没有记录这个前置**。⚠️ 但注意：那不是它此前唯一的前置 —— host B 上这个前置【已经满足】，卡住它的是选择器缺陷（上第 1 条）。

**后果（为什么必须立案而不能只当观察项）**：AC-214 的 `NEED` 含 AC-205，新鲜度窗口 K=200。**当前的 red 不是「环境里没有可投递的会话」，而是选择器把活会话跳过了**——修掉之后 host B 就能产出 AC-205 记录（`orangevps` 满足 settings 前置）；**host C 仍产不出**，两者的失败形态不同，这正是 Requested action 1 要分开落痕的理由。`freshness-producers.json` 仍然把 AC-205 登记为一个「跑一次 `coldstart-face` 就能刷新」的主体，而没有记下「需要一台 settings 允许 inbound 的活会话」这个前置。
5b 扫描（同载体内的同形点）：`coldstart-face.subjects` 的另外四条（AC-201/203/207/232）本轮**全部刷到 d=0 margin 200**（实测），⇒ **只有 AC-205 这一条的产出路径与那四条不同**（它读的是会话投递面，不是安装/交付面），登记时被并进了同一个 producer 名下。

## Requested action

1. **先把三态分开**（这是取假的前提）：`plugin/scripts/verify-deliver-coldstart.sh` 的 AC-205 腿目前把「投递不到」「投出去但被扣下」都印成「NOT written」。让它在 `send` exit 0 之后**先读一次 transcript 判定记录形态**，把三种结局分别落痕：`delivered`（物化）/ `held`（`Held peer message`，逐字贴出该行）/ `absent`（查无此文本）。⛔ 不改 `transcript-delivery-check.ts` 的三态契约（它是对的）。
   ⚠️ **本任务与 `gap-ac214-fifth-crossing-routine-detects-but-nothing-acts` 的分工**：那条任务已经修了同一文件里的**选择器活性闸**（第 1 条缺陷），那是「取到死会话」的形态；**本条管的是「取到了活会话、但结局是 held」**。两条的落痕都走同一段三态输出，⛔ 不要把选择器的活性闸再造一遍。
2. **把「免 hold」变成投递方能【检测】的前置，而不是让它静默失败**：`send-to-session.ts` 在发出之前先读目标 `~/.claude/sessions/<pid>.json` 对应的会话设置，判它是否具备 `permissions.defaultMode=bypassPermissions` 或 `crossSessionInbound:accept`（**这两个键就是文档里那条判据的直接量**）；不具备 ⇒ **在发送前就以一个独立的可区分结局收场**（例如 exit 3 + 一行「target will HOLD (no bypassPermissions/crossSessionInbound)」），⛔ 不要 exit 0 再让下游去猜。判据必须能取假：对今天的 host C 目标 ⇒ 该结局；人为给一个夹具会话加上 `crossSessionInbound:accept` ⇒ 结局翻转为直投。
   ⛔ **明确不做**：不把目标会话的 childToken 带出来（脚本自己的安全边界禁止）；⛔ 不放宽 `transcript-delivery-check.ts` 的三态契约。
3. **登记面说实话**：`plugin/freshness-producers.json` 里 AC-205 的条目补上它的产出前置（**验证机上有一个 settings 允许 inbound 的活会话**——不是「有一个活会话」，第一版这么写也是错的）。若判定该前置【无法由本仓库保证】（它取决于别的项目的会话配置）⇒ 把 AC-205 从 `coldstart-face.subjects` 拆出、单列一个 `session-delivery` producer 并写明前置；⛔ 不改 K、不改 AC-205 的 `criterion`、不删主体（那是人裁定的事）。

## AC

- [x] 判据能取假①（红）：在一台**只有已死会话**的验证机上跑 AC-205 腿 ⇒ 落痕为 `absent` 或连接失败，且**不写记录**（逐字贴出；⛔ 不再声称「与 host B 同形」—— host B 有活会话，那条记述已作废）。该形态的**选择器侧**已由 `gap-ac214-fifth-crossing-routine-detects-but-nothing-acts` 的 control 55 覆盖，本条只管**落痕形态**。
- [x] 判据能取假②（红）：在一台**有活会话但会扣下未识别 peer 消息**的验证机上跑 AC-205 腿 ⇒ 落痕为 `held` 并**逐字贴出那条 `Held peer message` 记录**（与今天 host C 同形）。
- [ ] 判据能取假③（绿）：目标会话具备 `crossSessionInbound:accept`（夹具会话即可，⛔ 不动真会话的配置）之后，同一台机上落痕变为 `delivered`，且载体出现一条新的 `ac=GOAL-009-AC-205` ∧ `transcript_confirmed=true` 记录。（待外部）
- [ ] 生产载体读数：实现落地后，`.quay/productization-verification.jsonl` 里出现 `ts` 晚于落地时刻的 AC-205 记录（⛔ 只由夹具满足不算产出）。（待外部）
- [x] `plugin/freshness-producers.json` 的 AC-205 条目要么写清前置，要么按 3 拆分；两种处置都要贴出改后的条目原文。

## DoD

AC-205 腿对「投递不到 / 被扣下 / 已送达」三态**逐条留痕且互不同形**（⛔ 不再是一句 NOT written），并且**至少在一台验证机上**（其会话 settings 允许 inbound 时）真的产出一条 `transcript_confirmed=true` 的 AC-205 记录（生产载体读数，ts 晚于落地时刻）。⛔ 不接受的替代物：改 K / 改 criterion / 删主体；放宽 `transcript-delivery-check.ts` 的三态契约；手写或搬运证据记录。

## Touches

- `plugin/scripts/send-to-session.ts`（发送前检测 goal 设置，把「会被扣下」变成可区分结局）
- `plugin/scripts/peer-identity-probe.ts`（既有身份机件，先查它是否已暴露该判据）
- `plugin/scripts/verify-deliver-coldstart.sh`（AC-205 腿：三态落痕；⚠️ 选择器活性闸已由 `gap-ac214-fifth-crossing-routine-detects-but-nothing-acts` 修，本条只加深三态落痕）
- `plugin/test/verify-deliver-coldstart.test.mjs`（本条新增的两条 --selfcheck 控件（三态落痕 / 发送前 HOLD 前置）的断言；basename 配对已把该测试拉进本任务的 scoped 门）
- `plugin/scripts/transcript-delivery-check.ts`（⛔ 只读，不改其契约）
- `plugin/freshness-producers.json`（登记面：前置或拆分）
- `tasks/gap-ac205-delivery-held-unidentified-peer-sender.md`（自身文件）