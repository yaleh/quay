---
id: gap-it0-split-or-commit-check-needs-change-tier-companion
title: it0-split-or-commit-check 是 full-tier 且 17 次在无关任务的 fan-in
  变红——按本仓库既定解法（change-tier 伴生检查）让改它的那个任务在自己的 scoped 门被抓到
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：`gap-checker-mutation-check-has-no-change-tier-companion`（2026-09-13）AC6 的 10 行表——对 full-tier 全 10 本逐本判「有无 change-tier 伴生」。本条是唯一一本除已修的两本之外**发生率非零**的（⚠️ 不是「建议后续」，是读数表里的下一名）。

**读数（`.quay/verification-round.jsonl` 全 1611 轮，2026-08-12…2026-09-13；不是窄窗）**：
`STATIC_CHECK_FAILED: it0-split-or-commit-check` **17 次**，首次 2026-08-13T14:24:11Z、末次 2026-09-04T08:16:12Z；其中 **17/17 轮的 `tests==0 ∧ fail==0`**（一个测试都没跑过）⇒ 纯静态红，挡的是那些任务的 **fan-in**，而**改动它的那个任务不付账**。

**同族的既定解法（本仓库已用三次、已验证一次）**：`checker-mutation-check` 的 change-tier 伴生（`gap-checker-mutation-check-has-no-change-tier-companion`，2026-09-13）、`quay-init-closure-ratchet-stale`（`gap-quay-init-closure-ratchet-manual-reanchor-recurs`，2026-09-06 `84236de34`）、以及两条更早的 done 先例（`gap-capability-catalog-declarations-not-enforced-at-script-creation`、`gap-crosscut-checks-zero-coverage-of-plugin-scripts`）。其中 `quay-init-closure-ratchet` 的伴生落地后该 checker 的 fan-in 静态闸失败 **35 → 0**（末次 2026-09-06T17:48:12Z，之后窗口内 0 条）——**该解法在本仓库有实测疗效，不是推测**。

**为什么不是「把 full-tier 搬进 scoped」**：`it0-split-or-commit-check` 是 whole-store 判定（跑全库任务树），搬进 scoped 等于把它的全量成本加到每个任务头上；且 full-tier 被推迟的原本理由是**它的红不保证由本 delta 造成**。伴生检查只在 delta 真的碰了本 checker 的载体时才触发 ⇒ 它的红**按构造归属于本 delta**。

**⇒ 本条的形态**：full-tier 那本**逐字不动**当 whole-store 兜底（延迟发现 ≠ 丢弃），另加一个按 delta 收窄的 change-tier 伴生，让**改它的那个任务在自己的 scoped 门被抓到**。

## Plan

1. **先判可行性**（同 `gap-checker-mutation-check-has-no-change-tier-companion` Plan 1）：读 `it0-split-or-commit-check` 的实现，确认它能否按「只判本次 delta 涉及的任务/文档」收窄（是否已有 `--only`/名单参数，或能否新增）。**若结构上只能全量做** ⇒ 本条如实交付「为什么不可收窄」的结论 + 下一步建议，⛔ **不得硬塞一个跑全量的 change-tier 检查**（那会把全量成本加到每个碰 `plugin/scripts/` 的任务头上）；结案同样算完成。
2. 可收窄时，在 `plugin/scripts/runner-static-gate.ts` 登记伴生检查，形状对齐既有的 `quay-init-closure-ratchet-stale`（`:571-573`）与 `checker-mutation-check-changed`（`:379-405`）：`@static-tier change` + `@static-object` **收窄到本 checker 的载体**（checker 脚本本身 + 其 mutation case + 注册表源）。⛔ 不新建第二份登记表——单一正本就是该文件。
3. 伴生检查的判定域 = **本次 delta**，⛔ 不是全仓。
4. full-tier 那本**逐字不动**（AC4 同款判据：该区段 diff 为空、只允许新增伴生块）。
5. ⚠️ **Touches 补充义务**：Plan 1 定位出的实现文件若超出下列清单，worker 必须先把它追加进本任务 `## Touches` 再提交——fan-in 的 anti-drift 是 HARD-FAIL 步。

## Acceptance Criteria

