---
id: gap-goal022-scope-item3-prereq-reinstall-uncovered
title: GOAL-022 充分性判官判 insufficient 跨一整个 judge+look 周期未变：范围节第三条「自定义 runner
  镜像消除重复装包」在在域 AC 集合里零覆盖，而实测它是 ≤30s 目标的 26.7%（8s/30s）⇒ 提 option (a)：加一条 AC-282 +
  退出条件句「三条 AC」改「四条 AC」
status: todo
labels:
  - gap
  - goal-sufficiency
  - test-wall-clock
parent: null
children: []
extra:
  schema: execution
---
**type:** proposal

## Proposal

**结论｜本任务提的是 option (a)：给 GOAL-022 新增一条 AC（拟 **AC-282**），把范围节第三条「自定义 runner 镜像消除重复装包」补进在域 AC 集合；并把退出条件句从「三条 AC 全部 achieved」改成「四条 AC 全部 achieved」+ 逐字列出 AC-282。⛔ 不改范围节（该条本来就写着，不是要删）。**

**触发**：充分性判官对 GOAL-022 已给出 DETERMINATE `insufficient`（`plugin/scripts/goal-driver.ts` 的 `semanticSufficiencyVerdict`，输入 = goal title ‖ 退出条件 ‖ `## 范围…` 节 ‖ 在域 AC 的 (id,title,expect)），且该裁决跨过一整个 judge+look 周期未变：

```
.quay/goal-sufficiency-followup.json  entries["GOAL-022"].key     = a2c80835e429d04191d4370a159f135b20672c4be1a3452531e4282c41775c65
                                       entries["GOAL-022"].since   = 2026-09-17T01:21:57.971Z
                                       entries["GOAL-022"].filedAt = null          ← 此前无任何任务承接
.quay/goal-sufficiency-cache.json      entries["a2c80835…"].verdict = "insufficient"   ts=2026-09-17T00:55:37.997Z
.quay/goal-round.jsonl                 round 191 的 goal-sufficiency fact 逐字：{"sufficiency":{"goal":"GOAL-022","verdict":"insufficient"}}
```

⇒ 每轮都在重复它，而没有任何机制消费它（`gap-goal-sufficiency-insufficient-has-no-followup-signal` 补的就是这条信号，本任务就是它 spawn 出来的那一件事）。

### 一、当前未被覆盖的那句话（逐字）

`goals/GOAL-022-…md` 的 `## 范围与非目标` 节：

> 范围：main/serial/lowconc 三阶段的单文件地板全部压到30秒以下（15个已点名文件）+ 静态检查80用例
> mutation-check 并行化 + 自定义 runner 镜像消除重复装包。

**未被覆盖的是第三项，逐字：`自定义 runner 镜像消除重复装包`。**

同一件事在 goal title 里也有对应字样（逐字）：`瓶颈是文件粒度太粗+重复装包`；
在 `## 背景` 里有独立实测段落（逐字）：

> ②"Install suite runtime prerequisites" 这一步每次job都要重新apt装PyYAML/tmux/procps（~8秒），因为ephemeral容器不留状态，是纯粹重复劳动。

### 二、为什么在域 AC 集合不覆盖它（枚举，不是抽样；硬规则 3）

范围节共三个工作项（另有「非目标」一节，判官也被喂到）。逐项对在域 AC 集合 = `{AC-279, AC-280, AC-281}`（逐步取证自 `goals/AC-*.md` 的 `goal: GOAL-022` 且 `status != superseded`；与该轮判官的 `## In-scope ACs` 输入逐字一致）：

| 范围节工作项（逐字） | 对上的在域 AC |
|---|---|
| ① `main/serial/lowconc 三阶段的单文件地板全部压到30秒以下（15个已点名文件）` | AC-279 |
| ② `静态检查80用例 mutation-check 并行化` | AC-280 |
| ③ `自定义 runner 镜像消除重复装包` | **（无）** |

