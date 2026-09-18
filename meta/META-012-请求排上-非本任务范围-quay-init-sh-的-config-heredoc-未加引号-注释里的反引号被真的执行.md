---
id: META-012
title: 请求排上（非本任务范围）：quay-init.sh 的 config heredoc 未加引号 ⇒ 注释里的反引号被真的执行、生成的
  .quay/config.yml 不是合法 YAML ⇒ 全仓 code-delta fan-in 在 step=suite 红在同 3
  个安装族测试（已单独立案，单行对照已验证）
status: proposed
handler: meta-driver
---
**只报告、不代裁** —— 该缺陷不在我这条任务的 `## Touches` 内，按纪律未修、不扩范围，已单独立案：`gap-quay-init-config-heredoc-comment-backtick-executes-cli`（todo，finding 形，5 条 AC）。

## 一、现象与代价

我这条任务（`gap-prose-prereq-refs-should-exclude-done-referenced-tasks`）的机械 fan-in 在 `step=suite` 红，`# tests 5941 / # pass 5938 / # fail 3`，三条全是**安装族**测试，与本任务 delta（`ready-pool-check.ts` + 3 个测试文件）无 import 通路：
- `plugin/test/conformance-target-fixture.test.mjs` AC4 (C) — `AssertionError: 'skip' !== 'run'`
- `plugin/test/quay-init-loop.test.mjs` AC3 — `AssertionError: confirmed run must exit 0`
- `packages/quay/test/install-config-driven-e2e.test.mjs` A2 — `AssertionError: second install failed`

同 3 条也出现在 16:25Z 另一条任务的 fan-in suite 日志里 ⇒ 不是本任务独有。

## 二、根因（实测 + 一条命令的对照）

`plugin/scripts/quay-init.sh:1826` 用**未加引号**的 heredoc 写 `.quay/config.yml`（`cat > "$cfg" <<EOF`）；其内 `:1854` 是一行**注释**，含反引号：

```
  # LOOP_VERSION_DEFAULTS（CLI `quay init --reconcile` 用它做 diff）。shell 无法 import TS，
```

⇒ 写 config 时那条 CLI **被真的执行**，其多行 stdout 被替换进注释，第二行起没有 `#` ⇒ 产物不是合法 YAML（实测 `python3 yaml.safe_load` 报 `ScannerError ... line 29 column 3`；`:28/:29` 逐字可见 `reconciled to this version's defaults.` / `filled loop.fork_baseline (was absent)`）。

**对照（能区分）**：
- PATH shim（`<shim>/quay` 写一行 marker 后 exit 0）⇒ marker = `ran: init --reconcile`（证明注释里的命令真的执行）；shim **不产 stdout 时 config 合法** ⇒ 畸形专门来自那条 CLI 的 stdout。
- 只把那一行注释改写成不含反引号的措辞（其余一字不动）⇒ 三个文件全绿（9/9、5/5、3/3），改回即全红。
- **宿主依赖（硬规则 4b 推论二形态）**：只有 `quay` 在 PATH 上（本机 `/home/yale/work/quay/plugin/bin/quay`）才命中；不在 PATH 时替换为空串、config 合法 ⇒ 同代码在不同机器上「有时坏」且静默。

**引入提交** = `1cdec24fa`（`gap-quay-init-native-reconcile`，2026-09-18T11:31Z，已 done）。

## 三、请求的处置

不必回我长答复——**让它被排上即可**：修法是一行注释的措辞（或核 `<<'EOF'` 形态是否可行），对照已在上文给出，落地后全仓 code-delta fan-in 的这 3 条即消失。

## 四、我这一侧的可核事实

本任务 scoped 门与就近读数：`plugin/test/ready-pool-check-*.test.mjs` + `promotion-driver-*.test.mjs` = 224/224，`# fail 0`；AC4 生产读数（真实 `tasks/` 目录、受害体改写前的正文）`cited=gap-git-history-window-notes-ref-dominates status=done ⇒ prosePrereqGap=[]`。**本轮我不会落地**——不是因为实现，而是因为上面那 3 条与该 delta 无关的恒红（`judgeRetryExemption` 已判 `unrelated-flaky-exempt`）。
