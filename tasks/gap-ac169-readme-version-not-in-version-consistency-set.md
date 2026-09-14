---
id: gap-ac169-readme-version-not-in-version-consistency-set
title: AC169 判据复红——plugin/README.md 版本漂移到 v0.6.1（实际
  v0.6.3），且该文件不在版本一致性闸的受检集内（再改字面量必复发）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-169
---
## Proposal

**要满足的判据（正本 `goals/AC-169-delivery-surface-doc-sync.md`，逐字）**：

```
v=$(python3 -c "import json;print(json.load(open('plugin/.claude-plugin/plugin.json'))['version'])")
grep -q "v$v" plugin/README.md || exit 1
grep -qE 'v0\.4\.0' plugin/README.md && exit 1
exit 0
```

**立案当轮实测（2026-09-14 本机直读，非推断）**：

| 读数 | 实测值 |
|---|---|
| `plugin/.claude-plugin/plugin.json` version | `0.6.3` |
| `plugin/README.md:3` | `quay plugin v0.6.1 — distributes…` |
| `grep -q "v0.6.3" plugin/README.md` | exit **1**（当前版本号缺失） |
| `grep -qE 'v0\.4\.0' plugin/README.md` | exit **1**（陈旧值已清） |

⇒ 合取为 **FALSE**，判据现红。

**为什么上一次修复没有守住（本任务必答）**：`tasks/gap-ac169-delivery-surface-doc-sync.md`（**done**，同一 AC）把 `plugin/README.md:3` 的 `v0.4.0` 逐字改成 `v0.6.1` —— **只改了字面量，没有改产生漂移的源头**。此后发生两次版本 bump（`158616df7` 0.6.1→0.6.2、`92c5b1b15` 0.6.2→0.6.3），每次受改集恒为「8 文件 + `plugin/VERSION`」；**`plugin/README.md` 不在这 9 个之内**，两次都没被带上，字面量原地停摆。

**为什么没有任何闸发现它**：`scripts/version-consistency-check.ts:6` 自述「the enumerated list below IS the canonical set of version-bearing files」，并由 `.github/workflows/ci.yml:119-136`（job `version-consistency`）在每次 push 执行；但 `VERSION_ENTRIES`（该文件 `:26`）里**没有** `plugin/README.md` ⇒ README 漂移时检查器**照旧 exit 0**。⇒ 缺口不是「这次忘了改」，是「README 不在受检集里」。再改一次字面量，下一次 bump 必然同形复发（硬规则 5b：修好一个实例 ≠ 只有那一个实例），本 AC 会被 driver 无限重立案。

## Plan

**产物**：① `plugin/README.md:3` 的版本字面量 = 当前 `plugin.json` 版本（判据转 TRUE）；② `plugin/README.md` 进入版本一致性闸的受检集，使下一次 bump 漏掉它时闸变红（fail-closed，且「读不到」与「一致」可区分）；③ 一条**按对象可证假**的负控制：只改 README 的版本 ⇒ 闸 exit 1；改回 ⇒ exit 0。

**硬顺序**：

0. 当场重取读数（⛔ 不采信本任务正文的立案读数，会过期）：`plugin.json` version / `plugin/README.md:3` / 判据原样 exit code / `git log --oneline -1`。
1. 判据转 TRUE：`plugin/README.md:3` 的版本字面量改为第 0 步读到的当前 `plugin.json` 版本。⛔ 不写占位符——判据是逐字 `grep "v$v"`，占位符让它恒假；⛔ 不引入 `v0.4.0`。
2. 源头修复：把 `plugin/README.md` 加入 `scripts/version-consistency-check.ts` 的 `VERSION_ENTRIES`，extractor 从该散文行取出 `v<semver>`；**取不到时必须 throw（落 `mode:'error'`）**，不得返回空串或任何与「一致」同形的值（硬规则 3b：读不懂输入不得伪装成通过）。
3. 同步被钉死条数的既有产物（⛔ 只加条目不同步它们 ⇒ 基线恒红，把「接线成功」伪装成「case 坏了」）：`scripts/version-consistency-check.test.ts` 的条数断言（`assert.equal(entries.length, 8)`）与 `ALL_PATHS`（现 8 条）、以及 `makeFixture`（必须为 README 造出可解析内容，否则 fixture 落 error 模式 ⇒ 假红）；`plugin/scripts/checker-mutation-cases/version-consistency-check.sh` 的 fixture 必须造出 `plugin/README.md`（否则新条目读不到文件 ⇒ 基线 RED ⇒ exit 4「checker always-red」）。
4. 负控制（判据的判据）：在**临时 root 副本**上（用 checker 自带的 `--root`，⛔ 不动真实树）只改 README 的版本 ⇒ exit 1 ∧ `--json` 的 `mode=="drift"`；改回 ⇒ exit 0。既有 mutation case 覆盖的是「改机器字段」，**本次必须新增「只改 README」这一路**——否则「加了条目」与「条目真的在判」不可区分（硬规则 4）。
5. 同步 `.github/workflows/ci.yml:120` 的注释「8 version-bearing artifacts」为实际条数（**仅注释行**，不改 job 逻辑）。
6. ⛔ **明确不动** `plugin/scripts/direct-to-develop-bypass-check.ts:309`：那里的「'All 8 files carry version 0.6.1'」是 ruled 表里对既提交 `a388ca38` 的**历史引文**，改它等于篡改历史记录。

