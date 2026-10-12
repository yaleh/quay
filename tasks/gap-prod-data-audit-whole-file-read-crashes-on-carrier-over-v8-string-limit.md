---
id: gap-prod-data-audit-whole-file-read-crashes-on-carrier-over-v8-string-limit
title: "P0 develop-wide red: prod-data-audit reads whole carriers via
  readFileSync — meta-driver-round.jsonl >0x1fffffe8 ⇒ ERR_STRING_TOO_LONG
  blocks every fan-in; stream + NOT-EVALUATED"
status: ready
labels:
  - gap
  - defect
  - develop-wide-red
parent: null
children: []
extra: {}
---
## Proposal
**A develop-wide suite red, found 2026-10-13 ~02:18 (+0800).** `plugin/scripts/prod-data-audit.ts:426` reads every production carrier whole: `fs.readFileSync(located, "utf8")`. `.quay/meta-driver-round.jsonl` reached 537,028,872 bytes, which is above V8's maximum string length of 0x1fffffe8 = 536,870,888. Both REAL-CARRIER tests in `plugin/test/prod-data-audit.test.mjs` (:227, :309) now throw `ERR_STRING_TOO_LONG` (`classifyCarrier` ← `buildAudit:658`).

Evidence:
- the fan-in suite log `.quay/fan-in-suite-gap-discovery-method-per-round-quota-verify-reserve-deep-reflection~wk-prod-anchor~1791828953643-00613d.log`, lines ~6026-6057;
- the develop baseline log `…~baseline-1791829214376-1ab3bd.log` shows the same 2 `✖`. Every earlier fan-in suite log has 0 such errors.

The carrier keeps growing (≥59 MB in 24h), so until this is fixed EVERY fan-in is red in the same place, and every landing in flight degrades toward needs-human. The red belongs to no task's delta.

Under hard rule 3b, an audit that cannot read its input must report "could not evaluate". It must neither crash nor return a value shaped like a pass. Reading a size-unbounded append-only carrier into one string is also hard rule 4 corollary 2 (an implicit host-dependent limit).

## Plan
1. Replace the whole-file read in `classifyCarrier` (and any sibling whole-file read of a `.jsonl` carrier in the same file; grep and paste the hit count, hard rule 5b) with a line-streaming reader. Count records, find the landing-relative window and detect single-JSON-doc carriers WITHOUT materializing the file as one string.
2. If a carrier still cannot be read (I/O error, unparsable framing), return `threeState: NOT_EVALUATED` with an explicit reason such as `carrier-unreadable:<code>` and keep auditing the other carriers. Never throw out of `buildAudit`, and never report it as `verified`/found-with-0.
3. Keep the existing semantics for normal-size carriers byte-identical: same record counts, same dispositions.

