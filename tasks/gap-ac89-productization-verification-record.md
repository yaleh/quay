---
id: gap-ac89-productization-verification-record
title: "AC89: 产品化验证结果落一处可机械核对的记录（per-task-suite-records.jsonl 形态，非散文报告）"
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac85-local-build-current-artifact
---

**type:** execution

## Proposal

**来源**：人 2026-08-16 裁定新阶段（manager-phase-goal.md AC89）。

**目的**：AC85–AC88 完成后，产品化状态（build 产物 / CI 等价路径 / 跨主机验证结果）要写回
**一处可机械核对的记录**，供下次"产品化健康"检查复用。

**判据**：验证结果（成功/失败 + 证据）落一份**可机械核对**的记录——**同 per-task-suite-records.jsonl
的形态**（结构化 JSON 行，不是散文报告）。⛔ 不要求新造一个仪表盘。

**依赖**：AC85（本机 build 产物）——记录的内容之一是该产物的版本号/路径；跨主机验证结果
（AC88）也写入本记录。

## Plan

1. 设计记录形态（JSON 行：`{ts, ac, ok, artifact, evidence, detail}`，对齐 per-task-suite-records）。
2. 落写入机制（plugin/scripts/ 下脚本或现有记录器的扩展），AC85/AC86/AC88 的验证结果写入。
3. 判据能取假：记录存在且可机械解析（jsonl 每行合法 JSON）；AC85-88 各一条。

## Acceptance Criteria

- [x] AC1: 存在一份结构化记录文件（如 `.quay/productization-verification.jsonl`），每行合法 JSON。
- [x] AC2: AC85 的 build 产物验证结果写入（成功/失败 + 版本号 + 产物路径）。
- [x] AC3: AC86 的等价路径执行结果写入（run id / 本地验证输出 + 时间戳）。
- [x] AC4: AC88 的跨主机验证结果写入（B/C 两机 + 安装/初始化/冷启动三项 + 时间戳）。
- [x] AC5: 记录可机械解析（一个读取脚本/检查器能消费，不靠人读散文）。

## Definition of Done

- [x] AC85–AC88 完成后，产品化验证状态落一处可机械核对的记录，下次"产品化健康"检查可直接消费。

## Evidence

**记录文件（SHARED checkout）**：`.quay/productization-verification.jsonl`（gitignored，`git check-ignore`
确认；与 `per-task-suite-records.jsonl` 同族运行时状态）。当前 4 行，每行合法 JSON，已由 checker 判定
`ok:true, evaluated:true`（`productization-verification-record-check.ts` 复算见下）。**记录落在主检出
（shared checkout），不落 worktree 的 fork-inherited `.quay/`**——与 per-task-suite-record.ts 同
`resolveSharedCheckout`（`git rev-parse --git-common-dir`）。

**记录形态**：`{ts, ac, ok, artifact, evidence, detail}` + 按 AC 附加字段
（AC85→`version`，AC86→`runId`，AC88→`host` + `stepInstall/stepInit/stepColdstart`）。`ok:false` 是合法
记录（失败的验证也必须入账）——checker 只判形状，不判 ok 值。

**写入机制（AC5 消费侧的对应物）**：
- `plugin/scripts/productization-verification-record.ts`（writer）——CLI append 一行到 shared checkout 的
  `.quay/productization-verification.jsonl`；fail-closed（缺必需字段 exit 2、不写任何东西，硬规则 3b）。
- `plugin/scripts/productization-verification-record-check.ts`（checker）——判据1 shape（每条记录的
  base+per-AC 字段，malformed ⇒ RED）+ 判据2 coverage（AC85/AC86/AC88-B/AC88-C 各至少一条 well-formed
  记录，缺 ⇒ RED；空记录集 ⇒ NOT-EVALUATED 不误红）。`ok:false` 不构成 shape 违规。
- **独立工具，未接 run_static_checks**（同 verify-deliver-coldstart.sh 先例）：它服务「产品化健康」检查
  （按 DoD 的下次消费方），不是每轮不变量；接进套件会把全 suite 绿性与 AC88 的执行状态（pending ③）
  和 host 字段保证耦合——「不能新增红」约束下不做。

**AC1 — 记录文件存在、每行合法 JSON**：
```
$ node --experimental-strip-types plugin/scripts/productization-verification-record-check.ts --json
  → {"ok":true,"evaluated":true,"reason":"productization-verification-record-check-pass",
     "checks":[{"check":"record-shape","ok":true,"reason":"well-formed (4 record(s))"},
               {"check":"per-ac-coverage","ok":true,"reason":"all-recorded (AC85 1 / AC86 1 / AC88 hosts B+C)"}]}
```
每行 `JSON.parse` 可解（checker 的 readJsonl 逐行 parse，unparseable ⇒ null ⇒ RED——4 条全 well-formed）。