**第四条 AC-281 不是第三项的判据，是端到端结果判据**：它的 criterion 只读 `.quay/ci-runs.jsonl` 里 test job 的 `conclusion=="success" ∧ durationSec<=30` —— **它无法区分「快是因为消除了重复装包」与「快是因为别的原因」**，而且它自己一个字都不提装包/镜像/prereq。

**逐字 grep 取证（硬规则 2 的动作：计数 + 打印命中）**：

```
$ for f in goals/AC-279-*.md goals/AC-280-*.md goals/AC-281-*.md; do printf '%s ' "$(grep -c -iE '镜像|install|装包|prereq' "$f")"; echo "$f"; done
0 goals/AC-279-…
0 goals/AC-280-…
0 goals/AC-281-…
```

三条都 **0 命中**。⇒ 在域 AC 集合里**没有任何一条**提到「装包 / 镜像 / prereq / runner 环境」—— 不是「覆盖得弱」，是**零覆盖**。

⚠️ 这三个 0 的配套动作（硬规则 2 的另一半：零计数要把谓词对着一个**已知为真**的样本干跑）见 **AC4 负控制**：同一谓词对着 `.github/workflows/ci.yml` 的 `Install suite runtime prerequisites` 步（已知含 `install` / `apt-get` 字样）必须取到非零。

### 三、这不是「判官太严」：第三项是 ≤30s 目标的 **26.7%**，直接量

`gh api /repos/yaleh/quay/actions/runs/35167517872/jobs`（2026-09-17 逐字取回；`test` job `conclusion=success`，**总计 209s**）：

| step | 秒 |
|---|---|
| **Run tests** | 172 |
| **Install suite runtime prerequisites** | **8** |
| Run actions/setup-node@v4 | 7 |
| Test-coverage self-check | 3 |
| Set up job | 2 |
| Run npm install | 2 |
| Run actions/checkout@v4 | 1 |
| Materialize develop / Verify prerequisites / Bootstrap config | 0 + 0 + 0 |
| **合计（已归属）** | **195**（job 209 ⇒ 14s 未归属：秒级取整 + 步间间隙） |

同一读数已由载体唯一写面 `plugin/scripts/ci-runs-collect.ts` 落进 `.quay/ci-runs.jsonl`（`ts=2026-09-17T00:40:37Z`、`durationSec=209`、`testFiles=650`），与 AC-281 立案时读的 `CAUSE=too-slow … took 209s` 是同一行。

⇒ 结论（可反驳，且给得出对照）：**已归属的非 `Run tests` 步骤合计 23s = 30s 目标的 77%**；其中「重新装包」一项 **8s = 目标的 26.7%**。即使 `Run tests` 被压到 0，剩下的 23s（再加 209−195=14s 的未归属部分）也把 30s 预算吃掉 —— **AC-281 单靠拆分 15 个文件在算术上不可达**。

⇒ 范围节第三项**不是锦上添花，是 AC-281 的必要条件**；而它今天**没有自己的判据**。这正是充分性判官要挡的形态：一块必需的工作没有判据 ⇒ 没有判据牵引 ⇒ 机器只会为「有 AC 的」工作立案（`goal-driver.ts` 的 G9 缺口语义环按「active AC 零关联任务」立案）⇒ 它会被静默漏掉。

### 四、提案：新增 **AC-282**（option a）

**拟写入的 AC**（经 `goal-store.ts write AC-282 --expect-absent …`，⛔ 不手改 `goals/*.md`）

- **title（逐字；决定落盘文件名 `goals/AC-282-install-suite-runtime-prerequisites-这一步不再每次-job-重复装包-post-fi.md`，`slugify(title).slice(0,60)` 已对着 AC-281 的现名复算过）**：

  `Install suite runtime prerequisites 这一步不再每次 job 重复装包——post-filing 最新一次 develop CI test job 的日志派生出三个前置全部 already-present（零 per-job install）`

