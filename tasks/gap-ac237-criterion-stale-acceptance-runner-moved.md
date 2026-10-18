---
id: gap-ac237-criterion-stale-acceptance-runner-moved
title: AC-237 判据 stale：gate/shared 抽取把 acceptance-runner.ts 搬走，判据仍 import 旧路径 ⇒
  判据移到真承载者（公开 CLI 端到端）+ 兄弟 AC-243 + import-specifier 防复发检查
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-237
---
## Proposal

**本轮逐字实测（2026-10-18，两次独立读数一致）**：

```
node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-237 --root . --json
⇒ "verdict": "fail"
   "reason": "acceptance failed (exit 1) — ... Error [ERR_MODULE_NOT_FOUND]: Cannot find module
              '/data/home/yale/work/quay/packages/quay/src/gate/acceptance-runner.ts' imported from ..."
```

判据当前逐字（`goals/AC-237-*.md` 的 `criterion:`）：

```js
const m = await import("./packages/quay/src/gate/acceptance-runner.ts");
const r = m.runAcceptance({ command: "echo CAUSE-TOKEN >&2; exit 1", cwd: ".", timeoutMs: 10000 });
```

**成因：合法重构搬走了承载者，不是保证坏了。** commit `e676d097b`（2026-10-18 09:33:51 +0800，`gate: extract types.ts + acceptance-runner.ts into gate/shared/ (break parent<->child import edges)`）把模块移到 `packages/quay/src/gate/shared/acceptance-runner.ts`。同一 fixture 在新路径上逐字读数：

```
{"ok":false,"reason":"acceptance failed (exit 1) — CAUSE-TOKEN"}
```

⇒ AC-237 断言的保证（失败 reason 携带判据自己写到 stderr 的成因）**仍然成立**；坏的是判据点名了一个已不再承载该角色的文件路径。

**为什么上一轮的修复没顶住**：`gap-acceptance-runner-failure-reason-drops-criterion-stderr`（done，2026-09-11）把机制修对了（`withFailureOutput` 折叠 stderr），其 AC6 也从 `.quay/goal-round.jsonl` 读到了生产载体。但它的 AC7 只在**当时**把判据跑绿一次；判据把**内部实现文件路径**钉成字符串，任何把该文件搬走的合法重构都会重新把它变假——与修复质量无关。这与 `gap-ac152-filter-carrier-renamed-criterion-stale`、`gap-ac157-catalog-carrier-moved-criterion-stale` 是同一形态（均为 done）：**判据绑在文件路径上，路径一动就重新变假**。

**同族普查（硬规则 5b，本轮实测不是抽查）**：扫描全部 `goals/*.md` 的 `criterion` 中的相对 `import(...)`/`require(...)` specifier，共 **16** 个；缺失 **4** 个：

| 缺失 specifier | 承载 AC | 状态 | 处置 |
|---|---|---|---|
| `./packages/quay/src/gate/acceptance-runner.ts` | AC-237 | achieved | **本任务修** |
| `./packages/quay/src/gate/acceptance-runner.ts` | AC-243 | achieved | **本任务一并修**（同一根因、同一路径） |
| `./plugin/scripts/manager-liveness-independent-check.ts` | AC-147 | superseded | 范围外：2026-09-12 已显式处置为 superseded，不把判据指向归档死件 |
| `./plugin/scripts/session-retirement-check.ts` | AC-149 | superseded | 同上 |

AC-243 本轮读数：`verdict: "not-evaluated"`，reason `acceptance failed (exit 3) — NOT-EVALUATED: could not obtain runner reason for a zero-output failing criterion: ''` —— 同一个 `ERR_MODULE_NOT_FOUND`。

**两个修法的取舍**：

- ✗ 把判据路径改成 `gate/shared/acceptance-runner.ts`：拒绝。下一次合法搬迁会再次把它变假，等于把同一个任务再立一遍。
- ✗ 在旧路径加 re-export shim：拒绝。仓库有明确的反搬壳原则（GOAL-034 / AC-353 要求删除 `gate/factories/loader.ts` 这类死 shim），且 shim 会让判据继续测一个不代表生产消费路径的内部符号。
- ✓ **把判据移到真承载者**：AC-237 的保证是「**goal gate 记录的**失败 reason 携带成因」⇒ 判据应驱动 goal gate 的生产消费面（`quay goal gate` CLI + 临时 goal 记录），读回它返回**并落盘**的 reason；AC-243 同理，读回 runner 对零输出失败判据的**真实**产出文本，再与 AC-241 的常量比较。两者都不再点名任何内部实现模块。

