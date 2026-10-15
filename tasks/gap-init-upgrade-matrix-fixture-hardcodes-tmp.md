---
id: gap-init-upgrade-matrix-fixture-hardcodes-tmp
title: init-upgrade-matrix 夹具硬编码 /tmp：在 runner 的 tmpfs /tmp 下三条 v0.14/0.15/0.16
  用例恒红（job 级 TMPDIR 覆盖不到）
status: todo
labels:
  - gap
  - ci
parent: null
children: []
extra: {}
---
## Proposal

develop 的 CI 自 2026-10-10 起全红，逐条查 `gh run view <runId> --log-failed` 后，**本文件负责的这一条**不是产品回归，而是**夹具硬编码 `/tmp`**：

- run 38700638546（07:43Z, headSha 290a771369）`plugin/test/init-upgrade-matrix.test.mjs` 三条用例红：
  `AssertionError [ERR_ASSERTION]: v0.14.0: \`quay init\` upgrade failed (2)`（v0.15.0 / v0.16.0 同形），
  同段 stderr 逐字：`worktree root '/tmp/quay-init-matrix-gen/scratch-rel-v0.14.0/../scratch-rel-v0.14.0-worktrees' is on tmpfs`。
- 成因：该夹具在**代码里写死 `/tmp`** 造 scratch 目录 ⇒ 它**不读 `TMPDIR`**。runner（self-hosted `tokyo-alpha`，`gh-runner-quay` 容器）挂 `--tmpfs /tmp`，而 `quay init` 对 tmpfs worktree root 是 **fail-closed 拒绝**（2026-08-04 OOM 防御，⛔ 不得放宽）。
- ⇒ 已 done 的 `gap-ci-test-job-tmpdir-on-disk-not-tmpfs`（把 `TMPDIR=${{ runner.temp }}` 写进 job 级 `$GITHUB_ENV`）**覆盖不到本夹具**：job 级 env 对硬编码 `/tmp` 无效。

## Plan

1. 定位夹具里造 scratch 的那处路径（`/tmp/quay-init-matrix-gen` 字面来自哪里），改成**走系统临时目录解析**（`os.tmpdir()` / `fs.mkdtempSync(path.join(os.tmpdir(), …))`），使 `TMPDIR` 生效。
2. 本机 A/B：`TMPDIR=<磁盘目录>` 与 `TMPDIR=<tmpfs 目录>` 两侧各跑一次同一文件，确认三条用例都不再因 tmpfs 红（改动前后者必红）。
3. 负控：用一个**故意忽略 TMPDIR** 的临时改法（或改动前形态）确认「硬编码 ⇒ tmpfs 下红」这一因果仍在，避免把红因归错。

## AC

- [ ] AC1: `plugin/test/init-upgrade-matrix.test.mjs` 里造 scratch 的路径不再含硬编码 `/tmp`（粘贴改动后的行），并说明它现在从哪里取临时根。
- [ ] AC2: 本机同一命令的 A/B 读数：`TMPDIR=<磁盘目录> node --test plugin/test/init-upgrade-matrix.test.mjs` 退出码 0；`TMPDIR=<tmpfs 目录>`（如 `/dev/shm/qim-$$`）**同样**退出码 0（粘贴两侧 `ℹ tests/pass/fail` 原文）；改动前的同一 `TMPDIR=<tmpfs 目录>` 那次必须是红（粘贴原文）。
- [ ] AC3: 负控：把临时改法回退成硬编码 `/tmp` 形态后，`TMPDIR=<tmpfs 目录>` 下三条 v0.14/0.15/0.16 用例**必须**复现「upgrade failed (2)」；恢复后绿。粘贴两侧读数。
- [ ] AC4: 改动只落在该夹具（`git diff --name-only` 只有这一个文件），⛔ 不改 `quay init` 的 tmpfs 判定、不改 runner 配置。

## DoD

- 落地后 develop 上**下一轮真实 CI run** 中，`init-upgrade-matrix` 的三条 v0.14/0.15/0.16 用例不再是该 run 的失败项（粘贴 run id + 结论）。
- 本机全量套件的结论里不再出现本文件的红（粘贴读数）。
- ⛔ 不引入新的 CI 失败项（对照该 run 的失败清单）。

## Touches

- plugin/test/init-upgrade-matrix.test.mjs
- tasks/gap-init-upgrade-matrix-fixture-hardcodes-tmp.md
