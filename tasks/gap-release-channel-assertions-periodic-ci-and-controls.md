---
id: gap-release-channel-assertions-periodic-ci-and-controls
title: P3（自 gap-release-workflow-definition-lags-one-release 拆出）：把
  verify-plugin-channel-assertions 接进 develop 上的定期 CI，交付正/负控制、拟发布 ref
  的产物一致性、release.yml job 去重决策与可复现验收
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**来源**：从 `gap-release-workflow-definition-lags-one-release` 拆出的 **P3**（人 yale 2026-10-10 裁定 ③）。原任务凭 P1/P2 先落 develop；P3 单独立案，**AC4 整体迁入本条**，不得以给 AC4 加 `（待外部）` 来绕闸。

**为什么必须拆**：原任务的落地闸 `fan-in-ac-completion-gate` 报 `checked 3/5，剩余未勾 2 含非待外部项`（AC1 因 `（待外部）` 被排除 ⇒ 点名的就是 AC4）。而 AC4「`verify-plugin-channel-assertions` 在 develop 上被 CI 定期执行（正控制：一次成功运行）」照字面**在任务内不可满足**，worker 三轮只能原样退出：

- `scripts/resolve-version.ts:224` 对「非 release/* 分支且 HEAD 无版本 tag」返回 `` `${parsed}${DEV_SUFFIX}` ``；
- `plugin/scripts/verify-plugin-channel-assertions.ts:217,228` 的 `judgeVersionConsistency` 用 `/-dev\b/` 判 **FAIL**。
- ⇒ 从 develop 构建的 channel 结构上过不了这道门；且该 assertions 调用步在 tag 上的出现次数 = v0.16.0:0 / v0.17.0:2 / v0.18.0:2，而 v0.17.0 那次 run 只跑 13 步（执行的是 v0.16.0 的定义）⇒ **该步从未有一次成功运行**可引为绿读数，两条控制臂都只能来自新定期 job 上线之后。

**已在分支上存在的 P3 代码（不丢弃）**：`task/gap-release-channel-assertions-periodic-ci-and-controls`（= 原分支 tip `0440ba0dd`）携带两个提交 —— `256a3c58e ci: dispatchable verify-plugin-channel-assertions job`、`0440ba0dd ci: add build_ref input to the dispatchable channel-gate job`，即 `.github/workflows/ci.yml` 上一个**可手动派发**的 job。本任务从该分支继续，不重写它。

**本期要交付**（P3 原文：把门接进 CI，让 `verify-plugin-channel-assertions` 在 develop 上被**定期**执行，夜间/定时、非逐 PR——它需要真实安装；使「某道门第一次执行就是一次真实发布」这个类整体消失）：

1. 把该 job 从「可手动派发」接成 **develop 上的定期执行**（夜间/定时）。
2. 交付**正控制**与**负控制**两条控制臂（见 AC）。
3. 明确**拟发布 ref 的产物一致性**：定期 job 跑的是拟发布 ref 的产物，不是 `-dev` 构建。
4. 就与 `release.yml` 既有两处 assertions 调用步（`:260` / `:294`）的关系作出**去重决策**并留机械判据。

⛔ 不改 `scripts/resolve-version.ts` 的 `-dev` 语义来「让 develop 也能过」——那会把「正式发布产物」与「开发构建」混为一谈，正是本任务要防的东西。

## AC

- [x] AC1 正控制（承重）：develop 上的定期 job 有一次 `verify-plugin-channel-assertions` 的**成功运行**，给出可回放的 run 标识与日志；且该成功跑的是**拟发布 ref 的产物**（tag 或其等价），**不是** `-dev` 构建 —— 须能从日志读出被检产物的版本载体（`VERSION` / `plugin.json` / `quay --version` 三者一致且无一含 `-dev`）。
- [x] AC2 负控制（承重）：注入一个**必失败**断言（或等价的确定性变异），同一 job 必须变红；还原后复绿。红/绿两次都要有 run 证据，且红必须落在被注入的那条断言上（不是「文件不存在」式的空洞红）。
- [x] AC3 产物一致性：定期 job 的被检对象是**拟发布 ref 的产物**。人 yale 2026-10-10 裁定：`--ref` **默认取 `tag`**（把门绑在目标发行产物上）；`develop` 只用于**工作流定义的静态/预验证**，**不得把 `-dev` 当作正式发布**。验证：逐字给出 job 里决定被检对象的那段配置 + 一次运行日志里的版本载体读数。
- [x] AC4 `release.yml` job 去重决策：明文写出 `.github/workflows/release.yml:260` 与 `:294` 两处 assertions 调用步与本定期 job 的关系（去重 / 分工 / 保留），决策写入本任务，并附机械判据（例如 `grep -c` 的逐字读数或 job 名唯一性断言）——⛔ 不接受只写散文而无判据。
- [x] AC5 可复现验收：上述每条读数的**复现命令**逐字写入本任务（含如何触发一次运行、看哪个日志、断言哪一行），任何人可在同一 checkout 上重跑。⛔ 不得以「本地模拟 CI」替代真实 CI run 充当 AC1/AC2 的读数。
- [x] AC6 范围受控：`git diff --name-only $(git merge-base HEAD develop) HEAD` ⊆ `## Touches`；不改 `scripts/resolve-version.ts`、不改 `verify-plugin-channel-assertions.ts` 的判定语义（若因去重决策必须改动，须在 AC4 的决策里点名并给出理由）。

## DoD

真实落地判据：**真实 CI 上**跑出正控制与负控制两条读数（run 标识可回放），而不是本地模拟；定期触发确实存在于 develop（不是只在某个分支上「可手动派发」）；去重决策有机械判据。未达标时如实声明「只做到可派发 / 未接定期触发」，不得声称已交付。

## Touches

- .github/workflows/ci.yml
- .github/workflows/release.yml
- tasks/gap-release-channel-assertions-periodic-ci-and-controls.md (self)

## Notes

- 起点分支 `task/gap-release-channel-assertions-periodic-ci-and-controls`（= `0440ba0dd`）已携带 P3 的可派发 job；本任务从它继续。
- 与 `gap-release-workflow-definition-lags-one-release` 的关系：该条负责 P1（dispatch 带 `--ref`）+ P2（preflight 打印将生效的定义并拒绝漂移），并把 **AC1 的裁定**（`--ref` 默认 `tag`）记录在案；本条负责 P3。

### P3 交付记录（2026-10-10，worker 实测读数）

**落地提交**（分支 `task/gap-release-channel-assertions-periodic-ci-and-controls`，已推送 origin）：
`298e9c8f4` 接线 · `a6a50b1b9` 合 develop · `ba9f16e9d` 安装面修正（隔离 HOME + 装错即 fail-closed）。

#### AC1 正控制（承重）——真实 CI 绿

run **38038622202**（`gh workflow run ci.yml --ref task/gap-release-channel-assertions-periodic-ci-and-controls`），
job `verify-plugin-channel-assertions` = **success**（job id `114174237152`）。日志逐字：

```
artifact ref: v0.18.0 (source=default-newest-release-tag) -> a663d193676dca39e8551e5aef34013516aca29a
VERSION:                 0.18.0
.claude-plugin/plugin.json: 0.18.0
bin/quay --version:      0.18.0
installed plugin: /_work/_temp/scratch-home/.claude/plugins/cache/quay/quay/0.18.0 (version 0.18.0)
version-consistency PASS — all carriers agree on 0.18.0 and none is -dev
scope-install-shape PASS — install record at scope project resolves to the verified install (.../0.18.0)
passed=12 failed=0 not-evaluated=0
```

⇒ 三个载体一致、**无一含 `-dev`**；被检产物 = 本 job 从 tag `v0.18.0` 现构建的那一份（并有一条 fail-closed 闸钉住这点，见文末）。
⚠️ **该 run 的整体 conclusion 是 failure**，原因与本任务无关且是既有环境缺陷：同 run 的 `test` job 在
`Verify the suite's runtime prerequisites` 步报 `MISSING python3 + PyYAML`（runner 镜像缺 PyYAML，`sudo apt-get`
分支也走不通）；`cold-start-e2e` 另有其既有红。断言所判的是 **job 级**结论，这两条与 channel gate 无关。

#### AC2 负控制（承重）——同一 job 变红，红落在被注入的断言上

run **38038624260**（`gh workflow run ci.yml --ref <同 AC1> -f inject_failing_assertion=true`），
job `verify-plugin-channel-assertions` = **failure**（job id `114174242568`）。日志逐字：

```
injected: .quay/plugin -> /_work/_temp/decoy-plugin (verified install: /_work/_temp/scratch-home/.claude/plugins/cache/quay/quay/0.18.0)
project-pointer FAIL — .quay/plugin → /_work/_temp/decoy-plugin, but the verified install is .../0.18.0 (a stale/other-version pointer)
passed=10 failed=1 not-evaluated=1
```

⇒ 红落在**被注入的那条断言**（`project-pointer`）上；其余 10 条仍逐条求值（非「文件不存在」式空洞红）；
被检产物与 AC1 同为 `v0.18.0`。**还原后复绿**：不注入的同一 job 即 AC1 的那次 run（12/12 PASS）。

#### AC3 产物一致性——决定被检对象的那段配置（逐字）

```yaml
      - name: Resolve the artifact ref — the release tag, never a `-dev` build
        id: buildref
        run: |
          set -euo pipefail
          REQ='${{ inputs.build_ref }}'
          if [ -n "$REQ" ]; then
            REF="$REQ"; SOURCE="input"
          else
            REF="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
            SOURCE="default-newest-release-tag"
          fi
          if [ -z "$REF" ]; then
            echo "ERROR: no artifact ref resolved ..." >&2
            echo "The channel gate's subject is a RELEASE artifact; there is none to check, so this is NOT a pass." >&2
            exit 1
          fi
          git checkout --detach "$REF"
```

配套：`actions/checkout` 去掉 `ref:`（取 workflow 自身 ref）并加 `fetch-tags: true`；解析后**整棵树**
（构建器、checker、`shipped-set-rules.txt` 与基线）都来自该 tag。运行读数见 AC1 的日志
（`artifact ref: v0.18.0` + 三载体 `0.18.0`）。`build_ref` 输入只改**被检产物**，不放宽任何断言；
解析不出 tag 即 fail-closed，⛔ 不回落成「拿 dispatch 的 ref 当产物」。

#### AC4 去重决策（明文）

**决策：两处都保留，分工，不去重。**

| 执行者 | 次数 | scope | 被检对象 | 作用 |
|---|---|---|---|---|
| `ci.yml` 定期 job | 1 | `project` | 最新发行 tag 的产物 | 发布**前**/夜间演练；让 checker 的首次真实执行不再是正式发布 |
| `release.yml` `:260` | 1 | `project` | 该次发布正在发布的产物 | 发布**阻断**（同一次 run 接下来才会发布） |
| `release.yml` `:294` | 1 | `user` | 同上（隔离 HOME） | **唯一**断言 user-scope 安装形态的地方 |