## Plan

1. **重锚 AC-237 判据（经 ABI 写，⛔ 不手搓 `goals/*.md`）**：`quay goal write AC-237 --criterion "<AC1 里的单行>"`。该判据已由立案方逐字验证：`sh -n` exit 0、`sh -c` exit 0、`evaluateCriterionAttribution` = `{"evaluated":true,"bare":[]}`。要点：
   - 在 `mkdtemp` 里建最小 `goals/`（GOAL-999 + 两条 AC）；一条判据写 `CAUSE-TOKEN` 到 stderr 后 `exit 1`，另一条静默 `exit 1`；
   - 用 `node packages/quay/bin/quay.js goal gate <id> --root <tmp> --json` 跑（产品 CLI 面、source-execution、不经 dist）；
   - 断言①：有输出的失败 `verdict=fail` 且 `reason` 含 `CAUSE-TOKEN`；
   - 断言②：`event.payload.reason`（即写入 `.quay/gate-events.jsonl` 的记录）也含 `CAUSE-TOKEN`——对得上 AC 标题的「goal gate **记录的** reason」；
   - 断言③：零输出失败的 `reason` 含 `criterion wrote no output to stderr/stdout` 且**不含** `CAUSE-TOKEN`（两支不同形，硬规则 3b）；
   - 每条失败路径同一行 `console.error("CAUSE=…")` + `process.exit(1)`；`die()` 先清理 tmp 再退出；全程单行（store 以 YAML 折叠标量存它）。
2. **一并重锚 AC-243 判据**：`quay goal write AC-243 --criterion "<AC5 里的单行>"`。语义不变：取 runner 对零输出失败判据的真实 `reason`，剥掉 `acceptance failed (exit N) — ` 前缀，与 `goals/AC-241-*.md` 的 `T = "…"` 常量逐字比较；不等 ⇒ `CAUSE=constant-diverged`。已逐字验证 `sh -n`/`sh -c` exit 0、attribution `bare: []`。
3. **防复发检查（新增一个测试，不新增 checker 脚本）**：`packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs`（必须带 `// @test-group product`，否则 `scripts/test.sh` 的 test-framework / group 规则会红）：
   - 读 `goals/*.md` 的 frontmatter（`yaml`），**只看 `criterion` 字段**（⛔ 不扫 origin/expect 散文）；
   - 提取 `import("<rel>")` / `require("<rel>")` 中 `./` 或 `../` 开头的 specifier；
   - 跳过 `status: superseded|retired` 的记录（已显式出域、不再复验）；
   - 每个 specifier 必须 `fs.existsSync(path.resolve(specifier))`；否则列出 `file → specifier` 并失败；
   - 测试接受 `QUAY_GOALS_ROOT` 环境变量覆盖 goals 目录（默认 repo 根下 `goals/`），使负控制能在 tmp fixture 上跑而不改生产 `goals/`；
   - **如实写明覆盖边界**（硬规则 3b）：只防「criterion 的 import/require 字面量指向已消失模块」；不覆盖 shell 里 `grep`/`-e` 的路径、也不覆盖动态拼接；`[ ! -e … ]` 这类要求不存在的断言不会被误报；
   - 该测试在 `scripts/test.sh` 的 `packages/*/test/*.test.mjs` glob 内 ⇒ 下一次搬文件/归档脚本的人会在同一次 landing 的 suite 里看到红，而不是等 goal-driver 几天后报一个无法归因的红灯。
4. **负控制（真载体，⛔ 夹具自证不算）**：在任务 worktree 里 `cp` 备份 `packages/quay/src/gate/shared/acceptance-runner.ts`，临时把 `withFailureOutput` 的正常失败分支改回只返回 prefix ⇒ AC-237 判据必须 exit 1 且 stderr 含 `CAUSE=reason-lost-criterion-stderr`；`cp` 恢复后 `md5sum` 与改前一致 ⇒ exit 0。⛔ 不用 `git checkout` 恢复（会洗掉并发改动）。
5. **生产载体读数**：landing 后由 goal-driver 下一轮独立复核；从 `.quay/goal-round.jsonl` 取**落地时刻之后**的轮次，贴 AC-237 `verdict: pass` 与 AC-243 不再 fail/not-evaluated 的记录，并核对 goal 记录的 `evidence.at` 晚于落地时刻。

