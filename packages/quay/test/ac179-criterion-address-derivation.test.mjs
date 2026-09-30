// @test-group product
// gap-ac179-criterion-cmdline-port-literal-stale — AC-179 判据的**地址派生**那一步。
//
// 病灶（2026-09-23 直接量，cwd = 主检出）：判据从 serve 进程的 cmdline 里 grep `--host … --port …`。
// `ce0f47518` 把 web 端口默认改成**内核分配**（`--port 0`）⇒ cmdline 里那个 0 是**请求**、不是绑定端口，
// 而真实端口只在载体 `.quay/server.json` 里可知（`start-drivers.ts:26-28` 逐字：「the carrier is the
// only place the port is knowable」）。于是判据派生出 `172.28.0.1:0`（curl rc=7 连接被拒）、报
// 「no running instance / addr=none」——**而卡片一直在渲染**。同一时刻两侧读数：旧判据 exit 1；
// 载体 `web` 端口上同一条 curl+grep 命中 `id="goal-card"` 1 次。
//
// 本文件把**落库的判据文本本身**（`goals/AC-179-*.md` 的 `criterion`）绑到行为上，用真实的
// `quay.ts serve` 形态进程 + 真实载体 + 真实 HTTP 跑正负两向读数。⛔ 不是把派生逻辑抄一份来测——
// 抄一份只能证明「抄的那份对」，判据漂移时不会红（硬规则 4 推论三）。
//
// 覆盖：
//   AC1′  内核分配端口的生产形态（`--port 0` + 载体）⇒ exit 0，且 stdout 里派生的地址
//         **逐字等于当次载体 `web` 服务的 host:port**（⛔ 不是 0）；
//   AC2′  能取假，三向：(a) 卡片缺失 ⇒ 非 0 且 stderr 含 `/dashboard` 与 `id="goal-card"`；
//         (b) 无 serve 进程 ⇒ 非 0，**成因与 (a) 不同形**；(c) 地址指到死端口 ⇒ 非 0 且含「连接被拒」；
//   AC3′  非字面量（真负控制）：同一 root 上两次不同的内核端口 ⇒ 两次 exit 0 且各自等于当次载体值；
//   AC4′  归因：制造真实 fail ⇒ stderr 对**每个**候选给出 pid + 派生地址 + 成因，
//         ⛔ 候选存在时不得出现 `addr=none`（判据自身的 `sh -c` 进程也命中 pgrep，曾经正是它把地址抹空）；
//   AC5′  载体只取 `name == "web"`：把两服务对调（web 指向不渲染卡片的那个监听）⇒ 必须取假；
//   AC6′  三分：载体缺失 / 指向死 pid ⇒ exit 3（查不成），与 exit 0（合格）不同形；
//   AC7′  判据文本对 AC-241 的 bare-failure-exit 谓词仍为空（不得在修这条时新长出无成因的失败出口）。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { evaluateCriterionAttribution } from "../src/goal-store.ts";
import {
  writeCarrier,
  mkRoot,
  runSh,
  derive,
  installLiveWebAddressHelper,
} from "./helpers/live-web-address-fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The criterion text AS STORED — the same string the gate hands to `sh -c`. */
function storedCriterion() {
  const dir = path.join(REPO_ROOT, "goals");
  const file = fs.readdirSync(dir).find((f) => /^AC-179-.*\.md$/.test(f));
  assert.ok(file, `no goals/AC-179-*.md under ${dir}`);
  const raw = fs.readFileSync(path.join(dir, file), "utf8");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  assert.ok(m, `${file} has no frontmatter block`);
  const fm = parseYaml(m[1]);
  assert.equal(typeof fm.criterion, "string");
  return fm.criterion;
}

const CRITERION = storedCriterion();

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ── the fixture: a REAL serve-shaped process. The file is named `quay.ts` on purpose — the stored
// criterion's candidate predicate is `pgrep -f 'quay.ts serve'`, so a fixture named anything else
// would not exercise the same enumeration. It binds port 0 (kernel-assigned, the production default)
// and writes its bound ports where the test can read them back, exactly as the real carrier does. ──
const FIXTURE_SERVE = `
const http = require("node:http");
const fs = require("node:fs");
const argv = process.argv.slice(2);
let host = "127.0.0.1", port = 0, portfile = null, mode = "card";
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--host") host = argv[++i];
  if (argv[i] === "--port") port = Number(argv[++i]);
  if (argv[i] === "--portfile") portfile = argv[++i];
  if (argv[i] === "--mode") mode = argv[++i];
}
const page = (withCard) =>
  withCard ? '<html><body><div id="goal-card">goals</div></body></html>'
           : '<html><body><div id="live-card">no goal card on this listener</div></body></html>';
const web = http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true,"stale":false}'); return; }
  if (req.url === "/dashboard") { res.writeHead(200, { "content-type": "text/html" }); res.end(page(mode === "card")); return; }
  res.writeHead(404); res.end("not found");
});
const control = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(page(false)); });
web.listen(port, host, () => control.listen(0, host, () => {
  if (portfile) fs.writeFileSync(portfile, JSON.stringify({ web: web.address().port, control: control.address().port }));
}));
`;