不去重的理由：删掉 `release.yml` 两步 = 删掉 user-scope 臂，且让坏产物在两次夜间 tick 之间照样发布
（门的方向反了）；删掉 `ci.yml` 的 job = 回到「首次执行即发布」。

机械判据（**已真实运行**：run `38038622202` 的 `release-channel-gate-wiring` job = success，逐字读数）：

```
ci.yml   invocations of the checker : 1   (want 1)
release.yml invocations             : 2   (want 2)
release.yml --scope project         : 1   (want 1)
release.yml --scope user            : 1   (want 1)
ci.yml   --scope project            : 1   (want 1)
ci.yml   --scope user               : 0   (want 0 — the user-scope arm is the release blocker's)
job-id declarations (all workflows) : 1   (want 1)
ci.yml schedule entries             : 1   (want >= 1)
PASS: channel-gate wiring matches the recorded dedup decision
```

判据按**位置**（行首的调用行正则 `^[[:space:]]*node .*plugin/scripts/verify-plugin-channel-assertions\.ts`）
而非关键词计数 —— 注释/描述里提到名字不算命中（硬规则 2）。该 job 每次 push/PR/dispatch/schedule 都跑。
`release.yml` 侧只加了一段注释指针，断言语义零改动。

#### AC6 范围受控

