// @test-group engine
// freshness-refresh-remedy-availability.test.mjs — the CONSUMER for `remedyAvailability`
// (tasks/gap-ac214-seventh-crossing-blocked-remedy-has-no-consumer).
//
// THE DEFECT THIS FILE PINS (measured 2026-09-25, `.quay/routine-findings.jsonl` line 878).
// The probe had already measured — and honestly written into the PRODUCTION carrier — the quantity
// `inventory.producers_executable_from_this_host: 0`, with its cause named in `notes`
// (`ssh precondition 0 verified live this run (… Permission denied, rc=255) so NO producer is
// runnable from this host without an authorization change`). The SAME round's `filing-round` record
// still filed two `status: ready` tasks whose requested action was "re-run coldstart-face on a host
// already authorized to B". ⇒ A truthful reading with no consumer is shaped exactly like "nothing
// happened" (硬规则 3b / 4b). This is the seventh crossing of the same family: every earlier fix
// wired a consumer to the PREVIOUS reading, and the reading one layer up stayed consumer-less.
//
// WHAT IS PINNED HERE — three independently-valued states, each able to TAKE FALSE, and the
// artifact-shape difference between them:
//   (a) the DECLARATION is real and readable from the production mapping (⛔ not a fixture-only
//       field): `execution_probe` parses with a host, a denied-command and a verbatim remedy;
//   (b) the classifier's THREE-WAY split — `executable` / `blocked` / `not-evaluated` — with the
//       negative controls that make each take false: a DENIAL is `blocked`, but a same-rc DNS
//       failure and a spawn error are `not-evaluated` (⛔ "could not look" must not read as
//       "looked and it is denied");
//   (c) the ROUTINE's blocked arm: the reading lands in the carrier with its own value, the finding
//       is routed to the human-visible channel (`needs-human`, verbatim remedy, the mapping's own
//       producer command), NO dispatchable task is produced, STALE is still reported, and the same
//       subject is not escalated twice while the reading is unchanged;
//   (d) the routine's EXECUTABLE arm as the reverse control: the SAME finding files a normal,
//       dispatchable task — i.e. the blocked arm is not 恒有输出;
//   (e) a mapping that declares NO execution probe ⇒ `not-declared`, filing unchanged (the gate
//       does not apply), which is a third shape again.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { llmProbeRoutine, resolveMappingPath } from "../scripts/probe-routine.ts";
import {
  classifyExecutionProbeResult,
  escalationKey,
  escalationMarkerByKey,
  foldProbeReportedValue,
  parseExecutionProbe,
  readProducerMapping,
  remedyGatesProducer,
  renderRoutineTaskBody,
} from "../scripts/routine-file-gate.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** 本文件建过的所有临时目录（tmp-leak-pairing 的 carrier-array 形态，同 probe-routine.test.mjs）。 */
const CREATED_DIRS = [];
after(() => {
  for (const d of CREATED_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function makeTmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  CREATED_DIRS.push(d);
  return d;
}

// ── (a) the DECLARATION, read from the production mapping (⛔ not a fixture) ─────────────────────

test("DECLARATION — the production mapping's execution_probe parses into a usable declaration", () => {
  const rel = "plugin/freshness-producers.json";
  const abs = path.join(REPO_ROOT, rel);
  assert.ok(fs.existsSync(abs), `the production mapping must exist to be read: ${abs}`);
  const { producers, executionProbe, commands } = readProducerMapping(abs);

  // the registry half must still read (⛔ this task does not weaken the producer gate)
  assert.ok(producers instanceof Set && producers.size >= 3, "the registry half must still read");
  assert.equal(producers.has("coldstart-face"), true);
  assert.equal(producers.has("upgrade-face"), true);

  // the declaration half
  assert.ok(executionProbe, `${rel} must declare an execution_probe — that IS this task's 2a`);
  assert.equal(executionProbe.blockedPattern, "Permission denied",
    "the denied-pattern is what separates 'denied' from 'could not tell' — it must be declared");
  assert.ok(executionProbe.command[0] === "ssh" && executionProbe.command.includes("BatchMode=yes"),
    `the reachability probe must be a non-interactive ssh: ${JSON.stringify(executionProbe.command)}`);
  assert.ok(executionProbe.producers.includes("coldstart-face") && executionProbe.producers.includes("upgrade-face"),
    "the reading must declare WHICH producers it gates (⛔ not a blanket suppression)");
  assert.ok(executionProbe.remedy, "a blocked reading with no declared remedy is not a remedy");
  assert.match(executionProbe.remedy.action, /authorized_keys/,
    "the remedy must name the authorized_keys change (the task's '改哪个 authorized_keys')");
  assert.match(executionProbe.remedy.host, /^[^@]+@.+/, "the remedy must name the machine");
  for (const id of executionProbe.producers) {
    assert.ok(commands.get(id), `producers[${id}].command must be quotable verbatim (the single source)`);
  }
});

test("DECLARATION — parseExecutionProbe is fail-closed: a block without id/command is not a declaration", () => {
  assert.equal(parseExecutionProbe(undefined), null);
  assert.equal(parseExecutionProbe({}), null);
  assert.equal(parseExecutionProbe({ id: "x" }), null, "no command ⇒ not runnable ⇒ not a declaration");
  assert.equal(parseExecutionProbe({ command: ["ssh"] }), null, "no id ⇒ not a declaration");
  assert.ok(parseExecutionProbe({ id: "x", command: ["ssh", "h", "true"] }));
});

// ── (b) the classifier's three-way split, both arms able to take false ───────────────────────────

const DECL = {
  id: "host-b-ssh",
  command: ["ssh", "-o", "BatchMode=yes", "yale@orangevps.wan.hwang.men", "true"],
  timeoutMs: 20_000,
  blockedPattern: "Permission denied",
  producers: ["coldstart-face", "session-delivery", "upgrade-face"],
  remedy: { host: "yale@orangevps.wan.hwang.men", action: "把本机 `~/.ssh/id_ed25519.pub` 追加到目标侧 `~/.ssh/authorized_keys`（需人授权）", alternative: "或在一台已被 B 授权的主机上跑" },
};

test("RESOLUTION — the mapping is read from the SAME code revision as the spec that declares it", () => {
  // The failure this pins was MEASURED on this task's own first production reading attempt: with the
  // code revision swapped in (spec read from the worktree) but the mapping read from `root`, the
  // reading silently became `not-declared` — a declaration whose consumer could not see it.
  const root = makeTmpDir("remedy-resolve-root-");
  const rev = makeTmpDir("remedy-resolve-rev-");
  fs.mkdirSync(path.join(root, "plugin"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "freshness-producers.json"), "{\"producers\":[]}", "utf8");
  fs.writeFileSync(path.join(rev, "freshness-producers.json"), "{\"producers\":[],\"execution_probe\":{\"id\":\"x\"}}", "utf8");
  assert.equal(resolveMappingPath(root, rev, "plugin/freshness-producers.json"),
    path.join(rev, "freshness-producers.json"),
    "the revision's copy wins when the two differ and it exists");

  // in-tree kernel (the production wiring: pluginRoot === <root>/plugin) ⇒ ONE path, no change
  const inTree = path.join(root, "plugin");
  assert.equal(resolveMappingPath(root, inTree, "plugin/freshness-producers.json"),
    path.join(root, "plugin", "freshness-producers.json"));
  assert.equal(resolveMappingPath(root, inTree, "plugin/freshness-producers.json"),
    path.resolve(root, "plugin/freshness-producers.json"),
    "pluginRoot === <root>/plugin ⇒ the two candidates are the same path (production unchanged)");

  // a workspace that keeps its mapping elsewhere (no plugin-side copy) still resolves its own
  assert.equal(resolveMappingPath(root, rev, ".quay/my-producers.json"),
    path.join(root, ".quay", "my-producers.json"));
  // neither exists ⇒ the pre-fix path is returned, so the caller still fails closed on unreadable
  assert.equal(resolveMappingPath(root, rev, ".quay/nope.json"), path.join(root, ".quay", "nope.json"));
});

test("CLASSIFIER — the three states are independently valued; each takes false in the other's arm", () => {
  const executable = classifyExecutionProbeResult(DECL, { status: 0, stdout: "", stderr: "" });
  const blocked = classifyExecutionProbeResult(DECL, {
    status: 255, stdout: "", stderr: "yale@orangevps.wan.hwang.men: Permission denied (publickey,password).",
  });
  const dns = classifyExecutionProbeResult(DECL, {
    status: 255, stdout: "", stderr: "ssh: Could not resolve hostname orangevps: Temporary failure in name resolution",
  });
  const spawnError = classifyExecutionProbeResult(DECL, { status: null, error: { message: "ETIMEDOUT" } });

  // 硬规则 3b: the three must NOT share an output word.
  assert.equal(executable.status, "executable");
  assert.equal(blocked.status, "blocked");
  assert.equal(dns.status, "not-evaluated");
  assert.equal(spawnError.status, "not-evaluated");
  assert.equal(new Set([executable.status, blocked.status, dns.status]).size, 3,
    "executable / blocked / not-evaluated must be three distinct values");
  assert.equal(executable.evaluated, true);
  assert.equal(blocked.evaluated, true);
  assert.equal(dns.evaluated, false, "⛔ a failure that is not the DECLARED denial is NOT 'blocked'");
  assert.equal(spawnError.evaluated, false);

  // ⛔ the negative control that matters: SAME rc=255, opposite readings. Widening `blocked` to
  // "non-zero exit" would make a DNS failure read as "the humans must act" — measured on this host,
  // the FQDN form is denied while the short alias cannot even resolve, both at rc=255.
  assert.notEqual(dns.status, blocked.status, "same rc, different state — the pattern is load-bearing");
  assert.match(blocked.reason, /Permission denied/);
  assert.match(dns.reason, /did not match the declared denial/);
  // the verbatim observation survives into the record (so a reader audits the reading, not a verdict)
  assert.match(blocked.observed, /Permission denied \(publickey,password\)/);
});

test("CLASSIFIER — a declaration with NO blocked_pattern cannot produce 'blocked' (fail-closed, ⛔ never a guess)", () => {
  const noPattern = { ...DECL, blockedPattern: null };
  const r = classifyExecutionProbeResult(noPattern, { status: 255, stdout: "", stderr: "Permission denied (publickey)." });
  assert.equal(r.status, "not-evaluated", "⛔ without a declared denial there is nothing to recognize as blocked");
  assert.equal(r.evaluated, false);
});

test("FOLD — the probe's OWN declared value is readable only against the SPEC's declared vocabulary", () => {
  const mech = classifyExecutionProbeResult(DECL, { status: null, error: { message: "spawn ENOENT" } });
  assert.equal(mech.status, "not-evaluated");
  const specValues = ["executable", "blocked", "not-evaluated"];

  // a declared value is accepted, and when the mechanical reading could not be taken it DECIDES
  const fromProbe = foldProbeReportedValue(mech, "blocked", specValues);
  assert.equal(fromProbe.status, "blocked");
  assert.equal(fromProbe.source, "probe-reported");
  assert.equal(fromProbe.probeReported, "blocked");

  // an UNDECLARED token must not be silently accepted as a state this routine understands
  const junk = foldProbeReportedValue(mech, "surely-fine", specValues);
  assert.equal(junk.status, "not-evaluated", "⛔ an undeclared value is not a reading");
  assert.equal(junk.probeReported, "surely-fine", "but it is recorded verbatim, not dropped");

  // the mechanical reading WINS when it could be taken (⛔ a re-paraphrase never overrides a measurement)
  const real = classifyExecutionProbeResult(DECL, { status: 0 });
  const folded = foldProbeReportedValue(real, "blocked", specValues);
  assert.equal(folded.status, "executable");
  assert.equal(folded.source, "execution-probe");
  assert.equal(folded.probeReported, "blocked", "the disagreement is recorded, ⛔ not hidden");
});

test("GATE — the reading gates only the producers it declares (both arms can take false)", () => {
  const blocked = classifyExecutionProbeResult(DECL, { status: 255, stderr: "Permission denied (publickey)." });
  const executable = classifyExecutionProbeResult(DECL, { status: 0 });
  assert.equal(remedyGatesProducer(blocked, DECL, "coldstart-face"), true);
  assert.equal(remedyGatesProducer(blocked, DECL, "upgrade-face"), true);
  assert.equal(remedyGatesProducer(blocked, DECL, "some-other-producer"), false, "⛔ not a blanket suppression");
  assert.equal(remedyGatesProducer(blocked, DECL, null), false, "a missing-producer finding needs no cross-machine run");
  assert.equal(remedyGatesProducer(executable, DECL, "coldstart-face"), false, "the executable arm takes false");
  assert.equal(remedyGatesProducer(undefined, DECL, "coldstart-face"), false, "an absent reading gates nothing");
});

// ── the routine's two arms (blocked / executable) ────────────────────────────────────────────────

const FRESHNESS_FINDING = {
  id: "freshness-stale-goal-009-ac-207",
  kind: "stale-subject",
  subject: "GOAL-009-AC-207",
  symbols: ["coldstart-face"],
  files: ["plugin/freshness-producers.json", ".quay/goal-freshness-margin.json"],
  verdict: "act-now",
  rationale: "margin 20/K=200 = 10% of the window left, below the 23.4% the producer plus one interval can consume at the measured burst rate; newest evidence frozen at 2026-09-20T13:50:36Z",
  suggestedAction: "re-run coldstart-face on a host already authorized to B (this host is NOT: ssh BatchMode rc=255)",
  producer: "coldstart-face",
};

const PRODUCER_CMD = "bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts \"B C\" --force --root <main-checkout>";

/** 工作区：一条声明了产出者登记面 + remedy-availability 词表的 probe 例程 + 板 + mapping。 */
function makeWorkspace({ declareProbe = true, declareSpec = true, label = "w" } = {}) {
  const root = makeTmpDir(`remedy-avail-${label}-`);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "probes"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), [
    "loop:", "  routines:", "    - name: freshness-refresh", "      trigger: interval:120m",
    "      probe: freshness-refresh", "",
  ].join("\n"), "utf8");
  const routing = [
    "output_routing:",
    "  stale-subject: milestone-candidate",
    "  producers_file: plugin/freshness-producers.json",
    ...(declareSpec ? ["  remedy_availability:", "    key: remedyAvailability", "    values: [executable, blocked, not-evaluated]"] : []),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "plugin", "probes", "freshness-refresh.md"),
    `---\ninstrument: none\nfallback: none\n${routing}---\nReport stale subjects.\n`, "utf8");
  const mapping = {
    producer_registry: true,
    producers: [
      { id: "coldstart-face", command: PRODUCER_CMD, wallclock_hours: 0.34, subjects: ["GOAL-009-AC-207"] },
      // a SECOND producer the declared execution probe does NOT gate — the arm that proves the
      // reading is scoped (and that the escalation channel's exemption is not a blanket hole).
      { id: "some-other-producer", command: "bash plugin/scripts/other.sh", wallclock_hours: 0.1, subjects: ["GOAL-009-AC-999"] },
    ],
    ...(declareProbe ? {
      execution_probe: {
        id: "host-b-ssh",
        command: ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "yale@orangevps.wan.hwang.men", "true"],
        timeout_ms: 20000,
        blocked_pattern: "Permission denied",
        producers: ["coldstart-face"],
        remedy: {
          host: "yale@orangevps.wan.hwang.men",
          action: "把本机 `~/.ssh/id_ed25519.pub` 逐字追加到 `yale@orangevps.wan.hwang.men` 的 `~/.ssh/authorized_keys`（目标侧动作，需人授权）",
          alternative: "或在一台已被 B 授权的主机上跑本 finding 自己那条 producer 命令",
        },
      },
    } : {}),
  };
  fs.writeFileSync(path.join(root, "plugin", "freshness-producers.json"), JSON.stringify(mapping), "utf8");
  spawnSync("git", ["-C", root, "init", "-q"], { encoding: "utf8" });
  return root;
}

