// @test-group product
// Stage — /goal + /doc web views (SPEC §4: the third sibling kind's route, done together with
// /doc which previously had NO route, both following the /adr shape). The goal page's most
// valuable column is the most recent verdict + time, read from the record's `evidence` field —
// which is ledger-DERIVED (gap-goal-evidence-cache-should-not-enter-git): the provider surfaces
// the store's view-model, whose `evidence` comes from `.quay/gate-events.jsonl`, never the file.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** `cookie` (optional) — gap-webui-goal-body-copy-en-zh: the default language is `en`, so the arms
 *  that pin this page's PRE-EXISTING Chinese copy ask for `lang=zh` explicitly (they become zh
 *  regression guards); the negative arms MUST do so too, or they would be vacuous under `en`. */
function get(port, urlPath, cookie) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers: cookie ? { Cookie: cookie } : {} }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

let server, port, originalCwd, workspaceRoot;

before(async () => {
  const tasksDir = makeTmpDir("goal-serve-tasks-");
  const adrDir = makeTmpDir("goal-serve-adr-");
  workspaceRoot = makeTmpDir("goal-serve-ws-");
  // The goal store lives at <workspaceRoot>/goals; the document store at <workspaceRoot>/docs-managed.
  const goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "docs-managed"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "goals", "GOAL-001-three-layer.md"),
    "---\nid: GOAL-001\ntitle: three-layer unification\nstatus: active\nkind: goal\norigin: 2026-08-09 human goal setting\n---\n## Goal\none target statement\n");
  // AC-028's file carries a STALE `evidence:` block (the "inherited from git" reading this task
  // removes). The ledger (written below) has the REAL latest event; the UI must show the LEDGER
  // timestamp, never this stale one (gap-goal-evidence-cache-should-not-enter-git).
  fs.writeFileSync(path.join(workspaceRoot, "goals", "AC-028-experience-flows.md"),
    "---\nid: AC-028\ntitle: experience flows between layers\nstatus: active\nkind: criterion\ngoal: GOAL-001\ncriterion: git rev-list --count integration..develop\nexpect: \"=0\"\norigin: 2026-08-09 measured criterion\nevidence:\n  at: 2020-01-01T00:00:00Z\n  verdict: pass\n  reading: \"stale-inherited\"\n---\n## Rationale\nmeasured\n");
  // AC-029 has a stale file `evidence:` but NO ledger event ⇒ the UI must render "—" (missing =
  // not-checked, never the stale inherited reading).
  fs.writeFileSync(path.join(workspaceRoot, "goals", "AC-029-no-ledger.md"),
    "---\nid: AC-029\ntitle: no ledger event\nstatus: active\nkind: criterion\ngoal: GOAL-001\ncriterion: exit 0\norigin: o\nevidence:\n  at: 2020-01-01T00:00:00Z\n  verdict: pass\n  reading: \"stale-inherited\"\n---\n## Rationale\nno ledger\n");
  fs.writeFileSync(path.join(workspaceRoot, "docs-managed", "DOC-001-quay-directive-skill.md"),
    "---\nid: DOC-001\ntitle: quay-directive skill\nstatus: active\nkind: skill\n---\n## Body\nthe directive skill\n");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);
  // The gitignored ledger is the evidence source (gap-goal-evidence-cache-should-not-enter-git):
  // AC-028 has a goal gate event (the UI must render THIS timestamp); AC-029 has none (⇒ "—").
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "gate-events.jsonl"),
    JSON.stringify({ id: "ev-1", item_id: "AC-028", pipeline_id: "AC-028", gate: "goal", actor: "goal-cli", verdict: "pass", timestamp: "2026-09-06T12:00:00Z", payload: { reason: "ok" } }) + "\n");
  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
});

