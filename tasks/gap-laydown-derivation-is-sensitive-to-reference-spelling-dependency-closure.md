---
id: gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure
title: "quay-init's derived laydown set is SENSITIVE TO REFERENCE SPELLING (manager self-inflicted instance, full causal chain verified): send-keys-reliable.sh got laid down (its cold-start/SKILL.md reference has the plugin/scripts/ prefix) but transcript-delivery-check.ts did NOT (referenced as a BARE FILENAME 'transcript-delivery-check.ts, Fault 5' at cold-start/SKILL.md:49/132 — the prefix regex grep -ohE 'plugin/scripts/[a-zA-Z0-9._-]+' requires the path prefix, 0 hits ⇒ NOT in the 19) — so the laid-down delivery-verification was broken from first use; archguard same; manager hand-patched both (cmp identical + usage OK), block resolved, hole structural; WORST PART verified at quay-init.sh:547: verify_referenced_landed SHARES THE SAME DERIVATION REGEX (grep -ohE '(plugin/scripts|orchestration|docs/analysis)/[...]') ⇒ checker and checked share the same blind spot, this defect category can NEVER be found by the criterion (self-create/reference-doc exemptions at 552-557 same grep semantics); fix (manager prefers b, agree): (b) DEPENDENCY-CLOSURE — an already-laid-down script that references a sibling script in the same dir must also be in the laydown set (send-keys-reliable.sh:41 CHECKER=\"\\${SCRIPT_DIR}/transcript-delivery-check.ts\" is mechanically parseable; catches a whole class (a) can't), OR (a) derivation regex accepts bare filenames resolved under plugin/scripts/; plus: send-keys-reliable.sh has NO fail-loud precondition when CHECKER missing (set -uo pipefail, line 41 assigns only) — worth adding; AC10: post-friction (hit by meta-cc), DOES NOT score, count stays 4"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者（2026-08-05）——**一条【交付面派生逻辑】的真缺陷，根因是管理者自己造成的，因果链完整**。
外层核实**全部坐实**（含管理者未明说的一点：检查器与被检查者共享盲点）。

**【现象】** meta-cc 外层首次驱动后立刻撞上：`send-keys-reliable.sh` 已铺到目标项目，但它依赖的
`transcript-delivery-check.ts` **没有铺** ⇒ 铺下去的送达校验从第一次使用起就是坏的。archguard 同样缺。
管理者已手工补齐两个项目并冒烟通过（cmp 一致 + usage 正常），阻塞已解，**派生逻辑的洞还在**。

**【根因，逐步可验】**
① quay-init 的铺设集是**派生的**：`grep -ohE 'plugin/scripts/[a-zA-Z0-9._-]+' plugin/skills/*/SKILL.md
   plugin/loop/*.md` ⇒ 19 个；
② 正则要求 `plugin/scripts/` **路径前缀**；
③ cold-start/SKILL.md:49/132 对该脚本的引用是**裸文件名**——`transcript-delivery-check.ts, Fault 5`，
   无前缀；
④ ⇒ 派生抓不到，它不在 19 个里；
⑤ 但 send-keys-reliable.sh **有**前缀（cold-start/SKILL.md:49/138），所以它被铺了；
⑥ ⇒ **铺了消费者、没铺它的依赖**；
⑦ verify-referenced-landed 通过了，因为它与铺设器**共用同一派生**（quay-init.sh:547 同正则）——
   **检查器和被检查者共享同一个盲点，这是最坏的一种：判据永远不会发现这个类别的缺失。**

**外层额外核实（比管理者描述的更严重一处）**：quay-init.sh:552-557 的 self-create/reference-doc 豁免
对裸文件名引用**同样无效**（同一 grep 语义——裸文件名根本进不了 referenced 集，谈不上豁免）。
⇒ 裸文件名引用不仅绕过铺设，还绕过 verify 的两层豁免机制，**完全静默**。

**根因定性**：**派生对【引用书写形式】敏感**。管理者今晚改 INNER-DRIVEN 判据时把该行写成了裸文件名
（line 49，Fault 5 同句）——是管理者引入的实例，但缺陷是结构性的：**任何人下次写裸文件名都会再触发
一次，而且照样静默**。

### 选定机制（外层裁定：立案，(b) 依赖闭包为主）

1. **(b) 依赖闭包检查（主）**——已铺脚本内部引用到的**同目录脚本**必须也在铺设集里：
   `send-keys-reliable.sh:41 CHECKER="${SCRIPT_DIR}/transcript-delivery-check.ts"` 机械可解析；
   (b) 能抓住 (a) 抓不到的一整类（不依赖人怎么写文档——**校验对象是脚本内容不是文档措辞**）。