/** Detached fixture serves, killed at the end of the file. */
const spawned = [];
after(() => {
  for (const pid of spawned) {
    try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  }
});

function killServe(pid) {
  try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
}

/** Direct quantity: is anything listening on this loopback port right now? (A killed child lingers as
 *  a zombie until reaped, so `kill(pid, 0)` is a PROXY that stays true — the socket is the reading.) */
async function portServing(port) {
  return await new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    const done = (v) => { try { s.destroy(); } catch { /* already closed */ } resolve(v); };
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
    s.setTimeout(1000, () => done(false));
  });
}

/** A disposable git root (the criterion resolves `$root` via `git rev-parse --show-toplevel`). */
function makeRoot(tag) {
  const root = fs.realpathSync(makeTmpDir(tag));
  execFileSync("git", ["init", "-q"], { cwd: root });
  installLiveWebAddressHelper(root);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, "quay.ts"), FIXTURE_SERVE);
  return root;
}

let serveSeq = 0;

/** Spawn a fixture serve rooted at `root`; returns { pid, web, control }. */
function startServe(root, { port = 0, mode = "card" } = {}) {
  const portfile = path.join(root, `ports-${++serveSeq}.json`);
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", path.join(root, "quay.ts"), "serve", "--host", "127.0.0.1", "--port", String(port), "--mode", mode, "--portfile", portfile],
    { cwd: root, detached: true, stdio: "ignore" },
  );
  child.unref();
  spawned.push(child.pid);
  const deadline = Date.now() + 20000;
  while (!fs.existsSync(portfile)) {
    assert.ok(Date.now() < deadline, `fixture serve (pid ${child.pid}) never reported its ports`);
    sleepMs(25);
  }
  const ports = JSON.parse(fs.readFileSync(portfile, "utf8"));
  return { pid: child.pid, web: ports.web, control: ports.control };
}

/** Write a schemaVersion-1 carrier (`services` as given; `web` must appear exactly once). */
function carrierDefault(pid, web, control) {
  return [
    { name: "web", pid, host: "127.0.0.1", port: web, up: true },
    { name: "control", pid, host: "127.0.0.1", port: control, up: true },
  ];
}

/** Run the STORED criterion exactly as the acceptance runner does: `sh -c "<criterion>"`, cwd=root. */
function runCriterion(root) {
  return spawnSync(CRITERION, { cwd: root, shell: true, encoding: "utf8", timeout: 120000 });
}

/** A port the kernel just handed out and that is now free again (bound-then-closed socket). */
async function freePort() {
  const srv = net.createServer();
  const p = await new Promise((res) => srv.listen(0, "127.0.0.1", () => res(srv.address().port)));
  await new Promise((res) => srv.close(res));
  return p;
}

test("AC1′ — kernel-assigned port: the stored criterion derives the carrier's web address and passes", () => {
  const root = makeRoot("ac179-crit-ac1-");
  const s = startServe(root);
  writeCarrier(root, s.pid, carrierDefault(s.pid, s.web, s.control));
  const r = runCriterion(root);
  assert.equal(r.status, 0, `criterion should pass; stderr=${r.stderr}`);
  assert.match(r.stdout, new RegExp(`http://127\\.0\\.0\\.1:${s.web}/dashboard`), "the derived address must be the carrier's web port, verbatim");
  assert.doesNotMatch(r.stdout, /:0\/dashboard/, "the derived address must never be the requested port 0");
});

