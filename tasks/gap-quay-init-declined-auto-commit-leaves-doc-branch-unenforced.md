---
id: gap-quay-init-declined-auto-commit-leaves-doc-branch-unenforced
title: quay:init auto-commit 被拒（非交互）后 doc-branch 不变量无人兜底——外部进程事后提交 laydown
  时主检出停在 develop、author 永不出现
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

**缺口**：`quay:init` 的 doc-branch 不变量（主检出落在 doc 分支如 `author`，不落在 landing baseline `develop`）只在两条路径上被建立——(a) init 时仓库已有提交（pre-write 判定）；(b) init 自己的 auto-commit 造出首提交后重评估（`gap-init-branch-model-runs-before-auto-commit-fresh-repo-needs-two-runs`，2026-10-12 已落地）。第三条路径没人兜底：**非交互下 init 的 auto-commit 被拒**——`autoCommitClosedSet` 在无 `--auto-commit-config`/`--auto-commit-confirm` 时 fail-closed DECLINED（这是 `gap-quay-init-never-commits-broken-committed-state` 刻意的安全性质：绝不提交自己没创建的工作树）——于是 init 写盘后没有提交可 fork，`ensureDocBranch` 重评估如实报 still-unborn、不建 `author`；随后若由外部进程（自主 loop 的 Observer 会话、或人工）手工提交 laydown 而不重跑 init，主检出就停在 `develop`、`author` 永不出现，doc-branch 不变量被静默打破。

**实测证据（2026-10-21，第三方项目 plantuml-js）**：首提交 `5a16b21` author `Observer Probe <observer@example.invalid>`、message `quay workspace laydown: init six-file config surface`（≠ quay init auto-commit 恒用的 `chore(quay-init): …`）⇒ laydown 不是 init 自己提交的；主检出在 `develop`、无 `author`、`.quay/config.yml` 无 `loop.doc_branch`。复现（当前 quay）：全新 0 提交仓库上 `init --auto-commit-config` 一条命令即可建出 `author` 并切换（(b) 路径已生效）；但去掉 `--auto-commit-config`（非交互）则 auto-commit DECLINED、无提交、无 `author`——正是本条要修的缺口。

<!-- dedup-ref --> 相关但机制不同（均已 done，仅溯源不阻塞）：`gap-init-branch-model-runs-before-auto-commit-fresh-repo-needs-two-runs`（auto-commit 造首提交后重评估）；`gap-quay-init-no-doc-branch-bootstrap-leaves-main-checkout-on-develop`（原始「从不建 doc 分支」设计，后被反转）。本条是它们的第三条：auto-commit 被拒的退化路径。

**修复方向（实现可自选，判据钉住可观测不变量）**：让 doc-branch 不变量不依赖 init 一次性的 best-effort。两条互补：
1. init 在 auto-commit 被拒且仓库无提交可 fork 时，输出一条**机器可读**的「doc-branch 不变量待建立」信号（与通用 `auto-commit: DECLINED` 文案区分，如独立输出字段 / 专用 exit code / 持久化 pending 标记），并附可执行补救命令。
2. 加一条**常驻检查**（driver 启动路径或某个 `quay` 动词，复用 `branch-model.ts` 的判定），对「主检出在 `develop`、仓库有 ≥1 提交、却无 doc 分支」的 workspace fail-closed 报违反并给出单命令补救——这样外部提交 laydown 之后、下一轮 driver 启动即被发现，而不是永久静默停在 `develop`。

## Touches

- packages/quay/src/init.ts
- packages/quay/src/core/branch-model.ts
- packages/quay/src/cli/init.ts
- packages/quay/test/init.test.mjs
- packages/quay/test/branch-model.test.mjs
- tasks/gap-quay-init-declined-auto-commit-leaves-doc-branch-unenforced.md

## Acceptance Criteria