- **goal**: `GOAL-022`
- **criterion**: 下方草稿逐字。
- **expect**: 「criterion exits 0 once `.quay/ci-runs.jsonl` 里本 GOAL 立案之后最新一次 develop CI test job 的 `prereqProvision` 读数显示三个前置**全部**为 `already-present`；任一为 `installed-*` ⇒ exit 1；读数缺失 / 派生不出 ⇒ exit 1 且带**独立 CAUSE**（⛔ 不与通过同形）。」
- **origin**: 「GOAL-022 范围节第三条『自定义 runner 镜像消除重复装包』；`## 背景` 实测该步每次 job 重装 PyYAML/tmux/procps ~8s；该步占 30s 目标的 26.7%。」

**criterion 草稿（逐字，供人审）**：

```python
python3 - <<'CRIT'
import json, os, sys

CAR = ".quay/ci-runs.jsonl"
SINCE = "2026-09-17T00:45:02Z"   # GOAL-022 的 activatedAt = 本 GOAL 立案时刻（退出条件句的锚）
NEED = ("pyyaml", "tmux", "procps")

if not os.path.exists(CAR):
    sys.stderr.write("CAUSE=carrier-absent — %s does not exist, so no CI-run reading can be made at all\n" % CAR); sys.exit(1)

rows = []
for ln in open(CAR, encoding="utf-8"):
    ln = ln.strip()
    if not ln:
        continue
    try:
        r = json.loads(ln)
    except Exception:
        continue
    if r.get("workflow") != "CI":
        continue
    if r.get("branch") != "develop":
        continue
    if str(r.get("ts") or "") <= SINCE:
        continue
    rows.append(r)

if not rows:
    sys.stderr.write("CAUSE=no-post-filing-run — no CI run on develop with ts > %s exists yet in %s\n" % (SINCE, CAR)); sys.exit(1)

rows.sort(key=lambda r: r.get("ts") or "")
latest = rows[-1]

job = None
for j in latest.get("jobs") or []:
    if j.get("name") == "test":
        job = j
        break

if job is None:
    sys.stderr.write("CAUSE=no-test-job-in-latest-run — the latest post-filing develop CI run (%s, %s) has no 'test' job entry\n" % (latest.get("runId"), latest.get("url"))); sys.exit(1)

prov = job.get("prereqProvision")

if not isinstance(prov, dict):
    sys.stderr.write("CAUSE=prereq-provision-not-recorded — the test job of run %s (%s) carries no prereqProvision reading, so per-job re-installation cannot be judged from this carrier. This is NOT-EVALUATED, not 'no install happened'.\n" % (latest.get("runId"), latest.get("url"))); sys.exit(1)

missing = [k for k in NEED if k not in prov]

if missing:
    sys.stderr.write("CAUSE=prereq-provision-incomplete — prereqProvision lacks %s (got keys %s)\n" % (missing, sorted(prov))); sys.exit(1)

unreadable = {k: prov[k] for k in NEED if prov[k] == "absent"}

if unreadable:
    sys.stderr.write("CAUSE=prereq-provision-underivable — run %s (%s): %s could not be derived from the job log (NOT-EVALUATED)\n" % (latest.get("runId"), latest.get("url"), unreadable)); sys.exit(1)

installed = {k: prov[k] for k in NEED if prov[k] != "already-present"}

if installed:
    sys.stderr.write("CAUSE=still-reinstalling-every-job — run %s (%s) provisioned %s INSIDE the job (measured 2026-09-17: this step cost 8s of a 30s target = 26.7%%)\n" % (latest.get("runId"), latest.get("url"), installed)); sys.exit(1)

print("OK — run %s (%s, ts=%s): %s were all already present; the install step took the no-op path" % (latest.get("runId"), latest.get("url"), latest.get("ts"), ", ".join(NEED)))

sys.exit(0)
CRIT
```

**载体的契约（判据要读的那个量必须穿得过中间层 —— 硬规则 4c）**：`prereqProvision` 是 `jobs[]` 上新增的**派生**字段，取值词表：

```
"already-present" | "installed-apt" | "installed-pip"（tmux/procps 只有 already-present | installed-apt）| "absent"
```

