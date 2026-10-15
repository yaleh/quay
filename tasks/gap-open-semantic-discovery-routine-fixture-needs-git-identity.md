---
id: gap-open-semantic-discovery-routine-fixture-needs-git-identity
title: open-semantic-discovery-routine 夹具缺 git identity ⇒ runner 上 Author
  identity unknown（同族已 done 修法的第二个实例）
status: ready
labels:
  - gap
  - ci
parent: null
children: []
extra: {}
---
## Proposal

develop 的 CI 全红里，`plugin/test/open-semantic-discovery-routine.test.mjs` 的
「AC(citations)」是 runner 上**没有 git identity** 导致的夹具失败：

- run 38700638546 该用例失败信息逐字含 `Author identity unknown`（`git commit` 被 git 拒绝：既无 `user.name`/`user.email` 配置，也无 `GIT_AUTHOR_*`/`GIT_COMMITTER_*` 环境）。
- 同族已有 done 任务 `gap-commit-routine-write-no-git-identity-fallback`（修的是**另一个**夹具）⇒ 本夹具是**未被覆盖的第二个实例**，⛔ 不重复立案：本任务只处理本文件。
- ⛔ 不许用「跳过该用例 / 标记 skip」来消红：这条 AC 要测的正是 routine 真的产出了 citations（那要真的提交）。

## Plan

1. 查重：读已 done 的 `gap-commit-routine-write-no-git-identity-fallback` 的落地实现，判断其中是否有**可复用**的 helper / env 注入形状；有则复用（⛔ 不静默各写一份），无则在 AC3 里给出「为何不能复用」的具名结论。
2. 在本夹具里把身份**显式给定**（`GIT_AUTHOR_NAME/EMAIL` + `GIT_COMMITTER_NAME/EMAIL`，或 `git -c user.name=… -c user.email=… commit`），范围只限本夹具造出的子进程。
3. 复现「无全局身份」的环境形状（例如 `HOME=$(mktemp -d)` + `GIT_CONFIG_GLOBAL=/dev/null`），A/B 两侧：改动前红（`Author identity unknown`），改动后绿。

## AC

- [x] AC1: 粘贴改动后的行：本夹具的 `git commit` 现在显式携带身份（说明用的是 env 还是 `-c`），并说明它为什么不影响宿主/别的夹具。
  **读数：用的是 env，不是 `-c`** —— 复用本文件既有的 `GIT_ENV` 常量（`:223`）。改动后该行逐字为：
  `execFileSync("git", ["-C", ws, "commit", "-q", "-m", "pin content: the file the round will cite"], { encoding: "utf8", env: GIT_ENV });`
  **为什么不影响宿主/别的夹具**：身份只进**本夹具造出的子进程**的 `env`（`GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }`），⛔ 不写任何 `git config`（既非 `--global`，也不写 `ws` 仓内局部配置）⇒ 宿主全局配置、`ws` 仓自身配置、别的夹具都未被修改；`ws` 是 `mkdtemp` 临时目录，用例结束即消失。宿主有身份时的负控制见 AC2 第 3 条。
- [x] AC2: A/B 两侧原文读数：在 `HOME=<临时空目录> GIT_CONFIG_GLOBAL=/dev/null` 的形状下，改动前该用例红且报 `Author identity unknown`；改动后 `node --test plugin/test/open-semantic-discovery-routine.test.mjs` 退出码 0（粘贴两侧 `ℹ tests/pass/fail`）。
  **同一无菌形状（`HOME=$(mktemp -d) GIT_CONFIG_GLOBAL=/dev/null`）的两侧读数**：
  - 改动前：exit **1**；`ℹ tests 127` / `ℹ pass 126` / `ℹ fail 1`；唯一失败项 `✖ AC(citations) — … (plugin/test/open-semantic-discovery-routine.test.mjs:4404:1)`，原文 `Error: Command failed: git -C /tmp/osd-routine-ws-YXV58q commit -q -m pin content: the file the round will cite` + `Author identity unknown`。
  - 改动后：exit **0**；`ℹ tests 127` / `ℹ pass 127` / `ℹ fail 0` / `ℹ skipped 0` / `ℹ todo 0`。
  - 负控制（宿主**已有**全局身份、不施加无菌 env）：改动后同样 `ℹ tests 127` / `pass 127` / `fail 0`，exit 0 ⇒ 修法不是只在无菌环境才生效。
  - 机制对照（`/tmp` 独立三臂探针，**实测非推断**）：裸 `git commit` ⇒ exit 128 `Author identity unknown`；带 `GIT_ENV` 形状 ⇒ exit 0 且 `git log -1 --format='%an <%ae>|%cn <%ce>'` = `t <t@t>|t <t@t>`（身份**真的落在提交上**，不是"碰巧成功"）；带 `GIT_ENV` 形状且继承到**空**的 `GIT_AUTHOR_NAME` ⇒ 仍 exit 0 / `t <t@t>`，证明展开顺序 `{ ...process.env, GIT_AUTHOR_NAME: "t" }` 压得住「存在但为空」这一陷阱。