- [x] 一个 fixture（`git init -b develop` + 1 提交 + 无 `author` 分支 + `loop.fork_baseline: develop` 的 config）触发常驻检查，输出「doc-branch 不变量违反」且 exit 非 0；补救命令（`quay init --doc-branch-name author` 或 `git checkout -b author`）执行后，同一检查器报告 ok、exit 0。
- [x] 负对照：主检出已在 `author` 的 fixture 下，检查器报告 ok、exit 0（证明检查器能取假，不是恒真回显）。
- [x] 非交互 `quay init`（无 `--auto-commit-config`）在 0 提交仓库上运行后，其输出/退出码/产物里存在机器可读的「doc-branch 不变量待建立」信号（grep 可命中，不是只有 prose "DECLINED" 文案）。
- [x] `node --test packages/quay/test/init.test.mjs` 与 `node --test packages/quay/test/branch-model.test.mjs` exit 0。

## Definition of Done

一个真实 repo（plantuml-js 或等价 fixture）从「主检出 develop、无 author」经补救命令变成「主检出 author」，且常驻检查重跑报 ok；修复后的检查器/信号在测试里以负对照证明能取假（DIR-026 Reading A：真实对象经机制操作过，不是 fixture 自证）。

## Evidence

**机制（实现）**：`packages/quay/src/core/branch-model.ts` 新增只读四态判定 `checkDocBranchInvariant`（`satisfied` / `violated` / `pending` / `not-evaluated`）+ `formatDocBranchInvariantReport`（稳定 token `doc-branch-invariant: <STATE> (reason: <枚举>)`）；`packages/quay/src/init.ts` 新增唯一名字解析 `resolveDocBranchName`（flag > `loop.doc_branch` > 约定），`runInit` 在运行结束后把该判定附在 `InitResult` / `buildInitReport` 的 `docBranchInvariant` 上；`packages/quay/src/cli/init.ts` 新增只读动词 `quay init --check-doc-branch`（仅 `violated` exit 1；`pending` / `not-evaluated` exit 0），并让每次非 blocked 的 init 都打印该行。

**AC1 读数**（等价 fixture：`git init -b develop` + 1 提交 + 无 `author` + `loop.fork_baseline: develop`）：
```
doc-branch-invariant: VIOLATED (reason: on-baseline-no-doc-branch) — ...; remedy: quay init --doc-branch-name author
EXIT=1
（补救：git checkout -b author 或 quay init --doc-branch-name author）
doc-branch-invariant: SATISFIED (reason: not-on-baseline) — ...   EXIT=0
```
**AC2 负对照**：主检出在 `author` 的 fixture ⇒ `SATISFIED` / `EXIT=0`；检查器自身只读（检查后 `git branch --list author` 仍为空、HEAD 未移动、config 字节不变，见 `branch-model.test.mjs` AC1(CLI)）。

**AC3 读数**（0 提交仓库、非交互 `quay init`，auto-commit DECLINED）：
```
stderr: auto-commit: DECLINED (non-interactive — ...)
stdout: doc-branch-invariant: PENDING (reason: no-commits-yet) — ...; remedy: commit ... then run `quay init --doc-branch-name author`
--json: {"docBranchInvariant":{"state":"pending","reason":"no-commits-yet","ok":true,...}}
```
外部进程随后提交 laydown ⇒ 同一检查器转为 `VIOLATED` / exit 1（这正是原先永久静默的窗口）。

**AC4 读数**：`node --test packages/quay/test/branch-model.test.mjs` → 62 pass / 0 fail；`node --test packages/quay/test/init.test.mjs` → 90 pass / 0 fail。

**DoD 读数**：真实 plantuml-js 工作区（本机 `/data/home/yale/work/plantuml-js`，已被人工补救为 `author`）上跑 `quay init --check-doc-branch` ⇒ `SATISFIED (reason: not-on-baseline)` / exit 0（只读，未改动该工作区）。等价失败态 fixture（首提交 author 为 `Observer Probe <observer@example.invalid>`、message `quay workspace laydown: init six-file config surface`、主检出 `develop`、无 `author`）经 `quay init --doc-branch-name author` 后：`[CREATED] doc-branch -> author` + 主检出 `develop → author`，重跑检查 ⇒ `SATISFIED` / exit 0。负对照（AC2）与 `PENDING`/`NOT-EVALUATED` 两态证明输出词表里存在「非违反」取值，不是恒真回显。
