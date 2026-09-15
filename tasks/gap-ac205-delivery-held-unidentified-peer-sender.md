---
id: gap-ac205-delivery-held-unidentified-peer-sender
title: AC-205 的产出前置是环境的且未登记：probe 投出去了但被接收方按「unidentified session」扣下（Held peer
  message），AC-214 判据因此在当前环境恒 red
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra: {}
---
## Finding

**AC-205 的现状不是「没跑」也不是「跑坏了」，而是「投出去了、被接收方【扣下待批】」——而扣下的判据在接收方的 settings，不在投递方。**
本 finding 是 `gap-ac214-fifth-crossing-routine-detects-but-nothing-acts` 在 AC2 的取证过程中实测出来的；该任务因此无法把 AC-205 刷进新鲜度窗口（AC-214 判据到现在只剩它一条 red）。

实测（2026-09-15，`bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root /home/yale/work/quay`，两轮）：

1. **host B（`orangevps.wan.hwang.men`）**：`target: pid=1003072`，`send-to-session failed to connect`。ssh 实测该机 `~/.claude/sessions` 里 4 个登记会话的 pid **全部不是活进程**（`ps -p 1664053/1634692/1429681/1003072 -o comm=` 全空）⇒ 该机没有可投递的同址会话。远端日志逐字：`verify-deliver-coldstart.sh` 第 53 行 `NOTE: AC-205 record NOT written (send-to-session failed to connect — 缺值≠合格)`。
2. **host C（`ad-arm1.wan.hwang.men`）**：`target: pid=1958929`（活），`send exit 0`，但 `transcript_confirmed=0`。远端日志逐字：`NOTE: AC-205 record NOT written (transcript_confirmed=0 — send exit 0 但 transcript 未物化 ⇒ 不落账，负控制 AC4)`。
3. **事后直读目标 transcript（决定性读数）**：`~/.claude/projects/-home-yale-work-archguard/dad21301-02e7-42dd-814e-c6ca58ad975e.jsonl` 里 `grep -c ac205-probe` = **4** ⇒ probe **确实送达了**。但四条记录的形态**全部**是：
   `{"type":"system","subtype":"informational","content":"Held peer message — from an unidentified session [verified pid 157212] (peer cla…"`
   即 `type:"system"` + `subtype:"informational"`，**不是** `type:"user"` 也**不是** `type:"attachment"`。

**为什么这构成一个缺陷（而不是「检查太严」）**：`plugin/scripts/transcript-delivery-check.ts` 的三态契约（该文件第 25–40 行）**只**把两类物化形态算作 DELIVERED —— a real USER message（`type==="user"` ∧ `message.role==="user"`）或 `type==="attachment"`，二者都是「被接收方【采纳】了」的形态。「Held peer message」是**待批**形态，判 UNKNOWN(exit 3) 是**正确**的：把它算成 delivered 等于把「排队中」说成「已送达」。⇒ **检查是对的，被检查的对象变了。**

**根因不在投递方，在【接收方的 settings】**（这是本条最重要的一处更正 —— 第一版归因于「投递方没有身份」，**是错的**）：
- `plugin/scripts/send-to-session.ts` 的文件头（2026-08-15/2.1.241 实测记录）逐字写着：**「投递不由 token 类型决定，由【接收方 settings】——`permissions.defaultMode=bypassPermissions` 或 `crossSessionInbound:accept` 任一即直通，皆无则 held→expired（项目会话全带前者 ⇒ 直通）」**。
- ⇒ 本机 probe 被扣下的直接成因是：**目标会话（`/home/yale/work/archguard`，sessionId `dad21301-…`）的 settings 两者皆无**。`from an unidentified session` 是**扣下时的措辞**，不是根因。
- ⇒ **修投递方（`send-to-session.ts`）不会改变这个结局**；文档里唯一「免 hold」的通道是把**目标会话自己的 childToken** 带出来用（用法③），而该脚本自己的安全边界段落明确禁止这样做（「childToken 是会话密钥——把它带出目标会话 = 把『以该会话身份发消息』的能力给了持有者」），outer 2026-08-15 也已拒绝过该形态。**⇒ 这不是本任务可以自行选择的路径。**

⇒ **AC-205 的产出前置是环境的，而且是【未登记】的**：验证机上必须有一个 settings 允许 inbound（`permissions.defaultMode=bypassPermissions` 或 `crossSessionInbound:accept`）的**活**会话。2026-09-14 那次成功就是在 `orangevps` 上恰好满足了这个前提。`plugin/freshness-producers.json` 把 `GOAL-009-AC-205` 登记在 `coldstart-face.subjects` 下时**没有记录这个前置**。