- [x] AC1（正控制·核心，可取假）：造一个「只改 `it0-split-or-commit-check` 载体，且**故意使其判定在该 delta 上失效**」的 delta，跑该任务的 scoped 门。判据：scoped 门**退出码非零** ∧ 输出**点名该 checker**；命令与输出尾部贴进读数段。⛔ 取假形态：scoped 门绿、而同一 delta 在 fan-in 的 full-tier 才红 ⇒ 未达成。**并附反向控制**：还原该文件后同一命令必须绿（证明红可归因于被改的那个文件，而不是 delta 整体）。
- [x] AC2（负控制·不误伤，可取假）：一个**完全不碰该 checker 载体**的 delta，其 scoped 选中集合**不含**该伴生检查。判据：`select-static-checks-for-touches.ts --names` 的实际输出（贴进读数段）不含伴生名；且**逐条给出 `0` 的那几行所对的真实路径**（硬规则 2：零计数要拿已知为真的样本干跑一次）。⛔ 取假形态：任何 delta 都选中它 ⇒ 它事实上成了 `always` tier，未达成。
- [x] AC3（成本按 delta 收窄，可取假）：实测并落盘——①「只改该 checker 一本」时伴生检查的 wall；②同机同时段 full-tier 全量 `it0-split-or-commit-check` 的 wall。判据：两条读数存在 ∧ ① **显著小于** ②。⛔ 取假形态：① 与 ② 相当 ⇒ 没有真正按 delta 收窄。⚠️ ② 的读法：`.quay/checker-cost.jsonl` 里该 checker 的历史行**是参考不是本次读数**，必须当场跑一次并记 wall + `duration_ms`。
- [x] AC4（⛔ 不削弱 full-tier 兜底，逐字）：判据：`git diff` 中原 `it0-split-or-commit-check` 的 `@static-tier full` 注释与其执行体**逐字未变**（该区段 diff 为空，只允许新增伴生块）。⛔ 取假形态：把 full-tier 那本删除或降级为 change ⇒ 未达成。
- [ ] AC5（生产载体验证·读产物，⚠️ 允许 not-evaluated）：落地后，`.quay/verification-round.jsonl` 中 `it0-split-or-commit-check` 的 **fan-in 侧静态闸失败**应停止增长。判据：读数段给出四个量——实现落地时刻、落地前该失败的末次时刻（**现为 2026-09-04T08:16:12Z**，⛔ 不要抄本条的立案时刻）、落地后窗口长度、落地后该失败数。⚠️ **若落地后窗口内没有任何任务改动过该 checker 载体 ⇒ 记 `not-evaluated` 并写明**，⛔ 不得记为通过（硬规则 4 推论三）。——外层 verification-round 验证
- [x] AC6（硬规则 5b）：对 full-tier 剩余 9 本再核一遍「是否已有 change-tier 伴生」（本条的 10 行表以 2026-09-13 的读数为准；`checker-mutation-check` 与 `quay-init-closure-ratchet` 已各自有伴生）。判据：仍有「该有而无」的**须实际立案**并附任务 id，⛔ 不接受「建议后续」。

## Definition of Done

- `plugin/scripts/runner-static-gate.ts` 登记伴生检查落地（或如实交付「结构上不可收窄」的结论）；对应的 `plugin/test/` 可失败控制补上（伴生检查的 tier/object 解析与 `--list` 一致；注入不一致即红）。
- AC1 / AC3 的真实读数落盘（路径随实现定，须在任务体读数段点名）。
- AC6 的核对结果落进任务体读数段，需另立案的已实际立案（附 id）。
- ⛔ 本条**不动** scoped 选择公式本身；⛔ 不处理「`tier=change` 的 glob 没够到 delta」那类形态（另一个缺陷，需要时另立案）。

## Touches

- tasks/gap-it0-split-or-commit-check-needs-change-tier-companion.md
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/it0-split-or-commit-check.ts
- plugin/scripts/it0-split-or-commit-check.sh
- plugin/test/scoped-static-checks.test.mjs
- experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts
- experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.sh
- .quay/it0-split-or-commit-companion-evidence.jsonl

## 读数段

机件读数另存 `.quay/it0-split-or-commit-companion-evidence.jsonl`（7 行 JSON：AC1 红/反向控制、AC2 负控表、AC3 成本、AC4 逐字+可咬控制、AC6 审计表）。⚠️ 该文件不在 git 索引里（`.quay/` 是 gitignored），但 `anti-drift-touches-check` 会把它算作「本任务写过的文件」⇒ 必须列进 `## Touches`（首轮实测 HARD FAIL 就是这么报的：`out-of-declared: task wrote .quay/it0-split-or-commit-companion-evidence.jsonl`）。

