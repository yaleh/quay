---
id: gap-ac241-frozen-bare-failure-exits-have-no-owner
title: AC-241 台账回归（第 5 次）：判据的【真值】有 owner（frozen-violated）而【归因】没有 —— 30
  条存量裸失败出口被棘轮基线豁免、写门只管出生，任一条被轮转到并失败就写出不可归因 fail
status: ready
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-241
---
## Finding

**回归（生产台账，逐字读数）** — GOAL-009 的常设不变式 AC-241（`long-term: true`，2026-09-11T13:55:25.575Z achieved）在 **2026-09-14T04:53:40.224Z 第 5 次转红**：

```
2026-09-14T04:49:17.312Z  AC-241  pass   goal-cli     ← 最后一次绿
2026-09-14T04:49:58.345Z  AC-179  fail   goal-sweep
    reason="acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"
2026-09-14T04:53:40.224Z  AC-241  fail   goal-cli
    reason="acceptance failed (exit 1) — unattributable failing goal AC(s): AC-179: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"
2026-09-14T04:53:44.608Z  AC-242  fail   goal-cli
    reason="acceptance failed (exit 1) — stale-pass: frozen achieved AC(s) whose criterion is CURRENTLY false: AC-179"
```

`goals/AC-179-web-card-and-cli.md`（GOAL-001，achieved）的 criterion 唯一失败出口是**裸 `exit 1`**（criterion 第 8 行），零输出 ⇒ runner 走第三分支写空因模板 ⇒ AC-241 的台账不变式被打破。

**本次立案轮的机械读数**（主检出，`node --no-warnings --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts --json`）：

```
{"inDomain":108,"bareAcs":30,"bareLines":53,"baseline":32,"delta":-2,"status":"pass","ok":true,
 "ids":["AC-157","AC-158","AC-160","AC-162","AC-163","AC-164","AC-165","AC-166","AC-167","AC-168",
         "AC-169","AC-179","AC-185","AC-189","AC-190","AC-191","AC-192","AC-194","AC-196","AC-198",
         "AC-199","AC-200","AC-201","AC-204","AC-205","AC-206","AC-207","AC-232","AC-234","AC-238"]}
```

⇒ **AC-179 早就在棘轮的 `ids` 里**（不是检测不到），棘轮 `30 ≤ 32`、`status":"pass"`、exit 0。

### 真值有 owner，归因没有（本轮逐字取证，⛔ 修正初稿的「没有 owner」）

`.quay/goal-round.jsonl` **round 23**（`2026-09-14T04:51:55.118Z`，红前 1 分 45 秒）逐字：

```
"frozenFailing":{"failing":["AC-179"],"judgment":"violated","cause":null,"frozenScope":77}
"gaps":[..., {"goal":"GOAL-001","ac":"AC-179","state":"frozen-violated","taskCount":0}, ...]
```

⇒ **AC-179 的【真值】是有 owner 的**：`computeGoalGaps` 的 `frozen-violated` 分支（`plugin/scripts/goal-driver.ts:1517` 一族的枚举态）认出了它并 spawn 了任务——就是现在 `ready` 的 `gap-ac179-criterion-cold-miss-30s-ttl-always-expired`。**这一点必须说清楚，否则会把「已有人在修」误判成「无人拥有」。**

**但那个 owner 只能修【真值】，修不了【归因】，而且它的修法是暂时的：**

1. **owner 的解法是「令该判据变绿」**（`frozen-violated` 的语义），而 AC-179 的假是**宿主负载相关**的——那条任务自己的 Finding 逐字写着「任何固定帽最终都会重新翻转」。⇒ 它绿一次，下一次负载打过 10s 帽再红一次，**每红一次就再写一条不可归因的 fail**；owner 再被 spawn 一次。**这是 livelock，不是收敛。**
2. **那条 owner 明文被禁止改 criterion**（「AC-179 criterion 逐字不改」）⇒ 它结构上不可能修归因。
3. **能修归因的两个机件都不管存量**：
   - **棘轮是 shrink-only 且有基线豁免**——`criterion-failure-attribution-check.ts` 与 `packages/quay/src/goal-store.ts` 两处注释**逐字**写明「⛔ 故意不是零目标」，AC-179 在 `ids` 里被**显式容忍**；
   - **写门只管出生**——CREATE 必须 0、UPDATE 只有 shrink-only（“不许变差”），**没有任何东西要求已存在的 30 条变好**。

