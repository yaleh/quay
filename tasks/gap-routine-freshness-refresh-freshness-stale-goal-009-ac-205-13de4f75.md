---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205-13de4f75
title: "freshness-refresh: Delivery-face distance d=264 has passed K=200
  (margin=-64) and the newest AC-205 record is 232.71h old
  (2026-10-12T21:59:06Z, carrier line 360); only session-del"
status: ready
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
Delivery-face distance d=264 has passed K=200 (margin=-64) and the newest AC-205 record is 232.71h old (2026-10-12T21:59:06Z, carrier line 360); only session-delivery produces this subject, and its AC-205 leg is the one face whose precondition is not repo-controlled.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1792680214267` · ts `2026-10-22T14:43:34.267Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`session-delivery`、`targetInboundPolicy`、`verify-deliver-coldstart.sh:find_ac205_target_session`
- 涉及文件：
- `plugin/freshness-producers.json:156`
- `plugin/freshness-producers.json:172`
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl:360`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run session-delivery from this host (FILE-ONLY here): host B currently has a live procStart-matching session pid 3198864 whose argv --settings carries permissions.defaultMode=bypassPermissions (precheck verdict direct) => ⑦ leg can land; host C still reads will-hold (defaultMode/crossSessionInbound unset).

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `GOAL-009-AC-205` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-22T14:43:34.267Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-205`（routine `freshness-refresh`，runId `freshness-refresh-1792680214267`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205-13de4f75.md`

## Evidence

**处置 = 修掉（⛔ 不是「已注意到」，也⛔ 不是第四次「已有机制在管」归档）。** 本轮与前三次立案的**新事实**是：⑦ 腿的会话前置在 host B **由假转真**，因此处置 = 按登记面 `producers[].command` **真跑产出者** ⇒ ⑦ 腿落 `delivered` ⇒ 载体新增 AC-205 记录 ⇒ AC-214 新鲜度判据重新转绿。

### ① 立案 → 处置 的读数对照

| 量 | finding 立案时（2026-10-22T14:43:34Z） | 处置后（判据同轮写快照 `at=2026-10-22T15:08:18Z`） |
|---|---|---|
| AC-205 最新载体记录 | `.quay/productization-verification.jsonl:360`，`ts=2026-10-12T21:59:06Z`，`build_sha=61a1ebb0600f…` | **`:405`，`ts=2026-10-22T14:52:36Z`，`build_sha=5a69424613da9790a758a92f9cab258f4ff8f7c8`，`host=orangevps`，`shipped_from_installed_artifact=true`，`transcript_confirmed=true`** |
| `evidence_age_hours` | 232.71 | **0.26** |
| `d`（交付面内容距离，K=200） | 264 | **0** |
| `margin = K − d` | −64 | **+200** |
| AC-214 criterion 退出码 | 红（exit 1） | **绿（exit 0）** |

`d` 由判据与探针的**同一实现**重算（⛔ 不手写第二份交付面清单，cwd = 本任务 worktree）：

```
node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts \
  --delivery-face-distance --from 61a1ebb0600f49269849d18757232fd8dfb28a13 --json