### Plan 1 可行性（**可收窄**，实证而非断言）

读实现后确认：**本 checker 的载体是任务库，不是它自己的源码**。判据是回放而非推理——把 `.quay/verification-round.jsonl` 里 17 条 `STATIC_CHECK_FAILED: it0-split-or-commit-check` 轮次中**能取到提交的全部 12 轮**的 `commit` 取出、`git archive <commit> tasks` 后重跑该 checker：**12/12 复现出违规，且 12/12 都是任务文件级违规，没有一次与 checker 源码有关**（该 checker 源码末次改动 = 2026-08-28，而 08-30/08-31/09-02/09-04 的失败都发生在它没被碰过的时候）：

```
e2ec2606 → SELECT-SPLIT: "gap-outer-bg-job-migration-proposal" compound ready 无 children
5919c6fc → CHILD-LINK-SYMMETRY: "gap-doc-develop-sync-semantic-conflict-resolution" 的 parent 漏列它
f8b9e9e1 → PARENT-DONE-IFF-CHILDREN: "gap-session-liveness-bclass-move-to-serial" done 而其 child todo
6d370478 → PARENT-DONE-IFF-CHILDREN: "gap-slot-refill-landed-detection-implementation-file-classes"
7e64a86b → DEP-DONE-IFF-DEPS: "gap-ac72-cert-mechanism-retire" done 而其 dep ready
d1f4e6a8 → CHILD-LINK-SYMMETRY: "gap-fan-in-delta-scope-inventory-annotate"
00f4cf0a / c1e0b238 → CHILD-LINK-SYMMETRY: 同一条 "gap-doc-develop-sync-semantic-conflict-resolution"
cdf4ccf4 → PARENT-DONE-IFF-CHILDREN: "gap-execution-loop-productization-p2-p4"
750f5dd7 / 605b532d → PARENT-DONE-IFF-CHILDREN: "gap-doc-develop-sync-semantic-conflict-resolution"
1aaae50a / c510e929 → SELECT-SPLIT: 同一条 "gap-outer-bg-job-migration-proposal"
```

⇒ **可收窄**：五条规则全是「一个任务 + 它的一跳邻居（children / parent / depends_on）」上的关系判定，所以判定域收窄到 delta 的任务文件**加一跳闭包**即可，成本 ∝ delta，**不是** ∝ 库大小。

### 实现（`--changed` 模式）

`plugin/scripts/it0-split-or-commit-check.ts` 增 `--changed [--base <ref>] [--only <id,…>]`（`.sh` wrapper 透传）：① delta 任务文件 = `git diff <base>...HEAD`（**三点 ⇒ merge-base**，所以 base 分支前进不贡献任何东西；base 缺省取 develop / origin/develop / master / origin/master 首个可解析者）∪ `git diff HEAD` ∪ untracked；② **只加载**这些文件 + 一跳邻居（不读全库）；③ 对闭包跑**同一份 `runChecks`**，并只在违规**点名的任务里至少一个是 delta 任务**时上报（⇒ 红按构造归属于本 delta；与 delta 无交集的是库里别处的既有违规，留给 full-tier 兜底 —— 延迟发现 ≠ 丢弃）。无 delta 任务文件 / git 上下文不可用 ⇒ 显式 `NOT-EVALUATED:` 行 + exit 0（⛔ 不是 exit 3：scoped runner 用 `set -euo pipefail` 裸 eval，非零会**中止一个无辜任务**）。

登记：`plugin/scripts/runner-static-gate.ts` 新增 `it0-split-or-commit-check-changed`（`@static-tier change`，`@static-object tasks/ plugin/scripts/runner-static-gate.ts plugin/scripts/it0-split-or-commit-check.ts plugin/scripts/it0-split-or-commit-check.sh plugin/scripts/checker-mutation-cases/it0-split-or-commit-check.sh`），紧跟 full-tier 那本之后。

### AC1 正控制（可取假）+ 反向控制