- [x] AC3: 查重结论：`gap-commit-routine-write-no-git-identity-fallback` 的修法**复用了吗**？复用则给出复用的 helper 名与其所在文件；不能复用则给出具名理由（⛔ 不接受「各自独立所以各写一份」这种无理由表述）。
  **结论：不能复用**，具名理由三条：
  1. 它的落地实现是 `plugin/scripts/probe-routine.ts:782` 的 `routineGit()`，**模块私有**（`function routineGit` 无 `export`）⇒ 本夹具 import 不到。该文件唯一 export 的是常量 `ROUTINE_COMMIT_IDENTITY`（`:771`；实测全仓 `grep` 除自身外零消费者）；只拿常量仍要自己重写一遍 git 调用，等于没复用。
  2. **消费契约不同**：它是 `spawnSync` + 返回 `{ ok, reason }`（**不抛**）的生产形状；本夹具要的是 `execFileSync` + 抛异常（断言失败要带 stderr 原文）。照搬会把夹具的"抛错并把 stderr 打进失败输出"降级成静默 `{ ok:false }`。
  3. 本文件**已有自己的等价机制** `GIT_ENV`（`:223`，11 个 `spawnSync` 站点在用）⇒ 正确的复用对象是本文件既有的那一个；跨文件再引入第二套身份写法，才是 ⛔「静默各写一份」。
  **5b 同族扫描（本载体之外的其它实例，实测非推断）**：全仓 `plugin/` + `packages/` 中满足「含 git commit 调用点 ∧ 文件内不出现任何身份字面量（`GIT_AUTHOR_NAME|GIT_COMMITTER_NAME|user.name|user.email|GIT_CONFIG_GLOBAL`）」的文件 = **1 个**：`plugin/scripts/task-ops.ts:209` 的生产函数 `commitTaskFile`。同一无菌形状下的 `/tmp` 探针实测：返回 `false`、无提交，且**把 `tasks/X-1.md` 留在索引里**（`git diff --cached` 非空）——除同族缺陷外还多一条违反硬规则 11（共享索引留暂存）的副作用；宿主有身份时返回 `true` 且索引干净。⛔ 该文件**不在本任务 `## Touches` 内**，本任务不改它，仅记录（未立案）。
- [x] AC4: 该用例的语义未被削弱：改动后仍断言 routine 真的产出了 citations（粘贴改动后的断言行 / 判据行），⛔ 不得改成 skip 或只断言退出码。
  **读数：改动后下列断言行逐字保留（未删未改任何一行）**：
  - ``assert.ok(Array.isArray(c.citations) && c.citations.length >= 1, `the cluster carries a REAL citation (got ${JSON.stringify(c.citations)})`);``
  - `assert.equal(cite.quote, "export const a = 1;", "the quote is the LINE's own text, taken from the tool result");`
  - ``assert.ok(atCommit.includes(cite.quote), `the cited line really carries the quote AT THE RECORDED COMMIT (got ${JSON.stringify(atCommit)})`);``（`atCommit` 取自 `git show <commit>:<file>` 的第 N 行，是**独立于被测轮次**的机械判据）
  - `assert.equal(c.citations.some((x) => x.line === 99), false, "the fabricated citation was NOT persisted");` 与 `assert.ok(c.evidence_unverifiable >= 1, …)`
  - `assert.notDeepEqual(c.evidence_lines, c.citations);`（模型的 prose 声明不被当成 citations）
  **未 skip**：`git diff -U0 | grep '^+' | grep -iE 'skip|todo\('` 命中 **0**（无输出）。
  **该用例仍真的提交、真的产出 citations**：实测打印 `AC3 reading: open-semantic-discovery@… citations=[{"file":"plugin/scripts/a.ts","line":1,"commit":"d05ea343…","quote":"export const a = 1;"},…] evidence_unverifiable=1` 与 `AC3 mechanical check: git show d05ea343…:plugin/scripts/a.ts | line 1 = "export const a = 1;"`。
- [x] AC5: 改动只落在该测试文件（`git diff --name-only` 只有它）。
  **读数**：`git diff --name-only` ⇒ `plugin/test/open-semantic-discovery-routine.test.mjs`（1 个文件）。任务文件本身由 Provider ABI（`task_write`）单独提交，不属于代码 diff。

## DoD

- 落地后 develop 上**下一轮真实 CI run** 中该用例不再是失败项（粘贴 run id + 结论）。
- ⛔ 不引入新的 CI 失败项。

## Touches

- plugin/test/open-semantic-discovery-routine.test.mjs
- tasks/gap-open-semantic-discovery-routine-fixture-needs-git-identity.md


ADR-007 逐里程碑暗轴记录（本任务的声明）
该轴仍暗,理由: 本任务改的是夹具如何给 git 身份（显式 env / -c），是夹具环境耦合的修复，不量架构面（依赖图 / 文档比 / 变异存活都没测），没有可解析的读数可贴。