⇒ **无人拥有的不是「AC-179 为假」，是「AC-179 的失败出口不写成因」。** 而 AC-241 恰恰就是**归因**这条不变式 ⇒ 它被绑在宿主负载上，红绿随负载翻转。**这就是 AC-241 反复回归的机制。**

### 为什么前四次修复都没有守住（是机制形态，不是「没做」）

四次 `done` 任务都 claim 了 `goal_ac: AC-241`，落地方向**全部**是**检测面**或**出生面**：

- `gap-goal-criteria-bare-failing-exit-unattributable`（done）：造检测器 + shrink-only 棘轮（baseline 32，`docs/analysis/criterion-failure-attribution.baseline.json`）。
- `gap-criterion-attribution-ratchet-blind-to-trailing-computed-exit`（done）：补 `exit(...)` 尾参为 `else <非零>` 的形态。
- `gap-criterion-attribution-blind-to-silent-terminal-command`（done）：补「判据没有 exit 语句、退出码被行尾静默命令继承」的形态。
- `gap-criterion-attribution-write-gate-at-birth`（done）：把判定搬进 `goal-store.ts` 写面，**新** criterion 带裸失败出口**在出生时被拒**（CREATE 必须 0）。

**这四条对付不了 AC-179，而且不是「漏了」——是结构上的三个原因：**

1. **AC-179 检测得到**：它在 `ids` 里。检测面的修复对它零作用。
2. **AC-179 被基线豁免**：`30 ≤ 32` 就是 pass，豁免集里的人**没有任何修复路径**。
3. **出生面管不到存量**：写门只拒**新**的裸 criterion；对已存在的 30 条只有「不许变差」，**没有任何东西要求它们变好**。

**⚠️ 且这一点已被前例证明可行**：棘轮 `--json` 自己报 `"fixed":["AC-203","AC-217"]` —— **两条曾进过 baseline 的 AC 的裸失败出口已经被修掉了**（`goal-round.jsonl` round 12 里 AC-203 正是 `frozen-violated`）。⇒ 本任务要做的**不是新机制**，是把同一件已证明可行的事对**剩余 30 条**做完。

### 逐条清单（机械枚举，非抽样）

30 条，全部 `achieved`；按 goal：GOAL-003 × 11、GOAL-009 × 7、GOAL-007 × 5、GOAL-008 × 4、GOAL-001 × 2、GOAL-015 × 1（括号内为该 criterion 的裸失败出口行数）：

```
AC-157(3) AC-158(3) AC-160(1) AC-162(1) AC-163(1) AC-164(4) AC-165(2) AC-166(3) AC-167(4) AC-168(1)
AC-169(2) AC-179(1) AC-185(2) AC-189(3) AC-190(3) AC-191(1) AC-192(1) AC-194(1) AC-196(3) AC-198(2)
AC-199(2) AC-200(1) AC-201(1) AC-204(1) AC-205(1) AC-206(1) AC-207(1) AC-232(1) AC-234(1) AC-238(1)
```

它们全在**冻结复验域**（`achieved ∧ ¬inAchievedReverifyScope`：所属六个 goal 全 `achieved`，且这 30 条**无一是 `long-term: true`** ⇒ 两条分支都不进），只被 `goal-store.ts check --stale-pass --sweep` 的**有界轮转**重跑。轮转转到谁、谁在当下宿主上为假，谁就往台账写一条**不可归因的 fail**。

**其中 7 条是棘轮已文档化的 over-approximation**：`packages/quay/src/goal-store.ts` 的 `ATTRIBUTION_RE` 上方注释**逐字**记载「7 of the 33 baselined ACs (AC-189/190/191/196/198/199/200) are bare ONLY via this class」——即「`echo` 到 stdout」这一类；而 runner 折叠 stderr 后**回落到 stdout** ⇒ **它们其实可归因、对 AC-241 无风险**。**其余 23 条是真静默**——AC-179 就在这 23 条里。

**发生率（硬规则 12，已查历史非等下一轮）**：**4 天内 5 次**，前 4 次的肇事 AC 依次是 AC-239+AC-161 → AC-172 → AC-245 → AC-179。**不是「可能发生」，是实测约每天 1 次的频率。**

### 与在飞任务的关系（机制不同，不是重复）

