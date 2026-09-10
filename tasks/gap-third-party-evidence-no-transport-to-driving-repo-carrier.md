---
id: gap-third-party-evidence-no-transport-to-driving-repo-carrier
title: 第三方主机产出的 GOAL-009/015 证据没有回传机件 —— 8 条 goal
  判据要求「host≠本机」的记录落在驱动方载体里，而唯一写入者只在它自己运行的那台机上写，注释里点名的 develop-deliver-tgz.sh
  --verify-coldstart 不存在
status: todo
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-207
---
## Proposal

**实测（2026-09-10 22:1xZ，全仓库枚举，非抽查）**：GOAL-009 在域 9 条判据中有 7 条（AC-203/204/205/206/207/214/232）、GOAL-015 有 1 条（AC-234），逐条要求本仓库 `.quay/productization-verification.jsonl` 里出现一条满足 `host != 本机 hostname` ∧ `project_root` 不在本仓库下的记录。**而把这个量从产生处送到读取处的那一层不存在。**

三个直接量（按位置判定，硬规则②）：

1. **写入者唯一**：`grep -rln 'productization-verification' --exclude-dir=node_modules .` 在非归档、非 goals、非 packages 副本的范围内只命中 **`plugin/scripts/verify-deliver-coldstart.sh` 一个可执行件**；`grep -rn 'GOAL-009-AC-\|GOAL-015-AC-' plugin/scripts/*.{sh,ts}` = **36 命中，全部在该文件**。它写的是 `<cwd>/.quay/productization-verification.jsonl`（`:1949` 的 `--ac89` 缺省）——**运行在哪台机上就写在哪台机上**。
2. **判据要求它运行在【别的机】上**（`host != me`）⇒ 记录必然落在远端；**而没有任何机件把它取回来**：全仓库 `ac89` / `productization-verification` 的读侧命中只有 goals/ 的判据本身与该脚本自己，**零个 ingest/回传实现**。
3. **注释点名的那个机件不存在**：`verify-deliver-coldstart.sh:48` 写「跨主机驱动由 `develop-deliver-tgz.sh --verify-coldstart` 承担（scp 本脚本 + .tgz 过去执行，再取回证据）」。实测 `develop-deliver-tgz.sh` 的 arg parser（`:80-85`）flag 全集 = `--root --hosts --force --check --max-age --selfcheck`，**`grep -c 'verify-coldstart' plugin/scripts/develop-deliver-tgz.sh` = 0**；其 remote_script（`:371-414`）只做 `npm install -g` → `quay serve` + http 探活 → `deliver-verify-usage.sh`，**既不跑 verify-deliver-coldstart.sh，也不 scp 任何证据文件回来**（本地侧只 `grep` 远端 stdout 的 `HTTP-VERDICT` / `USAGE-VERIFY-*` 标记）。

**载体本身在 `.gitignore` 里** ⇒ 也不可能靠 git 回流。

**后果（已实测发生）**：2026-09-10 09:40Z 在 orangevps 上的一次真实运行**确实产出了 4 条记录**（`GOAL-009-AC-204` host=B / `GOAL-009-AC-206` host=orangevps / `GOAL-009-AC-201` / `AC88`），落在 `~/work/ac207-e2e-record.jsonl`；同机 `~/work/quay/.quay/productization-verification.jsonl` 的 `GOAL-` 记录数 = **0**；本机载体 24 条记录里 `GOAL-*` 只有 1 条 `GOAL-009-AC-201`（本机产），**上述 8 条判据要求的形态一条都没有**。⇒ 证据产出了、被扔在远端旁路文件里、判据永远读不到。

**这不是「还没跑够」，是判据穿不过中间层**（硬规则 4c）：量的产生处（远端 cwd）与读取处（驱动方仓库载体）之间少了一层，因此这 8 条判据只能靠人手工搬运才可能转绿，**机制上不可达**。历史上唯一进过本地载体的跨机记录（`AC88` host=B/C 等 15 条）也正是这样手工搬的。

