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
