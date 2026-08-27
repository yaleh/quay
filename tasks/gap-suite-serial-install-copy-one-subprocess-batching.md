---
id: gap-suite-serial-install-copy-one-subprocess-batching
title: suite serial-install 族墙钟地板——quay-init.sh copy_one 逐文件 cmp/sha256sum 子进程爆炸，批量化是唯一杠杆（16-lane 并行主池，total_work 地板，拆分无效）
status: ready
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

serial install 族的 7 个慢文件（近 5 轮 M bucket avg>100s，实测）跑在 **16-lane 并行主池，非 concurrency-1 serial 泳道**（实测 measure-history 里这 7 文件 laneCount=16，全库无 laneCount=1 记录；全量 suite 总墙钟 429s < 7 文件时长之和 ~1400s ⇒ 并行摊开）。**1321s 是 total_work**（跨 16 lane 摊开只占 ~87s 墙钟），⛔ 不是 serial phase 墙钟。

**⇒ 拆分对墙钟零作用**：16-lane 并行下地板 = total_work/16，拆分不减 total_work。**唯一降地板的杠杆是摊销/批量化——减少真实子进程次数。** 这是对 `gap-suite-longtail-single-file-floor`（已 done，只修了 prod-data-audit）方向纠偏：那一条的「拆分」对 `prod-data-audit` 成立（它要批量化），但对剩下这 7 个方向本身就错。**收益估计**：批量化减 total_work ~1100s ⇒ 全量墙钟 −~60–70s（429s→~360s，方向性），⛔ 不是 −1321s。

**核心机制（本任务的落地对象）**：`quay-init.sh` 的 `copy_one()`（`quay-init.sh:244`）在 `copy_dir` 的 `for f in "$src_dir"/*`（`:359`）循环里，对 ~815 个机制文件**每文件一次 `cmp -s`**（`:258`）+ managed 文件每文件一次 `sha256sum | cut`（`:289`，两个子进程）+ 真 install 每文件一次 `cp`（`:254`）。每次 `--loop`（含 `--dry-run`）⇒ **~800–1600 个子进程 spawn**。这是 `real-target-verify.sh` dry-run（~30s）与 install（28–37s）墙钟的主导成本。

**与 buildAudit 同 shape，批量化手法可复用**：`prod-data-audit.ts` 的 `buildAudit` 曾经是同一类「循环内逐文件子进程」爆炸（逐载体 grep + 逐任务 git-log，实测 **148.2s→12.0s，−92%**），已用 `buildReferenceIndex`/`buildLandingEpochIndex`/`buildWriterIndex` 一次扫描批量化。`copy_one` 是同一 shape，收益方向一致。

**杠杆优先序（逐文件判据）**：
- **① 产品侧批量化（最高杠杆，本任务）**：`quay-init.sh` copy_one 批量化——一次 diff/python3 pass 替代逐文件 cmp，一次 `sha256sum` 批量替代逐 managed 文件 `sha256sum|cut`。**同时加速全部 7 个文件 + 真实 install（archguard/meta-cc 的实际 `quay init --loop`）**。
- **② 已摊销、剩余成本在 dry-run 扫描（① 落地后自动消解）**：`real-target-verify.test.mjs`（install 已走 `laydownWorkspace` 摊销，6 test 各跑一次 dry-run ~30s）；① 落地后 dry-run → ~3–5s。
- **③ 未摊销、测非标准 install（① 落地后大幅缩小，残留的减次数是次要杠杆）**：`quay-init-loop.test.mjs`（测 auto-commit/non-git/dry-run/decline-confirm，标准 fixture 不适用）、`install-config-driven-e2e-{runtime,upgrade,e2e}.test.mjs`（测 Node/Go 不同 target + upgrade，机制文件 byte-identical 只有 config 不同）。
- **④ 已接近最优，不动**：`quay-init-loop-driver.test.mjs`（~14/17 已摊销，仅 AC2/AC3/AC6 因改 plugin 树需 fresh install）、`worker-driver.test.mjs`（~20 集成 test spawn 真实 driver，end-to-end 地板难摊销）。

