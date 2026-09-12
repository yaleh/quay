---
id: gap-criterion-attribution-write-gate-at-birth
title: AC-241 台账回归：新 AC 在【写入面】就不许带裸失败退出 —— 棘轮是事后检测且对 goals/-only delta
  结构上不跑；今日新建的 AC-247/248/249 已把不可归因的 fail 写进生产台账
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-241
---
## Proposal

**症状（生产台账逐字，2026-09-12T08:45:1xZ，`actor=goal-cli`）** —— `goals/AC-247/248/249`（GOAL-016，今日 08:43–08:45 新建）各自的**最后一条** `gate=goal` 事件：

```
AC-247 | verdict=fail | reason="acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"
AC-248 | verdict=fail | reason 逐字同上
AC-249 | verdict=fail | reason 逐字同上
```

⇒ long-term 已 achieved 的 **AC-241 回归为 exit 1**，逐字点名这三条：

```
unattributable failing goal AC(s): AC-247: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout; AC-248: …; AC-249: …
```

**控制（证明该判据可被满足，不是恒假 —— 硬规则 4 推论四：给不出区分性对照就只是假说）**：取同一本台账的副本，**仅**把这三条记录的 `payload.reason` 换成带成因的文本（其余逐字节不动），同一条 AC-241 判据退出 **0**。两次读数 **1 → 0**，翻转的成因是台账内容而非环境。

**棘轮此刻是红的——但至今一次都没机会跑到它们**：

```
node --no-warnings --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts --root . --json
{"inDomain":98,"bareAcs":34,"bareLines":57,"baseline":32,"delta":2,
 "added":["AC-247","AC-248","AC-249"],"status":"fail","ok":false,…}
```

**为什么上一版修复没托住（两条，都可核，且都不是「忘了跑」）**：

1. **棘轮是【事后】检测，改不了已经写出的台账记录**。AC-241 判的是**台账**，棘轮判的是**判据文本**；一条裸退出 AC 只要被创建并跑过一次，那条不可归因的 `fail` 就已经在 `.quay/gate-events.jsonl` 里了——之后再变红只是事后告警，无论告得多快都清不掉那条记录。`gap-goal-criteria-bare-failing-exit-unattributable`（done）把这条义务从 **runner 侧**挪到了**判据文本侧**，但没有挪到**写入侧**。

2. **棘轮对「创建一条 AC」这一 delta 形态结构上不跑**。`goals/` 是 `DOC_SURFACES`（`plugin/scripts/select-static-checks-for-touches.ts:223`）⇒ 只改 `goals/` 的 delta 是纯 doc delta ⇒ `code_delta` 为空 ⇒ `@static-tier change` 的这条检查那一轮不执行。`plugin/scripts/runner-static-gate.ts:650` 的注释**逐字承认**这个洞，并明确禁止用目录 glob 去补（那会把整个 `goals/` 面由 doc 翻成 CODE，打红无关用例）：「只改 goals/ 的分支 code_delta 为空 ⇒ 跳过全量 suite ⇒ 本检查器那一轮不跑」。
   **实证（时间线，⛔ 不是推断）**：今天最后一次全量 suite 是 `03:45`（`.quay/full-suite-state.json` 的 mtime），而三条 AC 生于 `08:43–08:45` ⇒ **棘轮从出生到现在一次都没跑到过它们**；与此同时 goal-driver 常驻进程（pid 1112073）每轮都在跑 GOAL-016 的判据，**每轮都在往台账里追加一条不可归因的 fail**。

**写入面今天是空的（这才是可堵的边界）**：`packages/quay/src/goal-store.ts` 的写入契约对 `criterion` 只查**非空**（`:1248`–`:1278` 的 create / update 两支），而 `:1203-1204` 的注释逐字写着 create-as-active **不过** P6 激活闸：「create-as-active is NOT gated — a new record's criterion is validated by the create completeness contract」——**而那个 contract 从不问「失败出口写不写成因」**。⇒ 一个 AC 可以在**出生那一刻**就带着裸失败退出进入 active 并被每轮执行，此后每一次失败都在污染 AC-241 所判的那本台账。

**发生率（同一形态两日内 5 条，不是假想 —— 硬规则 12：先给发生率再谈机制）**：AC-239 → AC-245 → AC-247/248/249（其中三条是今天同一个会话一次创建）。前两条的**判据文本**已各由一条 done 任务修过，但**没有任何一条堵住写入面** ⇒ 这是同一缺陷的第三次复发，每次复发都在生产台账上留下一条永久的不可归因记录。

