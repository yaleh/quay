---
id: gap-develop-ci-red-node20-floor-and-static-not-evaluated
title: 真实 develop CI 恒红：dist-verify-node-floor 在它要验证的 Node 20 底线上调用
  `--experimental-strip-types`（该 flag 需 Node ≥22.6）致打包闸 fail-closed；test job 三条
  STATIC_CHECK_NOT_EVALUATED 后退出 1 ⇒ AC-281 恒不可达
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**问题（直接量，2026-09-26）**：AC-281（GOAL-022「CI 与 release 渠道成为可信守门员」）判据报红，逐字：
`CAUSE=latest-run-not-green — the latest post-filing CI test job (https://github.com/yaleh/quay/actions/runs/36205553373) concluded 'failure', not 'success'; a fast-but-broken run does not satisfy this AC`
载体 `.quay/ci-runs.jsonl`（652 行）最近 6 次 develop CI **全部 `failure`**，`durationSec` 151–292 ⇒ 既非 success，也远高于判据的 ≤30。

**两个 job 的成因（逐字取自 `gh run view 36205553373 --log-failed`）**：

① `dist-verify-node-floor`（17s，卡在 "Build the npm-pack tarball"）：
```
Checking the .sh delivery form on the staged copy (declared entry surface vs consumer docs)...
node: bad option: --experimental-strip-types
ERROR: the staged plugin's .sh delivery form is not an argued decision — see above.
```
该 job 的用途正是"确认 runner 真在声明的底线上"——`.github/workflows/ci.yml:279-281` 钉 `node-version: '20'` 并断言 `node --version | grep -E '^v20\.'`；而 `packages/quay/scripts/package.sh:145` 调 `${PLUGIN_DEST}/scripts/capability-catalog.sh --entry-surface`，该检查内部以 `node --experimental-strip-types` 运行，**此 flag 自 Node 22.6 才有** ⇒ 在它要验证的底线上**必然**崩，随后打包闸 fail-closed（`package.sh:152` 的 `exit 1`）。⇒ 结构性矛盾（验证底线的 job 自己用了高于底线的语法），⛔ 不是偶发、⛔ 不是网络或 runner 问题。

② `test`（1m24s，退出 1）：821 个测试文件全部通过（`__GROUP__ concurrency=128 files=821 sum_ms=1794916`、末组 `pass 5 / fail 0`、`tmux-leak-scan: clean`），但该 run 的静态检查阶段出现三条：
```
STATIC_CHECK_NOT_EVALUATED: primitives-drift-check
STATIC_CHECK_NOT_EVALUATED: gate-event-coverage-check
STATIC_CHECK_NOT_EVALUATED: direct-to-develop-bypass-check
```
⚠️ **诚实标注（本条的因果未钉死）**：在 `--log-failed` 输出里我**没有**定位到 test job 的 `##[error]` 行，"三条 NOT_EVALUATED 触发兜底红 ⇒ 退出 1"目前只是**与形状一致的最可能解释**，不是已证结论。AC1 要求先把它钉死，⛔ 立案文本不得被当作结论引用。

**做法方向**：① dist job：让那条 .sh 交付形态检查在 Node 20 上可跑——要么改为不依赖 `--experimental-strip-types` 的形式，要么把"底线证明"与"需要高版本语法的打包检查"分成两条路径（该 job 想证明的是**npm-pack 产物能在声明的 Node 底线上安装并运行**，不是"打包脚本本身能在 Node 20 上跑"）；② test job：先钉死三条 NOT_EVALUATED 的成因（缺 ref / 缺文件 / 判据要求高于 CI 环境），再决定补前置还是改判据。⛔ AC-281 的 `success` 与 `durationSec <= 30` 两个条件都不动，⛔ 不靠放宽判据让它变绿。

**已知约束（实现时须遵守）**：`packages/quay/scripts/package.sh` 与 `plugin/scripts/capability-catalog.sh` 都在 `plugin/scripts/sh-census-check.ts` 的全文件代码行计费范围内（当前基线 `embeddedInterpreterLines=7686`=基线，零余量）⇒ 改动必须**净增代码行 ≤0**（注释行免费；`if ! x; then…fi` 三行可折成 `x || …` 一行以抵扣）。若改到 `develop-deliver-tgz.sh` 之外的脚本，另注意其被引用的行号（本仓有按 `<file>:<line>` 引用的惯例）。

## AC
- [ ] AC1 钉死 test job 退出 1 的成因（⛔ 不采信本任务上面的"最可能解释"）：在失败日志里定位到使 `test` job 的 `Run tests` 退出 1 的那一步（建议 `gh run view <该 id> --log-failed | grep -n -E '##\[error\]|STATIC_CHECK_NOT_EVALUATED|exit code'`，以及日志末尾的汇总块），把逐字证据与行号贴进 ## Evidence。若确认是三条 NOT_EVALUATED 触发兜底红，给出触发处那几行；若不是，写出真成因（例如某条 summary gate、超时、或资源）。
- [ ] AC2 本地复现 dist 那一条（能取假）：在本机 Node 20 下逐字跑 `bash packages/quay/scripts/package.sh` 的那一步（或直接 `node --experimental-strip-types` 的最小样例 + `bash <staged>/scripts/capability-catalog.sh --entry-surface`），复现 `node: bad option: --experimental-strip-types`；贴出 Node 20 与 Node ≥22.6 的**对照**读数（负控制：高版本下同一命令不报该错）。
- [ ] AC3 读生产载体（⛔ fixture/本地等价物不算，硬规则 4 推论三）：`.quay/ci-runs.jsonl` 中 `workflow=="CI"` ∧ `branch=="develop"` ∧ `conclusion=="success"` 且 `ts` 晚于本次落地时刻的记录数 ≥1，打印该条与前 3 条；并给出 `gh run view <该 id>` 的 URL 与 `.quay/ci-runs.jsonl` 那条记录**相互印证**（sha/时间对得上）。
- [ ] AC4 判据侧复核：把 `goals/AC-281-*.md` frontmatter 的 `criterion` 原样取出、以 `bash` 跑（heredoc），在你的成功 run 之后退出 0；逐字输出贴进 ## Evidence。
- [ ] AC5 三个 job 都绿：`gh run view <该 id>` 显示 `version-consistency` / `dist-verify-node-floor` / `test` 全部 ✓。若 `durationSec <= 30` 仍不满足，写明是哪个 job 超时及其实测秒数，⛔ 不得改判据阈值。

## DoD
- [ ] 上面的判据实跑通过，且是**真实 CI 上的读数**（不是本地等价物）：`gh run view` 的 URL 与 `.quay/ci-runs.jsonl` 的新记录能相互印证。
- [ ] ⛔ 不用「放宽/改判据（AC-281 的 success 与 ≤30s）」「`continue-on-error`」「跳过失败步骤」让它变绿；动到的每一步都要能指出它修的是根因（⛔ 不以「CI 绿了」结案，若绿只是因为某步被静默跳过即为未完成）。
- [ ] 若 AC5 的 ≤30s 被证明**结构上不可达**（例如 test job 的下界本身 >30s），如实写明并附实测下界，⛔ 不静默放宽、⛔ 不自行改判据。

## Touches
- `packages/quay/scripts/package.sh`
- `.github/workflows/ci.yml`
- `plugin/scripts/capability-catalog.sh`
- `tasks/gap-develop-ci-red-node20-floor-and-static-not-evaluated.md`