- **写面 = `plugin/scripts/ci-runs-collect.ts`**（载体 `.quay/ci-runs.jsonl` 的**唯一写面**），派生自该 run 的 `test` job 日志 —— 与既有 `testFiles`（`deriveTestFilesFromLog`，读 `__GROUP__ … files=N`）**同一条日志下载路径**（`--log-fetch decisive` 已经会拉这份日志），不新增网络调用。
- **先例是 `seaVerify`**（同文件、同注释族）：载体里没有承载该读数的字段时，判据只能停在 `CAUSE=carrier-absent`，而那是结构性的（硬规则 4 推论三：实现了、测试绿了、生产没跑过）。`seaVerify` 的注释逐字写着这件事，并给出 `absent` 这个**独立取值**表示「没评估成」。本字段照抄这个形状。
- **`absent` 是独立取值，⛔ 绝不回落成 `already-present`**（硬规则 3b：读不懂不得冒充合格）。「日志拉到了但三条 marker 一条都没有」也必须是 `absent`，**不是**通过。
- 为了让派生不被散文措辞绑死，workflow 那一步应打印机器可读的一行（house 形：`__GROUP__` / `__PERFILE__`），例如 `__PREREQ__ pyyaml=already-present`；那一步今天已经在 `gap-ac281-develop-ci-test-job-wallclock-under-30s` 的 Touches 里（`.github/workflows/ci.yml`）。⛔ 但**不要求**为此新增或删除 workflow 步骤：`plugin/test/ci-runner-env-prereqs.test.mjs` 断言那一步的 install 配方必须**仍在**（删掉会立刻红），本提案只要求它**不再被执行**（走 `already-present` 分支）。

**备选载体形状（人可改判，二选一）**：把 `jobs[].steps[]` 补上 `durationSec`（GitHub 的 jobs API 本来就返回每个 step 的 `started_at`/`completed_at`，`ci-runs-collect.ts` 的 `GhJob.steps` 类型目前只留了 name/conclusion/number），判据改读「install 步的时长」。⛔ 我不推荐它做**主**判据：那要为一个尚未测量的快路时长设一个阈值（硬规则 4 推论一：成本结构未知前不设数值阈值），而 `already-present` / `installed-*` 是**有名字的两种观测**，不需要数字。

### 五、退出条件句的配套改字（最小改动；范围节不动）

现状（逐字）：

> 三条 AC 全部 achieved：AC-279（15个原地大文件全部被拆分/移走）、AC-280（checker-mutation-check.sh
> 的用例循环真正并行化）、AC-281（.quay/ci-runs.jsonl 里本 GOAL 立案之后的最新一次 develop CI
> test job 是 success 且 durationSec ≤30）。

改为（拟，逐字）：

> 四条 AC 全部 achieved：AC-279（15个原地大文件全部被拆分/移走）、AC-280（checker-mutation-check.sh
> 的用例循环真正并行化）、AC-282（"Install suite runtime prerequisites" 不再每次 job 重复装包——
> post-filing 最新一次 develop CI test job 的日志派生出三个前置全部 already-present）、AC-281
> （.quay/ci-runs.jsonl 里本 GOAL 立案之后的最新一次 develop CI test job 是 success 且 durationSec ≤30）。

为什么必须一起改：退出条件句**逐字枚举**了 AC 编号，加了 AC-282 而句子仍写「三条 AC」，body 就自相矛盾；而 `sufficiencyCacheKey` 含退出条件文本 ⇒ 这一改会**同时**换掉判官的缓存 key，触发重判（AC3）。

### 六、与在飞任务的关系（⛔ 不是重复立案）