**后果（为什么必须立案而不能只当观察项）**：AC-214 的 `NEED` 含 AC-205，新鲜度窗口 K=200；AC-205 在两条验证机上都产不出新记录 ⇒ **AC-214 判据在当前环境下恒 red**，而 `freshness-producers.json` 仍然把 AC-205 登记为一个「跑一次 `coldstart-face` 就能刷新」的主体。**这正是本仓库反复出现的形态：一个恒 red 的判据与「机制坏了」同形，而这次机制没坏——是它的一个外部前置不再成立。**
5b 扫描（同载体内的同形点）：`coldstart-face.subjects` 的另外四条（AC-201/203/207/232）本轮**全部刷到 d=0 margin 200**（实测），⇒ **只有 AC-205 这一条的产出路径与那四条不同**（它读的是会话投递面，不是安装/交付面），登记时被并进了同一个 producer 名下。

## Requested action

1. **先把两类失败分开**（这是取假的前提）：`plugin/scripts/verify-deliver-coldstart.sh` 的 AC-205 腿目前把「投递不到」与「投出去但被扣下」都印成「NOT written」。让它在 `send` exit 0 之后**先读一次 transcript 判定记录形态**，把三种结局分别落痕：`delivered`（物化）/ `held`（`Held peer message`，逐字贴出该行）/ `absent`（查无此文本）。⛔ 不改 `transcript-delivery-check.ts` 的三态契约（它是对的）。
2. **把「免 hold」变成投递方能【检测】的前置，而不是让它静默失败**：`send-to-session.ts` 在发出之前先读目标 `~/.claude/sessions/<pid>.json` 对应的会话设置，判它是否具备 `permissions.defaultMode=bypassPermissions` 或 `crossSessionInbound:accept`（**这两个键就是文档里那条判据的直接量**）；不具备 ⇒ **在发送前就以一个独立的可区分结局收场**（例如 exit 3 + 一行「target will HOLD (no bypassPermissions/crossSessionInbound)」），⛔ 不要 exit 0 再让下游去猜。判据必须能取假：对今天的 host C 目标 ⇒ 该结局；人为给一个夹具会话加上 `crossSessionInbound:accept` ⇒ 结局翻转为直投。
   ⛔ **明确不做**：不把目标会话的 childToken 带出来（脚本自己的安全边界禁止）；⛔ 不放宽 `transcript-delivery-check.ts` 的三态契约。
3. **登记面说实话**：`plugin/freshness-producers.json` 里 AC-205 的条目补上它的产出前置（**验证机上有一个 settings 允许 inbound 的活会话**——不是「有一个活会话」，第一版这么写也是错的）。若判定该前置【无法由本仓库保证】（它取决于别的项目的会话配置）⇒ 把 AC-205 从 `coldstart-face.subjects` 拆出、单列一个 `session-delivery` producer 并写明前置；⛔ 不改 K、不改 AC-205 的 `criterion`、不删主体（那是人裁定的事）。

## AC

- [ ] 判据能取假①（红）：在一台**只有已死会话**的验证机上跑 AC-205 腿 ⇒ 三态落痕为 `absent` 或连接失败，且**不写记录**（与今天 host B 同形，逐字贴出）。
- [ ] 判据能取假②（红）：在一台**有活会话但会扣下未识别 peer 消息**的验证机上跑 AC-205 腿 ⇒ 落痕为 `held` 并**逐字贴出那条 `Held peer message` 记录**（与今天 host C 同形）。
- [ ] 判据能取假③（绿）：目标会话具备 `crossSessionInbound:accept`（夹具会话即可，⛔ 不动真会话的配置）之后，同一台机上落痕变为 `delivered`，且载体出现一条新的 `ac=GOAL-009-AC-205` ∧ `transcript_confirmed=true` 记录。
- [ ] 生产载体读数：实现落地后，`.quay/productization-verification.jsonl` 里出现 `ts` 晚于落地时刻的 AC-205 记录（⛔ 只由夹具满足不算产出）。
- [ ] `plugin/freshness-producers.json` 的 AC-205 条目要么写清前置，要么按 3 拆分；两种处置都要贴出改后的条目原文。

## DoD

AC-205 腿对「投递不到 / 被扣下 / 已送达」三态**逐条留痕且互不同形**（⛔ 不再是一句 NOT written），并且**至少在一台验证机上**（其会话 settings 允许 inbound 时）真的产出一条 `transcript_confirmed=true` 的 AC-205 记录（生产载体读数，ts 晚于落地时刻）。⛔ 不接受的替代物：改 K / 改 criterion / 删主体；放宽 `transcript-delivery-check.ts` 的三态契约；手写或搬运证据记录。

## Touches

- `plugin/scripts/send-to-session.ts`（发送前检测 goal 设置，把「会被扣下」变成可区分结局）
- `plugin/scripts/peer-identity-probe.ts`（既有身份机件，先查它是否已暴露该判据）
- `plugin/scripts/verify-deliver-coldstart.sh`（AC-205 腿：三态落痕）
- `plugin/scripts/transcript-delivery-check.ts`（⛔ 只读，不改其契约）
- `plugin/freshness-producers.json`（登记面：前置或拆分）
- `tasks/gap-ac205-delivery-held-unidentified-peer-sender.md`（自身文件）