---
id: gap-shipped-set-ceiling-stale-by-one-blocks-every-release-since-v0-20-0
title: shipped-set 体积上限停在 286，真实产物已是 287：v0.20.0、v0.21.0 的 release.yml 都被
  shipped-set-clean 拦下，按产物自身读数重新锚定
status: done
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

**来源**：v0.21.0 发布事故（2026-10-20）。同一条断言在 v0.20.0（2026-10-16，run 38883031015）和 v0.21.0（2026-10-20，run 39449799348）上给出逐字相同的失败：`shipped-set-clean FAIL — files 287 > ceiling 286 (exceeds by 1)`，13 条断言 12 过 1 败。

**实测（2026-10-20/21）**：
- 两次构建产物的文件清单逐字相同（均 287 个），且本机用 release.yml step 5 的同一条命令（`bash plugin/scripts/publish-dist-branch.sh --branch <scratch>`，不带 `--push`）构建再 `git archive` 得到的也是 287 个，`shipped-set-rules.ts --check <dir> --size-ceiling` exit 1，与 CI 一致；
- 上次干净通过的 v0.19.0 是 266 个，之后增加 21 个：8 个 `scripts/dist/*.js` bundle（`deletion-closure-check`、`enum-surface-parity-check`、`experiment-manifest`、`guard-lineage-check`、`import-graph-check`、`judgment-consumer-check`、`suite-bucket-select`、`suite-load-sampler`）与 13 个 `docs/analysis/*`（架构分析与发现工具及其 prompt），无删除；
- 开发专用内容轴 `{"files":0,"bytes":0,"shLines":0}` 通过，所以这是**基线过期**，不是产物里混进了不该有的东西；`shLines` 与基线一致（7345），`bytes` 只报告不判（`SIZE_GATED_AXES = ["files","shLines"]`）；
- 当前 develop 上 `plugin/shipped-set-baseline.json` 的 `shipped` 仍是 `{"files":286,"bytes":61456361,"shLines":7345}`。

**机制**：体积上限在 10-14 被有意从每次推送的套件搬到发布门（`plugin/test/shipped-set.test.mjs` 注释：the guarantee moved to the release gate, it was not dropped），所以 fan-in 不会拦它，切版并推 tag 之后才第一次执行；而发布流程里没有任何一步负责重新锚定。release.yml 检出的是 `inputs.tag`，基线文件按 `findUp(moduleDir(), …)` 从该 tag 自己的树里读，所以只有在**切版之前**把新基线放进 develop 才对下一个 tag 生效。

**做法（规定的 CLI，不手改 JSON）**：
1. 在 worktree 里合并最新 develop，用 release.yml step 5 的同一条命令构建真实产物，`git archive` 到临时目录；
2. `node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --check <dir> --size-ceiling`，记录 before（预期 exit 1；以实测数字为准）；
3. `node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --reanchor <dir> --why "<说明>"`；
4. 再跑一次 `--check <dir> --size-ceiling`，记录 after（要求 exit 0）。

**留意**：
- `_reanchorLog` 的 `why` 是手写文字，曾出现过文字里的数字与实际写入的数字不一致（"281 → 284 … +4" 而 281+4=285）导致下一次 fan-in 红灯，所以 `why` 里的前后文件数必须与同一条记录里机器写入的值逐一相等；
- 构建产物会往 worktree 里写 `plugin/scripts/dist/`、`plugin/gate-scripts/dist/`、`plugin/docs` 等，这些会让三个按整棵树扫描的静态检查变红（`task-file-bypass-check`、`worktree-namespace-literal-check`、`serve-binding-literal-check`）；取完证据后必须 `rm -rf` 这些目录与临时分支再跑 scoped gate，并在 Evidence 里写明已删除；
- 文件数上限是**精确值**：如果在本任务落地与下一次切版之间又有 shipped 文件进入 develop，需要用同样步骤再锚定一次，这正是另一条预检任务要让它在切版之前可见的原因；本任务不负责预检。