test("AC5 — GET /goal lists goals; /goal?kind=criterion lists criteria with recent verdict (origin moved off the list)", async () => {
  // gap-webui-goal-list-tab-split-goal-ac: the merged GOAL+AC list split into two tabs. Goals render
  // on the default tab; the criterion (AC-028) and its ledger-derived verdict render on the
  // Criteria tab.
  const goals = await get(port, "/goal");
  assert.equal(goals.status, 200);
  assert.match(goals.body, /GOAL-001/);
  assert.match(goals.body, /three-layer unification/);
  assert.doesNotMatch(goals.body, /AC-028/, "criteria are not on the Goals tab");
  // gap-webui-goal-list-sort-and-column-set AC1: the whole-prose `origin` column left the list
  // (it lives on the detail page now) — the list must no longer render it.
  assert.doesNotMatch(goals.body, /origin/, "origin is no longer a list column");

  const r = await get(port, "/goal?kind=criterion");
  assert.equal(r.status, 200);
  assert.match(r.body, /AC-028/);
  assert.match(r.body, /experience flows/);
  // The most valuable column: recent verdict + time — now from the LEDGER, not the file.
  assert.match(r.body, /pass/);
  assert.match(r.body, /2026-09-06T12:00:00Z/);
  assert.doesNotMatch(r.body, /2020-01-01T00:00:00Z/, "stale file evidence must never render (ledger is the source)");
});

test("AC5 — GET /goal/AC-028 renders the detail page with criterion and verdict", async () => {
  const r = await get(port, "/goal/AC-028");
  assert.equal(r.status, 200);
  assert.match(r.body, /criterion/);
  assert.match(r.body, /git rev-list/);
  assert.match(r.body, /pass/);
  assert.match(r.body, /2026-09-06T12:00:00Z/, "detail shows the LEDGER timestamp, not the stale file one");
  assert.doesNotMatch(r.body, /2020-01-01T00:00:00Z/);
});

test("AC3 (evidence-out-of-git) — 无账本记录的 AC 显示「—」，⛔ 不显示继承自 git 的读数", async () => {
  // AC-029 has NO ledger event (its file still carries a stale `evidence:` block) ⇒ the UI must
  // show "—", never the stale `2020-01-01` reading inherited from the file (hard rule 6).
  const detail = await get(port, "/goal/AC-029");
  assert.equal(detail.status, 200);
  assert.doesNotMatch(detail.body, /最近 verdict/, "no ledger event ⇒ the detail page omits the recent-verdict line");
  assert.doesNotMatch(detail.body, /2020-01-01/, "stale file evidence must never render");
  const list = await get(port, "/goal?kind=criterion");
  assert.doesNotMatch(list.body, /2020-01-01/, "no stale inherited reading anywhere in the list");
});

test("AC5 — GET /goal/GOAL-001 renders a goal (no criterion cell) with origin", async () => {
  const r = await get(port, "/goal/GOAL-001");
  assert.equal(r.status, 200);
  assert.match(r.body, /three-layer unification/);
  assert.match(r.body, /origin/);
});

test("AC5 — GET /goal/nope → 404", async () => {
  assert.equal((await get(port, "/goal/AC-999")).status, 404);
});

test("AC5 — /doc route exists (previously no route: grep -c document = 0) and lists DOC-001", async () => {
  const r = await get(port, "/doc");
  assert.equal(r.status, 200);
  assert.match(r.body, /DOC-001/);
  assert.match(r.body, /quay-directive skill/);
});

test("AC5 — GET /doc/DOC-001 renders the document body", async () => {
  const r = await get(port, "/doc/DOC-001");
  assert.equal(r.status, 200);
  assert.match(r.body, /the directive skill/);
});

test("the task list (/tasks) nav links to goals and docs", async () => {
  const r = await get(port, "/tasks");
  assert.equal(r.status, 200);
  assert.match(r.body, /\/goal/);
  assert.match(r.body, /\/doc/);
});