/** 假探针 argv（⛔ 不 spawn LLM）：打印契约要求的那一个 JSON 对象。 */
function fakeProbeArgv(payload) {
  const script = path.join(os.tmpdir(), `fake-probe-ra-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(script, `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`, "utf8");
  return [process.execPath, script];
}

function readCarrier(root) {
  const p = path.join(root, ".quay", "routine-findings.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** 跑一次例程。`probeRun` 是**执行探针**的注入读数（受控语料）；`fileTaskFn` 像生产那样把任务
 *  体写进 `tasks/`，于是**第二次**运行能像生产一样从板上读到「已升级」。 */
async function runRoutine(root, { probeRun, nowMs, findings = [FRESHNESS_FINDING], extra = {} } = {}) {
  const written = [];
  const routine = llmProbeRoutine(
    { name: "freshness-refresh", trigger: "interval:120m", probe: "freshness-refresh", dispatch: null },
    {
      root, pluginRoot: path.join(root, "plugin"), probeTimeoutMs: 30_000,
      probeArgv: () => fakeProbeArgv({ findings, shards: 1, notes: "controlled reading" }),
      runExecutionProbe: () => probeRun,
      now: () => nowMs.value,
      fileTaskFn: async (taskId, title, body, status) => {
        written.push({ taskId, title, body, status });
        fs.writeFileSync(path.join(root, "tasks", `${taskId}.md`),
          `---\nid: ${taskId}\ntitle: ${JSON.stringify(title)}\nstatus: ${status ?? "todo"}\n---\n${body}\n`, "utf8");
        return { ok: true, reason: `filed as ${taskId}` };
      },
      ...extra,
    },
  );
  const facts = await routine.run({ halted: false });
  return { facts, written };
}

const DENIED = { status: 255, stdout: "", stderr: "yale@orangevps.wan.hwang.men: Permission denied (publickey,password)." };
const REACHABLE = { status: 0, stdout: "", stderr: "" };

test("ROUTINE (blocked arm) — the reading is recorded with its OWN value and the finding goes to the human-visible channel", async () => {
  const root = makeWorkspace({ label: "blocked" });
  const { facts, written } = await runRoutine(root, { probeRun: DENIED, nowMs: { value: Date.parse("2026-09-25T06:00:00Z") } });

  assert.equal(facts[0].state, "verified", facts[0].reason);
  // (i) the reading is a TOP-LEVEL field with an independent value (⛔ not prose in `notes`)
  const scan = readCarrier(root).find((r) => r.kind === "scan-round");
  assert.equal(scan.remedy_availability.status, "blocked");
  assert.equal(scan.remedy_availability.evaluated, true);
  assert.equal(scan.remedy_availability.source, "execution-probe");
  assert.equal(scan.remedy_availability.probeId, "host-b-ssh");
  assert.match(scan.remedy_availability.observed, /Permission denied/);
  assert.equal(facts[0].value.remedy_availability, "blocked");

  // (ii) STALE itself is STILL reported (⛔ never silently downgraded to fresh)
  const findings = readCarrier(root).filter((r) => r.kind === "finding");
  assert.equal(findings.length, 1, "the stale-subject finding must still be recorded in the blocked arm");
  assert.equal(findings[0].dupKind, "stale-subject");
  assert.equal(findings[0].subject, "GOAL-009-AC-207", "the subject must reach the carrier");

  // (iii) the artifact is NOT the dispatchable shape
  assert.equal(written.length, 1);
  assert.equal(written[0].status, "needs-human", "⛔ the blocked arm must not produce a dispatchable task");
  assert.match(written[0].body, /remedy-availability：`blocked` · subject：`GOAL-009-AC-207`/);
  assert.match(written[0].body, /yale@orangevps\.wan\.hwang\.men/, "the machine must be named");
  assert.match(written[0].body, /authorized_keys/, "the authorized_keys change must be named");
  assert.ok(written[0].body.includes(PRODUCER_CMD), "the producer command must be quoted VERBATIM from the mapping");
  assert.match(written[0].title, /\[remedy-blocked\]/);
  // ⛔ the escalation must NOT enter the dispatchable dedup space (symbols key)
  assert.doesNotMatch(written[0].body, /- 观测符号：/,
    "an escalation carrying the symbols line would suppress the dispatchable channel for that producer forever");

  // (iv) the round is recorded as an ESCALATION, distinctly from an ordinary filing
  const filing = readCarrier(root).find((r) => r.kind === "filing-round");
  assert.equal(filing.remedy_availability, "blocked");
  assert.deepEqual(filing.escalated, [written[0].taskId]);
  assert.deepEqual(filing.filed, [written[0].taskId]);
  assert.equal(filing.rejected.length, 0);
});

test("ROUTINE (executable arm = reverse control) — the SAME finding files a DISPATCHABLE task (⛔ not 恒报挡住)", async () => {
  const root = makeWorkspace({ label: "exec" });
  const { facts, written } = await runRoutine(root, { probeRun: REACHABLE, nowMs: { value: Date.parse("2026-09-25T06:00:00Z") } });

  assert.equal(facts[0].state, "verified", facts[0].reason);
  const scan = readCarrier(root).find((r) => r.kind === "scan-round");
  assert.equal(scan.remedy_availability.status, "executable", "the same host, the other reading");
  assert.equal(scan.remedy_availability.source, "execution-probe");

  // the SAME finding is still reported (STALE is not conditional on the remedy reading)
  assert.equal(readCarrier(root).filter((r) => r.kind === "finding").length, 1);

  assert.equal(written.length, 1, "the executable arm MUST file — otherwise the blocked arm proves nothing");
  assert.notEqual(written[0].status, "needs-human", "⛔ not the human-visible channel here");
  assert.doesNotMatch(written[0].body, /remedy-availability：`blocked`/);
  assert.match(written[0].body, /- 观测符号：`coldstart-face`/, "the dispatchable shape carries the symbol key");
  const filing = readCarrier(root).find((r) => r.kind === "filing-round");
  assert.equal(filing.remedy_availability, "executable");
  assert.deepEqual(filing.escalated, []);
});

test("ROUTINE (unchanged reading) — a second blocked round does NOT re-file the same subject", async () => {
  const root = makeWorkspace({ label: "repeat" });
  const nowMs = { value: Date.parse("2026-09-25T06:00:00Z") };
  const first = await runRoutine(root, { probeRun: DENIED, nowMs });
  assert.equal(first.written.length, 1, "control baseline: the first blocked round DOES escalate");

  // the reading did not change; advance past the durable last-run window so the routine really runs
  nowMs.value += 3 * 60 * 60 * 1000;
  const second = await runRoutine(root, { probeRun: DENIED, nowMs });
  assert.equal(second.written.length, 0, "⛔ the same subject must not be escalated twice while the reading is unchanged");
  const rounds = readCarrier(root).filter((r) => r.kind === "filing-round");
  const last = rounds[rounds.length - 1];
  assert.equal(last.escalated.length, 0);
  const reject = last.rejected.find((x) => x.gate === "blocked-repeat");
  assert.ok(reject, `the refusal must be its OWN gate, not rate/dedup: ${JSON.stringify(last.rejected)}`);
  assert.match(reject.reason, /subject:GOAL-009-AC-207/);
  assert.match(reject.reason, /is already escalated/);
  // and the SCAN still ran and still reported the stale subject (⛔ the dedup silences the filing,
  // never the measurement)
  assert.equal(readCarrier(root).filter((r) => r.kind === "finding").length, 2);
});

test("ROUTINE (no execution probe declared) — `not-declared` is a THIRD shape: the gate does not apply", async () => {
  const root = makeWorkspace({ declareProbe: false, label: "nodecl" });
  const { facts, written } = await runRoutine(root, { probeRun: DENIED, nowMs: { value: Date.parse("2026-09-25T06:00:00Z") } });
  assert.equal(facts[0].state, "verified", facts[0].reason);
  const scan = readCarrier(root).find((r) => r.kind === "scan-round");
  assert.equal(scan.remedy_availability.status, "not-declared");
  assert.notEqual(scan.remedy_availability.status, "blocked", "⛔ 'not declared' must not read as 'blocked'");
  assert.notEqual(scan.remedy_availability.status, "executable", "⛔ nor as 'executable'");
  assert.equal(written.length, 1, "no declaration ⇒ the filing shape is unchanged");
  assert.notEqual(written[0].status, "needs-human");
});

test("ROUTINE (rate window) — the blocked reading reaches the human channel even when the DISPATCH budget is exhausted", async () => {
  // MEASURED (2026-09-25, this task's first real production round): the 24h dispatch rate window was
  // already saturated (3 filings — 2 of them freshness-refresh's own, 1 from `semantic-dedup-scan`),
  // so a `blocked` reading was recorded while EVERY escalation was starved to zero. The reading
  // changed nothing. The escalation channel is therefore bounded by its own rule (one open
  // escalation per subject while the reading is unchanged), ⛔ not by the dispatch window.
  const root = makeWorkspace({ label: "rate" });
  const uncovered = {
    ...FRESHNESS_FINDING, id: "freshness-other", subject: "GOAL-009-AC-999",
    producer: "some-other-producer", symbols: ["some-other-producer"],
  };
  const { written } = await runRoutine(root, {
    probeRun: DENIED, nowMs: { value: Date.parse("2026-09-25T06:00:00Z") },
    findings: [FRESHNESS_FINDING, uncovered],
    extra: { filingRate: 0 }, // the dispatch budget is exhausted by construction
  });
  assert.equal(written.length, 1, "exactly one task — the escalation");
  assert.equal(written[0].taskId.includes("freshness-stale-goal-009-ac-207"), true);
  assert.equal(written[0].status, "needs-human");
  const filing = readCarrier(root).find((r) => r.kind === "filing-round");
  assert.deepEqual(filing.escalated, [written[0].taskId]);
  // the reverse arm in the SAME round: a finding whose producer the reading does NOT gate is still
  // subject to the dispatch window (⛔ the exemption is scoped to the human channel, not a hole)
  const other = filing.rejected.find((x) => x.findingId === "freshness-other");
  assert.ok(other, `the uncovered producer must still be dispatch-throttled: ${JSON.stringify(filing.rejected)}`);
  assert.match(other.reason, /^rate:/);
});

// ── the SHAPE that actually happened: the subject's symbol key is held by a `done` task ───────────
//
// MEASURED (2026-09-25, `.quay/routine-findings.jsonl` line 974, runId
// `freshness-refresh-1790308195712`, task gap-ac214-eighth-crossing-done-key-permanently-suppresses-…):
// the two subjects that were over the freshness margin (AC-238/239) had their symbol key supplied by
// a `status: done` routine task, and `boardKeys()` was status-BLIND ⇒ `gateEscalation` rejected them
// `dedup: an equivalent finding is already on the board (matched key: symbols:goal-009-ac-238,
// upgrade-face)` in EVERY round through 790 consecutive failures. The escalation channel built one
// crossing earlier (this file's parent task) therefore never reached them. The fixture below is that
// shape in ONE workspace: a prior task holding the subject's symbol key, `status:` the only variable.

/** The prior task's body = the DISPATCHABLE routine shape (it carries the `- 观测符号：` bullet the
 *  board reader keys on). Its key must equal the CANDIDATE's key or the fixture proves nothing. */
function seedPriorTask(root, status) {
  const body = renderRoutineTaskBody({ ...FRESHNESS_FINDING }, {
    routine: "freshness-refresh", probe: "freshness-refresh", runId: "prior", carrier: ".quay/routine-findings.jsonl",
    ts: "2026-09-25T05:00:00Z", taskId: "gap-routine-prior",
  });
  assert.match(body, /- 观测符号：`coldstart-face`/, "the seed must carry the symbol key the candidate keys on");
  fs.writeFileSync(path.join(root, "tasks", "gap-routine-prior.md"),
    `---\nid: gap-routine-prior\ntitle: prior\nstatus: ${status}\n---\n${body}\n`, "utf8");
}

test("ROUTINE (a DONE task already holds the subject's symbol key) — the escalation is NOT swallowed", async () => {
  const root = makeWorkspace({ label: "closed-key" });
  seedPriorTask(root, "done");
  const { facts, written } = await runRoutine(root, { probeRun: DENIED, nowMs: { value: Date.parse("2026-09-25T06:00:00Z") } });

  assert.equal(facts[0].state, "verified", facts[0].reason);
  assert.equal(written.length, 1, "⛔ a FINISHED task's key must not swallow the escalation — this is the crossing this closes");
  assert.equal(written[0].status, "needs-human");
  assert.match(written[0].body, /remedy-availability：`blocked` · subject：`GOAL-009-AC-207`/, "the verbatim remedy must still reach the human channel");

  const filing = readCarrier(root).find((r) => r.kind === "filing-round");
  assert.deepEqual(filing.escalated, [written[0].taskId]);
  assert.equal(filing.rejected.some((x) => String(x.reason).startsWith("dedup:")), false,
    "no `dedup:` rejection for that subject — the done key must not be a blocking项");
  // the acceptance's dedup reading is on the CARRIER (⛔ not only in prose): an acceptance that
  // matched a closed key and one that matched nothing must not look alike
  const reading = filing.dedup_state.find((d) => d.findingId === FRESHNESS_FINDING.id);
  assert.ok(reading, `the accepted filing must carry its dedup reading: ${JSON.stringify(filing.dedup_state)}`);
  assert.equal(reading.state, "done-only");
  assert.equal(reading.accepted, true);
  assert.match(reading.matchedKey, /^symbols:/);
  assert.match(reading.reason, /CLOSED task/);
});

test("ROUTINE (the SAME board with the prior task OPEN) — the escalation IS dedup-rejected (reverse control)", async () => {
  const root = makeWorkspace({ label: "live-key" });
  seedPriorTask(root, "ready"); // the ONLY difference from the test above
  const { written } = await runRoutine(root, { probeRun: DENIED, nowMs: { value: Date.parse("2026-09-25T06:00:00Z") } });

  assert.equal(written.length, 0, "⛔ an OPEN equivalent still blocks — the fix is not 「把 dedup 关掉」");
  const filing = readCarrier(root).find((r) => r.kind === "filing-round");
  const reject = filing.rejected.find((x) => x.findingId === FRESHNESS_FINDING.id);
  assert.ok(reject, `the open-key arm must reject: ${JSON.stringify(filing.rejected)}`);
  assert.match(reject.reason, /^dedup:/);
  const reading = filing.dedup_state.find((d) => d.findingId === FRESHNESS_FINDING.id);
  assert.equal(reading.state, "live");
  assert.equal(reading.accepted, false);
});

test("BOARD READER — the escalation marker is re-readable from the board, and a normal task is NOT one", () => {
  const dir = makeTmpDir("remedy-board-");
  const subject = "GOAL-009-AC-207";
  fs.writeFileSync(path.join(dir, "esc.md"),
    `---\nid: esc\n---\n## Finding\n- remedy-availability：\`blocked\` · subject：\`${subject}\` · host-execution-probe：\`host-b-ssh\`\n`, "utf8");
  fs.writeFileSync(path.join(dir, "normal.md"), "---\nid: normal\n---\n## Finding\nordinary body\n", "utf8");
  const map = escalationMarkerByKey(dir);
  assert.deepEqual([...map.keys()], [`subject:${subject}`]);
  assert.equal(map.get(`subject:${subject}`), "esc.md");

  // and the RENDERER emits exactly what the reader reads (one grammar, ⛔ not two)
  const body = renderRoutineTaskBody(
    { ...FRESHNESS_FINDING, id: "x" },
    { routine: "freshness-refresh", probe: "freshness-refresh", runId: "r1", carrier: ".quay/routine-findings.jsonl", ts: "t", taskId: "gap-routine-x" },
    { blocked: { probeId: "host-b-ssh", observed: "Permission denied (publickey,password).", remedy: DECL.remedy, producerCommand: PRODUCER_CMD } },
  );
  const dir2 = makeTmpDir("remedy-board-rendered-");
  fs.writeFileSync(path.join(dir2, "rendered.md"), body, "utf8");
  assert.deepEqual([...escalationMarkerByKey(dir2).keys()], [`subject:${subject}`],
    "the rendered escalation body must round-trip through the board reader byte-for-byte");

  // escalationKey falls back deterministically when the probe reported no subject
  assert.equal(escalationKey({ ...FRESHNESS_FINDING, id: "x" }), "subject:GOAL-009-AC-207");
  assert.equal(escalationKey({ ...FRESHNESS_FINDING, id: "x", subject: null }), "producer:coldstart-face");
  assert.equal(escalationKey({ ...FRESHNESS_FINDING, id: "fid", subject: null, producer: null }), "finding:fid");
});

test("ROUTINE (unreadable execution probe) — `not-evaluated` files as before AND is visible (⛔ no silent 'fine')", async () => {
  const root = makeWorkspace({ label: "noteval" });
  const { written } = await runRoutine(root, {
    probeRun: { status: null, error: { message: "spawn ssh ENOENT" } },
    nowMs: { value: Date.parse("2026-09-25T06:00:00Z") },
  });
  const scan = readCarrier(root).find((r) => r.kind === "scan-round");
  assert.equal(scan.remedy_availability.status, "not-evaluated");
  assert.equal(scan.remedy_availability.evaluated, false);
  assert.notEqual(scan.remedy_availability.status, "executable", "⛔ 'could not look' must not read as 'looked and it is fine'");
  assert.notEqual(scan.remedy_availability.status, "blocked", "⛔ nor as 'blocked'");
  assert.equal(written.length, 1, "the declared fail-open direction: an unreadable reading does not stop filing");
  assert.notEqual(written[0].status, "needs-human");
});