## AC

- [x] AC1 AC-237 判据取真：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-237 --root . --json` ⇒ `verdict: "pass"`、exit 0；贴改后 criterion 全文（逐字取自 `quay goal show AC-237 --json`）与 gate 读数。可直接采用的判据（立案方已逐字验证；单行，unbroken）：

```
node --no-warnings --experimental-strip-types -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"ac237-"));const die=m=>{try{fs.rmSync(d,{recursive:true,force:true})}catch(e){}console.error(m);process.exit(1)};const g=p=>path.join(d,"goals",p);fs.mkdirSync(path.join(d,"goals"));fs.writeFileSync(g("GOAL-999.md"),"---\nid: GOAL-999\ntitle: fixture\nstatus: active\nkind: goal\norigin: probe\nbody: |\n  probe\n---\n");const mk=(id,crit)=>fs.writeFileSync(g(id+".md"),"---\nid: "+id+"\ntitle: fixture\nstatus: active\nkind: criterion\ngoal: GOAL-999\ncriterion: \""+crit+"\"\nexpect: fixture\norigin: probe\n---\n");mk("AC-901","echo CAUSE-TOKEN >&2; exit 1");mk("AC-902","exit 1");const run=id=>{const r=cp.spawnSync(process.execPath,[path.join(process.cwd(),"packages/quay/bin/quay.js"),"goal","gate",id,"--root",d,"--json"],{encoding:"utf8"});let j;try{j=JSON.parse(r.stdout)}catch(e){die("CAUSE=gate-json-unparseable exit="+r.status+" stdout="+JSON.stringify(String(r.stdout).slice(0,200)))}return j};const a=run("AC-901");if(a.verdict!=="fail"){die("CAUSE=fixture-with-stderr-not-fail verdict="+a.verdict)}if(!String(a.reason).includes("CAUSE-TOKEN")){die("CAUSE=reason-lost-criterion-stderr reason="+JSON.stringify(a.reason))}if(!String(a.event&&a.event.payload&&a.event.payload.reason).includes("CAUSE-TOKEN")){die("CAUSE=recorded-event-lost-criterion-stderr event="+JSON.stringify(a.event&&a.event.payload))}const b=run("AC-902");if(!String(b.reason).includes("criterion wrote no output")){die("CAUSE=zero-output-cause-not-distinguished reason="+JSON.stringify(b.reason))}if(String(b.reason).includes("CAUSE-TOKEN")){die("CAUSE=zero-output-echoes-token reason="+JSON.stringify(b.reason))}try{fs.rmSync(d,{recursive:true,force:true})}catch(e){}process.exit(0)'
```

- [x] AC2 判据不再点名搬走的内部模块：`quay goal show AC-237 --json` 的 criterion 中 `packages/quay/src/gate/acceptance-runner.ts` 命中数 ⇒ 0。非恒零配套干跑：改前同一命令 ⇒ ≥1（贴改前/改后两读数）。
- [x] AC3 记录载体也带成因：AC1 的 fixture 里 `event.payload.reason` 含 `CAUSE-TOKEN`；并直接读临时 root 的 `.quay/gate-events.jsonl` 最后一行证明已落盘（贴该行）。
- [x] AC4 两支不同形（硬规则 3b）：零输出失败的 `reason` 含 `criterion wrote no output to stderr/stdout` 且不含 `CAUSE-TOKEN`（贴读数）。
- [x] AC5 兄弟 AC-243 取真：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-243 --root . --json` ⇒ `verdict: "pass"`；贴改后 criterion 与读数。可直接采用的判据（立案方已逐字验证；单行，unbroken）：