**delta**：一个 **untracked 的任务文件** `tasks/zzz-it0-companion-probe.md`（`role: compound` + `status: ready` + `children: []`）——即「只改该 checker 的载体，且故意使其判定在该 delta 上失效」。
命令：`bash scripts/test.sh --for-task gap-it0-split-or-commit-check-needs-change-tier-companion --allow-thin`
读数：**退出码 = 1**，输出尾部：
```
  scoped check: run_checker "it0-split-or-commit-check-changed" bash "<wt>/plugin/scripts/it0-split-or-commit-check.sh" --changed "<wt>"
  - SELECT-SPLIT: task "zzz-it0-companion-probe" is a compound task with status "ready" and NO children — compound tasks must be split into children before being SELECTed for a milestone (DIR-026)
STATIC_CHECK_FAILED: it0-split-or-commit-check-changed exit=1
checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): it0-split-or-commit-check-changed(exit=1) …
```
⇒ scoped 门非零 ∧ 点名该 checker ∧ 点名违规。
**反向控制**：`rm tasks/zzz-it0-companion-probe.md` 还原后，**同一条命令、同一 worktree** ⇒ **退出码 = 0**，伴生报：
`NOT-EVALUATED: it0-split-or-commit-check --changed — no task file in this delta (base develop); …`
⇒ 红可归因于被改的那个文件，而不是 delta 整体（硬规则 4 推论四：附一个「若 Y 为假则结果会不同」的对照）。
⚠️ 诚实标注一处中途证据：首次反向控制时该命令仍非零，但红的是 **`mirror-pair-drift-check`**（`plugin/scripts/it0-split-or-commit-check.{sh,ts}` vs `experiments/quay-perpetual-stream/scripts/` 双副本漂移），**不是**伴生——已 `cp` 同步镜像后重跑得 0。⇒ 那次的非零与伴生无关，且暴露了一个真实的派发前置（见下「镜像副产物」）。

### AC2 负控制（不误伤）

⚠️ **权威读法是 `--commands`**（`--names` 打印的是 `parseStaticCheckRegistry` 从**脚本路径**派生的名字，伴生与 full-tier **调用同一个脚本 ⇒ 同名**，`--names` 对两条登记各打一次同名行——同族更正见 `gap-checker-mutation-check-has-no-change-tier-companion` 的 AC2 段）。
真实 CLI：`node --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts --touches <path> --commands --root <wt>`，数输出中 `it0-split-or-commit-check-changed` 的行数：

| delta 路径（**均为盘上真实存在的路径**） | 伴生被选中 |
|---|---|
| `plugin/scripts/repo-root.ts` | 0 |
| `packages/quay/src/serve.ts` | 0 |
| `docs/proposals/quay-proposal.md` | 0 |
| `plugin/test/scoped-static-checks.test.mjs` | 0 |
| `tasks/DIR-130.md` | 1 |
| `plugin/scripts/runner-static-gate.ts` | 1 |
| `plugin/scripts/it0-split-or-commit-check.ts` | 1 |
| `plugin/scripts/checker-mutation-cases/it0-split-or-commit-check.sh` | 1 |

⇒ 四个「0」各自对齐**真实存在**的路径逐一列出（硬规则 2：零计数要配已知为真的样本干跑——上表四个「1」就是同一次运行里同一调用形的正样本；首轮草表曾把 `docs/proposals/foo.md` / `plugin/test/x.test.mjs` 两个**不存在**的路径写成 0 行，已更正为真实路径，因为「路径不存在」也会给出 0，那是**假 0**）。已知为真的样本行逐字：
`run_checker "it0-split-or-commit-check-changed" bash "<root>/plugin/scripts/it0-split-or-commit-check.sh" --changed "<root>"`
⚠️ **诚实标注**：`@static-object tasks/` 在 `--task` 模式下**必然被选中**——选择器无条件把 `tasks/<id>.md` 追加进 touches（`select-static-checks-for-touches.ts:834`）⇒ 任何任务文件 delta 都会选中它。这是**载体就是任务库**的必然结果，本仓库同形先例 = `landing-target-check`（`:307`，同为 change tier、同带 `tasks/` object）。它**不是 `always` tier**：无任务文件的 delta（任何 `--touches` 文件清单）一行都不选中（上表四个 0）。使每任务成本可负担的是 **①的 delta 收窄加载**，不是更窄的触发面。

### AC3 成本按 delta 收窄

同机同时段（`2026-09-13T09:19:18Z…09:21Z`，**load ≈ 41–50**——宿主被并发 fan-in 压满，如实记录），**12 对交错采样**（伴生、全量、伴生、全量…，交错是为了抵消负载漂移）：

