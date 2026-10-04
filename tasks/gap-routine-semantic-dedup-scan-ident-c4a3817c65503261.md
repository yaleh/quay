---
id: gap-routine-semantic-dedup-scan-ident-c4a3817c65503261
title: "semantic-dedup-scan: Both bodies are spawnSync(git,[-C,cwd,...args]) to
  {status,stdout,stderr}; same git-runner in the two release-* scripts which
  also duplicate the Ran interface "
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Both bodies are spawnSync(git,[-C,cwd,...args]) to {status,stdout,stderr}; same git-runner in the two release-* scripts which also duplicate the Ran interface and ref enumeration.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791142275270` · ts `2026-10-04T19:31:15.270Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`git`
- 涉及文件：
- `plugin/scripts/release-branch-janitor.ts:160`
- `plugin/scripts/release-reading-sandbox.ts:101`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `ident-c4a3817c65503261`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791142275270`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## Disposition

**修法**：新建 `plugin/scripts/git-runner.ts`，把两载体各自私有的 git runner 家族收成一份：`Ran`（`{status,stdout,stderr}`）、`git(cwd,args):Ran`（非抛出式 `spawnSync('git',['-C',cwd,...args])`，`?? -1` / `?? ''` 回落原样保留）、`nonEmptyLines(s)`（trim-and-drop 行拆分）、`revParseSha(root,revision)`（`rev-parse --verify --quiet`，取不到返回 `null` 而非空串，硬规则 3b）、`enumerateReleaseRefs(root)`（`for-each-ref refs/heads/release-*` + `refs/heads/release/*`，读不到返回 `null`）。两载体改为 import 并删除私有副本：`release-branch-janitor.ts` 删 `Ran` / `git` / `lines` / `enumerateReleaseBranches` / `tipSha`，`release-reading-sandbox.ts` 删 `Ran` / `git` / `revParse` / `sourceReleaseRefs`。

**语义逐点核对（⛔ 提取不改判定）**：①非零退出在两载体都仍是「值」而非异常（调用方各自判 `status`，只有调用方知道该码是值还是仪器故障）；②`tipSha(root,b)` → `revParseSha(root,"refs/heads/"+b)`、`revParse(root,rev)` → `revParseSha(root,rev+"^{commit}")` —— 削皮规则仍归调用方，命令逐字不变；③枚举统一为 `.sort()`（`git for-each-ref` 本就按 refname 排序，两调用方都当集合用，sandbox 侧对枚举前后数组的比较无影响）；④janitor `--log` 读回用的 `lines(text)` → `nonEmptyLines(text)`，算法逐字相同。

**规则 5b（同一载体其它适用点 —— 命中数与前 3 条）**：在 `plugin/scripts/` grep「本地定义一个 git runner 返回 {status,stdout,stderr}」（指纹 `status: r.status ?? -1`）提取前得 **2 处 / 1 族**（即 `release-branch-janitor.ts:160` + `release-reading-sandbox.ts:101`，本 finding），提取后为 **0**。同族其它契约各自成族、⛔ 不在本 scope：
1. 抛出式（`git(root,args,opts):string`）：`dev-stats-collect.ts:131` 用 `execFileSync` + `core.quotepath=false` + 失败抛出，返回 `string` 而非 `Ran`；其 `lines()` 也只剥尾部 CR、不去空白 —— **契约不同 ⇒ 不是副本**。
2. CLI-runner 式（`runCli(cli,args,cwd):{argv,exit,stdout,stderr}`）：`server-partial-stop-verify.ts:449` + `server-restart-inflight-verify.ts:449`（两处仅 `timeout` 180000 vs 300000 不同）—— 跑的是 quay CLI 不是 git，且**已是例程 finding 通道自己的记录**（`.quay/routine-findings.jsonl` 有 files 含 `server-partial-stop-verify.ts:423` + `server-restart-inflight-verify.ts:479` 的记录），归它自己那条 finding。

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/release-branch-janitor.ts`
- `plugin/scripts/release-reading-sandbox.ts`
- `plugin/scripts/git-runner.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `tasks/gap-routine-semantic-dedup-scan-ident-c4a3817c65503261.md`