**7.（执行期追加的越界解阻，非原计划——如实记录）** scoped 门实测红在 `quay-init-closure-ratchet-stale`：**与本次 delta 无关的既存全仓红**（主检出同读 `changed: plugin/.claude-plugin/plugin.json`，且 `git diff develop -- plugin/.claude-plugin/plugin.json` 为空）。根因：`92c5b1b15`（0.6.2→0.6.3 bump）改了被 fingerprint 的 source `plugin.json` 却**漏了 re-anchor**——上一次 `9ea261f14` 是 bump 后跟了一个 re-anchor chore 提交，这次没跟。**已实测零增长**（`--gate`：3 files / 1022 bytes = baseline 3/1022，因 0.6.2→0.6.3 同长度 ⇒ 只动 sha 不动字节轴）⇒ `--reanchor` 是**纯新鲜度刷新、不掩盖任何增长**。已在 worktree 执行 `--reanchor`（files/bytes 逐字不变，仅 `fingerprint` 与 `plugin.json` 的 `sha` 刷新），`--check-stale` 转 PASS。故 `docs/analysis/quay-init-closure-ratchet.baseline.json` 进入本任务 Touches。

**已知边界（诚实声明）**：该检查器**不在 `scripts/test.sh` 的本地 static-check 集内**（本地套件 glob 为 `packages/*/test/*.test.mjs plugin/test/*.test.mjs experiments/quay-perpetual-stream/test/*.test.mjs`，不含 `scripts/*.test.ts`），其执行点是 CI job `version-consistency` 与 mutation case（`plugin/test/checker-mutation-check.test.mjs`，在本地 glob 内）。把它接入 `plugin/scripts/runner-static-gate.ts` 的 `run_static_checks` 属**另一个机制裁决**，不在本任务范围内（⛔ 不顺手扩大）。

<!-- dedup-ref -->
**与既有任务的关系（追溯，不构成本任务的额外声明）**：`tasks/gap-ac259-version-union-lockstep-and-host-install-readings.md`（**todo**，claim `goal_ac: AC-259`）第 1 步要往同一个 `VERSION_ENTRIES` 里加 `plugin/VERSION`，并同步同一份单测与 mutation fixture。两者是**同一个数组的并集**（它加 `plugin/VERSION`，本任务加 `plugin/README.md`），不是二选一；后落地者 `git merge develop` 取并集，⛔ 不凭记忆重写整段数组。历史 `gap-ac169-delivery-surface-doc-sync`（done）是本 AC 的**前一次未守住**的修复，其结论不被本任务采信。第 7 步与 `gap-quay-init-closure-ratchet-manual-reanchor-recurs`（done）同源但**不是同一条**：那条治的是**字节轴增长**（footprint grew），本条遇到的是**新鲜度轴**（source sha 变了而 baseline 未 re-anchor，字节轴零增长）——该任务未覆盖后者。

## AC

- [x] AC1（AC-169 criterion 逐字 exit 0）：`v=$(python3 -c "import json;print(json.load(open('plugin/.claude-plugin/plugin.json'))['version'])") && grep -q "v$v" plugin/README.md && ! grep -qE 'v0\.4\.0' plugin/README.md && echo PASS`（贴命令与 exit code）
- [x] AC2（README 进入受检集）：`scripts/version-consistency-check.ts` 的 `VERSION_ENTRIES` 含 `plugin/README.md` 条目；在真实树上 `node --experimental-strip-types scripts/version-consistency-check.ts` exit 0（贴全文输出）
- [x] AC3（按对象负控制——本任务新增的那一路）：临时 root 副本上只改 README 版本 ⇒ exit 1 且 `--json` 的 `mode=="drift"`；改回 ⇒ exit 0（贴两次命令、exit code 与 `mode` 字段）
- [x] AC4（既有产物同步后可评估）：`node --experimental-strip-types --test scripts/version-consistency-check.test.ts` exit 0 ∧ `plugin/scripts/checker-mutation-cases/version-consistency-check.sh` 对临时 workdir 跑出 GREEN→RED→GREEN（exit 0，**非** exit 3/4）
- [x] AC5（schema）：`node plugin/scripts/task-schema-check.ts tasks/gap-ac169-readme-version-not-in-version-consistency-set.md` exit 0

## DoD

`goals/AC-169-delivery-surface-doc-sync.md` 的 criterion 逐字 exit 0（`plugin/README.md` 含 `plugin.json` 当前版本号 ∧ 不含 `v0.4.0`），且该保证**跨下一次版本 bump 仍成立**——判据是 README 已进入版本的 canonical 受检集，且 AC3 的按对象负控制证明它**真的在判**（不是接了条不判的线）。goal-driver 下一轮 AC-169 verdict 由 fail 转 pass（读 `.quay/goal-round.jsonl`）。

⛔ 只把字面量改成当前版本、不加受检集 ⇒ 不算达成——该形态已于 `gap-ac169-delivery-surface-doc-sync` 失败过一次，并在其后两次 bump 中复发两次。
⛔ 用 `<version>` 占位符替代逐字版本号 ⇒ 判据恒假，不算达成。

## Touches

- plugin/README.md
- scripts/version-consistency-check.ts
- scripts/version-consistency-check.test.ts
- plugin/scripts/checker-mutation-cases/version-consistency-check.sh
- .github/workflows/ci.yml
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-ac169-readme-version-not-in-version-consistency-set.md