// AC98 原断言「空态必须指向 manager-phase-goal.md / outer-phase-goal.md 这两个 prose 正本」。
// ⊕ 2026-09-06 G3 推翻了那个前提：manager-phase-goal.md 头部现自述「已降级为归档……正本已迁至
// ../goals/」。继续断言旧指针 = 让页面把读者送去一个归档文件当正本读（本仓库反复付过代价的那种
// 过期指针）。故本条改为断言【新的正确行为】：空态说明 goals/ 即正本，且仍不得说 "No goals."。
test("AC98(G3 后) — 空态指向 goals/ 自身为正本，⛔ 不再指向已降级的 prose 归档，也不说 'No goals.'", async () => {
  const r = await get(port, "/goal?status=superseded"); // no superseded records
  assert.equal(r.status, 200);
  assert.match(r.body, /goals\//);
  assert.doesNotMatch(r.body, /No goals/);
  // 负控制：旧指针不得再作为「正本」出现在空态的主句里。
  assert.doesNotMatch(r.body, /阶段目标正本在 prose 文件/);
});

// draft 是唯一「等着人裁定」的态（SPEC-goal-mechanism 裁定 3：draft→active 保留给人）。
// 此前它【没有任何 UI 入口】——?status=draft 有记录但筛选器不列它 ⇒ 提案写了也没人看得见。
test("draft 在筛选器里可达（此前缺失 ⇒ 提案不可见）", async () => {
  const r = await get(port, "/goal");
  assert.equal(r.status, 200);
  assert.match(r.body, /status=draft/, "筛选器必须提供 draft 入口");
});

test("有 draft AC 时 Goals tab 显示跨 tab 待裁定横幅与条数；无 draft 时不显示", async () => {
  const draftPath = path.join(workspaceRoot, "goals", "AC-900-draft-proposal.md");
  fs.writeFileSync(draftPath,
    "---\nid: AC-900\ntitle: a proposed criterion\nstatus: draft\nkind: criterion\ngoal: GOAL-001\ncriterion: exit 0\nexpect: \"exit 0\"\norigin: meta-driver 提案，依据 .quay/gate-events.jsonl 计数\n---\n## Rationale\nproposed\n");
  try {
    // gap-webui-goal-list-tab-split-goal-ac: a draft CRITERION is the Criteria tab's own count, so
    // the default Goals tab shows the cross-tab hint ("另有 N 条 AC 待裁定"), not its own banner.
    // `lang=zh` (gap-webui-goal-body-copy-en-zh): the banner sentence is now ROW 21's
    // `draftOtherBanner`, so pinning its Chinese column requires asking for zh. ⚠️ The two NEGATIVE
    // arms below need it just as much — under the default `en` they would pass because the page has
    // no Chinese at all, i.e. for the wrong reason (决定记录 ④).
    const r = await get(port, "/goal", "lang=zh");
    assert.match(r.body, /另有 1 条 AC 待裁定/);
    assert.match(r.body, /href="\/goal\?status=draft&kind=criterion"/);
    // 已经在 draft 筛选下时不重复提示（避免同一信息叠加两次）。
    const d = await get(port, "/goal?status=draft", "lang=zh");
    assert.doesNotMatch(d.body, /待裁定/, "?status=draft 不叠加横幅");
    // en peer: the banner is present AND translated, so the zh arms above are a reading of the
    // LANGUAGE and not of the banner's presence (which the two negative arms alone cannot show).
    const rEn = await get(port, "/goal", "lang=en");
    assert.match(rEn.body, /1 more AC awaiting a decision/);
    assert.doesNotMatch(rEn.body, /待裁定/, "the en Goals tab carries no Chinese banner copy");
  } finally {
    fs.rmSync(draftPath, { force: true });
  }
  // 负控制：draft 清零后横幅必须消失（⛔ 不得是恒显示的装饰）。
  const after = await get(port, "/goal", "lang=zh");
  assert.doesNotMatch(after.body, /待裁定/);
  // …and the same negative under en — the control must hold in the language the banner actually
  // renders in, not only in the one where the literal happens to be absent by construction.
  assert.doesNotMatch((await get(port, "/goal", "lang=en")).body, /awaiting a decision/);
});
