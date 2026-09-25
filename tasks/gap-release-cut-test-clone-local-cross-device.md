---
id: gap-release-cut-test-clone-local-cross-device
title: release-cut.test.mjs 的 fixture `git clone --local` 跨设备恒红——全量套件在 fan-in 恒失败
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象与证据（2026-09-25，本机）**：全量套件 `plugin/test/release-cut.test.mjs` 在**任何**任务的 fan-in 里恒红，签名唯一：
`AssertionError [ERR_ASSERTION]: clone must succeed: fatal: failed to create link '/tmp/release-cut-dryrun-XXXXXX/repo/.git/objects/00/456e...': Invalid cross-device link`（该文件 7 条测试全部死在同一个 helper 上）。

- 该测试 2026-09-24 17:04 由 `39df7b2ee`（release-cut: provision the worktree, tests, catalog declaration, SPEC pointer）落到 develop；**此后 develop 上仅有的 2 次 fan-in 全量套件（11:26 `gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238`、11:41 `gap-driver-anchor-runs-without-host-derived-memory-envelope`）2/2 全红**，同签名 ⇒ 不是 flake，是 develop-wide。
- 独立复现（本机，非套件内）：`node --test plugin/test/release-cut.test.mjs` ⇒ exit 1，7 条全死在同一行。

**机制**：`plugin/test/release-cut.test.mjs:70` `spawnSync("git", ["clone", "--local", "-q", repoRoot, root])`。git **显式** `--local` 时在 `copy_or_link_directory()` 里 `option_local > 0` ⇒ `link()` 失败即 `die_errno("failed to create link")`，**不回退为拷贝**。本机 `/data` = xfs(`/dev/vdb`)、`/tmp` = ext4(`/dev/vda2`) ⇒ `link()` 返 `EXDEV`。测试的注释写着「`--local`: hardlinked objects, ~0.7 s, no network」——它把「同一文件系统」当成了隐式前提。

**影响（为什么这必须单独立案）**：`scripts/test.sh` 全量套件是 fan-in 的必经步 ⇒ **所有**任务的 fan-in 在 suite 步恒失败，develop 停止前进（本 worker 的任务已 7/7 AC 完成、delta 与该文件零交集，仍无法落地）。

**同族先例（同一陷阱已咬过本仓一次，且有独立载体）**：`tasks/gap-ac194-production-criterion-owner.md` §AC4 记载，一次 `git clone --local … /tmp/…` 因同样跨设备失败，且脚本无 `set -e` 而 `cd` 失败继续 ⇒ `git add -A` 落进共享主检出，697 文件被 live driver 同秒推进 develop，事后靠 `git update-ref` 恢复（`INCIDENT-shared-checkout-leak.md`）。**本任务与该先例机制相同、载体不同**（那次是手搓脚本，这次是已落地的测试文件）；与 `gap-release-cut-single-carrier-and-main-ledger-trace`（讲 ledger 单一载体）无关。

**范围外（观察项，按硬规则 12 不设为前置）**：是否应在 `scripts/test.sh` 统一 pin `TMPDIR` 到与仓同设备（`test.sh:330` 的注释已假设本机 `$TMPDIR` 是 tmpfs，实测 `TMPDIR` 未设 ⇒ `/tmp` 在 rootfs ext4，该假设与实测不符）。这是另一条系统性修法，本任务只修调用点。

## Plan

1. `plugin/test/release-cut.test.mjs` 的 `makeClone()`：argv 由 `["clone","--local","-q",repoRoot,root]` 改为 `["clone","--local","--no-hardlinks","-q",repoRoot,root]`，并改写上方注释：说明 `--no-hardlinks` 保「不联网、无 file:// 传输」的原意，只放弃硬链接（跨设备宿主上硬链接本就不可能），代价是改为拷贝。**已实测**（2026-09-25，本机 `/data`→`/tmp`）：裸 `--local` 复红；`--local --no-hardlinks` 与去掉 `--local` 两种写法均成功、对象数同为 4427。
2. 加一条诚实读数（硬规则 3b/4c）：`makeClone` 用 `fs.statfsSync` 比较 repo 与 tmpdir 的设备号，把「本次是否跨设备」作为一个**独立取值**输出（例如 `SUITE-RELEASE-CUT-FIXTURE dev=<same|cross>`），⛔ 不得让「跨设备」与「没测」同形。
3. 复核：`node --test plugin/test/release-cut.test.mjs` 在跨设备宿主上退出码 0；并确认未破坏该文件原有 7 条断言语义（happy path 仍是真的 clone、真的 worktree、真的 ledger）。

## Acceptance Criteria

- [ ] 在**跨设备**宿主（repo 在 `/data`，`TMPDIR` 未设 ⇒ tmpdir 在 `/`）上 `node --test plugin/test/release-cut.test.mjs` 退出码 0（改前同一条命令 exit 1，7 条全死，作为负控制留档）。
- [ ] 负控制可复核：把 `--no-hardlinks` 去掉后同一条命令复红，且失败签名仍是 `Invalid cross-device link`（证明确实是这一处、而不是别的原因变绿）。
- [ ] `makeClone` 输出一条「本次 fixture clone 是否跨设备」的独立读数（枚举取值，不是布尔 `ok`），且该读数在跨设备宿主上取到 `cross`。
- [ ] `git -C <repo> grep -c 'clone", "--local"' plugin/test/release-cut.test.mjs` 为 0，且新 argv 里同时含 `--local` 与 `--no-hardlinks`（保留原意的证据）。

## Definition of Done

真实落地：在跨设备宿主上 `node --test plugin/test/release-cut.test.mjs` 真绿（7/7），且失败模式（去掉 `--no-hardlinks` 复红）在同一宿主上复现过；该修复经某任务 fan-in 的全量套件后进 develop，之后任一任务的 fan-in 不再在 suite 步恒红。仅改注释、或仅在 fixture 里 mock 掉 clone，不算完成。

## Touches

- plugin/test/release-cut.test.mjs
- tasks/gap-release-cut-test-clone-local-cross-device.md