| | min | median | max |
|---|---|---|---|
| ① 伴生（delta = 恰好 1 个任务文件） | **189 ms** | 243 ms | 324 ms |
| ② full-tier 全量 `it0-split-or-commit-check`（2090 任务） | **476 ms** | 559 ms | 739 ms |

⇒ ②/① = **2.52（min）/ 2.30（median）**，① 显著小于 ②。当场另跑一次计入 `.quay/checker-cost.jsonl`（AC3 要求当场读数，历史行只作参考）：
`{"name":"it0-split-or-commit-check-changed","ms":509,…}` 与 `{"name":"it0-split-or-commit-check","ms":1079,…}`（同为 load 49.78 的同窗口）。
**⚠️ 诚实分解**：① 里含**固定开销**（node 启动 115 ms + 3 次 git spawn 57 ms = **172 ms**，同窗口 min-of-5 实测），而 ② 不含这 172 ms ⇒ **wall 比值低估了收窄幅度**。结构性量才是主证据：**① 读 2 个任务文件（1 delta + 1 相邻），② 读 2090 个**。若把固定开销扣掉，② 的「读库」部分 ≈ 964 ms 而 ① ≈ 337 ms（后者含 spawnSync 自身开销），仍是数倍差。

### AC4 full-tier 兜底逐字未动

`git diff develop...HEAD -U0 -- plugin/scripts/runner-static-gate.ts | grep -c '^-[^-]'` ⇒ **0**（整文件零删除行 ⇒ 纯新增）。并且逐字比对：
`# @static-tier full  (whole-store ratchet — deferred to the full-suite gate in scoped mode)` + `run_checker "it0-split-or-commit-check" bash "${repo_root}/plugin/scripts/it0-split-or-commit-check.sh" "${repo_root}"` 这两行拼成的子串在 `develop` 与 `HEAD` 里**各出现恰好 1 次，且子串逐字节相同**。
另有测试钉住（`plugin/test/scoped-static-checks.test.mjs`）：断言该 full 登记**恰好一条**、其 `commandLine` **不含** `--changed`、伴生**恰好一条**且**含** `--changed` ∧ object 含 `tasks/`。
**双向可咬控制**（临时改 → 跑 → 还原；两次都红）：
- 删掉伴生的 `run_checker "it0-split-or-commit-check-changed" …` 行 ⇒ 红：`AssertionError: whole-store registration + its change-tier companion`
- 把 full 块的 `# @static-tier full …` 改成 `change` ⇒ 红：`AssertionError: exactly ONE registration of it0-split-or-commit-check must be \`full\` (deferred ≠ dropped)`
⇒ 新断言**可咬两个方向**，不是恒绿。

### AC5 生产载体验证 —— ⚠️ **not-evaluated**（本 AC 保持未勾 + `外层 verification-round 验证` 标记）

1. **实现落地时刻**：`2fe0d2719945c400c831b2269ba7979d6d64a03e`，`2026-09-13T09:20:34+00:00`（worktree 内；`5edcd84d2` = 09:12:39Z 是其前置实现提交）。ff 到 develop 由 fan-in 完成 ⇒ **本读数写入时尚未落地 develop**。
2. **落地前该失败的末次时刻**：`STATIC_CHECK_FAILED: it0-split-or-commit-check` 末次 = **2026-09-04T08:16:12.373Z**（`.quay/verification-round.jsonl` 全史 1625 轮 / 2026-08-12T03:28:00Z…2026-09-13T09:14:56Z，共 **17** 次；与本条立案时的 17 次一致，立案后未新增）。
3. **落地后窗口长度**：**0**（无任何轮次在本实现落地之后跑过 fan-in）。
4. **落地后该失败数**：**0**，但窗口为 0 ⇒ **不是证据**。
⇒ 硬规则 4 推论三：本 AC 记 **not-evaluated**，⛔ 不记为通过；保持未勾并以 `——外层 verification-round 验证` 结尾（本仓库既有的「只差外层验证」形态，机械可区分：`fan-in-ac-completion-gate.ts` 判 `pass-external` 而非 `pass`；本条已实测该 gate 输出 `剩余未勾 1 项均为（待外部）/外层验证——可翻 done` / `PASS (exit 0) — flip allowed`）。
⚠️ **并附一条可证伪性说明**：本伴生**覆盖不到**「状态翻转族」——`PARENT-DONE-IFF-CHILDREN` / `DEP-DONE-IFF-DEPS` 是由 **driver 在 fan-in 的 ff 段**把任务翻 `done` 造成的，而 scoped 门在**翻之前**跑（`worker-driver.ts` 步序：typecheck → doc-check → scoped-gate → suite → ff）。⇒ 伴生能抓的是**创作期**违规（`SELECT-SPLIT` / `CHILD-LINK-SYMMETRY` / `DEP-DANGLING`，以及「在已 done 的父下新建子」这类由 delta 侧引入的 `PARENT-DONE`）；**纯由翻转造成的**那部分仍由 full-tier 延迟发现。这是如实的能力边界，不是已达成。