```
node --no-warnings --experimental-strip-types -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"ac243-"));const die=m=>{try{fs.rmSync(d,{recursive:true,force:true})}catch(e){}console.error(m);process.exit(1)};const g=p=>path.join(d,"goals",p);fs.mkdirSync(path.join(d,"goals"));fs.writeFileSync(g("GOAL-999.md"),"---\nid: GOAL-999\ntitle: fixture\nstatus: active\nkind: goal\norigin: probe\nbody: |\n  probe\n---\n");fs.writeFileSync(g("AC-903.md"),"---\nid: AC-903\ntitle: fixture\nstatus: active\nkind: criterion\ngoal: GOAL-999\ncriterion: \"exit 1\"\nexpect: fixture\norigin: probe\n---\n");const r=cp.spawnSync(process.execPath,[path.join(process.cwd(),"packages/quay/bin/quay.js"),"goal","gate","AC-903","--root",d,"--json"],{encoding:"utf8"});let j;try{j=JSON.parse(r.stdout)}catch(e){die("CAUSE=gate-json-unparseable exit="+r.status+" stdout="+JSON.stringify(String(r.stdout).slice(0,200)))}const reason=String(j.reason||"");const m=reason.match(/^acceptance failed \(exit [^)]*\) — (.*)$/);if(!m){die("CAUSE=reason-shape-changed reason="+JSON.stringify(reason))}const real=m[1].trim();const files=fs.readdirSync("goals").filter(f=>/^AC-241-.*\.md$/.test(f));if(files.length!==1){die("CAUSE=AC-241-record-not-uniquely-locatable files="+JSON.stringify(files))}const src=fs.readFileSync(path.join("goals",files[0]),"utf8");const t=src.match(/T\s*=\s*"([^"]+)"/);if(!t){die("CAUSE=AC-241-bare-reason-constant-gone — its detector shape changed; re-scope AC-243")}if(real!==t[1]){die("CAUSE=constant-diverged — AC-241 T="+JSON.stringify(t[1])+" runner="+JSON.stringify(real))}try{fs.rmSync(d,{recursive:true,force:true})}catch(e){}process.exit(0)'
```

- [x] AC6 防复发检查存在且有效：`node --test packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs` ⇒ exit 0；负控制：在 tmp goals 目录放一条 criterion 指向 `./packages/quay/src/__nope__.ts`，用 `QUAY_GOALS_ROOT=<tmp>` 跑同一测试 ⇒ exit 1 并列出 `file → specifier`（贴两侧；⛔ 不改生产 `goals/`）。
- [x] AC7 负控制证明判据能因**保证本身**变红：按 Plan 4 临时去掉 stderr 折叠 ⇒ AC-237 判据 exit 1 且 stderr 含 `CAUSE=reason-lost-criterion-stderr`；`cp` 恢复后 md5 一致且判据 exit 0（贴两侧）。
- [x] AC8 落盘文本可被真接受侧执行：对 `quay goal show AC-237/AC-243 --json` 取出的 criterion，`sh -n` 与 `sh -c` 均 exit 0（接受侧是 `/bin/sh`=dash，⛔ 只验 bash 不算）。
- [x] AC9 普查留痕：在本任务 Evidence 里贴「16 个相对 import specifier / 缺失 4 个 / AC-147、AC-149 为 superseded」的枚举命令与输出。
- [x] AC10 schema：`node plugin/scripts/task-schema-check.ts tasks/gap-ac237-criterion-stale-acceptance-runner-moved.md` ⇒ exit 0。

## DoD

AC-237 在 goal-driver 下一轮由 fail 翻 **pass**，且 AC-243 一并翻 pass；两者靠的是**判据移到真承载者（生产 CLI `goal gate` 端到端）+ 失败带 CAUSE + 负控制可红**——⛔ 不是把判据改成恒真，⛔ 也不是给旧路径加 shim 或只把字符串改成新路径。防复发检查必须能在 `scripts/test.sh` 里跑、能对「criterion import 一个不存在的模块」报红，并如实写明它不覆盖的形态。⛔ 只让 AC-237 变绿而 AC-243 仍红/未评估 ⇒ 不算达成（同一根因、同一文件路径，硬规则 5b）。

## Touches

- goals/AC-237-失败判据必须可归因-goal-gate-记录的失败-reason-必须携带判据自身写出的成因-不得只留-exit-1.md
- goals/AC-243-ac-241-的空因常量必须与-acceptance-runner-实际产出的零输出成因文本同源-ac-241-自身退化.md
- packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs
- tasks/gap-ac237-criterion-stale-acceptance-runner-moved.md