## AC

- [x] AC0（before）：按上述步骤 1–2 构建真实产物并跑 `--check <dir> --size-ceiling`，把命令、exit 码与完整输出贴进 `## Evidence`
- [x] AC1：按步骤 3 跑 `--reanchor <dir> --why "<说明>"`，把完整输出贴进 `## Evidence`
- [x] AC2（after）：按步骤 4 对同一份产物目录再跑 `--check <dir> --size-ceiling`，exit 0，输出贴进 `## Evidence`
- [x] AC3（改动面受控）：`git diff <合并后的 develop> -- plugin/shipped-set-baseline.json` 只包含 `shipped.files`、`shipped.bytes` 的变化与 `_reanchorLog` 末尾新增的恰好一条记录；顶层 `files`、`bytes`、`shLines` 仍为 0，`shipped.shLines` 仍为 7345；把 diff 贴进 `## Evidence`
- [x] AC4（文字与数字一致）：新增 `_reanchorLog` 记录的 `why` 同时写出重新锚定前后的文件数，且这两个数与同一条记录里机器写入的前后值逐一相等，用一条一行脚本核对并把脚本与输出贴进 `## Evidence`
- [x] AC5（不留构建残渣）：取完证据后已删除构建产物目录与临时分支，`git status --porcelain` 只剩 `plugin/shipped-set-baseline.json` 与本任务文件，scoped gate 通过；在 `## Evidence` 写明删除了哪些目录
- [ ] AC6（读生产载体）：下一次真实 release run 的 `verify-plugin-channel` 里 `shipped-set-clean` 为 PASS，贴 run id 与该行日志（待外部）

## DoD

真实落地：develop 上的 `plugin/shipped-set-baseline.json` 记录的 `shipped.files` 等于按 release.yml 同一条命令构建出的真实产物的文件数，`--check --size-ceiling` 在这份产物上 exit 0，且 `_reanchorLog` 里的说明与数字一致。⛔ 不得为使检查变绿而手改 JSON，也不得放宽 `SIZE_GATED_AXES`，也不得改动开发专用内容那三条轴。

## Touches

- plugin/shipped-set-baseline.json
- tasks/gap-shipped-set-ceiling-stale-by-one-blocks-every-release-since-v0-20-0.md

## Evidence

**构建**（release.yml step 5 的同一条命令，在本任务 worktree 内执行）：
`bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify` → exit 0，orphan commit `d2fb85033`（121 bundled entrypoints，剪枝 19 个不可达 `.sh`，dist-closure OK）；
`git archive plugin-channel-verify | tar -x -C <ART>` → `find <ART> -type f | wc -l` = **287**。
`ART=/data/home/yale/shipped-set-artifact-7NHrmc`（worktree **之外**的临时目录，避免产物目录进入整树扫描的静态检查视野）。

### AC0（before）— exit 1

```
$ node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --check /data/home/yale/shipped-set-artifact-7NHrmc --size-ceiling
(node:3981527) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of .../plugin/scripts/shipped-set-rules.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to .../package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
shipped-set-rules: artifact 287 files · 63139052 bytes · 7345 .sh lines · 21 rule(s) in force
  ratchet (rule-excluded content present): {"files":0,"bytes":0,"shLines":0}
  measured: {"files":0,"bytes":0,"shLines":0}
  baseline: {"files":0,"bytes":0,"shLines":0}
  size ceiling: {"files":287,"bytes":63139052,"shLines":7345} vs recorded {"files":286,"bytes":61456361,"shLines":7345}
  headBaseline: {"files":0,"bytes":0,"shLines":0,"shipped":{"files":286,"bytes":61456361,"shLines":7345}}
shipped-set-rules: FAIL — the artifact's size exceeds the recorded clean reading — files 287 > ceiling 286 (exceeds by 1) (bytes 63139052, +1682691 vs the recorded 61456361: reported, not gated — see SIZE_GATED_AXES) — reanchor with: node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --reanchor /data/home/yale/shipped-set-artifact-7NHrmc (record the before/after run output)
EXIT=1
```

