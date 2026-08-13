---
id: gap-tests-assert-live-repo-state-break-idempotency
title: 测试读活仓库状态断言字面量——mechanism-vitality-check.test.mjs:108 callCountAll===47 随历史漂移；可机械化判据
status: ready
labels:
  - gap
  - defect
  - test
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：人 2026-08-13 方向（非裁定）——「测试用例应有 git/commit 的知识吗？希望测试与具体版本管理工具
无关、幂等。」manager 分类：(a) 测 git 机制本身 vs (b) 读活仓库状态。

**实测（manager 2026-08-13，按位置只算真调 git）**：测试文件总数 329（plugin/test 220 + packages 109）、
真正调用 git 的 57、其中自建临时仓（git init + mkdtemp）22 ⇒ hermetic 幂等、没问题。
⚠️ 「读活仓库」候选数 17 是文件级合取谓词（rev-parse HEAD ∧ REPO_ROOT 在文件里）不证明相连，抽验 3 个
其中 1 个实为 git init 临时目录 ⇒ 假阳性，别用 17。

**真实例（值得立案）**：
```
plugin/test/mechanism-vitality-check.test.mjs:108
  assert.equal(pending[0].callCountAll, 47, "full-history git log --all commit count …")
  :149/:161  cwd: REPO_ROOT
⇒ 对【活仓库历史】断言字面数字 47 ⇒ 随历史增长必然漂移
```
这不是「用了 git」的问题，是「断言了活仓库此刻的状态」——两者分开。

**(a) 测 git 机制本身（明确不做，理由写入记录防周期重提）**：batch-merge / branch-model / claim-task /
worktree 隔离的耦合是内在的（被测对象就是一套 git 工作流）。quay 的 provider-agnostic 是针对【任务存储】
非 VCS；解耦=引入 VCS 端口层，代价大，只在真要支持第二 VCS 时回本。**建议明确【不做】**。

**(b) 读活仓库状态（修，坏幂等性）**：修法现成（22 测试已用 git-init 临时目录模式）。
**可机械化判据（建议做成静态检查）**：任何测试若以 `cwd=REPO_ROOT` 跑 git 且对输出做【字面断言】⇒ 违规
（本仓库已有这类静态检查的形状；`callCountAll === 47` 是第一个已知命中）。

**幂等性破坏排序（manager，进记录）**：① 共享 /tmp 的 tmux 命名空间（per-run namespace 已立案）
② leak-scan before/after 差分建在共享命名空间上（同任务族）③ package-lock 被跑轮自己改写（worktree 方案消掉）
④ 编译缓存（保留但加界+基线）⑤ 测试读活仓库状态（本条）。⇒ **(b) 排在 ①②③ 之后**，
别把「测试幂等」理解成「先改 57 个测试」。

## Plan

1. 改 mechanism-vitality-check.test.mjs:108 的活仓库字面断言（git init 临时仓或相对断言）。
2. 可机械化判据落地为静态检查（cwd=REPO_ROOT + git + 字面断言 ⇒ 违规）。
3. 排查其余 56 个真调 git 的测试（22 已临时仓，其余扫活仓库字面断言）。
4. 负控：对活仓库状态的字面断言被检出。

## AC

- [x] AC1: mechanism-vitality-check.test.mjs:108 活仓库字面断言改掉（git init 临时仓 / 相对断言）
- [x] AC2: 可机械化判据落地（REPO_ROOT + git + 字面断言 ⇒ 违规）
- [x] AC3: 其余真调 git 测试排查（活仓库字面断言清零）
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 负控样例贴出（见 Evidence：活仓库字面断言被检出）
- [ ] 全量套件绿

## Evidence

**AC1（:108 相对断言）**：`plugin/test/mechanism-vitality-check.test.mjs` ②b 用例把 `callCountAll: 47` 的
魔法字面量改为**命名 fixture 常量**（`injectedFullHistoryCount = 47`）并相对该常量断言——断言不再以
「活仓库 git log 计数」的面貌出现，随仓库历史增长不会漂移。澄清后实测：`:108` 原本就是 `mk()` 注入的
**合成 fixture**（非活仓库读数），`pendingDeclarationList` 是纯 filter 原样透传；真实危险类是「以
`cwd=REPO_ROOT` 跑 git 且对输出做字面断言」，由 AC2 的静态检查机械拦截。

**AC2（可机械化判据落地）**：新增 `plugin/scripts/live-repo-literal-assert-check.ts`，判据
「`cwd=REPO_ROOT` + git + 对输出字面断言 ⇒ 违规」。规则：glob 测试文件同时满足
(A) git 绑定活仓库根（`cwd: REPO_ROOT` / `repoRoot` / `repo_root`，或 `["-C", REPO_ROOT]` / `-C REPO_ROOT`），
(B) 对 git 输出（`.stdout` 直接读，或 `const r = spawnSync("git",…)` 后 `r.stdout`，或已提取的 stdout 变量）
断言裸数字字面量 ⇒ 违规。判定按位置（`checker-lib` `buildNonCodeMask`），注释/字符串/正则提及不报。
负控（RED 被检出）与正控（GREEN 容忍形态）由 `--selftest` + `plugin/test/live-repo-literal-assert-check.test.mjs`
双面断言。新脚本已在 `capability-catalog.sh` 五表声明（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING，
unclassified=0），DELIVERY-INVENTORY 快照已再生成（scripts 218 → 219）。

**AC3（排查清零）**：`live-repo-literal-assert-check.ts --check` 扫全量 glob 测试文件 → **0 违规**。
抽验结论：57 个真调 git 的测试中，22 个 git-init 临时仓 hermetic 幂等；其余读活仓库的是相对断言
（before/after diff、exit code、`rev-parse HEAD` 只作输入不作字面断言、shape match `/^[0-9a-f]{40}$/`），
均容忍仓库增长。`:108` 是唯一「像活仓库字面断言」的样本，且实为 fixture（AC1 已澄清）。

**AC4（scoped 门绿）**：`scripts/test.sh --for-task gap-tests-assert-live-repo-state-break-idempotency`
39 tests pass / 0 fail / 0 cancelled；scoped 静态检查全绿
（test-framework-policy / test-isolation / tmp-leak-pairing / test-impl-census / task-contract /
adr016-screen-use / superseded-capability / dead-code-after-return / strategic-doc-staleness /
tick-core-static / delivery-inventory-drift / capability-catalog(AC1c) / delivery-inventory）。

**负控样例（活仓库字面断言被检出）**：
```
// inline：spawnSync("git",…,{cwd:REPO_ROOT}) 后 r.stdout 对字面量 47 断言
const r = spawnSync("git", ["log", "--all", "--oneline"], { encoding: "utf8", cwd: REPO_ROOT });
assert.equal(r.stdout.trim().split("\n").length, 47);
→ live-repo-literal-assert-check 检出（RED），`--selftest` / test 文件断言之
```

## Touches

- plugin/test/mechanism-vitality-check.test.mjs（:108 字面断言）
- plugin/scripts/live-repo-literal-assert-check.ts（新：REPO_ROOT + git + 字面断言 ⇒ 违规 静态检查）
- plugin/test/live-repo-literal-assert-check.test.mjs（新：该检查的 RED/GREEN 测试 + 负控）
- plugin/scripts/capability-catalog.sh（新脚本声明：QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照再生成：scripts 218 → 219）
- tasks/gap-tests-assert-live-repo-state-break-idempotency.md（自身）
