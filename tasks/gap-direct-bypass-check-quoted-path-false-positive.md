---
id: gap-direct-bypass-check-quoted-path-false-positive
title: direct-to-develop-bypass-check 对非 ASCII 文件名误判——git quotes 使 ^docs/
  排除失效（2fdb6e32 false positive）
status: done
labels: []
parent: null
children: []
extra: {}
---
---
id: gap-direct-bypass-check-quoted-path-false-positive
title: "direct-to-develop-bypass-check 对非 ASCII 文件名误判——git quotes 使 ^docs/ 排除失效（2fdb6e32 Web UI 设计正本 false positive）"
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**判据正本（直接引用，勿转述）**：无独立 manager-phase-goal 段——本任务由 inner 2026-08-16 立案，源证 = select-preflight fan-in 被 direct-to-develop-bypass-check 误挡。

**实测（2026-08-16，select-preflight fan-in full suite）**：
```
fan-in 全量 suite 在静态检查 direct-to-develop-bypass-check 红（fail-closed）。
红源：develop 上 2fdb6e32「manager: 落盘 Web UI 改进版设计正本」被标记 bypass=TRUE。
但该提交只 touch docs/design/quay-webui-improved-2026-08-16/Quay改进版WebUI.dc.html
（design-internal，^docs/ 排除本应豁免）。
```

**根因（fan-in subagent 实读 + 本任务核实，非猜测）**：
`plugin/scripts/direct-to-develop-bypass-check.ts` L92 排除正则 `^(?:tasks\/|docs\/|...)/` 对**非 ASCII 文件名**失效——`git diff --name-only` 对含非 ASCII 的文件名输出**带引号**（`"docs/design/.../Quay改进版WebUI.dc.html"`），前导引号使 `^docs\/` 匹配失败 ⇒ 该文件被误判为 code-surface ⇒ bypass=TRUE。

**⇒ 这是 bypass-check 的 quoted-path 处理 bug**：`^docs/` 排除无法识别被 git quotes 包裹的非 ASCII 路径。

**⛔ 独立于 08e8ec55**（release 0.5.0 genuine bypass，归 owning layer 裁定）——本任务只修 2fdb6e32 类的 quoted-path false-positive。修它**不 unblock** select-preflight fan-in（08e8ec55 仍在），但修掉一个真实检测缺陷。

## Plan

1. 实读 `plugin/scripts/direct-to-develop-bypass-check.ts` L92 排除正则 + git diff 输出解析（L277/L326 附近）。
2. 确认非 ASCII 文件名在 git 输出里的 quoted 形态（`git diff --name-only` 对含非 ASCII 的路径加引号）。
3. 修：解析 git 输出时去掉 quotes（或让排除正则容忍前导引号），使 `^docs/` 等排除对非 ASCII 路径生效。
4. **负控制**：构造一个 `docs/` 下非 ASCII 文件名的提交 ⇒ bypass-check 必须不红（豁免）；构造一个 code-surface 非 ASCII 文件名 ⇒ 必须红。

## Acceptance Criteria

- [x] AC1: 非 ASCII 文件名在 `docs/` 下被排除正则正确豁免（git quoted 路径处理）。
- [x] AC2: code-surface 非 ASCII 文件名仍被标记 bypass（不误放）。
- [x] AC3: 负控制成立——2fdb6e32 类（docs/ 非 ASCII）不红；真实 code 非 ASCII 红。
- [x] AC4: 既有 bypass-check 测试全绿 + 新增 quoted-path 用例。

## Definition of Done

- [x] bypass-check 对非 ASCII 文件名的排除判定正确（docs/ 豁免、code 标记）；负控制 + 既有测试绿。

## Evidence

**修法**：`gitCommitFiles()` 的 `git diff --name-only` 前加 `-c core.quotepath=false`——让 `--name-only`
输出原始路径字节（默认对含非 ASCII 的路径输出 C-quoted 形态 `"docs/.../Quay\346\224\271\350\277\233\347\211\210WebUI.dc.html"`，
前导引号使 `^docs/` 排除失效 ⇒ design-internal 被误判 code-surface）。关闭 quotepath 后 `^docs/` 恢复对非 ASCII 路径生效。

**验证 1（2fdb6e32 复核：修复前 exit 1 → 修复后 exit 0）**：
```
$ node --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts --root /home/yale/work/quay --commits 2fdb6e32 --json
evaluated: True ok: True reason: no-code-surface-direct-commits codeSurface: 0 designInternal: 1   exit=0
```
修复前同命令：`codeSurface: 1 designInternal: 0 reason: direct-commit-bypasses-fan-in`（exit 1）——2fdb6e32 被误判。

**验证 2（任务指定复核：--root /home/yale/work/quay --baseline b11ce720）**：
```
$ node --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts --root /home/yale/work/quay --baseline b11ce720
direct-to-develop-bypass-check: evaluated=true ok=true (ac65-authorized-or-ruled-historical-only)
  denominator: total=82 code-surface=7 design-internal=75 in-lock-window=0 ac65-authorized=5 ruled-historical=3   exit=0
```
（修复前此命令 exit 1——2fdb6e32 false positive 使全量扫描红。）

**验证 3（测试 30/30 绿，含 4 条新增 quoted-path 用例）**：
```
$ node --test plugin/test/direct-to-develop-bypass-check.test.mjs
ℹ tests 30  ℹ pass 30  ℹ fail 0
```
新增用例：
- `PURE isDesignInternalPath — 非 ASCII 文件名恢复排除（AC1/AC2）`
- `AC3 负控制·真实 git — 2fdb6e32 CLI --commits 必须 GREEN（AC3）`
- `CLI — docs/ 下非 ASCII 文件名直接提交 ⇒ GREEN（AC1/AC3 负控制）`
- `CLI — code-surface 非 ASCII 文件名直接提交 ⇒ RED（AC2 不误放），路径不带引号/转义`

**负控制**：temp repo 构造 `docs/design/Quay改进版WebUI.dc.html` 直投 ⇒ GREEN（design-internal=1）；
构造 `plugin/test/测试.test.mjs` 直投 ⇒ RED（codeSurfaceFiles[0]=`plugin/test/测试.test.mjs`，原始字节非 C-quoted）。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（quoted-path 处理）
- plugin/test/direct-to-develop-bypass-check.test.mjs（新增非 ASCII 用例）
- tasks/gap-direct-bypass-check-quoted-path-false-positive.md（自身）