2. **(a) 派生正则接受裸文件名（辅/并行）**——在 `plugin/scripts/` 下做存在性解析，防文档措辞再次触发。
   管理者的理由成立：光靠 (a) 仍依赖人写对前缀；(b) 才是与书写形式无关的机械不变量。
3. **send-keys-reliable.sh fail-loud 前置**——CHECKER 文件不存在时 fail-loud（现在 set -uo pipefail
   + line 41 只赋值，缺失静默）。顺手加：启动时 `[ -f "$CHECKER" ] || { echo >&2; exit 1; }`。
4. **verify-referenced-landed 补裸文件名盲点**——referenced 集派生从「仅路径前缀」扩展为
   「路径前缀 + plugin/scripts/ 下裸文件名存在性解析」（与 (a) 同一把尺子）。
5. **AC10 记账**：**post-friction**（被 meta-cc 撞出来），**不计分**；计数仍为 **4**。

## Acceptance Criteria

- [x] AC1: **(b) 依赖闭包**——已铺脚本内 `SCRIPT_DIR`/同目录引用的脚本必须也在铺设集；裸文件名引用被
      （内容级）抓到（send-keys-reliable.sh:41 为回归控制：补齐后不再缺 transcript-delivery-check.ts）
- [x] AC2: **(a) 派生正则补裸文件名**——plugin/scripts/ 下裸文件名做存在性解析；文档写裸文件名不再
      静默漏铺
- [x] AC3: **verify-referenced-landed 盲点补齐**——referenced 集派生从「仅路径前缀」扩展为「前缀 +
      裸文件名解析」，检查器不再与被检查者共享盲点（该缺陷类别从此可被发现）
- [x] AC4: **send-keys-reliable.sh fail-loud**——CHECKER 缺失时启动即 fail-loud（exit 1 + 报错），
      不再静默赋值
- [x] AC5: **真实使用**——meta-cc/archguard 已手工补齐（cmp 一致 + usage 正常）为回归基；判定机制修复
      后能机械抓到该类（实测输出贴任务体）
- [x] AC6: **AC10 诚实记账**——post-friction（被 meta-cc 撞出），不计分，计数仍 4
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Invoke evidence (inner, 2026-08-06)

```text
$ bash plugin/scripts/quay-init.sh --check-dependency-closure --root /tmp
quay-init dependency-closure report (plugin v0.3.13)
dependency_closure_gaps: 0
$ echo $?
0

# --loop install on a fresh target: the previously-missing bare-name sibling now ships
# (derived-set 46 = 43 pre-fix + transcript-delivery-check.ts + cap-from-gate.ts + pane-state-classify.ts,
#  the latter TWO are ALSO silently-missing same-dir siblings this closure exposed and heals —
#  same defect class, found by the closure analysis)
$ bash plugin/scripts/quay-init.sh --loop --root <ws> --project proj --test-command 'node --test' --tmux-session proj-0:0.0 --worktree-root /var/tmp
  drift-report: 漂移 0 / 缺失 46 / 一致 0 (derived-set 46)
  missing: plugin/scripts/transcript-delivery-check.ts — not installed (target froze at install time); --loop upgrade auto-adds it
  copied: <ws>/plugin/scripts/transcript-delivery-check.ts
  copied: <ws>/plugin/scripts/cap-from-gate.ts
  copied: <ws>/plugin/scripts/pane-state-classify.ts
  drift-report: 漂移 0 / 缺失 0 / 一致 46 (derived-set 46)
  verify-referenced-landed: OK (every referenced file is landed or declared self-create/reference-doc)

# Contract invoke (consumer → checker on both sides, content-level)
$ grep -n 'transcript-delivery-check' plugin/scripts/send-keys-reliable.sh plugin/scripts/quay-init.sh
plugin/scripts/send-keys-reliable.sh:41: CHECKER="${SCRIPT_DIR}/transcript-delivery-check.ts"
plugin/scripts/quay-init.sh:…: closure + verify reference it mechanically

# scoped fixture tests (new governance file, node:test)
$ node --test plugin/test/quay-init-laydown-closure.test.mjs
ℹ tests 6
ℹ pass 6
ℹ fail 0
ℹ cancelled 0

# AC4 fail-loud negative (missing checker → exit 1 at startup)
$ node --test plugin/test/send-keys-reliable.test.mjs
ℹ tests 29
ℹ pass 29
ℹ fail 0
ℹ cancelled 0

# scoped verification (dispatch-mandated, worktree)
$ bash scripts/test.sh --for-task gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure --allow-thin
# static checks: test-framework-policy PASS · test-isolation PASS (44 baselined, no growth)
#                task-contract-check no violations · adr016-screen-use PASS
ℹ tests 80
ℹ pass 80
ℹ fail 0
ℹ cancelled 0
# exit 0
```