与 CI 的 `shipped-set-clean FAIL — files 287 > ceiling 286 (exceeds by 1)` 逐项一致；开发专用内容三轴仍为 0（过期的是基线，不是产物）。

### AC1（reanchor）— exit 0

```
$ node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --reanchor /data/home/yale/shipped-set-artifact-7NHrmc --why "release-gate size ceiling stale by one since v0.19.0: the v0.20.0 (run 38883031015) and v0.21.0 (run 39449799348) release runs both failed shipped-set-clean with files 287 > ceiling 286. Re-anchored from a real publish-dist-branch.sh artifact (the same command release.yml step 5 runs) assembled from this worktree's plugin/ tree and extracted with git archive: files 286 -> 287, bytes 61456361 -> 63139052. shLines unchanged at 7345; the three dev-only ratchet axes stay 0; bytes is reported, not gated (SIZE_GATED_AXES = files, shLines)."
shipped-set-rules: OK — baseline re-anchored to {"files":0,"bytes":0,"shLines":0} (artifact totals {"files":287,"bytes":63139052,"shLines":7345})
EXIT=0
```

（`MODULE_TYPELESS_PACKAGE_JSON` 告警同 AC0，stderr 噪声，不影响 verdict。）

### AC2（after，同一份产物目录）— exit 0

```
$ node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --check /data/home/yale/shipped-set-artifact-7NHrmc --size-ceiling
shipped-set-rules: artifact 287 files · 63139052 bytes · 7345 .sh lines · 21 rule(s) in force
  ratchet (rule-excluded content present): {"files":0,"bytes":0,"shLines":0}
  measured: {"files":0,"bytes":0,"shLines":0}
  baseline: {"files":0,"bytes":0,"shLines":0}
  size ceiling: {"files":287,"bytes":63139052,"shLines":7345} vs recorded {"files":287,"bytes":63139052,"shLines":7345}
  headBaseline: {"files":0,"bytes":0,"shLines":0,"shipped":{"files":286,"bytes":61456361,"shLines":7345}}
PASS — no rule-excluded content; ratchet {"files":0,"bytes":0,"shLines":0} ≤ baseline {"files":0,"bytes":0,"shLines":0}
EXIT=0
```

### AC3（改动面受控）— `git diff develop -- plugin/shipped-set-baseline.json`

```diff
@@ -168,6 +168,30 @@
         "shLines": 7345
       },
       "why": "AC-334 (tasks/gap-shipped-set-per-run-criterion-gates-churn-prone-artifact-totals): …"
+    },
+    {
+      "when": "2026-10-20T22:23:58.171Z",
+      "from": {
+        "files": 0,
+        "bytes": 0,
+        "shLines": 0,
+        "shipped": {
+          "files": 286,
+          "bytes": 61456361,
+          "shLines": 7345
+        }
+      },
+      "to": {
+        "files": 0,
+        "bytes": 0,
+        "shLines": 0
+      },
+      "shipped": {
+        "files": 287,
+        "bytes": 63139052,
+        "shLines": 7345
+      },
+      "why": "release-gate size ceiling stale by one since v0.19.0: … files 286 -> 287, bytes 61456361 -> 63139052. shLines unchanged at 7345; the three dev-only ratchet axes stay 0; bytes is reported, not gated (SIZE_GATED_AXES = files, shLines)."
     }
   ],
   "_axes": {
@@ -181,8 +205,8 @@
   "bytes": 0,
   "shLines": 0,
   "shipped": {
-    "files": 286,
-    "bytes": 61456361,
+    "files": 287,
+    "bytes": 63139052,
     "shLines": 7345
   }
 }
```