**追加摊销候选（2026-08-27，longtail worker 补）**：
- `packages/quay/test/npm-pack-e2e.test.mjs`（P bucket，96.9s avg → 120s 上升）：9 test 每个跑一遍 `package.sh`（build-dist + npm pack）+ tarball install ⇒ 摊销：一次 pack+install、9 test 复用。
- `plugin/test/verify-deliver-coldstart.test.mjs`（M bucket，115.9s avg → 160s 上升）：三步交付验证 ① npm install .tgz（独立成本，需摊销）② quay-init --loop（已被本任务 copy_one 批量化覆盖）③ 冷启动活性扫描。只①需额外处理。

## Plan

1. **先 profile 成本拆解（硬规则 4：成本结构未知前不设数值阈值）**：在 `copy_one`/`copy_dir` 里对 cmp / sha256sum / cp / 其它子进程各计时，产出「~30s dry-run 里各占多少秒」的实测表，再定批量化目标——不代拍 −92% 或任何具体数。
2. **批量化 copy_one 的文件比较**：用一次 `diff -rq`（或一次 python3 读全部源文件内存比较）替代逐文件 `cmp -s` 子进程；输出行（`would-copy:`/`would-skip (identical):`/`would-conflict:`/`would-clean-residue:` 等）**逐字不变**。
3. **批量化 managed 文件的 sha256sum**：用一次 `find -exec sha256sum {} +`（或 python3 批量）替代逐 managed 文件 `sha256sum | cut`。
4. **双向负控制（判据不能取假）**：批量化后跑一遍现有 e2e 断言面——`install-config-driven-e2e*.test.mjs`（byte-identity）、`real-target-verify.test.mjs`（would-copy/would-conflict 计数）、`quay-init-loop*.test.mjs`（laid-down 完整性）——输出与批量化前**逐字一致**。任何一行输出变了即回归。
5. **测墙钟**：dry-run 与 install 的 before/after 贴任务体（同一 N 下对照，不跨 N 比）。

## Acceptance Criteria

- [ ] AC1（能取假，成本先拆解）：`copy_one`/`copy_dir` 的 cmp/sha256sum/cp/其它 各子进程耗时实测表贴任务体，批量化目标基于该表而非拍脑袋。
- [ ] AC2（能取假，输出逐字不变）：批量化后 `quay-init.sh --loop --dry-run` 的 stdout 与批量化前逐字一致（`would-copy`/`would-skip`/`would-conflict`/`would-clean-residue` 计数与行序不变），由现有 e2e 断言面验证。
- [ ] AC3（能取假，墙钟下降）：dry-run 单次墙钟与 install 单次墙钟较批量化前显著下降（下降比例贴 before/after，同一 N 对照）。
- [ ] AC4（生产载体，非仅 fixture）：`real-target-verify.test.mjs` 全套与 `install-config-driven-e2e*` 全套在批量化后仍绿，且各自墙钟随 AC3 下降。

## Definition of Done

`quay-init.sh` copy_one/copy_dir 子进程批量化落地；AC1–AC4 全勾；dry-run/install 输出与批量化前逐字一致（e2e 断言面绿）；墙钟 before/after 贴任务体。

## Touches

- plugin/scripts/quay-init.sh（copy_one/copy_dir 批量化：一次 diff/python3 替代逐文件 cmp，一次批量替代逐 managed sha256sum|cut）
- packages/quay/test/npm-pack-e2e.test.mjs（pack+install 摊销：一次 pack+install、9 test 复用）
- plugin/test/verify-deliver-coldstart.test.mjs（npm install .tgz 摊销）
- tasks/gap-suite-serial-install-copy-one-subprocess-batching.md（自身）
