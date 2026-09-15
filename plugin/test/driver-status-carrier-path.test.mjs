// @test-group engine
// driver-status-carrier-path.test.mjs — gap-driver-status-carrier-path-names-first-entry-not-the-existing-one
//
// 缺陷（实测于第三方项目 quay-fleet）：`quay driver status` 报的 `carrier_path` 指向一个【不存在】的文件
// （`.quay/<kind>-outcome.jsonl`），而同一个 JSON 里的 `carrier_records` 是真实数字——因为 count 汇总
// 所有载体（含真实存在的 `<kind>-round.jsonl`），path 却取 registry 表【首个】名字。合起来看像正常读数
// （有路径、有计数、有新鲜时间戳），实际是一个「读不到」被伪装成「正常」（硬规则 3b）。
//
// 为什么 quay 自测发现不了：quay 自己的 `.quay/` 下 promotion-outcome 与 promotion-round 同时存在
// （历史遗留），首个恰好存在 ⇒ 缺陷被掩盖。只在「只写新名字」的干净项目上暴露（硬规则 4：在开发检出里
// 跑的测试结构上无法取假）。
//
// Run: scripts/test.sh plugin/test/driver-status-carrier-path.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KERNEL = path.resolve(__dirname, "..", "scripts", "driver-runtime.ts");

/** 直接 spawn kernel（⛔ 不经 `quay driver` CLI）：status 路径不需要 config.yml / plugin root 解析
 *  （driver-runtime.test.mjs:456 同款用法），故 fixture 只有 --root 下的 .quay/。 */