<!-- dedup-ref -->
**与既有 done 任务的关系（仅追溯，不构成任何依赖声明）**：`gap-goal-criteria-bare-failing-exit-unattributable`（建棘轮）、`gap-criterion-attribution-ratchet-blind-to-trailing-computed-exit`（棘轮补 computed 形态）、`gap-criterion-attribution-blind-to-silent-terminal-command`（棘轮补隐式退出形态）——三条都在**检测器**这一侧，本条在其**上游**（写入面），且不改棘轮的判定域与基线。

## Plan

1. **止血**：给 `goals/AC-247/248/249` 的**每个**失败出口补一句 stderr 成因。同一条判据的不同出口成因必须**互不相同**（例：「载体不存在」/「地址里没有任何合格记录，缺哪些字段」/「记录存在但 host 是本机」），⛔ **只加诊断输出、不动判定条件**——同一载体上改前改后的退出码必须逐条相同。

2. **共用谓词（一份实现，⛔ 不是两份）**：把「这一行是失败退出且同行无 stderr / `>&2` / console.error」的判定做成**单一实现**。方向必须是 **产品侧 → 插件侧**（`packages/quay/` 目前不反向依赖 `plugin/scripts/`，而 `plugin/scripts/goal-driver.ts` 等已 import `packages/quay/src/goal-store.ts`）⇒ 谓词落在 `packages/quay/src/goal-store.ts` 并导出，`plugin/scripts/criterion-failure-attribution-check.ts` 改为 import 它。理由不是风格：**两个检测器必然漂移**，AC-243 就是这条纪律的实证（它专门钉住「识别空因的常量必须与 runner 实时文本同源」）。

3. **在写入面拒绝**（堵边界本身）：
   - **CREATE**（`!existingFile` 的 criterion 分支）：criterion 含裸失败退出 ⇒ 拒绝，stderr 点名**行号与该行内容**。
   - **UPDATE**（`touchesCriterion`）：**只许不增**——新文本的裸失败退出行数 ≤ 旧文本的。⛔ 不要求存量 32 条一次归零（硬规则 12：别用未测量的残差挡住可达目标；棘轮的既有裁定也是这个方向：shrink-only）。
   - 拒绝文案必须与「criterion 为空」等其他拒绝**不同形**（硬规则 3b：读不懂输入 ≠ 合格；一个判定若没有「未评估/读不懂」这一态，就无法区分「查过且合格」与「没查成」）。

4. **夹具与负控制**：写入面闸必须有能取假的单测（见 AC4）。若收紧写面红掉既有夹具（顺手用了现在非法状态的用例），按主体补齐该夹具、并把该文件写进 `## Touches`（⛔ 不是放宽闸）。

5. **回到台账**：判据文本修好后，让**真** goal-driver 在 production root 跑一轮，读台账确认三条的最后一条事件带成因，AC-241 的判据对**生产台账**干跑 exit 0。

## Acceptance Criteria

- [ ] **AC1 存证（改前读数，机械可复算）**：a) `.quay/gate-events.jsonl` 中 AC-247/248/249 各自的**最后一条** `gate=goal` 事件 `verdict=fail` 且 `payload.reason` 逐字 = `acceptance failed (exit 1) — criterion wrote no output to stderr/stdout`；b) AC-241 的判据（逐字取自 `goals/AC-241-*.md`，⛔ 不手写）对**生产台账**干跑 ⇒ `exit=1`，stderr 逐字点名 AC-247 / AC-248 / AC-249 三条。两条读数都留档。

- [ ] **AC2 三条判据写成因且判定语义不变（能取假）**：`goals/AC-247/248/249` 的每个失败出口（`exit 1` 与 `exit 3`）同行都有 stderr 写入，**且成因互不相同**（把 `grep -n "sys.exit"` 与 `grep -n "stderr"` 的行号集比对的输出贴进记录）。同一载体上逐条干跑，改前/改后的退出码**逐条相同**（0 / 1 / 3 三态语义不变）；`bash -n` 或等价语法检查通过。控制的取法：改前文本用 `git show develop:goals/AC-247-*.md` 抽出的 criterion，改后用本分支的。