test("AC3′ — non-literal (negative control): a fresh kernel-assigned port on the same root still passes", async () => {
  const root = makeRoot("ac179-crit-ac3-");
  const s1 = startServe(root);
  writeCarrier(root, s1.pid, carrierDefault(s1.pid, s1.web, s1.control));
  const r1 = runCriterion(root);
  assert.equal(r1.status, 0, `first run; stderr=${r1.stderr}`);
  assert.match(r1.stdout, new RegExp(`127\\.0\\.0\\.1:${s1.web}/dashboard`));

  // Stop the host and start a fresh one on the SAME root: the kernel hands out a DIFFERENT port, so a
  // criterion carrying a literal port would keep passing on its literal while this one tracks the carrier.
  killServe(s1.pid);
  for (let i = 0; i < 200 && (await portServing(s1.web)); i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(await portServing(s1.web), false, "the first fixture serve must have stopped serving before the second starts");
  const s2 = startServe(root);
  assert.notEqual(s2.web, s1.web, "the kernel assigned a different ephemeral port");
  writeCarrier(root, s2.pid, carrierDefault(s2.pid, s2.web, s2.control));
  const r2 = runCriterion(root);
  assert.equal(r2.status, 0, `second run; stderr=${r2.stderr}`);
  assert.match(r2.stdout, new RegExp(`127\\.0\\.0\\.1:${s2.web}/dashboard`));
});

test('AC2′(a) — card missing: non-zero, naming /dashboard and id="goal-card"', () => {
  const root = makeRoot("ac179-crit-ac2a-");
  const s = startServe(root, { mode: "nocards" });
  writeCarrier(root, s.pid, carrierDefault(s.pid, s.web, s.control));
  const r = runCriterion(root);
  assert.notEqual(r.status, 0, "a dashboard without the card must not pass");
  assert.match(r.stderr, /\/dashboard/, "the cause must name the endpoint");
  assert.match(r.stderr, /id="goal-card"/, "the cause must name the element it looked for");
  assert.match(r.stderr, /card missing/, "the cause must name the class of failure");
});

test("AC2′(b) — no serve process under this root: non-zero, shaped differently from card-missing", () => {
  const root = makeRoot("ac179-crit-ac2b-");
  const r = runCriterion(root);
  assert.notEqual(r.status, 0, "nothing is serving → never a pass");
  assert.doesNotMatch(r.stderr, /card missing/, "(b) must not reuse (a)'s cause shape");
  assert.match(r.stderr, /addr=underivable|cannot be evaluated/, `the cause must name why there is no address; stderr=${r.stderr}`);
});

test("AC2′(c) — the derived address points at a dead port: non-zero, cause says connection refused", async () => {
  const root = makeRoot("ac179-crit-ac2c-");
  const s = startServe(root);
  const dead = await freePort();
  writeCarrier(root, s.pid, carrierDefault(s.pid, dead, s.control));
  const r = runCriterion(root);
  assert.notEqual(r.status, 0, "a dead port must not pass");
  assert.match(r.stderr, /connection refused/, `the cause must name the refusal; stderr=${r.stderr}`);
  assert.match(r.stderr, new RegExp(`:${dead}/dashboard`), "the cause must name the address actually dialled");
});

test("AC5′ — only the service named 'web' is dialled: swapping the two entries must fail", () => {
  const root = makeRoot("ac179-crit-ac5-");
  const s = startServe(root);
  // `web` points at the CARDLESS listener, `control` at the card-serving one. A criterion that took
  // "the listening port in the carrier" instead of `name === "web"` would still pass here.
  writeCarrier(root, s.pid, [
    { name: "web", pid: s.pid, host: "127.0.0.1", port: s.control, up: true },
    { name: "control", pid: s.pid, host: "127.0.0.1", port: s.web, up: true },
  ]);
  const r = runCriterion(root);
  assert.notEqual(r.status, 0, "the criterion must judge on the `web` service, not on any listener");
  assert.match(r.stderr, /card missing/);
});

test("AC4′ — attribution: every candidate is enumerated with pid + address + cause; never addr=none", () => {
  const root = makeRoot("ac179-crit-ac4-");
  const s = startServe(root, { mode: "nocards" });
  writeCarrier(root, s.pid, carrierDefault(s.pid, s.web, s.control));
  const r = runCriterion(root);
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stderr, /addr=none/, "a candidate's --port 0 must not erase a derived address");
  // The criterion's own `sh -c` runner matches the `quay.ts serve` pattern and is rooted here too —
  // it must be REPORTED (as address-underivable), not silently dropped, and must not clobber the live
  // candidate's address.
  assert.match(r.stderr, new RegExp(`pid=${s.pid} addr=127\\.0\\.0\\.1:${s.web} cause=`), "the live candidate's pid + derived address + cause must be present");
  assert.match(r.stderr, /addr=underivable cause=/, "the runner-shaped candidate must carry a named cause");
  assert.match(r.stderr, /candidates \(quay\.ts serve with cwd=root\): 2/, "BOTH candidates are enumerated (enumerate, not boolean)");
});

test("AC6′ — three states stay distinct: an underivable address is NOT-EVALUATED (exit 3), never 0 and never a card-missing fail", () => {
  for (const [tag, services] of [
    ["absent", null],
    ["dead-pid", [{ name: "web", pid: 4194303, host: "127.0.0.1", port: 1 }]],
  ]) {
    const root = makeRoot(`ac179-crit-ac6-${tag}-`);
    startServe(root);
    if (services) writeCarrier(root, 4194303, services);
    const r = runCriterion(root);
    assert.equal(r.status, 3, `${tag}: an address that cannot be derived is NOT-EVALUATED, not 0 and not 1; stderr=${r.stderr}`);
    assert.match(r.stderr, /NOT-EVALUATED/);
    assert.match(r.stderr, /addr=underivable/);
  }
});

test("AC7′ — the amended criterion carries no bare failure exit (AC-241 ratchet must not regress)", () => {
  const verdict = evaluateCriterionAttribution(CRITERION);
  assert.equal(verdict.evaluated, true);
  assert.deepEqual(verdict.bare, [], `the stored criterion has unattributable failure exits: ${JSON.stringify(verdict.bare)}`);
});