## Evidence

所有读数均在任务 worktree `/data/home/yale/work/quay-worktrees/gap-ac237-criterion-stale-acceptance-runner-moved`
里取得（develop `74a551d08` 已 merge 进 worktree + 本任务提交）。

### AC1 — AC-237 判据经生产 CLI 面取真

重锚后的 criterion（逐字取自 `quay goal show AC-237 --json`）：

```
node --no-warnings --experimental-strip-types -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"ac237-"));const die=m=>{try{fs.rmSync(d,{recursive:true,force:true})}catch(e){}console.error(m);process.exit(1)};const g=p=>path.join(d,"goals",p);fs.mkdirSync(path.join(d,"goals"));fs.writeFileSync(g("GOAL-999.md"),"---\nid: GOAL-999\ntitle: fixture\nstatus: active\nkind: goal\norigin: probe\nbody: |\n  probe\n---\n");const mk=(id,crit)=>fs.writeFileSync(g(id+".md"),"---\nid: "+id+"\ntitle: fixture\nstatus: active\nkind: criterion\ngoal: GOAL-999\ncriterion: \""+crit+"\"\nexpect: fixture\norigin: probe\n---\n");mk("AC-901","echo CAUSE-TOKEN >&2; exit 1");mk("AC-902","exit 1");const run=id=>{const r=cp.spawnSync(process.execPath,[path.join(process.cwd(),"packages/quay/bin/quay.js"),"goal","gate",id,"--root",d,"--json"],{encoding:"utf8"});let j;try{j=JSON.parse(r.stdout)}catch(e){die("CAUSE=gate-json-unparseable exit="+r.status+" stdout="+JSON.stringify(String(r.stdout).slice(0,200)))}return j};const a=run("AC-901");if(a.verdict!=="fail"){die("CAUSE=fixture-with-stderr-not-fail verdict="+a.verdict)}if(!String(a.reason).includes("CAUSE-TOKEN")){die("CAUSE=reason-lost-criterion-stderr reason="+JSON.stringify(a.reason))}if(!String(a.event&&a.event.payload&&a.event.payload.reason).includes("CAUSE-TOKEN")){die("CAUSE=recorded-event-lost-criterion-stderr event="+JSON.stringify(a.event&&a.event.payload))}const b=run("AC-902");if(!String(b.reason).includes("criterion wrote no output")){die("CAUSE=zero-output-cause-not-distinguished reason="+JSON.stringify(b.reason))}if(String(b.reason).includes("CAUSE-TOKEN")){die("CAUSE=zero-output-echoes-token reason="+JSON.stringify(b.reason))}try{fs.rmSync(d,{recursive:true,force:true})}catch(e){}process.exit(0)'
```

gate 读数（exit 0）：

```
$ node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-237 --root . --json
$ echo $?
0
{"id":"AC-237","verdict":"pass","cause":null,"reason":"acceptance passed (exit 0)","timeoutMs":60000}
```

### AC2 — 判据不再点名被搬走的内部模块（含非恒零干跑）

```
# 改前（dd013cf7b^，即 AC-237 criterion 重锚之前）
$ git show 'dd013cf7b^:goals/AC-237-失败判据必须可归因-…-不得只留-exit-1.md' | grep -c 'packages/quay/src/gate/acceptance-runner.ts'
1
# 改后（criterion 字段内的命中数）
$ quay goal show AC-237 --json | node -e '…count in .criterion…'
0
# 兄弟 AC-243 同一直方图：1 → 0
```

### AC3 — 记录载体（.quay/gate-events.jsonl）也带成因

```
AC-901 verdict: fail
AC-901 reason: acceptance failed (exit 1) — CAUSE-TOKEN
AC-901 event.payload.reason: acceptance failed (exit 1) — CAUSE-TOKEN
ledger tail（临时 root 的 .quay/gate-events.jsonl，AC-902 那行）:
{"id":"580a37bb-ea6e-4965-afbc-8fd16b659510","item_id":"AC-902","pipeline_id":"AC-902","gate":"goal","actor":"goal-cli","verdict":"fail","timestamp":"2026-10-18T02:01:56.487Z","payload":{"reason":"acceptance failed (exit 1) — criterion wrote no output to stderr/stdout","evaluationRoot":"/tmp/ac237-evidence-eils2N","treeSha":null}}
```