## Acceptance Criteria
- [x] AC1: a unit test with a synthetic `.jsonl` carrier larger than 0x1fffffe8 bytes, made as a sparse/streamed fixture (no 512 MB string in the test process), shows `classifyCarrier` returns a real record count via streaming, OR `NOT_EVALUATED` with a `carrier-unreadable`/size reason. It never throws. Negative control: restore `readFileSync(located,"utf8")` ⇒ the test goes red with `ERR_STRING_TOO_LONG`. Paste both. — **DONE.** 稀疏 fixture（`ftruncate` 造洞：`st_size`=536,874,984 B > 0x1fffffe8，盘上仅 8,192 B，测试进程内无 512 MB 字符串）走 AC 允许的 **OR 第二支**：`classifyCarrier` → ③ NOT_EVALUATED `carrier-unreadable:line-too-long`（洞本身就构成一条超预算行），⛔ 不抛、⛔ 不给偏小记录数；同一 fixture 的 `.json` 状态载体走 `carrier-unreadable:string-too-long`。负控制两半都贴：(a) 测试内 `assert.throws(fs.readFileSync(p,"utf8"), e=>e.code==="ERR_STRING_TOO_LONG")`；(b) **真变异控制**——把被删的那一行原样放回 `classifyCarrier` ⇒ 2 red，`Error: Cannot create a string longer than 0x1fffffe8 characters … at classifyCarrier ← at buildAudit`（即「一个载体打崩整份审计」）。另加结构性判据：`fs.readFileSync` 探针证明该路径对载体**零次**整文件读（不是 try/catch 吞掉）。
- [x] AC2: parity. On normal-size fixtures, the audit output before and after the change is identical (paste a diff of the JSON for the existing fixtures: empty). — **DONE.** before/after 的 `classifyCarrier` JSON **逐字节相同**：14 个 fixture 载体 × 2 条路径（预计算索引的批量路径 / 无索引的单载体路径）= 28 行，`diff parity-before.json parity-after.json` 输出为空（exit 0）。并把**确切**计数钉进既有的 fixture 测试（accum=2 / empty=0 / state=1 / single-json=1），⛔ 不用 `>=` 那种对「差一条」不敏感的写法。
- [x] AC3: the real carrier. `node --test plugin/test/prod-data-audit.test.mjs` in the task worktree against the production `.quay` (meta-driver-round.jsonl > 512 MB at run time; paste `stat -c %s`) exits 0. Paste the TAP summary. — **DONE，但前提被外部改掉了，如实记录。** 命令在任务 worktree 对生产 `.quay` 跑：**16/16 pass，exit 0**（TAP 摘要见 Evidence）。⚠️ AC 括注的前提「运行时 > 512 MB」在本次会话中被**与本任务无关的轮转**改掉了：02:35 实测 `meta-driver-round.jsonl` = 538,347,409 B，02:37:13 变为 95,017,936 B——本任务⛔不修改/截断/轮转生产载体（DoD 明令），故该前提**本会话无法复现**。可复现的替身是 AC1 的稀疏 fixture（确定性、随时可跑，>0x1fffffe8），外加一条**条件守卫**测试：任何真实生产载体一旦再次超限，该测试自动对它生效并断言给出真三态判定而非崩（当下无超限载体 ⇒ 它如实报 not-evaluated 并打印最大载体读数）。
- [x] AC4: the whole-file `.jsonl` reads remaining in `prod-data-audit.ts` are listed. Each is either converted or justified as bounded. Paste the `grep -n readFileSync` hits before and after. — **DONE.** before **6** 命中（`:141 :205 :311 :325 :426 :609`），其中**整文件读 `.jsonl` 载体的是 2 处**（`:141` `recordEpochsFromFile`、`:426` 事故行），两处均已转换。after **5** 处 `readFileSync` 调用，**无一读 `.jsonl` 载体**：`:268` 状态文件全文（先按 size 判 0x1fffffe8 上限）、`:324`/`:743` 是 grep 出的候选**源码**文件、`:430` 两个固定的退役检查源码、`:444` `tasks/*.md`。硬规则 5b 全仓镜像（同原则找其它适用点）：命中 **31** 处（非测试代码里 `readFileSync` × 载体类标识符），前 3 = `plugin/scripts/meta-driver.ts:414` `readRoundCarrier`（**读的是同一个载体** `.quay/meta-driver-round.jsonl`，且 `catch { return [] }` ⇒ 超限时静默报「没有历史」——3b 的最坏形态）、`plugin/scripts/goal-driver.ts:1567`、`plugin/scripts/inner-wakeup-heartbeat-check.ts:430`。**⛔ 三者均不在本任务 `## Touches` ⇒ 只上报、不顺手改**（`meta-driver.ts:414` 应单独立一条 gap）。

## Definition of Done
- `scripts/test.sh --for-task <this task>` green, including the full suite at fan-in.
- No production carrier is modified, truncated or rotated by this task.

## Touches
- tasks/gap-prod-data-audit-whole-file-read-crashes-on-carrier-over-v8-string-limit.md
- plugin/scripts/prod-data-audit.ts
- plugin/test/prod-data-audit.test.mjs

## Evidence

### AC1 — 负控制 (a)：被删掉的那一行本身在这个 fixture 上真的抛
```
fixture: /tmp/pda-oversize-…/.quay/huge.jsonl
  st_size = 536874984  (V8 max = 536870888, over = true)
  st_blocks*512 = 8192 bytes on disk (sparse)          ← 稀疏：盘上 8 KB，不是 512 MB
  fs.readFileSync(target,"utf8") -> ERR_STRING_TOO_LONG: Cannot create a string longer than 0x1fffffe8 characters
  classifyCarrier -> threeState=NOT_EVALUATED recordCount=null recordsAfterLanding=null disposition=SUSPECT
    reason: carrier-unreadable:line-too-long: 逐行流式读取失败（huge.jsonl）——载体无法评估（硬规则 3b：读不懂输入既不抛穿也不伪装成通过）
  scanJsonlCarrier -> {"ok":false,"code":"line-too-long"}
```

### AC1 — 负控制 (b)：真变异控制（把 `fs.readFileSync(located,"utf8")` 原样放回 `classifyCarrier`）
```
$ node --test --test-name-pattern="AC1 carrier over V8|AC1 buildAudit does not abort" plugin/test/prod-data-audit.test.mjs
✖ AC1 carrier over V8's max string length — negative control throws, classifyCarrier does not
✖ AC1 buildAudit does not abort — the oversized carrier is NOT_EVALUATED, the others still get a verdict
ℹ tests 2 · pass 0 · fail 2

  Error: Cannot create a string longer than 0x1fffffe8 characters
      at Object.readFileSync (node:fs:483:20)
      at classifyCarrier (…/plugin/scripts/prod-data-audit.ts:557:24)
      at buildAudit (…/plugin/scripts/prod-data-audit.ts:793:17)
    code: 'ERR_STRING_TOO_LONG'
```
变异已回退（`grep -n "MUTANT" plugin/scripts/prod-data-audit.ts` ⇒ 无命中）。