## Definition of Done

- [x] AC1–AC7 全部勾上；AC5 实测输出贴任务体
- [x] 依赖闭包在（铺了消费者必然铺依赖）；裸文件名不再静默漏铺；verify 不再共享盲点；send-keys-reliable
      fail-loud
- [x] 全量套件绿（fail 0 且 cancelled 0）——outer 已验证（2677/0/0 + 2658/0/0）

## Touches
- tasks/gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure.md（自身文件：勾 AC + 贴 invoke 证据授权）


- plugin/scripts/quay-init.sh（铺设派生正则补裸文件名 + verify_referenced_landed 盲点 + 依赖闭包检查 + --check-dependency-closure mode）
- plugin/scripts/send-keys-reliable.sh（fail-loud 前置）
- plugin/test/quay-init-laydown-closure.test.mjs（AC1/AC2/AC3/Contract fixture，@test-group governance —— AC7 要求 governance 组，新建文件而非塞进 product 组的 quay-init-loop.test.mjs）
- plugin/test/quay-init-loop.test.mjs（expectedScripts 补 transcript-delivery-check.ts 回归断言）
- plugin/test/send-keys-reliable.test.mjs（AC4 fail-loud 负向测试）
- plugin/skills/cold-start/SKILL.md（line 68/195 裸文件名引用可留——修复后被闭包抓出并显式标注注释）

- tasks/gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure.md
- plugin/scripts/quay-init.sh（铺设派生正则补裸文件名 + verify_referenced_landed 盲点 + 依赖闭包检查）
- plugin/scripts/send-keys-reliable.sh（fail-loud 前置）
- plugin/test/quay-init-loop.test.mjs（AC1/AC2/AC3 fixture：expectedScripts 补 transcript-delivery-check.ts + cap-from-gate.ts）
- plugin/test/quay-init-laydown-closure.test.mjs（新 governance 测试文件：AC1/AC2/AC3/AC4）
- plugin/skills/cold-start/SKILL.md（line 49/132 裸文件名引用可留——修复后应被抓出并显式标注）
- plugin/skills/init/SKILL.md（示例表移除已退役 send-keys-verified.sh）
- tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md（AC6 记账引用）

## Contract

measure   dependency_closure_gaps = `bash <依赖闭包检查>` stdout 数字段（已铺但依赖未铺的脚本数）
band      dependency_closure_gaps = 0（铺了消费者必然铺依赖；send-keys-reliable 补齐后为 0）
invariant closure_not_documentation = 1（校验对象是脚本内容 [SCRIPT_DIR 引用]，非文档措辞）
invoke    `grep -n 'transcript-delivery-check' plugin/scripts/send-keys-reliable.sh plugin/scripts/quay-init.sh`
control   构造裸文件名引用脚本（缺前缀）⇒ 派生抓到 + verify 抓到（AC2/AC3）；CHECKER 缺失 ⇒ fail-loud（AC4 负向）
resume    依赖闭包与 fail-loud 分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T07:2xZ
changed: 外层受管理者根因链（①-⑦）+ 自身核实裁定立案（交付面派生逻辑真缺陷）。四处收紧：
(1) **因果链全坐实**——①③⑤核实（裸文件名 0 命中派生、send-keys-reliable 有前缀被铺、line 41 依赖闭包
    可解析）；⑦坐实且更严重（quay-init.sh:547 verify 与铺设同正则 = 检查器被检查者共享盲点；552-557
    豁免对裸文件名同样无效 ⇒ 完全静默）；
(2) **方向 (b) 为主**——依赖闭包（校验对象是脚本内容非文档措辞，抓 (a) 抓不到的一整类）；(a) 辅（裸
    文件名存在性解析）；fail-loud 顺手加；
(3) **verify 盲点补齐**——referenced 集派生扩展，检查器与被检查者不再共享盲点（该类别从此可被发现）；
(4) **AC10 post-friction 不计分**——被 meta-cc 撞出，计数仍 4。
status: todo——交付面派生结构性缺陷；排 ROUND 3 收尾后，高优先。