（AC-901 写 CAUSE-TOKEN 的那条 fail 事件同样落盘；两者的 `payload.reason` 与 CLI 返回的 `reason` 逐字相同。）

### AC4 — 两支不同形（硬规则 3b）

```
AC-902 verdict: fail
AC-902 reason: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout
reason contains "criterion wrote no output": true
reason contains "CAUSE-TOKEN": false
```

### AC5 — 兄弟 AC-243 取真

重锚后的 criterion（逐字取自 `quay goal show AC-243 --json`）：

```
node --no-warnings --experimental-strip-types -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"ac243-"));const die=m=>{try{fs.rmSync(d,{recursive:true,force:true})}catch(e){}console.error(m);process.exit(1)};const g=p=>path.join(d,"goals",p);fs.mkdirSync(path.join(d,"goals"));fs.writeFileSync(g("GOAL-999.md"),"---\nid: GOAL-999\ntitle: fixture\nstatus: active\nkind: goal\norigin: probe\nbody: |\n  probe\n---\n");fs.writeFileSync(g("AC-903.md"),"---\nid: AC-903\ntitle: fixture\nstatus: active\nkind: criterion\ngoal: GOAL-999\ncriterion: \"exit 1\"\nexpect: fixture\norigin: probe\n---\n");const r=cp.spawnSync(process.execPath,[path.join(process.cwd(),"packages/quay/bin/quay.js"),"goal","gate","AC-903","--root",d,"--json"],{encoding:"utf8"});let j;try{j=JSON.parse(r.stdout)}catch(e){die("CAUSE=gate-json-unparseable exit="+r.status+" stdout="+JSON.stringify(String(r.stdout).slice(0,200)))}const reason=String(j.reason||"");const m=reason.match(/^acceptance failed \(exit [^)]*\) — (.*)$/);if(!m){die("CAUSE=reason-shape-changed reason="+JSON.stringify(reason))}const real=m[1].trim();const files=fs.readdirSync("goals").filter(f=>/^AC-241-.*\.md$/.test(f));if(files.length!==1){die("CAUSE=AC-241-record-not-uniquely-locatable files="+JSON.stringify(files))}const src=fs.readFileSync(path.join("goals",files[0]),"utf8");const t=src.match(/T\s*=\s*"([^"]+)"/);if(!t){die("CAUSE=AC-241-bare-reason-constant-gone — its detector shape changed; re-scope AC-243")}if(real!==t[1]){die("CAUSE=constant-diverged — AC-241 T="+JSON.stringify(t[1])+" runner="+JSON.stringify(real))}try{fs.rmSync(d,{recursive:true,force:true})}catch(e){}process.exit(0)'
```

gate 读数（exit 0）：

```
$ node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-243 --root . --json
$ echo $?
0
{"id":"AC-243","verdict":"pass","cause":null,"reason":"acceptance passed (exit 0)","timeoutMs":60000}
```

### AC6 — 防复发检查存在且有效（生产绿 / 负控制红）

生产 `goals/`：

```
$ node --test packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs
✔ every relative import/require specifier in a live goal criterion resolves on disk
✔ negative control: a criterion naming a removed module is reported as file → specifier
✔ superseded / retired records are skipped (their criteria are no longer re-verified)
✔ non-relative specifiers (node:fs, package names) are not file-path claims and are ignored
ℹ tests 4 / pass 4 / fail 0
$ echo $?
0
```

负控制（tmp goals，⛔ 未改生产 `goals/`）：

```
$ QUAY_GOALS_ROOT=<tmp> node --test packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs
$ echo $?
1
  AC-fixture.md → ./packages/quay/src/__nope__.ts
```

### AC7 — 负控制证明判据能因「保证本身」变红（真载体，cp 备份/恢复）