→ {"state":"computed","distance":264,...}
```

**负控制（硬规则 4「判据能取假」）**：同一谓词对 2026-09-20 的旧证据 sha `c80040ad49b335df44269ac07ea829d2a3511843` 干跑 ⇒ `{"state":"computed","distance":803,...}` ≫ K=200 ⇒ 它不是恒绿。

判据本体（`goals/AC-214-*.md` 的 `criterion:` 折叠块，`YAML.parseAllDocuments()[0]` 取出后 `bash` 执行，cwd = **主检出** —— 载体是 gitignored 运行产物，只在主检出存在）在处置后逐字输出：

```
freshness GOAL-009-AC-201: 0/200 (margin 200)
freshness GOAL-009-AC-232: 0/200 (margin 200)
freshness GOAL-009-AC-205: 0/200 (margin 200)
freshness GOAL-009-AC-207: 0/200 (margin 200)
freshness GOAL-009-AC-203: 0/200 (margin 200)
freshness GOAL-009-AC-238: 4/200 (margin 196)
freshness GOAL-009-AC-239: 4/200 (margin 196)
EXIT=0
```

### ② 前置当场复核（⛔ 不采信上一轮读数；与 finding 的 suggestedAction 同源）

- **可达性**：`ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'echo PROBE-B-OK; df -h /'` ⇒ rc=0（17G free）；`… yale@ad-arm1.wan.hwang.men` ⇒ rc=0。⛔ 但这只证明可达（`execution_probe` 的 `executable` 含义）。
- **host B**：`~/.claude/sessions/*.json` **67** 项；用 ⑦ `find_ac205_target_session` 的**同一活性谓词**（`kill(pid,0)` 活 ∧ `/proc/<pid>/stat` 第 22 字段 == 登记项 `procStart` ∧ socket 与 `.key` 都在）枚举 ⇒ **活会话 1 条**：`pid=3198864`、`sessionId=1ea01597-7c56-4f84-8af7-a63da978107c`、`cwd=/home/yale/quay-verify-upgrade-6b91fa84-root`，其 argv `--settings` 逐字带 `permissions.defaultMode":"bypassPermissions"` ⇒ `hold-precheck=direct`。**归属**：它隶属**另一个项目**正在跑的 upgrade-face 隔离副本（父进程为该副本的 `driver-anchor` pid 2818891，在驱动 DIR-095）⇒ ⛔ 不是本仓库制造，也⛔ 不是可依赖的常态。
- **host C**：仍只有 `pid=3801624`，`hold-precheck=will-hold`（`defaultMode` / `crossSessionInbound` 两键皆无）⇒ C 腿注定 `held`、不落账。

### ③ 真跑的产出者（逐字命令形态 + 结果）

登记面 `plugin/freshness-producers.json` 的 `session-delivery.command`（**单一来源**，⛔ 不在此复制第二份），本机执行形式：`--verify-coldstart --ac207-e2e --hosts "B C" --force --root /data/home/yale/work/quay --driving-profiles <目标机网关认得的 profiles 文件>`；该文件从 host B 的 `~/quay-driving-profiles.yml` 逐字取回（`launcher: claude-fjdac` / `model: deepseek-v4-pro-anthropic` / `auth: token`，135 字节）—— ⛔ 不用本仓 `.quay/profiles.yml`（其 `v4.1flash-anthropic` 是本机网关专属）。

B 腿 `⑦ session delivery (AC-205)` 段逐字（`.quay/verify-coldstart-remote-B-5a694246.log:51-57`）：

```
== ⑦ session delivery (AC-205): installed dist/send-to-session.js → same-host target → transcript-verified ==
  target: pid=3198864 sessionId=1ea01597-7c56-4f84-8af7-a63da978107c (name from registry)
  send-to-session (installed dist): /home/yale/quay-verify-coldstart-5a694246.npm/lib/node_modules/quay/plugin/scripts/dist/send-to-session.js
  transcript: /home/yale/.claude/projects/-home-yale-quay-verify-upgrade-6b91fa84-root/1ea01597-7c56-4f84-8af7-a63da978107c.jsonl
  shipped_from_installed_artifact=1 transcript_confirmed=1 evaluated=1 host=orangevps
  delivery_outcome=delivered hold_precheck=direct send_rc=0
  ac205 record written → /home/yale/quay-verify-coldstart-evidence-5a694246.jsonl
```

`delivery_outcome` 取自 ⑦ 的六态词表 `no-target | no-transcript | send-failed | delivered | held | absent` —— 本次是 **`delivered`**，⛔ 不是 `held`（C 腿的形态）也⛔ 不是 `no-target`（前三次立案时 B 的形态）。

**transcript 侧的外部可核（⛔ 不采信 send 的退出码）**：probe 文本 `ac205-probe-1792680772-3219097` 在目标会话 transcript 里逐字命中：

```
grep -rho "ac205-probe-[0-9a-z-]*" ~/.claude/projects/-home-yale-quay-verify-upgrade-6b91fa84-root/ \
  （host B）⇒ ac205-probe-1792680772-3219097
```

B 腿整体：`remote verify rc=0 evidence_lines=10`、`EVIDENCE-TRANSPORT appended=10`、`evidence-completeness COMPLETE present=6`、`e2e-pairing E2E-PAIR OK host=orangevps`（同一次运行的 AC-201/203/204/206/207/232/234 一并刷新）。

### ④ 处置落在哪个载体、为什么那是「修掉」而不是注释

`plugin/freshness-producers.json` 的 `session-delivery.preconditions` 末尾新增本条 2026-10-22 的记录（前置由假转真的当场读数 + `delivered` 的逐字结局 + 新载体记录 + 判据转绿）。理由与上一轮同源：该文件是**探针与人工升级通道唯一的前置来源** —— 它决定下一轮读者会不会把 `remedy_availability=executable`（可达性）译成「重跑即可修复」，也决定「这条腿的闸到底是什么」这一事实有没有库内正本。⛔ 本轮**没有**改 K、criterion、`goals/`、`.quay/routine-findings.jsonl`、任何验证机会话配置。

**5b 扫描（修一处 ≠ 只此一处）**：`grep -c '"preconditions"' plugin/freshness-producers.json` ⇒ **3**（`coldstart-face` / `session-delivery` / `upgrade-face`），三条都各自登记了自己的环境前置，本轮的「活且允许入站的会话」只作用于 `session-delivery` ⇒ 该形状没有未登记的兄弟实例。

### ⑤ 遗留（如实，⛔ 不当作已解决）

- host C 腿仍是 `will-hold`（其唯一活会话属别的项目、两键皆无）⇒ **今后任何一次重跑，AC-205 只有在 B 或 C 上恰好存在一条活且允许入站的会话时才会刷新**。这条前置仍由**验证机上的其他项目**决定，本仓库控制不了；本轮之所以能修掉，靠的是 B 上那个 upgrade-face 隔离副本的 worker 会话仍在跑。
- 因此 finding 的 Effect Prediction（「修复后同一 subject 不再复发」）只在**新鲜度窗口内**成立；窗口再次越过时（K=200 交付面提交），finding 会**再次机械立案** —— 那不是回归，而是该判据在工作。

- 该轴仍暗,理由:本任务只向 `plugin/freshness-producers.json` 追加一条既成事实的前置记录（纯 JSON 字符串），未新增/移动/删除任何模块或 import 边，L_D/L_G 结构读数不因本轮变化。