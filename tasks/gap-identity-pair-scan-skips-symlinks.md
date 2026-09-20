---
id: gap-identity-pair-scan-skips-symlinks
title: identity-replication-check.ts 的 AC3 字节对扫描跟随软链——59 对"复制"其实是同一 inode
  自己比自己，应与 mirror-pair-drift-check 同规则跳过软链
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

`plugin/scripts/identity-replication-check.ts` 的 `findByteIdenticalPairs()`（约 :234）在比对 `plugin/scripts/*` 与 `experiments/*/scripts/` 的同名文件时用 `fs.existsSync(cand)` + `fs.readFileSync(cand)`——**跟随软链**。而 `experiments/quay-perpetual-stream/scripts/` 下现有 **59 个软链**（`ls -la … | grep -c '^l'` = 59，总条目 121，`git ls-files …` = 121 同样为 121），全部形如 `X -> ../../../plugin/scripts/X`。于是扫描把 59 个文件**与它自己**逐字节比对、当然相等，报成 59 对"字节完全相同文件对 / 27646 行"。

现场实跑（立案时，逐字）：

```
== 字节完全相同文件对 (AC3) — 59 对 / 27646 行 ==
  plugin/scripts/anti-drift-touches-check.ts  ==  experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.ts  (442 行)
  plugin/scripts/anti-gaming-guard.ts  ==  experiments/quay-perpetual-stream/scripts/anti-gaming-guard.ts  (95 行)
  … 及另外 54 对
```

抽样 5/5 用 `ls -la` 核实：`anti-drift-touches-check.ts`、`anti-gaming-guard.ts`、`audit-independence-check.sh`、`audit-independence-check.ts`、`build-evidence-collector.ts` 在 experiments 侧**全部是软链**（`-> ../../../plugin/scripts/<name>`）。

**同仓已有正本规则，且与本扫描直接冲突**：`plugin/scripts/mirror-pair-drift-check.ts` 头注释逐字写着 ——

> "a REGULAR FILE present in BOTH dirs is a pair (byte-compared). A SYMLINK on either side is NOT a pair — it is a single-source reference (the same file), so it cannot drift; the checker excludes it rather than comparing a file against itself."

**判定**：探针缺陷——报出的"59 对复制"里绝大部分是**自己比对自己**（同一 inode），把"单一来源引用"读成了"复制替代抽象"的最强证据。修法方向：`findByteIdenticalPairs()` 用 `lstat`/`readlink`（或 `Dirent.isSymbolicLink()`）跳过任一侧为软链的条目，与 `mirror-pair-drift-check.ts` 取同一判定；修后对数应落到**真实常规文件副本**的量级（`mirror-pair-drift-check.ts` 头注释记的 61 个同名条目 / 21 软链 / 40 真副本，以修后现场读数为准）。

<!-- dedup-ref -->
相关联但不同机制：[[gap-mirror-pair-drift-policy-plugin-scripts-experiments]]（已 done）泛化的是**通用镜像漂移闸**（`mirror-pair-drift-check.ts`），它的产出恰好是本任务要对齐的规则正本；本任务改的是 `identity-replication-check.ts` 自己的 AC3 扫描，不动那个检查器。[[gap-archguard-p2-identity-replication-checker]]（已 done）落地检测器本体时其 AC3 只要求"报出字节完全相同文件对"，未处理软链语义。

## AC

- [ ] AC1（复现固化）：贴出立案读数逐字（59 对 / 27646 行）与 5/5 抽样的 `ls -la` 输出（证明被报的"对"在 experiments 侧是软链），并附两条计数：`ls -la experiments/quay-perpetual-stream/scripts/ | grep -c '^l'` = 59、`git ls-files experiments/quay-perpetual-stream/scripts/ | wc -l` = 121。
- [ ] AC2（修后·位置判定）：修后重跑检测器，`byteIdentical.pairs[]` 中 **experiments 侧为软链的条目数 = 0**（对每条做 `lstat` 判定后计数，贴出计数与命令），总对数落到真实副本量级（贴出修后精确数字，并与 `mirror-pair-drift-check.ts` 对同一镜像目录给出的真副本数交叉核对，贴出后者输出）。
- [ ] AC3（负控制·真副本不许被一并漏掉）：构造一个含两条目的 fixture 目录——`a.ts` 两侧都是**常规文件**且逐字节相同、`b.ts` 在 experiments 侧是**软链**——修后的 `findByteIdenticalPairs()`（或等价可注入 fixture 的测试入口）必须**报 a、不报 b**。贴出该 fixture 的真实输出（两行都要出现，一行是命中、一行是缺席的对照）。
- [ ] AC4（与姊妹规则一致）：用一条命令级证据证明两检查器对"软链不是 pair"取同一判定——`node --experimental-strip-types plugin/scripts/mirror-pair-drift-check.ts --json` 与 identity-replication 的 AC3 结果在"软链条目"这一集合上**都没有**条目（贴出两侧输出）。
- [ ] AC5（单测）：`node --experimental-strip-types plugin/test/identity-replication-check.test.mjs` exit 0，且新增断言含软链 fixture（不报）+ 真副本 fixture（报）两条。
- [ ] AC6（scoped 门）：`bash scripts/test.sh --for-task gap-identity-pair-scan-skips-symlinks` 绿（或等价 scoped 静态门）。

## DoD

修后对**生产载体**（本仓真实的 `experiments/quay-perpetual-stream/scripts/` 镜像目录）跑过一次：AC3 段输出里 59 个软链条目全部消失、真实文件副本对数保留，修前/修后两段输出逐字贴进任务体；并与 `mirror-pair-drift-check.ts` 的真副本读数交叉核对一次（贴出两侧数字）。⛔ 不以"新增 fixture 单测通过"代替生产读数（hard rule 4 推论三）。

## Touches

- plugin/scripts/identity-replication-check.ts
- plugin/test/identity-replication-check.test.mjs
- tasks/gap-identity-pair-scan-skips-symlinks.md