<!-- dedup-ref --> `gap-ac179-criterion-cold-miss-30s-ttl-always-expired`（**ready**，`goal_ac: AC-179`）修的是 **AC-179 的【真值】**：把 `/dashboard` 的冷构建移出请求路径。**它一次都不修归因**，且明文要求 `goals/AC-179-*.md` 的 criterion 逐字不改。同一文件上的两个**不同**性质：

- 那条落地后 AC-179 通过 ⇒ AC-241 会绿——**直到下一次宿主负载把它打过 10s 帽**（那条任务自己的 Finding 就写明「任何固定帽最终都会重新翻转」）。
- 本任务落地后 AC-179 **即使失败**，台账尾事件也是**可归因的 fail** ⇒ AC-241 结构上不再由它决定。

⇒ **两条都需要**，且**本任务是唯一能让 AC-241 不再依赖宿主负载的那条**。（旁证：那条任务的 `## Touches` **不含** `goals/AC-179-*.md` ⇒ 它从设计上就不改这个文件；且实测**没有任何在飞任务**把 `goals/AC-*.md` 写进 Touches ⇒ 无锁冲突。）

⚠️ **执行者须知**：本任务对 AC-179 的改动**只新增失败路径上的诊断写出**，⛔ 不动真值条件、⛔ 不动 `--max-time`、⛔ **不使它变绿**。那条任务的「AC-179 criterion 逐字不改」出自更早的 `gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks` 的 DoD，其**意图**是「⛔ 不得通过修改该 criterion 来满足（那条任务的）AC」——即**不得靠削弱判据取绿**；本任务不削弱任何判据。执行者须在任务体里**写明本任务与该约束的关系**。

## AC

- [ ] **机械全量（30→0）**：修复后 `node --no-warnings --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts --json` 报 `"bareAcs": 0`（修复前 30），并以 `--capture` **重新记录** `docs/analysis/criterion-failure-attribution.baseline.json`（`count` 由 32 → 0）；棘轮仍 `exit 0`。两侧原始 JSON 都贴
- [ ] **真值不变（逐条，⛔ 不抽样）**：每个被修的 criterion，其**真值条件 / 退出码 / 数值帽（含 `--max-time`）/ 被检查的路径与符号逐字不变**；`git diff` 中除**失败路径上新增的诊断写出**（`>&2` / `sys.stderr.write` / `console.error`，或把既有 stdout 写出改投 stderr）之外**无任何语义改动**。逐条给出「文件:行 → 新增/改写的诊断文本」
- [ ] **诊断必须点名成因（⛔ 不是换成另一种空模板）**：每条新增诊断须**嵌入该判据自己的主语**（被检查的路径 / 变量 / id / 观测值），⛔ 不接受 `echo "failed" >&2` 这类零信息写法。30 条逐条给出「该诊断失败时会打印什么」，并至少实跑 1 条贴出真实输出
- [ ] **归因真的落地（负控制，真 runner）**：至少对 **AC-179 + 另外 ≥2 条**被修 AC，构造其失败分支并跑**真** `runAcceptance`（`packages/quay/src/gate/acceptance-runner.ts`），贴出 `reason` 逐字 —— 必须是判据自己写出的成因，⛔ 不得是 `criterion wrote no output to stderr/stdout`
- [ ] **写面机械保证 + 取假**：每条修复都经 `packages/quay/src/goal-store.ts write <id> --criterion …` 递交（⛔ 不手改 YAML），写门 shrink-only 对每条放行；并对 ≥3 条给出「故意让新 criterion 多带一个裸失败出口 ⇒ 写门 exit ≠ 0」的读数
- [ ] **回归钉（new）**：新增 `plugin/test/frozen-population-bare-failure-exits-zero.test.mjs`，断言 in-domain 裸失败出口集为空（`bareAcs` = 0），并含一条**取假**：对一份合成的裸 criterion fixture 该断言必须报红。贴 exit 0 与取假时 exit ≠ 0 两侧读数
- [ ] **AC-241 转绿，且不是被削弱的**：`goals/AC-241-*.md` 与 `goals/AC-243-*.md` 的 `criterion`/`expect` **逐字未改**（贴 `git diff --stat` 为空）；以 `goal-store.ts check --stale-pass --sweep --min-age-ms 0` 刷新台账尾事件后，**逐字跑 AC-241 的 criterion ⇒ exit 0**；并贴出 `item_id=AC-179` 的尾事件 **before / after**（after 必须是 `pass`，或 `fail` 且 reason 携带成因）
- [ ] **检测器未被放宽（取假）**：向 AC-241 的判据喂一份**合成的**台账（某 AC 尾事件为 `verdict=fail`、reason 为空因模板）⇒ 判据必须**仍 exit 1**；两侧读数都贴
- [ ] scoped 门 `bash scripts/test.sh --for-task gap-ac241-frozen-bare-failure-exits-have-no-owner --allow-thin` 退出码 0

