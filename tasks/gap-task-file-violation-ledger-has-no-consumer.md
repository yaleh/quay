---
id: gap-task-file-violation-ledger-has-no-consumer
title: "`--no-block 的任务文件违规台账（task-file-violation-ledger.jsonl）只有写者、零读者`"
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

## Finding

**同 coverage 台账的一份 grow-only 台账，同样是零读者 —— 2026-10-01 的 AC4 同载体扫描扫出来的。**

<!-- dedup-ref --> `tasks/gap-coverage-nonblock-ledger-has-no-consumer.md` 修的是 `.quay/gate-event-coverage-nonblock-ledger.jsonl`；它的 AC4 要求把 `plugin/scripts/runner-static-gate.ts` 里**全部** `--no-block` 接线扫一遍，看各自的 RED 落在哪个载体、载体有没有读者。

实测（2026-10-01，分支 `task/gap-coverage-nonblock-ledger-has-no-consumer`）：该文件里 `--no-block` 接线共 5 条，其中**两条共用同一份零读者台账**：

- `runner-static-gate.ts:227` `run_checker "task-contract-check" … --no-block`
- `runner-static-gate.ts:241` `run_checker "task-ac-carryover-check" … --no-block`

两者都把新违规写进 `task-contract-check.ts` 的 `NO_BLOCK_LEDGER_REL = ".quay/task-file-violation-ledger.jsonl"`（`recordNoBlockLedger`；carryover 从 contract 那里 import 同一个写者）。

读者数 = 0：全仓 `grep -rn 'task-file-violation-ledger'` 只命中写者自身 2 处、runner-static-gate 的注释、rhythm-consumer-check 的一条 fixture 字符串、两个测试文件、以及若干 `orchestration/*.md` 的散文/日志 —— **没有任何代码路径读它**。

⇒ 与上一条同形：`--no-block` 下 run_checker 按 exit 0 把 cost 行记成 `verdict:"pass"`，取值只剩这份台账；台账没人读 ⇒ 取值轴断（硬规则 9）。而 `capability-catalog-declarations.json` 里 task-contract-check 的 CONSUMER 行写着「manager/outer 每轮读 .quay/task-file-violation-ledger.jsonl」，**这句在机制上不成立** —— rhythm-consumer-check 判据3 只查该行非空、不查它是否为真，这正是判据3 的已知边界。

### 为什么不能照抄 coverage 那一条的修法

coverage 台账的「已处置」可以从载体**推导**（同任务补上了 `complete` 事件）。这份台账没有对应的推导量：条目键是 `checker|violation`（一条消息字符串），没有任何「已修」事件会写到任何载体上。照抄会得到一份只会增长、永不沉默的读数 —— 那正是噪声形态。

⇒ 需要先决定处置轴，候选：① 违规消失时由写者追加一条 `resolved`（要求写者每轮重新评估全量违规集）；② 把台账降为「最近一次运行」快照（可被新一次运行覆盖）；③ 承认它只是写侧审计，读侧改为在 suite 日志里以非滚动形态呈现。本任务不预设其一。

## AC

- [ ] **AC1（现状固化）** 在 develop 上重跑 `grep -rn 'task-file-violation-ledger' --include='*.ts' --include='*.sh' --include='*.mjs' plugin packages scripts`，贴命中数与全部命中行，按「写者 / 读者」分类给两个计数。⛔ 不接受只写「零读者」结论而不贴行。
- [ ] **AC2（处置轴定案）** 三候选至少各写出一条**必须有**的判据（能取假）与一条必须**不能**发生的形态（噪声 / 静默），据此选定一条，把理由与反例写进本任务体。
- [ ] **AC3（读者落地·读生产载体）** 按 AC2 的选型实现读者，对着**生产**台账取一次读数并贴出（⛔ 不是布尔）；把 fixture/注入关掉后该读数仍须取得到。
- [ ] **AC4（三态可取假）** 同一读者对「有未处置条目 / 条目已处置 / 载体缺席或坏行」三种输入各跑一次并贴读数；最后一态须是独立的「未评估」取值，与前两者都不同形（硬规则 3b）。
- [ ] **AC5（不回退前一条）** 在存在未处置条目的条件下，code delta 的静态闸仍不因它中止 —— 贴 `run_checker "task-contract-check"` 与 `run_checker "task-ac-carryover-check"` 的 exit 读数。
- [ ] **AC6（本任务自身的门）** `bash scripts/test.sh --for-task gap-task-file-violation-ledger-has-no-consumer` 绿。

## DoD

**真实落地**：生产台账里的条目，被新读者在一个**有人/有机制会处置**的面上报出过一次（贴该面的读数），并在处置后不再被报。⛔ 只加一段说明「可以去看这份台账」不算完成；⛔ 把 `--no-block` 改回 fail-closed 不算完成；⛔ 交出一份只增不减、每轮照报同一批条目的读数不算完成（那是噪声，不是处置面）。

## Touches

- `plugin/scripts/task-contract-check.ts`
- `plugin/scripts/task-ac-carryover-check.ts`
- `plugin/test/task-contract-check.test.mjs`
- `plugin/test/task-ac-carryover-check.test.mjs`
- `plugin/scripts/manager-tick-readings.ts`
- `.gitignore`
- `tasks/gap-task-file-violation-ledger-has-no-consumer.md`