function kernel(args) {
  return spawnSync(process.execPath, ["--experimental-strip-types", KERNEL, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
}

/** 一个「零记录」的干净 workspace root（.quay/ 空）。 */
function emptyRoot(t, tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dscp-${tag}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  return root;
}

function statusJson(root, kind) {
  const r = kernel(["status", "--kind", kind, "--root", root, "--json"]);
  assert.equal(r.status, 0, `status --json failed: ${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

// ── AC1 (negative control: RED before the fix) ────────────────────────────────────────────────────
// 只写 <kind>-round.jsonl、无 <kind>-outcome.jsonl 的 workspace：改前 carrier_path 指向不存在的
// outcome 文件而 carrier_records > 0；改后 carrier_path 指向实际存在的 round 文件。
test("AC1 — carrier_path names the FIRST EXISTING carrier, not the registry's first name", (t) => {
  const root = emptyRoot(t, "ac1");
  // 第三方项目 quay-fleet 的形态：只有 round，没有 outcome。
  fs.writeFileSync(
    path.join(root, ".quay", "worker-round.jsonl"),
    '{"ts":"2026-09-13T08:45:41.113Z","round":1}\n{"ts":"2026-09-13T08:46:11.113Z","round":2}\n',
    "utf8",
  );

  const st = statusJson(root, "worker");
  assert.ok(st.carrier_records > 0, `载体里有记录: ${JSON.stringify(st)}`);
  assert.equal(
    fs.existsSync(st.carrier_path),
    true,
    `carrier_path 必须指向实际存在的文件（改前指向不存在的 worker-outcome.jsonl）: ${JSON.stringify(st.carrier_path)}`,
  );
  assert.match(st.carrier_path, /worker-round\.jsonl$/, `主载体 = 实际存在的那个: ${JSON.stringify(st)}`);
  assert.equal(st.last_record_ts, "2026-09-13T08:46:11.113Z", `last_record_ts 仍读同一个文件: ${JSON.stringify(st)}`);
  // Plan 2：存在性分解让「哪个存在、哪个没有」在读数上可见，⛔ 不必读代码才知道。
  const files = Object.fromEntries(st.carrier_files.map((f) => [f.name, f]));
  assert.equal(files["worker-outcome.jsonl"]?.exists, false, `outcome 不存在 ⇒ 读数上可见: ${JSON.stringify(st.carrier_files)}`);
  assert.equal(files["worker-round.jsonl"]?.exists, true, `round 存在: ${JSON.stringify(st.carrier_files)}`);
  assert.equal(files["worker-round.jsonl"]?.records, 2, `逐载体行数: ${JSON.stringify(st.carrier_files)}`);
  assert.equal(files["worker-outcome.jsonl"]?.records, 0, `不存在的载体记 0 行: ${JSON.stringify(st.carrier_files)}`);
});

// ── AC1b (backward compat) — 两个名字都在时，主载体仍是 registry 首个（quay 开发检出的形态）──────
// 本条锁住「改的是取值规则、不是优先级表」：既有 driver-runtime.test.mjs:309 / driver-cli.test.mjs:268 /
// driver-runtime.test.mjs:469 三条断言（两载体并存 ⇒ 主载体是 outcome）依赖它。
test("AC1b — 两个载体都存在时，主载体仍是 registry 首个 outcome（⛔ 不改变既有优先级）", (t) => {
  const root = emptyRoot(t, "ac1b");
  fs.writeFileSync(path.join(root, ".quay", "worker-outcome.jsonl"), '{"ts":"2026-09-13T10:00:00Z","task":"a"}\n', "utf8");
  fs.writeFileSync(path.join(root, ".quay", "worker-round.jsonl"), '{"ts":"2026-09-13T09:00:00Z","round":1}\n', "utf8");

  const st = statusJson(root, "worker");
  assert.match(st.carrier_path, /worker-outcome\.jsonl$/, `首个存在者 = outcome: ${JSON.stringify(st)}`);
  assert.equal(st.carrier_records, 2, `两载体行数之和: ${JSON.stringify(st)}`);
  assert.equal(st.last_record_ts, "2026-09-13T10:00:00Z", `末条 ts = 两载体最大值: ${JSON.stringify(st)}`);
});

// ── AC2 — 一个载体都不存在 ⇒ 两字段同态（path 为 null ∧ records 不为正）────────────────────────────
test("AC2 — no carrier at all ⇒ carrier_path is null AND carrier_records is not a positive number", (t) => {
  const root = emptyRoot(t, "ac2");

  const st = statusJson(root, "promotion");
  assert.equal(st.carrier_path, null, `无载体 ⇒ 显式 null（⛔ 不是空串、更不是一个不存在的路径）: ${JSON.stringify(st)}`);
  assert.equal(st.carrier_records, 0, `无载体 ⇒ records 为 0（⛔ 不得为正数——两字段不得一真一假）: ${JSON.stringify(st)}`);
  assert.equal(st.last_record_ts, null, `无载体 ⇒ ts 为 null: ${JSON.stringify(st)}`);
  assert.deepEqual(
    st.carrier_files,
    [{ name: "promotion-outcome.jsonl", exists: false, records: 0 }, { name: "promotion-round.jsonl", exists: false, records: 0 }],
    `分解里两个载体都标 missing: ${JSON.stringify(st.carrier_files)}`,
  );

  // 人类可读形态同样必须显式表达「无」（⛔ 不是 `carrier_path=` 空串——空串与「读不到」同形）。
  const txt = kernel(["status", "--kind", "promotion", "--root", root]);
  assert.equal(txt.status, 0, `status failed: ${txt.stdout}\n${txt.stderr}`);
  assert.match(txt.stdout, /carrier_path=null\b/, `人类可读形态显式报「无」: ${txt.stdout}`);
  assert.match(txt.stdout, /carrier_files=promotion-outcome\.jsonl:missing,promotion-round\.jsonl:missing/, `分解可见: ${txt.stdout}`);
});

// ── AC3 — driver status（非 --json）输出以换行结尾 ────────────────────────────────────────────────
test("AC3 — non-JSON `driver status` output ends with a newline (⛔ no output glued to the next line)", (t) => {
  const root = emptyRoot(t, "ac3");
  fs.writeFileSync(path.join(root, ".quay", "worker-round.jsonl"), '{"ts":"2026-09-13T08:45:41.113Z","round":1}\n', "utf8");

  const r = kernel(["status", "--kind", "worker", "--root", root]);
  assert.equal(r.status, 0, `status failed: ${r.stdout}\n${r.stderr}`);
  assert.ok(r.stdout.length > 0, "有输出");
  assert.equal(
    r.stdout.at(-1),
    "\n",
    `最后一个字节必须是换行（改前实测 260 字节无尾随 \\n，管道里与后续输出粘连）: last=${JSON.stringify(r.stdout.at(-1))} len=${r.stdout.length}`,
  );
  // 恰好一行 + 一个尾换行（⛔ 不是多打/漏打）。
  assert.equal(r.stdout.split("\n").length, 2, `恰好一行正文 + 尾换行: ${JSON.stringify(r.stdout)}`);

  // 同一缺陷类：status --json 与 liveness 两态也都不以换行结尾（同一载体 4 处，一并修）。
  const j = kernel(["status", "--kind", "worker", "--root", root, "--json"]);
  assert.equal(j.stdout.at(-1), "\n", `status --json 同样以换行结尾: ${JSON.stringify(j.stdout.at(-1))}`);
  const lv = kernel(["liveness", "--kind", "worker", "--root", root]);
  assert.equal(lv.status, 0, `liveness failed: ${lv.stdout}\n${lv.stderr}`);
  assert.equal(lv.stdout.at(-1), "\n", `liveness（非 --json）以换行结尾: ${JSON.stringify(lv.stdout.at(-1))}`);
  const lvj = kernel(["liveness", "--kind", "worker", "--root", root, "--json"]);
  assert.equal(lvj.stdout.at(-1), "\n", `liveness --json 以换行结尾: ${JSON.stringify(lvj.stdout.at(-1))}`);
});

// ── gap-driver-status-carrier-path-source-label-mismatch：ts 的【来源】必须单列 ──────────────────
//
// 缺陷（实测 2026-09-13T22:33Z 于生产 /home/yale/work/quay）：status 同时报
// `carrier_path` = 首个【存在】的载体、`last_record_ts` = 全载体末条 ts 的【最大值】，下游把它渲染成
// `carrier:<carrier_path> last ts` —— 声称这个 ts 来自它点名的那一个。它并没有：
//   promotion-outcome.jsonl 存在但末条 ts = 20:01:48Z（2.5h 陈旧）；promotion-round.jsonl 末条 =
//   22:33:30Z ⇒ 报出的 ts 来自 round，而读 `carrier_path` 的人看的是 outcome。
// 上面 AC1b 那条测试**合法地**钉住了这个 juxtaposition（两载体并存 ⇒ 主载体 = outcome），所以修法⛔
// 不是改 `carrier_path` 的取值规则，而是把**真来源**单列出来（`last_record_carrier`）。

/** 一个载体【自己】的末条 ts（与该 kind 的 tsKey 无关：本文件的 fixture 全是 `ts` 键）。 */
function lastTsOf(file) {
  const text = fs.readFileSync(file, "utf8");
  let max = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (typeof j.ts === "string" && (max === null || j.ts > max)) max = j.ts;
  }
  return max;
}

/** 「首个存在载体 ≠ 最大 ts 载体」的 fixture —— 本任务的判别形态（两载体并存，只是新旧不同）。
 *  ⛔ 顺序取 registry 表顺序：outcome 在前 ⇒ primaryPath 必然是 outcome，而 ts 只可能来自 round。 */
function divergentRoot(t, tag) {
  const root = emptyRoot(t, tag);
  fs.writeFileSync(
    path.join(root, ".quay", "promotion-outcome.jsonl"),
    '{"ts":"2026-09-13T20:01:48.261Z","task":"older"}\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, ".quay", "promotion-round.jsonl"),
    '{"ts":"2026-09-13T22:33:30.546Z","round":1}\n{"ts":"2026-09-13T22:34:00.000Z","round":2}\n',
    "utf8",
  );
  return root;
}

// AC1（本任务）：新字段 `last_record_carrier` 必须点名**真**来源，且它自身末条 ts == 所报 ts。
// 负控制：只把标签重命名、没把真载体接出来的修法——即在「首个存在载体 ≠ 最大 ts 载体」的 fixture 上
// 仍指向 outcome（或干脆复制 carrier_path）——在此必红。
test("provenance AC1 — last_record_carrier is the carrier whose OWN last ts == last_record_ts", (t) => {
  const root = divergentRoot(t, "prov-ac1");

  const st = statusJson(root, "promotion");
  // 既有语义不动（否则会撞上面 AC1b）：carrier_path 仍是首个存在者。
  assert.match(st.carrier_path, /promotion-outcome\.jsonl$/, `carrier_path 语义不变: ${JSON.stringify(st)}`);
  assert.equal(st.last_record_ts, "2026-09-13T22:34:00.000Z", `ts 仍是全载体最大值: ${JSON.stringify(st)}`);
  // 本任务的新字段：ts 的真来源。
  assert.equal(
    typeof st.last_record_carrier,
    "string",
    `status 必须报出 ts 的来源（改前无此字段）: ${JSON.stringify(st)}`,
  );
  assert.match(st.last_record_carrier, /promotion-round\.jsonl$/, `来源 = 最大 ts 的载体: ${JSON.stringify(st)}`);
  assert.notEqual(st.last_record_carrier, st.carrier_path, `来源 ≠ 首个存在载体（这正是缺陷形态）: ${JSON.stringify(st)}`);
  // 判据对「被点名的载体」本身可核：它的末条 ts 就是所报的 ts（⛔ 不是「另一个文件的」）。
  assert.equal(lastTsOf(st.last_record_carrier), st.last_record_ts, `被点名的载体自己供出了这个 ts: ${st.last_record_carrier}`);
  assert.notEqual(lastTsOf(st.carrier_path), st.last_record_ts, `而被 carrier_path 点名的那个【没有】供出它: ${st.carrier_path}`);
});

// 同态：无载体 ⇒ ts 与来源同为 null（⛔ 不得「有 ts 无来源」或「有来源无 ts」——硬规则 3b）。
test("provenance AC1b — no carrier at all ⇒ last_record_carrier is null exactly when last_record_ts is", (t) => {
  const root = emptyRoot(t, "prov-ac1b");

  const st = statusJson(root, "promotion");
  assert.equal(st.last_record_ts, null, `无载体 ⇒ ts 为 null: ${JSON.stringify(st)}`);
  assert.equal(st.last_record_carrier, null, `无 ts ⇒ 无来源（同态）: ${JSON.stringify(st)}`);
});

// AC3（本任务 · 负控制）：**改前必须红**。改前没有这个字段 ⇒ assert 立即抛。
// 改后：被点名的那个就是最大 ts 的载体，而 carrier_path 仍指着陈旧的 outcome。
test("provenance AC3 (negative control) — promotion: outcome exists but STALE ⇒ the named carrier is the round carrier", (t) => {
  const root = divergentRoot(t, "prov-ac3");

  const st = statusJson(root, "promotion");
  assert.match(st.carrier_path, /promotion-outcome\.jsonl$/, `fixture 成立：carrier_path 指向陈旧的那个: ${JSON.stringify(st)}`);
  assert.match(st.last_record_carrier, /promotion-round\.jsonl$/, `所报载体 == 最大 ts 载体: ${JSON.stringify(st)}`);
  assert.equal(lastTsOf(st.last_record_carrier), "2026-09-13T22:34:00.000Z", `来源载体自身末条 ts: ${st.last_record_carrier}`);
});

// AC4（本任务）：人可读一行形携带**同一修正后的并置关系**——ts 紧邻它的来源；来源 ≠ carrier_path 时
// 该 ts 标注为「跨载体最大值」。负控制：用与 AC3 相同的 fixture 读非 --json 输出。
test("provenance AC4 — the one-line form pairs last_record_ts with its OWN carrier (+ cross-carrier marker)", (t) => {
  const root = divergentRoot(t, "prov-ac4");

  const r = kernel(["status", "--kind", "promotion", "--root", root]);
  assert.equal(r.status, 0, `status failed: ${r.stdout}\n${r.stderr}`);
  const m = r.stdout.match(/last_record_carrier=(\S+)/);
  assert.ok(m, `一行形必须报出 ts 的来源: ${r.stdout}`);
  assert.match(m[1], /promotion-round\.jsonl$/, `一行形的来源 = 最大 ts 载体（改前只有 carrier_path，指向 outcome）: ${r.stdout}`);
  assert.match(r.stdout, /\(cross-carrier max\)/, `来源 ≠ carrier_path ⇒ 该 ts 标注为跨载体最大值: ${r.stdout}`);
  // 同一行里 carrier_path 仍是首个存在者（语义未被这次修改动过）。
  assert.match(r.stdout, /carrier_path=\S*promotion-outcome\.jsonl/, `carrier_path 语义不变: ${r.stdout}`);

  // 无载体形态：显式 null（⛔ 不与「有来源」同形）。
  const empty = emptyRoot(t, "prov-ac4-empty");
  const e = kernel(["status", "--kind", "promotion", "--root", empty]);
  assert.equal(e.status, 0, `status failed: ${e.stdout}\n${e.stderr}`);
  assert.match(e.stdout, /last_record_carrier=null\b/, `无载体 ⇒ 来源显式 null: ${e.stdout}`);
  assert.doesNotMatch(e.stdout, /\(cross-carrier max\)/, `无载体 ⇒ 不出现跨载体标注: ${e.stdout}`);
});
