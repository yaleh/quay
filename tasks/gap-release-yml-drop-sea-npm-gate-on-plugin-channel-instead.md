---
id: gap-release-yml-drop-sea-npm-gate-on-plugin-channel-instead
title: release.yml：取消 sea/npm 产物 job，advance-master 改为消费 plugin 渠道真实安装验证
status: ready
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-274
---
## Proposal

人 2026-09-16 裁定（逐字，已落 `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §11）：
"取消 sea 和 npm release。这些是我们最近没有精力去保障的。" 追问 `advance-master` 拿什么 gate 后：
"按照 claude code plugin 发布和安装。CI 应当按此设计。"

<!-- dedup-ref -->
触发背景：2026-09-16 当晚两次真 dispatch `release.yml`，`sea-release`（windows-x64）在
"Verify the release archive carries the plugin sidecar (AC3)" 步骤真实失败，卡住了 `advance-master`
（`needs:` 覆盖它）。AC-266/AC-267/AC-268（全部关于 SEA/npm 产物线）已由 manager 会话在同一轮
`superseded`（goal store 写入，理由指向本任务与 SPEC §11），本任务是它们指向的**实现**，不是重复立案。

## Plan

**① 移除 5 个 job**（`.github/workflows/release.yml`）：`release`（npm pack + 挂 GitHub Release 资产）、
`sea-release`（×3 平台矩阵）、`sea-verify-node-free`、`sea-verify-node-free-cross-platform`、
`dist-verify-node-floor`（release.yml 内这份——依赖 `release` job 已发布资产的变体，⛔ 不是 ci.yml 里
自建产物的同名 job，那个不在本任务范围内）、`delivery-manifest-verify`（`--ci` 真资产模式）。
逐条确认删除前没有其它 job 反向依赖它们（`grep -n "needs:.*\b<job>\b" .github/workflows/release.yml`）。

**② 新增一个 job**（暂命名 `verify-plugin-channel`，允许实现时按更贴切的命名调整，但要与
`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §11 第 2 点的描述保持可追溯）：
在一个**全新、隔离**的环境（GitHub-hosted runner 本身即天然隔离，不需要额外沙箱）里，把 2026-09-16
在 ad-arm1 archguard 项目上手工做过的那套验证自动化：
1. `claude plugin marketplace add <this-tag-pinned-source>`（可用 `${{ inputs.tag }}` 或直接
   `github.repository` + `dist-plugin` ref，取决于 marketplace.json 当时的实际声明——落地时核实）。
2. `claude plugin install quay@quay --scope project -y`（针对一个 scratch 测试项目目录，不是这个仓库
   自己——避免自我安装的循环依赖）。
3. 对该 scratch 项目跑 `quay-init.sh`（从装好的 plugin cache 里取，同今晚手工验证路径）。
4. `quay driver start --kind promotion` / `--kind worker`，确认 `quay driver status` 两者 `alive=1`。
5. `quay serve --host 127.0.0.1 --port <free-port>`，确认健康（如 `curl` 探测能拿到响应，不需要 200，
   拿到任何 HTTP 响应即证明进程起来了——参考 `quay-serve-cold-start-blocks-event-loop` 那条已知的冷启动
   行为，不要把"暂时不响应"误判成失败）。
6. 收尾：停掉 driver + serve 进程（scratch runner 本身跑完即销毁，非必须但保持干净）。
失败即该 job 失败（fail-closed，不需要额外的显式判断——GitHub Actions 默认语义）。

**③ `advance-master` 的 `needs:` 改为 `[verify-plugin-channel]`**（只此一项——① 删掉的 job 不再存在，
自然不会出现在 needs 里；⛔ 不要保留任何指向已删除 job 的引用，否则 workflow 语法本身就会拒绝）。

**④ 不需要碰的东西（显式排除，避免范围蔓延）**：
- `plugin/scripts/release-master-advance-needs-check.ts`——**结构性地从文件派生期望的 `needs:` 全集**
  （不是硬编码列表），① ② ③ 落地后它会自动认可新的全集，无需修改，只需要在 AC 里重新跑一次确认。
- `ci.yml` 里那份**同名但独立**的 `dist-verify-node-floor` job——不属于本任务范围，继续自建产物验证，
  与 release.yml 无关。
- `publish-plugin-dist.yml` / `dist-plugin` 分支的构建触发方式——SPEC §11 第 6 点明确排除，本任务不碰。

## AC

- [ ] `.github/workflows/release.yml` 里 `grep -c "^  release:\|^  sea-release:\|^  sea-verify-node-free:\|^  sea-verify-node-free-cross-platform:\|^  dist-verify-node-floor:\|^  delivery-manifest-verify:"` = 0（六个旧 job 全部移除，用精确的行首缩进匹配，不是子串匹配）。
- [ ] `advance-master` 的 `needs:` 字面量就是 `[verify-plugin-channel]`（或落地时确定的实际命名，需与本任务体和 SPEC §11 保持一致更新）。
- [ ] `node --experimental-strip-types plugin/scripts/release-master-advance-needs-check.ts --root . --json` 在改动落地后重跑，`exit 0`（PASS），且打印的"job 集合"只剩 `verify-plugin-channel` + `advance-master` 两项——证明检查器确实是结构性派生的，不需要本任务去改它。
- [ ] 一次真实 dispatch（`gh workflow run release.yml --ref <tag> -f tag=<tag>`，⛔ 记得同时传 `--ref`，见 `gap-release-softprops-missing-explicit-tag-name` 的前车之鉴——虽然本任务已经不再有 softprops 步骤了，但仍要传对 `--ref` 让 workflow 定义本身取对版本）验证 `verify-plugin-channel` 真的跑通、`advance-master` 真的把 `master` ff 上去。

## DoD

`AC-274`（master ff 到全绿 release）在一次真实 dispatch 之后转 pass——不是本地读代码"看起来对"就收工；`.quay/ci-runs.jsonl` 里能看到一条 `workflow=Release conclusion=success` 且 job 列表只含 `verify-plugin-channel`（不再含任何 SEA/npm 相关 job 名）的记录，`master` 的提交正是那次 dispatch 的 tag。

## Touches

- .github/workflows/release.yml
- tasks/gap-release-yml-drop-sea-npm-gate-on-plugin-channel-instead.md