**相关但不同机制的既有任务**（均 done，都不覆盖回传这一层）：`gap-ac107-cross-host-mechanized-verify`（跨机跑该脚本）、`gap-ac88-verification-mechanism-extend-deliver`（扩展远端验证覆盖面）、`gap-deliver-verification-trigger-orphaned-after-land-path-migration`（触发点失联）。

## Plan

1. 在 `develop-deliver-tgz.sh` 实现注释已声明的 `--verify-coldstart` 模式：scp `verify-deliver-coldstart.sh` + 两个 .tgz 到目标机 → 远端以显式 `--ac89 <远端临时路径>` 执行 → **scp 该证据文件回本地** → 把其中行追加进本地 `.quay/productization-verification.jsonl`。
2. 回传/合并要 fail-loud：远端证据文件缺失/不可读/零行 ⇒ 输出一个与「合格」**不同形**的取值（`NOT-EVALUATED` / 非零退出），⛔ 不得静默 exit 0（硬规则 3b）。
3. 追加时按 `(ts, ac, host, project_root)` 去重，避免重复回传把同一条记录灌成多条（判据只判存在性，但重复会污染新鲜度判据 AC-214 的读数）。
4. 加测试钉死回传与降级两个方向。
5. 修正 `verify-deliver-coldstart.sh:48` 的注释使其与实现一致（当前它描述了一个不存在的机件——这本身就是硬规则 3b 的「看起来覆盖了」形态）。

## Acceptance Criteria

- [ ] AC1 机制落地（能取假）：`grep -n -- '--verify-coldstart)' plugin/scripts/develop-deliver-tgz.sh` ≥ 1 命中且位于 arg parser 的 `case` 分支位置（贴命中行与其上下各 2 行）；改前该 grep = 0（贴改前读数）。
- [ ] AC2 远端执行 + 取回：跑一次 `--verify-coldstart --hosts B`，贴出 ① 远端证据文件的行数读数 ② 把它 scp 回本地的命令与落地路径 ③ 追加后本地载体的行数前后差。
- [ ] AC3 直接量落账：跑完后 `python3` 读本地 `.quay/productization-verification.jsonl`，存在 ≥1 条满足 `ac` 以 `GOAL-009-AC-` 开头 ∧ `host` 非空且 ≠ 本机 `socket.gethostname()` ∧ `os.path.realpath(project_root)` 不在本仓库路径下的记录；贴出该记录全文与判定命令。
- [ ] AC4 负控制（能取假）：远端证据文件不存在（或传一个不可读路径）时，该模式**不新增本地记录**且退出码非 0 / 打印 `NOT-EVALUATED`；贴出该次运行的输出与本地载体行数不变的前后读数。
- [ ] AC5 测试钉死：新增 `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`，两方向各一条——① 给一份含 `GOAL-009-AC-*` 行的证据文件 ⇒ 目标载体新增对应行且重复调用不产生重复条目 ② 给空/缺失文件 ⇒ 返回可区分的未评估取值而非成功；`node --test plugin/test/develop-deliver-tgz-evidence-transport.test.mjs` exit 0。
- [ ] AC6 注释与实现一致：`verify-deliver-coldstart.sh:48` 描述的机件在 `develop-deliver-tgz.sh` 中可枚举到（AC1 的命中即证），且注释中的路径/flag 名与实现逐字一致（贴两侧文本）。

## Definition of Done

本仓库 `.quay/productization-verification.jsonl` 中出现**由机件回传、非手工搬运**的 `GOAL-009-AC-*` 记录（`host` ≠ 本机、`project_root` 在本仓库之外），且该回传路径对「远端没产出证据」给出与成功不同形的取值。⛔ 夹具/注入数据不算（硬规则 4 推论三）——判据读的必须是一次真实跨机运行留下的生产记录。

## Touches

- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- tasks/gap-third-party-evidence-no-transport-to-driving-repo-carrier.md