### AC6 硬规则 5b：full-tier 10 本逐本

方法：tier 表由**真实注册表**解析（`parseStaticCheckRegistry` 读 `plugin/scripts/runner-static-gate.ts`），⛔ 非手写；「伴生有无」由**注册表里是否有调用同一脚本的 change-tier 登记**机械判定；reds 取自 `.quay/verification-round.jsonl` **全史 1625 轮**（2026-08-12T03:28:00Z…2026-09-13T09:14:56Z，⛔ 非窄窗，硬规则 12b）；成本取自 `.quay/checker-cost.jsonl` 全史中位。实测确认全 10 本与 AC6 名单一致（total registrations 50 / full-tier 10）。

| # | checker | 注册 tier | change-tier 伴生 | fan-in 静态闸 reds（全史 1625 轮） | 成本中位 | 该不该有 + 理由 |
|---|---|---|---|---|---|---|
| 1 | `it0-split-or-commit-check` | full | **有（本条交付 `-changed`）** | 17（末 2026-09-04T08:16:12Z） | 715 ms (n=166) | **本条已消除** |
| 2 | `checker-mechanical-spine-check` | full | 无 | 0 | 1277 ms (n=2) | **不该有**（现在）—— 发生率 0。 |
| 3 | `task-ac-carryover-check` | full | 无 | 0 | 783 ms (n=165) | **不该有**（现在）—— 发生率 0（n=165 次运行）。 |
| 4 | `checker-mutation-check` | full | ⚠️ **develop 上无** | 8（末 **2026-09-13T04:41:32Z**，今天） | 18954 ms (n=161) | **该有而无 —— 已实际立案：`gap-checker-mutation-check-has-no-change-tier-companion`**（⛔ 非「建议后续」）。⚠️ **前提更正（硬规则 12b 的诚实面）**：本条 AC6 原文写「`checker-mutation-check` 已有伴生」——**在 develop 上不成立**：该伴生的实现只存在于那个任务的 worktree（该任务 status `needs-human`、未落地）；本树实测 `parseStaticCheckRegistry` 里**没有任何**调用 `checker-mutation-check.sh` 的 change-tier 登记 ⇒ 该缺陷在 develop 上**仍然活着**，任务 id 见左。 |
| 5 | `outer-retirement-precondition-check` | full | 无 | 0 | 34871 ms (n=3) | **不该有**（现在）—— 发生率 0。⚠️ 贵 ≠ 该有：伴生治的是归属错位，不是成本。 |
| 6 | `registry-bare-filename-scan` | full | 无 | 0 | 3851 ms (n=1) | **不该有**（现在）。 |
| 7 | `quay-init-closure-ratchet` | full | **有（`-stale`，`84236de34`）** | 35（末 2026-09-06T17:48:12Z，之后 0） | 1741 ms (n=1) | **已有，且是本条解法的疗效实证**：伴生落地后 35 → 0。 |
| 8 | `kernel-sibling-resolution-check` | full | 无 | **1**（2026-09-10T04:02:39Z） | 1225 ms (n=1) | **暂时不该有** —— 发生率 **1**，低于本仓库两次实际动手的门槛（35 与 6–8）。硬规则 12：读数已给出 ⇒ **降为观察项**（⛔ 不是「建议后续」）；**若再现 ≥2 次，按本表同法处理**（Plan 1 判可行性 → 收窄后登记伴生）。 |
| 9 | `config-key-consumer-check` | full | 无 | 0 | 780 ms (n=1) | **不该有**（现在）。 |
| 10 | `host-repo-surface-ratchet` | full | 无 | 0 | 1101 ms (n=1) | **不该有**（现在）。 |