两个 hunk：① `_reanchorLog` 末尾新增**恰好一条**记录；② 顶层 `shipped.files` 286→287、`shipped.bytes` 61456361→63139052。顶层 `files`/`bytes`/`shLines`（全 0）与 `shipped.shLines`（7345）**未出现在 diff 的任何 `-`/`+` 行**，即未改动；`SIZE_GATED_AXES` 未改，`_note`/`_axes` 文本未改。

### AC4（文字与数字一致）— 一行脚本核对

脚本 `/data/home/yale/shipped-set-ac4-check.mjs`（读同一条记录，把 `why` 里的前后值与机器写入的 `from.shipped` / `shipped` 逐一比对）：

```js
import fs from "node:fs";
const doc = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const e = doc._reanchorLog.at(-1);
const grab = (re) => { const m = e.why.match(re); if (!m) throw new Error(`why does not state ${re}`); return [Number(m[1]), Number(m[2])]; };
const [fw, ft] = grab(/files (\d+) -> (\d+)/);
const [bw, bt] = grab(/bytes (\d+) -> (\d+)/);
const ok = fw === e.from.shipped.files && ft === e.shipped.files && bw === e.from.shipped.bytes && bt === e.shipped.bytes;
console.log(JSON.stringify({ whyFiles: [fw, ft], machineFiles: [e.from.shipped.files, e.shipped.files], whyBytes: [bw, bt], machineBytes: [e.from.shipped.bytes, e.shipped.bytes], ok }));
process.exit(ok ? 0 : 1);
```

输出：

```
$ node /data/home/yale/shipped-set-ac4-check.mjs plugin/shipped-set-baseline.json
{"whyFiles":[286,287],"machineFiles":[286,287],"whyBytes":[61456361,63139052],"machineBytes":[61456361,63139052],"ok":true}
EXIT=0
```

### AC5（不留构建残渣）

已删除（取完证据之后）：
- 本地临时分支 `plugin-channel-verify`（`git branch -D`，was `d2fb85033` —— 它是 `publish-dist-branch.sh` 在共享 `.git` 里建的真分支，必须删）；
- `.tmp-dist-publish-worktrees/`（脚本的 throwaway 组装工作区遗留目录）；
- worktree 内的产物抽取目录 `.quay-artifact`（提取后**整体移到** worktree 外的 `/data/home/yale/shipped-set-artifact-7NHrmc`，再 `rm -rf`）。

**未产生**：`plugin/scripts/dist/`、`plugin/gate-scripts/dist/`、`plugin/docs/` 在 worktree 内**从未出现**——`build-plugin-dist.mjs` 只在 throwaway WORK 树里生成它们（`ls` 三者均 `No such file or directory`），所以那三个整树扫描静态检查没有红。

`git status --porcelain`（worktree，baseline 提交后）→ **空**，无构建残渣。本任务文件由 Provider ABI 的 `task_write` 直接提交到任务库，不经过本 worktree 的工作树，因此不出现在这里的 porcelain 里（唯一的实际改动是 `plugin/shipped-set-baseline.json`，已提交为 `0ad8f419b`）。

scoped gate（合并 develop 后，与 fan-in 同一条命令）：

```
$ bash scripts/test.sh --for-task gap-shipped-set-ceiling-stale-by-one-blocks-every-release-since-v0-20-0 --allow-thin
… import-graph-check: PASS；sh-census-check: PASS；landing-target: PASS …
scripts/test.sh: --for-task … — selector selected 0 test files (thin allowed); nothing to run, full suite still runs at fan-in
EXIT=0
```

anti-drift Touches：`ANTI-DRIFT OK: … 1 actual file(s), all within declared Touches (2 glob(s))`，exit 0。

### AC6（待外部）

下一次真实 release run 的 `verify-plugin-channel` 里 `shipped-set-clean` 为 PASS——需一次 tag + dispatch 后才能取值。本任务落地后、下一次切版前若没有新的 shipped 文件进入 develop，该断言应转为 PASS（上限是精确值 287）。