**AC2 — AC85 记录写入**：
```
{"ts":"2026-08-16T03:58:17.000Z","ac":"AC85","ok":true,
 "artifact":".../quay-0.4.0.tgz","version":"0.4.0",
 "detail":"path=.../quay-0.4.0.tgz size=3214065 mtime=2026-08-16T03:58:17Z sha256=05ada1ec... plugin_entries=321 version=0.4.0 repo_version=0.4.0 MATCH=yes"}
```
（成功 + 版本号 0.4.0 + 产物路径 + sha256；证据取 AC85 任务 Evidence 的真实值）

**AC3 — AC86 记录写入**：
```
{"ts":"2026-08-16T04:10:47.000Z","ac":"AC86","ok":true,"runId":"31925993366",
 "evidence":"gh run view 31925993366 --log --job 95113525795 | grep -E 'quay --version on|dist-verify-node-floor OK'",
 "detail":"run_id=31925993366 job_id=95113525795 node=v20.20.2 version=0.4.0 completed=2026-08-16T04:10:47Z output='quay --version on v20.20.2: 0.4.0'"}
```
（run id 31925993366 + 本地验证输出 + completed 时间戳；证据取 AC86 任务 Evidence）

**AC4 — AC88 记录写入（B/C 两机 + 三项 + 时间戳）**：B 与 C 各一条 AC88 记录，`host` 区分两机，
`stepInstall/stepInit/stepColdstart` 布尔三项 + `ts`：
```
{"ts":"2026-08-16T10:37:00.000Z","ac":"AC88","ok":false,"host":"B",
 "stepInstall":true,"stepInit":true,"stepColdstart":false,
 "detail":"host=B build_sha=25f76ad7 build_date=2026-08-16T10:37Z step_install=ok step_init=ok step_coldstart=pending (AC88 ③ 待决 ...)"}
{"...": "...","host":"C", ...}   # 同构
```
（①② 已验（AC88 任务 Evidence：STEP1_OK=1 + STEP2_OK=1 + AC5_OK=1），③ 冷启动 pending ⇒ `ok:false`
诚实入账；AC88 完成后 outer 驱动会再 append `ok:true` 记录——append-only 设计）
**AC88 接入**：`verify-deliver-coldstart.sh` 新增 `--host <B|C>`，其 AC89 记录行扩为
`{"ts","ac":"AC88","ok","artifact","evidence","detail","host","stepInstall","stepInit","stepColdstart"}`
——AC88 执行时把主机与三项结果写进本记录文件（`--ac89` 默认 `<cwd>/.quay/productization-verification.jsonl`）。

**AC5 — 可机械解析**：checker 即消费方；`plugin/test/productization-verification-record-check.test.mjs`
34 条 fixture（writer append/fail-closed/每 AC 必填字段、checker 判据1/判据2 正负控制、roundtrip、
shared-checkout 解析）全绿。

**机制侧改动**：
- `capability-catalog.sh` 登记两个新机件（question/cadence=按需/失效前提/last_reaffirmed/matching）；
- `docs/proposals/quay-product-outline.md` §6 DELIVERY-INVENTORY 快照 `scripts 256→258`
  （`verify-delivery-surface.ts --write-inventory` 重生成，delivery-inventory-drift-gate 绿）；
- `.gitignore` 补 `**/.quay/productization-verification.jsonl`（运行时状态，永不提交）。

**测试**：`scripts/test.sh --for-task gap-ac89-productization-verification-record` scoped 静态闸全绿
（delivery-inventory/catalog/superseded/concurrency/landing 等）；selector 对 Touches 解析 0 测试文件
（Touches 多为脚本/产物 glob，同 AC85 先例），`productization-verification-record-check.test.mjs`（34）+ 
`capability-catalog.test.mjs`（16）+ `verify-deliver-coldstart.test.mjs`（7）单独跑全绿。

## Touches

- plugin/scripts/productization-verification-record.ts（AC89 writer，新增）
- plugin/scripts/productization-verification-record-check.ts（AC89 checker，新增）
- plugin/scripts/verify-deliver-coldstart.sh（AC88 记录写 host + 三项步骤字段）
- plugin/scripts/capability-catalog.sh（登记两个新机件）
- plugin/test/productization-verification-record-check.test.mjs（AC89 fixture，新增）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照 scripts 256→258）
- .gitignore（补 `.quay/productization-verification.jsonl` 运行时状态忽略）
- .quay/productization-verification.jsonl（记录文件，SHARED checkout 运行时状态——`.quay/**` 过度宽泛，收窄到具体文件）
- tasks/gap-ac89-productization-verification-record.md（自身）