```
$ md5sum packages/quay/src/gate/shared/acceptance-runner.ts   # 改前
3c676e9264868513f7580db8ad3718b3
# 临时把 withFailureOutput 改回只返回 prefix（正常失败分支不再折叠 stderr/stdout）
$ /bin/sh -c "<criterion AC-237>"; echo $?
1
stderr: CAUSE=reason-lost-criterion-stderr reason="acceptance failed (exit 1)"
# 同时 goal gate 面的读数：verdict=fail, reason="acceptance failed (exit 1)"
$ cp <backup> packages/quay/src/gate/shared/acceptance-runner.ts
$ md5sum packages/quay/src/gate/shared/acceptance-runner.ts   # 恢复后
3c676e9264868513f7580db8ad3718b3
$ /bin/sh -c "<criterion AC-237>"; echo $?
0
```

（⛔ 用 `cp` 恢复，未用 `git checkout`；`git status --short` 恢复后无该文件改动。）

### AC8 — 落盘文本可被真接受侧（/bin/sh = dash）执行

```
$ ls -l /bin/sh
lrwxrwxrwx 1 root root 4 Mar 31  2024 /bin/sh -> dash
AC-237 sh -n EXIT=0
AC-237 sh -c EXIT=0
AC-243 sh -n EXIT=0
AC-243 sh -c EXIT=0
```

### AC9 — 同族普查（硬规则 5b，枚举不是抽查）

枚举命令：对 `quay goal list --root <snapshot>` 的每条记录取 `criterion`，用
`/(?:import|require)\s*\(\s*\\?(["'])((?:\.{1,2}\/)[^"'\n]*?)\\?\1\s*\)/g` 提取相对
specifier，再 `fs.existsSync(path.resolve(repoRoot, specifier))` 逐个判定。

```
PRE-FIX（goals 快照 dd013cf7b^）: total relative import specifiers = 16 ; missing = 4
  AC-147 -> ./plugin/scripts/manager-liveness-independent-check.ts [status=superseded]
  AC-149 -> ./plugin/scripts/session-retirement-check.ts [status=superseded]
  AC-237 -> ./packages/quay/src/gate/acceptance-runner.ts [status=achieved]
  AC-243 -> ./packages/quay/src/gate/acceptance-runner.ts [status=achieved]

POST-FIX（本 worktree）: total relative import specifiers = 14 ; missing = 2
  AC-147 -> ./plugin/scripts/manager-liveness-independent-check.ts [status=superseded]
  AC-149 -> ./plugin/scripts/session-retirement-check.ts [status=superseded]
```

AC-147、AC-149 于 2026-09-12 已显式处置为 `superseded` ⇒ 出域，不被防复发测试计入。

### AC10 — schema

```
$ node plugin/scripts/task-schema-check.ts tasks/gap-ac237-criterion-stale-acceptance-runner-moved.md
N/A legacy (no schema marker): tasks/gap-ac237-criterion-stale-acceptance-runner-moved.md
1 total, 0 pass, 1 N/A-legacy, 0 fail
$ echo $?
0
```

### 防复发测试的覆盖边界（硬规则 3b，如实写明）

只覆盖 `criterion` 字段里 `import(...)` / `require(...)` 的 `./`、`../` 字面量；
不覆盖 `grep`/`-e`/shell 重定向、`open(...)` 里的路径、动态拼接的 specifier、
包名（`node:fs`、`yaml`）以及静态 `import … from "…"`；`[ ! -e … ]` 这类
「要求不存在」的断言不会被误报。

### 生产载体读数（Plan 5 — landing 之后，本 worker 不代填）

本任务的工作止于把上述改动交给 fan-in；`AC-237/AC-243` 从 fail/not-evaluated 翻 pass 的
`.quay/goal-round.jsonl` 轮次由 goal-driver 在**落地之后**的下一轮独立记录，并要求该轮
`evidence.at` 晚于落地时刻。本 session 结构性无法取得那一条读数，⛔ 不以本地 gate 通过冒充。

## Blocker

**2026-10-18T02:20:41.931Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: cadence must be one of the five enumerated values: touches-relax-tighten.ts → 每轮（worker-driver 驻留环的轮末一步；loop.touches_relax 未声明或 mode 为 off / 读不懂时不跑，该轮 round 记录的 auto_tighten 为 null） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/full-suite-runner-cgroup.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：15d7cc1c-5ef9-40a8-a9c0-c480b632ee04