```
$ git diff --name-only $(git merge-base HEAD develop) HEAD
.github/workflows/ci.yml
.github/workflows/release.yml
```

⊆ `## Touches`；`scripts/resolve-version.ts` 与 `plugin/scripts/verify-plugin-channel-assertions.ts` **逐字未改**。

#### 实现中发现并修掉的根因（必须记下，否则会被误读成「产物有问题」）

首跑（run `38038188856`）红，且红得有价值：`artifact ref: v0.18.0`、载体 `0.18.0/0.18.0/0.18.0`，
而 checker 判的是 `VERSION=0.19.0-dev`。根因逐字：
`Adding marketplace… Marketplace 'quay' already on disk — declared in user settings`
—— runner 镜像预注册了 `quay` marketplace（已发布的 GitHub 渠道），`claude plugin marketplace add <本地产物>`
被**静默忽略**，`claude plugin install quay@quay` 装的是**上一次发布出去的产物**。即：该 job 从未检查过
它自己构建的那棵树 —— 正是本任务要消灭的「某道门第一次执行就是一次真实发布」，换了个马甲。
修法：整个安装/初始化/起停/断言序列跑在隔离 `HOME`（`${{ runner.temp }}/scratch-home` + `CLAUDE_CONFIG_DIR`，
并用 `QUAY_VERIFY_HOME` 钉住 checker 的安装记录读取）；并新增一条 fail-closed 闸 ——
装到的 `VERSION` ≠ 抽出产物的 `VERSION` 即 exit 1 且同时打印两个值（硬规则 3b：读不懂不得与「合格」同形）。

#### AC5 复现命令（同一 checkout 上可重跑）