- [ ] **AC3 台账上真的可归因（⛔ 夹具/注入载体不算 —— 硬规则 4 推论三）**：在 **production root** 用真 goal-driver 跑一轮（`node --experimental-strip-types plugin/scripts/goal-driver.ts --root /home/yale/work/quay --once --spawn-cap 0`，criterion 经 `goal-store gate` 真跑、真写 GateEvent），把该轮读数逐字留档：AC-247/248/249 的**最后一条** goal 事件的 `payload.reason` 携带判据自己写出的成因（非空、非那条模板）；随后 AC-241 的判据对**生产台账**干跑 ⇒ `exit=0`。⚠️ 交付前置（读者须知）：常驻 goal-driver 读的是**主检出**（`--root /home/yale/work/quay`），⛔ 不是任务分支 ⇒ 判据文本必须先到主检出，`--once` 那轮才跑得到新版；若主检出落后 develop，按既有 `syncDevelopToDoc` / 语义兜底追平后再跑这一条。

- [ ] **AC4 写入面闸存在且能取假（本任务机制的主体）**：a) 用 goal-store 写入一条**新** AC，其 criterion 含裸失败退出（如 `python3 -c 'import sys; sys.exit(1)'`）⇒ 拒绝、`exit≠0`、stderr 点名**行号**；b) 同一条 AC 的 criterion 改成同行写 stderr ⇒ 通过；c) UPDATE：把某 AC 的 criterion 由 N 条裸失败退出改成 N+1 条 ⇒ 拒绝；改成 ≤N（含 0）⇒ 通过。至少三组读数（拒 / 过 / 拒）与退出码、stderr 原文都留档。

- [ ] **AC5 单一实现（⛔ 不是第二份正则）**：`grep` 证明失败退出的判定只有一份实现——`packages/quay/src/goal-store.ts` 导出它、`plugin/scripts/criterion-failure-attribution-check.ts` import 它；`plugin/scripts/` 与 `packages/quay/src/` 内不存在第二处 `exit\s*\(\s*1` / `exit 1` 的判定正则。**非零计数必须打印命中**（硬规则 2：引用一个计数前先打印它匹配到的前 3 条实际内容），把命中数与前 3 条一起贴进记录。负控制：把共用谓词改成恒 false（或对一个已归因的判据调用）⇒ 不误报。

- [ ] **AC6 三态可区分**：写入面遇到读不懂的输入（criterion 非字符串 / 空 / 无法解析）⇒ 报错文案与「合格放行」**不同形**且 `exit≠0`；棘轮自身仍是 0=pass / 1=fail / 3=NOT-EVALUATED 三态，且 `--json` 的 `bareAcs` 在修完三条后 ≤ 基线 32（收缩方向，棘轮绿）。

- [ ] **AC7 全量套件绿 —— 外层 verification-round 验证**（worker 结构上被禁跑全量 suite；本条的量的产生处是 fan-in / 外层的 suite 轮，⛔ 不是 worker 自己的读数；scoped 门绿不等于全量绿）

## Definition of Done

**新 AC 在写入面就不可能带着「失败时什么都不写」的判据出生**，且这条闸与棘轮共用同一份判定实现；今日这轮污染（AC-247/248/249）被清掉——三条判据的失败出口都写成因，**生产台账**上它们各自的最后一条 goal 事件携带成因，AC-241 对生产台账干跑 `exit 0`。

⛔ 以下不算达成：

- 只把三条判据改好、不堵写入面 —— 那是同一补丁的第四次复发；
- 在写入面复制一份新的裸退出正则（与棘轮必然漂移）；
- 把棘轮的判定域放宽、或把某个检测器写成恒绿来让计数归零；
- 用夹具 / 注入载体冒充「台账上真的可归因」（硬规则 4 推论三：能产出 ≠ 已产出）。

## Touches

- goals/AC-247-当前-build-在-ad-arm1-干净接管停摆一月的存量项目且-driver-真活-读载体-不读-start-退出码.md
- goals/AC-248-驱动出的修复被-archguard-自己的机械判据确认为正确-检出行为必须前后翻转-不读单次退出码.md
- goals/AC-249-成套修改-代码修复与-adr-007-文档同步出自同一任务-单边不算.md
- packages/quay/src/goal-store.ts
- plugin/scripts/criterion-failure-attribution-check.ts
- plugin/test/criterion-failure-attribution-check.test.mjs
- plugin/test/goal-store-write-gate-criterion-attribution.test.mjs (new)
- tasks/gap-criterion-attribution-write-gate-at-birth.md