## DoD

- [ ] AC-241 判据在**真台账**上 exit 0，贴原始行（`item_id=AC-241` 最新一条 `verdict=pass`）
- [ ] 写清**为什么前四次修复没有守住**（① 检测面修不到已在 `ids` 里的 AC-179；② shrink-only 基线豁免它；③ 出生门只管新增量，存量 30 条无人拥有）**以及为什么 frozen-violated 的 owner 也不够**（它修真值、不修归因，且其解法是暂时的 ⇒ livelock）
- [ ] ⛔ 未改 AC-241 / AC-243 的判据；⛔ 未靠调大 `--max-time`、也未靠让判据变绿取绿
- [ ] ⛔ 未放宽 `ATTRIBUTION_RE`（`goal-store.ts` 明载这是**故意**的 over-approximation）。若执行者选择不把那 7 条 echo 类改投 stderr，须**点名残留计数与 id 清单**并说明为何它们对 AC-241 无风险，⛔ 不得静默留下
- [ ] 已写明本任务与 `gap-ac179-criterion-cold-miss-30s-ttl-always-expired` 约束的关系（见 Finding 末段）
- [ ] 写清**为什么这次修的是存量而非新增**：出生门（同批第 4 条 done 任务）已保证新 criterion 为 0，剩余的唯一洞就是这 30 条无人拥有的存量

## Touches

- goals/AC-157-archive-mechanism-exclusion-wiring.md
- goals/AC-158-execute-archive-batch-one.md
- goals/AC-160-runtime-usage-inventory-blind-spot.md
- goals/AC-162-register-plugin-no-user-enabled.md
- goals/AC-163-allowed-tools-plugin-prefix.md
- goals/AC-164-plugin-namespace-takes-traffic.md
- goals/AC-165-remove-root-mcp-json.md
- goals/AC-166-second-copy-retirement.md
- goals/AC-167-baime-executor-removal.md
- goals/AC-168-quay-init-contract-closed-set.md
- goals/AC-169-delivery-surface-doc-sync.md
- goals/AC-179-web-card-and-cli.md
- goals/AC-185-g9-driver-agent-abi.md
- goals/AC-189-task-goal-spec.md
- goals/AC-190-task-ac.md
- goals/AC-191-goal-ac-evidence-at.md
- goals/AC-192-ff-retry-counter-per-cycle.md
- goals/AC-194-no-direct-to-develop-bypass.md
- goals/AC-196-not-in-git-unchanged-boolean-0.md
- goals/AC-198-root-git-rev-parse-show-toplevel-path-dirname-kind-dir-git.md
- goals/AC-199-test-group-suite.md
- goals/AC-200-goal-文件里的存储-evidence-块残留清零-spec-8-要求-原五条-ac-未覆盖.md
- goals/AC-201-现-build-产物完整且可溯源-产物记录锚在-develop-祖先-commit-tgz-sha256.md
- goals/AC-204-quay-init-只写启用不写实现-禁列补-mcp-commands-hooks-且成对判定.md
- goals/AC-205-会话投递通道在项目生命周期内持续可用-目标会话-transcript-外部可核.md
- goals/AC-206-目标项目具备-goals-tasks-双载体-goals-与-tasks-一同由-quay-init-创建.md
- goals/AC-207-端到端-目标项目自己的-drivers-驱动出真实开发提交且任务翻-done.md
- goals/AC-232-下游-goal-载体必须能写-能读回-ac-206-只断言目录建了与可读-写入失败被注为-不阻塞-从未追查.md
- goals/AC-234-web-指向第三方项目时显示其真实载体与过程记录-http-200-不算证据-退出条件②.md
- goals/AC-238-升级路径-带旧版-vendored-runtime-的真实第三方项目-meta-cc-副本-被当前-develop-ti.md
- docs/analysis/criterion-failure-attribution.baseline.json
- plugin/test/frozen-population-bare-failure-exits-zero.test.mjs（new）
- tasks/gap-ac241-frozen-bare-failure-exits-have-no-owner.md