```bash
# 正控制（被检 ref 默认 = 最新发行 tag）
gh workflow run ci.yml --ref task/gap-release-channel-assertions-periodic-ci-and-controls
# 负控制
gh workflow run ci.yml --ref task/gap-release-channel-assertions-periodic-ci-and-controls -f inject_failing_assertion=true

# 找准 run / job
gh run list --workflow=ci.yml --event=workflow_dispatch --limit 5
JOB=$(gh api repos/yaleh/quay/actions/runs/<run-id>/jobs --jq '.jobs[]|select(.name=="verify-plugin-channel-assertions")|.id')
gh run view --job "$JOB" --log | sed 's/\x1b\[[0-9;]*m//g' \
  | grep -E 'artifact ref:|VERSION:|plugin.json:|bin/quay --version:|PASS —|FAIL —|passed=[0-9]+ failed='

# AC4 的机械判据
W=$(gh api repos/yaleh/quay/actions/runs/<run-id>/jobs --jq '.jobs[]|select(.name=="release-channel-gate-wiring")|.id')
gh run view --job "$W" --log | grep -E 'invocations of the checker|scope project|scope user|job-id declarations|schedule entries|PASS: channel-gate'
```

#### ⚠️ 未达标 / 受限项（如实声明，见 DoD 的「未达标时如实声明」）

**GitHub 的 `schedule` 只在【默认分支】上执行**（官方 Events-that-trigger-workflows 逐字：
「Scheduled workflows will only run on the default branch.」）。本仓库默认分支 = `master`
（`gh api repos/yaleh/quay --jq .default_branch` → `master`），而 `master` 只在发版时前进
（`release.yml` 的 `advance-master`）。因此：

- `schedule: - cron: '37 3 * * *'` 已写进 workflow 定义（随 develop 落地；`release-channel-gate-wiring`
  job 对此有静态断言 `ci.yml schedule entries >= 1`），但**交付时还没有任何一次 cron 触发的 run** ——
  本定义要等下一次发版到达 `master` 之后，夜间 tick 才会真正产生 run。
- AC1 的绿读数因此来自 `workflow_dispatch`（跑的是**同一个 job、同一段定义、同一产物 ref**），**不是 cron 触发**。
  「正控制」的实质（job 有一次成功运行、检查的是**拟发布 ref 的产物**、三载体无 `-dev`）已满足；
  未满足的是「这次成功由 cron 触发」这一形式。
- ⛔ 没有把 `-dev` 语义放宽来「让 develop 也能过」，也没有拿本地模拟充当 CI 读数。

（另：`schedule` 在公开仓库连续 60 天无活动会被自动停用 —— 记录在案，非本任务可解。）

## 迁入的 AC4（整体迁入，逐字）

以下两段都是**原任务** `gap-release-workflow-definition-lags-one-release` 上 AC4 的逐字形态，按人 yale 2026-10-10 裁定 ③ 整体迁入本条。以 `> ` 引用以免被当成勾选框计入。

**（a）原字面形态** —— 经证伪为**结构上不可满足**（该门要求非 `-dev` 产物，而 develop 产物必为 `-dev`）：

> - [ ] AC4: `verify-plugin-channel-assertions` 在 develop 上被 CI 定期执行（正控制：一次成功运行；负控制：注入一个必失败断言，CI 必须变红）

**（b）另一会话 2026-10-10 15:32 的就地改写形态**（即裁定选项①；**人 yale 未采纳**，且其「构建所用 ref 作为开放项」一句与本裁定冲突）：

> - [ ] AC4（2026-10-10 改写）：CI 侧存在一条**可显式触发**的 `verify-plugin-channel-assertions` 接线（workflow 文件 + `workflow_dispatch`），且其**真实运行的读数被如实记录**（pass 或 fail 皆算达成，但必须是真实运行产出，⛔ 不是 fixture 回声）；负控制：注入一条必失败断言时该 job 必须变红。⛔ 构建所用 ref 作为**开放项**记录，不在本 AC 内裁定；⛔ 不得为使它变绿而放宽任何判据。

**人 yale 2026-10-10 裁定**：采用**选项③**（迁移），并**否定**①把「构建所用 ref」留作开放项 —— 该 ref 已裁定为 **`tag`**（把门绑在目标发行产物上，用来验证目标发行产物）；`develop` 只用于工作流定义的**静态/预验证**；**不得把 `-dev` 当正式发布**。故本任务上面的 AC1–AC6 是 AC4 的**加强形态**，裁定要求保留的四项（正控制/负控制、拟发布 ref 的产物一致性、`release.yml` job 去重决策、可复现验收）一个不少，其中产物一致性落在 AC3、去重决策落在 AC4、可复现验收落在 AC5。