<!-- dedup-ref -->
- 本 store 内**没有任何任务提议过 GOAL-022 的 AC / 退出条件改动**：逐文件扫 `^goal_ac:`，命中 GOAL-022 的只有三条 AC 的**执行**任务 —— `gap-suite-split-15-over-30s-test-files`（ready，AC-279）、`gap-checker-mutation-parallel-case-loop`（ready，AC-280）、`gap-ac281-develop-ci-test-job-wallclock-under-30s`（todo，AC-281）。三条都只是**把已有 AC 做出来**，不碰 AC 集合或退出条件文本。本题立案前按机制词复扫一次（`重复装包` / `runner 镜像` / `runner image` / `PyYAML` / `Install suite runtime prerequisites`）亦无第四条命中该机制。
- `gap-ac281-develop-ci-test-job-wallclock-under-30s`（todo）的 Plan 第 3 步**已经点名**要处置这一项（逐字：「① `Install suite runtime prerequisites`（apt PyYAML/tmux/procps，每次 job 重装）… 处置方向按 GOAL-022 范围第三条：**把重复装包移出每次 job**（runner 侧预置 / 镜像 / 缓存）」），它的 Touches 含 `.github/workflows/ci.yml`。**它的存在恰恰是「第三块工作真的有人要做」的证据，但它认领的是 AC-281** —— 而 `goal_ac` 是单值标量，一条任务不能同时认领两条 AC（见 `docs/references/task-schema-canonical.md`）。本条提案补的是**判据**那一半（让第三块工作有自己的、可独立判定的 AC），不是重复它的工作。
- ⇒ 两者改的对象不同：本任务改 `goals/` 里的 AC 集合与退出条件文本；`gap-ac281` 改 `.github/workflows/ci.yml` 等实现面。本任务**不**依赖它先落地 —— 提案的覆盖论证只用到判官的输入集合与今天的直接量读数。

### 七、一条已知的、必须让人先看到的取舍

AC-282 落地后，它的 criterion 在今天**仍会 exit 1**，但成因是 `CAUSE=prereq-provision-not-recorded`（载体还没有这个字段）—— 这是**诚实的 NOT-EVALUATED**，不是「没通过」。要让这条 AC **可被判定**需要两次落地：① 载体侧派生 `prereqProvision`（写面 `ci-runs-collect.ts`）；② runner 环境真的预置了三个前置（范围节第三条的本体）。⛔ 只有 ① 不会变绿（三条 marker 全 `absent` ⇒ 仍 exit 1），这正是判据「把量挪到产物上」的意图（硬规则 4 推论三）。

**人若认为这条耦合不可接受，那就是改判 option (b)（把范围节第三条删掉）的理由** —— 我不推荐：第三节给的算术使它成为 AC-281 的必要条件。

## AC

- [ ] **AC1｜AC-282 已由 goal store 写入，且其 criterion 能被逐字提取并当场干跑。** 核法：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts get AC-282 --json` 取出 `criterion`，把该字符串**逐字**交给 `bash`（⛔ 不手抄、⛔ 不朴素 join 折叠块 —— 见 `goals/AC-161-*.md` 的提取先例），**在今天的载体上逐字跑**：必须 **exit 1** 且 stderr 的 `CAUSE=` ∈ {`prereq-provision-not-recorded`, `still-reinstalling-every-job`}（两者都可，取决于载体是否已补派生字段）。**exit 0 视为本 AC 失败**（今天不可能为真 ⇒ 若为真说明判据是恒真的）。贴出：提取命令、criterion 全文、exit code、逐字 stderr。写入必须用 `goal-store.ts write AC-282 --expect-absent …`（⛔ 手改 `goals/AC-282-*.md` 不算；`--expect-absent` 防并发立案互相覆盖）。
- [ ] **AC2｜退出条件句已改完且其余节逐字未动。** 核法：`goal-store.ts get GOAL-022 --json` 取 `body`，四条子断言全真 ⇒ exit 0：① **不含**子串 `三条 AC 全部 achieved`；② **含**子串 `四条 AC 全部 achieved` 与 `AC-282`；③ `AC-279` / `AC-280` / `AC-281` 三个串仍各在场；④ `## 背景` / `## 范围与非目标` / `## 执行主机` / `## 退出条件` 四个节标题仍在（防整篇替换时丢节）。任一假 ⇒ exit 1，stderr 与 failure exit **写在同一物理行**，带 `CAUSE=old-clause-still-present` / `CAUSE=new-clause-absent` / `CAUSE=ac-ids-lost` / `CAUSE=body-sections-lost`。并贴出 `git diff` 证明 `## 范围与非目标` 节正文**逐字未改**（范围节不改是本提案的一部分）。
- [ ] **AC3｜判官在【新 key】上重判过一次（⛔ 不是缓存命中）。** 核法：改前记下 `entries["GOAL-022"].key = a2c80835e429d04191d4370a159f135b20672c4be1a3452531e4282c41775c65`；改后断言 ① `.quay/goal-sufficiency-cache.json` 里**原 key 条目仍在且逐字未变**（`{'verdict':'insufficient','ts':'2026-09-17T00:55:37.997Z'}`，历史不被改写）② 出现一个**新** key 条目（`sufficiencyCacheKey` 含退出条件文本与范围节文本 ⇒ body 一改 key 必变）③ `.quay/goal-round.jsonl` 其后落一条 `goal-sufficiency` fact。⚠️ **新 verdict 是否翻成 `covered` 不作本任务的成功判据** —— 若仍是 `insufficient`，把读数与判官输入（title / 退出条件 / 范围节 / in-scope ACs）逐字记进任务体并**停手另立根因**；⛔ 不得为了让判官变绿而反复改文本或改提示词（那会把判官变成回声）。
- [ ] **AC4｜负控制（两向都取读数，硬规则 2 的两半）。** ① **零计数的方向**：把 AC1 里那组 `grep -c -iE '镜像|install|装包|prereq'` 谓词对着 `.github/workflows/ci.yml` 的 `Install suite runtime prerequisites` 步干跑 ⇒ 必须取到**非零**（证明「三条 AC 全 0」不是谓词读不懂输入）；② **谓词能取假的方向**：把 AC2 的谓词对着**改前**的 body 干跑 ⇒ 必须 exit 1 且 `CAUSE=old-clause-still-present`（改前 `三条 AC 全部 achieved` 在场、`AC-282` 不在场）。两次读数（命令 + 逐字输出 + exit code）贴进任务体。硬规则 3b：没有这一条，AC1/AC2 与「没查」同形。