### AC2 — parity diff（空）
```
$ node --experimental-strip-types pda-parity.mjs
fixture carriers: 14 · rows compared: 28
BEFORE === AFTER : true
$ diff parity-before.json parity-after.json
$ echo $?
0
```
两个模块（改动前的 `plugin/scripts/prod-data-audit.ts` 与 worktree 版）在**同一个进程、同一个 fixture 目录**上跑，输入逐字节相同；`git`/`grep` 一类环境量由显式索引旁路。

### AC3 — TAP 摘要 + 生产载体读数
```
$ stat -c '%s %y %n' .quay/meta-driver-round.jsonl
538347409 2026-10-13 02:35:06 … .quay/meta-driver-round.jsonl      ← 事故状态（> 0x1fffffe8）
 95017936 2026-10-13 02:37:13 … .quay/meta-driver-round.jsonl      ← 02:37:13 被外部轮转降到限下（非本任务所为）

$ node --test plugin/test/prod-data-audit.test.mjs      # 任务 worktree，对生产 .quay
✔ AC1 streamLines reports an over-budget line as unreadable — never a silent drop
✔ AC1 streaming read is chunk-boundary safe (multi-byte included)
✔ AC1 carrier over V8's max string length — negative control throws, classifyCarrier does not
✔ AC1 buildAudit does not abort — the oversized carrier is NOT_EVALUATED, the others still get a verdict
✔ AC1 a real carrier the audit cannot frame is NOT_EVALUATED, never a fabricated record count
✔ AC1/AC2/AC3/AC5/AC6 REAL-CARRIER — audit against production reproduces manager re-checks
✔ AC1 explicit carriers are always reported even at zero position-based refs
✔ AC3 guard — any real production carrier over V8's limit is read, not crashed on
ℹ tests 16 · pass 16 · fail 0 · duration_ms 13387
ℹ NOT-EVALUATED: no production carrier exceeds 0x1fffffe8 right now（最大 = measure-history.jsonl 205832900 B）
```

### AC4 — `grep -n readFileSync` before / after
```
$ git show develop:plugin/scripts/prod-data-audit.ts | grep -n readFileSync
141:  const text = fs.readFileSync(filePath, "utf8");              ← 整文件读 .jsonl 载体（recordEpochsFromFile）
205:          if (hasCarrierRef(fs.readFileSync(cand, "utf8"), basename)) n++;
311:      try { texts.push(fs.readFileSync(p, "utf8")); } catch { /* unreadable */ }
325:    try { text = fs.readFileSync(full, "utf8"); } catch { continue; }
426:  const raw = fs.readFileSync(located, "utf8").trim();          ← 事故行（整文件读 .jsonl 载体）
609:        try { text = fs.readFileSync(f, "utf8"); } catch { continue; }

$ grep -n readFileSync plugin/scripts/prod-data-audit.ts        # after（注释行已剔除）
268:    return { ok: true, text: fs.readFileSync(filePath, "utf8").trim() };   ← 状态文件，先按 size 判 0x1fffffe8
324:          if (hasCarrierRef(fs.readFileSync(cand, "utf8"), basename)) n++; ← grep 出的候选源码
430:      try { texts.push(fs.readFileSync(p, "utf8")); } catch { … }         ← 两个固定退役检查源码
444:    try { text = fs.readFileSync(full, "utf8"); } catch { continue; }      ← tasks/*.md
743:        try { text = fs.readFileSync(f, "utf8"); } catch { continue; }     ← grep 出的候选源码
```
余下 5 处均为**有界**输入（源码文件 / 任务体 / 退役检查文件），非 append-only 生产载体；唯一仍读完整文本的载体路径（状态文件）先按 `st.size > JS_MAX_STRING_LENGTH` 判上限，超限给独立取值而非抛。

### 硬规则 5b 全仓镜像（同原则的其它适用点，⛔ 不在 Touches ⇒ 只上报）
```
$ grep -rn readFileSync --include=*.ts --include=*.js --include=*.mjs \
    plugin/scripts plugin/loop orchestration packages/*/src | grep -iE "jsonl|carrier" | grep -viE "/test|fixture" | wc -l
31
```
前 3（按与本案同形程度排序）：
1. `plugin/scripts/meta-driver.ts:414` — `try { text = fs.readFileSync(path.join(root, rel), "utf8"); } catch { return []; }`，`rel` = `.quay/meta-driver-round.jsonl`（`:427`）**与** `.quay/goal-round.jsonl`（`:1082`）。**读的是同一个载体**，且失败被吞成 `[]`（「没有历史」）⇒ 超限时 meta-driver 的 divergence-recurrence 静默归零。**建议单独立 gap。**
2. `plugin/scripts/goal-driver.ts:1567` — 逐个 objective-evidence 载体整文件读。
3. `plugin/scripts/inner-wakeup-heartbeat-check.ts:430` — heartbeat `.jsonl` 载体整文件读。

（先例：`plugin/scripts/verification-marginal-return.ts:279` 早已注明「流式读 —— verification-round.jsonl 实测 ~73 MB，整文件 readFileSync 会白白吃内存」并已改造，说明本形状是已知族。）