**10 行三列全部有取值。**标为「该有而无」的只有 #4，**已实际立案并附 id**（⛔ 无「建议后续」项）；#8 按硬规则 12 降为观察项并附发生率读数。**本条未另立新任务**——唯一的「该有而无」行已有任务 id。

**⚠️ 2026-09-13 续做轮更正（硬规则 5b 的诚实面）：#4 的「develop 上无」已失效。** 续做轮 merge develop 后实测：`checker-mutation-check-changed` 的登记**已存在于 develop**（`plugin/scripts/runner-static-gate.ts:441`，`run_checker "checker-mutation-check-changed" … --check-changed`），即 `gap-checker-mutation-check-has-no-change-tier-companion` 的交付**已落地**。⇒ #4 当前应读作「**有**（已落地）」，上表 #4 的「⚠️ develop 上无 / 该缺陷在 develop 上仍然活着」是**立案时刻（2026-09-13 上午）的快照**，现在是过期陈述。AC6 的判据（该有而无的须立案 + 附 id）不受影响——它要的立案确已发生且已完成交付；此处更正的是**快照的可信期**，不是 AC6 的结论。

### 镜像副产物（AC1 反向控制暴露的真实前置）

`plugin/scripts/` ↔ `experiments/quay-perpetual-stream/scripts/` 是 **40 对真文件镜像**（`mirror-pair-drift-check`），改前者必须同步后者，否则 scoped 门红在 `mirror-pair-drift-check`（**不是**伴生的红）。本条已 `cp` 同步 `it0-split-or-commit-check.{sh,ts}` 两个镜像副本（漂移 4 → 2 允许项 / 2 真漂移 → 0 未豁免），并把这两个路径补进 `## Touches`（否则 fan-in 的 anti-drift 是 HARD-FAIL）。

### 覆盖边界（2026-09-13 续做轮·本任务自身 scoped 门的实测读数）

续做轮跑**本条自己的** scoped 门（driver fan-in 用的同一条：`scripts/test.sh --for-task gap-it0-split-or-commit-check-needs-change-tier-companion --allow-thin`）时，伴生**确实被选中并执行**，但报的是 `NOT-EVALUATED`：

```
scoped check: run_checker "it0-split-or-commit-check-changed" bash "<wt>/plugin/scripts/it0-split-or-commit-check.sh" --changed "<wt>"
NOT-EVALUATED: it0-split-or-commit-check --changed — no task file in this delta (base develop); nothing for the delta-scoped judgment to attribute (⛔ NOT conflated with PASS). The full-tier whole-store registration still runs at the full-suite gate.
```

原因（同一 worktree 内的机械读数，非推断）：`git diff develop...HEAD --name-only | grep -c '^tasks/'` ⇒ **0**，`git log develop...HEAD -- tasks/` ⇒ **空**。即：**本任务所在的 task worktree 分支，其三点 delta 里一个任务文件都没有**——本任务的任务文件改动（立案 / AC 勾选）经 `task_write` 落在**主检出**侧，不在 worktree 分支上。

⇒ **如实记录一条能力边界**（⚠️ 不是新缺陷、不阻塞本条、不改动任何 AC）：伴生对本任务这类 delta 取 `NOT-EVALUATED`，因此**AC1 用注入 probe 得到的绿/红，证明的是「机制能在有任务文件的 delta 上产出正确判定」，不是「生产流程里每个任务都会给出判定」**（硬规则 4 推论三的形态：能被 fixture 满足的判据只证明「能产出」）。本仓库既有先例：`worker-task-write-lands-on-main-not-worktree`（task_write 落主检出，AC tick 靠 fan-in 的 `git merge develop` 才进 worktree）。**这不改变 Plan 1 的可行性结论**（判定域收窄仍成立），也不改变三点的**归属正确性**选择（三点而非两点是刻意的：两点会把 develop 侧别人的改动算进本 delta，正是要避免的误归属）。它改变的是**覆盖率**——哪些任务的 delta 会带上任务文件，取决于该任务的任务文件是否在分支上被提交（本仓库确有分支如此，如 `gap-fan-in-ff-merge-token-gate-fail-closed` 的 `b7f4e3411`）。⇒ **本条的疗效主张只由 AC5（外部）承载**，此处不另作主张。