## DoD

**真实落地 = goal store 里 AC-282 真的在、GOAL-022 的退出条件句真的改了、判官真的在新 key 上重判过一次，且 AC-282 的 criterion 被逐字提取后在**今天的载体上**当场干跑过（今天必须红，且红在一个可区分的 `CAUSE=` 上）** —— ⛔ 不是「任务体里写了一段待批的建议文本」。

1. **落地对象**：`goal-store.ts get AC-282 --json` 返回该 AC，`goal=GOAL-022`、`kind=criterion`、`status=active`（写入经 goal store，⛔ 未手改任何 `goals/*.md`）。
2. **可被打红**：AC1 的干跑 exit 1 + 可区分的 `CAUSE=`；AC4 的两向读数都在。
3. **文本最小改动**：AC2 的四条子断言 + `## 范围与非目标` 节逐字未改的 diff。
4. **判据不空转**：AC3 的新 key 条目 + 轮记录 fact（⛔ 不是缓存命中；⛔ 不以 verdict 变绿为成功判据）。
5. **证据留痕**：上述读数落成 `.quay/ac282-*` 证据文件或写进任务体，**可被下一轮独立复算**。

⛔ **本任务不动任何状态**：不写 GOAL-022 的 `status`（保持 `active`）、不写 AC-279/280/281 的任何字段（保持 `active`）、不翻任何 AC 为 achieved。

## Touches

- goals/AC-282-install-suite-runtime-prerequisites-这一步不再每次-job-重复装包-post-fi.md (new)
- goals/GOAL-022-self-hosted-ci-test-job-墙钟压到-30-秒内-128核机器实测93-9-空闲-瓶颈是文件粒度太粗.md
- tasks/gap-goal022-scope-item3-prereq-reinstall-uncovered.md

⛔ **无测试文件、不新增 `plugin/scripts/*` 检查器**：本任务无代码路径（产物是 goal store 里的 **AC-282 记录 + GOAL-022 的退出条件文本**），其判据是 AC1/AC2 的可执行谓词当场干跑（含 AC4 负控制），不进套件。⛔ 载体侧派生 `prereqProvision`（`plugin/scripts/ci-runs-collect.ts`）与 runner 预置是**下游工作**，不是本任务的 Touches —— 本任务只把判据放进 store。
