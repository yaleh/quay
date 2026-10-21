// @test-group engine
// server-verifier-twin-helpers.test.mjs — the extraction that closes routine finding
// `server-verifier-twin-scripts` (routine `semantic-dedup-scan`, runId
// `semantic-dedup-scan-1792560001684`).
//
// THE FINDING. 216 of 491 non-comment lines in `server-partial-stop-verify.ts` reappeared verbatim in
// `server-restart-inflight-verify.ts`; five helper bodies were byte-identical and the sixth (`runCli`)
// differed only by its timeout literal. The two files are not copies of one script — they verify two
// different ACs — so the right disposition is EXTRACT the shared primitives, not merge the files.
//
// WHAT THIS FILE PINS — the extraction, in BOTH directions (硬规则 2 / 3b):
//   • the six helpers are DEFINED exactly once, in `gate-script-base.ts`;
//   • neither twin re-defines them, and each IMPORTS them from the base (the "extracted, not
//     deleted" half — a file that drops its copy without importing the shared one still links, so
//     the single-definition assertion alone would not notice);
//   • the shared bodies keep the ORIGINAL behavior, including the one place the copies disagreed:
//     the restart verifier's 300 s CLI budget vs the partial-stop verifier's 180 s default. A silent
//     unification would only show up as a real restart timing out on a busy host.
//
// The predicate used to scan sources is exercised on FIXTURES first (a defining source must read
// true, an importing source must read false) before it is run against the real files. A predicate
// that can only ever say "clean" proves nothing about them.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  cliArgv,
  isIsoInstant,
  out,
  readServerCarrier,
  resolveCliPath,
  runCli,
  SERVER_STATE_REL,
  sleep,
} from "../scripts/gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "..", "scripts");
const PARTIAL = "server-partial-stop-verify.ts";
const RESTART = "server-restart-inflight-verify.ts";
const BASE = "gate-script-base.ts";
const TWINS = [PARTIAL, RESTART];
/** The finding's own symbol list (it named `out` and `sleep` too, not just functions). */
const HELPERS = ["resolveCliPath", "readServerCarrier", "isIsoInstant", "out", "runCli", "sleep"];

function sourceOf(name) {
  return fs.readFileSync(path.join(SCRIPTS_DIR, name), "utf8");
}

/** Drop line/block comments (so a PROSE mention of a helper is never mistaken for a definition —
 *  硬规则 2: by position, not by keyword). String literals are kept; that is enough here. */
function codeOnly(src) {
  let outText = "";
  let i = 0;
  let inBlock = false;
  let inLine = false;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inBlock) {
      if (c === "*" && n === "/") {
        inBlock = false;
        i += 2;
      } else i++;
      continue;
    }
    if (inLine) {
      if (c === "\n") {
        inLine = false;
        outText += c;
      }
      i++;
      continue;
    }
    if (quote) {
      outText += c;
      if (c === "\\") {
        outText += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (c === "/" && n === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      outText += c;
      i++;
      continue;
    }
    outText += c;
    i++;
  }
  return outText;
}

/** Does this source DEFINE the helper? Structural (a declaration), never a keyword mention. */
function defines(src, name) {
  return new RegExp(`(?:^|[^\\w$])(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[<(]`).test(codeOnly(src));
}

/** Does this source take the helper FROM the shared base? A CALL-free import is inert, so the
 *  negative half asks for the import SPECIFIER, not merely the name. */
function importsFromBase(src, name) {
  const code = codeOnly(src);
  const spec = /import\s*\{([^}]*)\}\s*from\s*["']\.\/gate-script-base\.ts["']/.exec(code);
  if (!spec) return false;
  return spec[1].split(",").some((part) => part.trim().replace(/^type\s+/, "") === name);
}

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── the predicate, on fixtures (both arms) ──────────────────────────────────────────────────────────

test("predicate arm control: a defined helper reads TRUE, a commented mention and an import read FALSE", () => {
  assert.equal(defines("export function runCli(a) { return a; }\n", "runCli"), true);
  assert.equal(defines("function sleep(ms) {}\n", "sleep"), true);
  // 硬规则 2: a mention in prose is NOT a definition, even when it carries the keyword nearby.
  assert.equal(defines("// export function runCli(a) { return a; }\n", "runCli"), false);
  assert.equal(defines("/* function runCli() {} */\nconst x = 1;\n", "runCli"), false);
  // A DIFFERENT identifier that merely contains the name is not the name.
  assert.equal(defines("export function runCliArgv(a) { return a; }\n", "runCli"), false);
  // And the import half: importing is not defining either.
  assert.equal(defines('import { runCli } from "./gate-script-base.ts";\n', "runCli"), false);
  assert.equal(importsFromBase('import { runCli } from "./gate-script-base.ts";\n', "runCli"), true);
  assert.equal(importsFromBase('import { isDirectEntry } from "./gate-script-base.ts";\n', "runCli"), false);
  assert.equal(importsFromBase('import { runCli } from "./other.ts";\n', "runCli"), false);
});

// ── the finding's disposition: single definition, imported by both twins ────────────────────────────

test("all six twin helpers are DEFINED exactly once in the finding's closure — in gate-script-base.ts", () => {
  // The closure the finding named: the two twins plus the base that now holds the one definition.
  // ⛔ Deliberately NOT the whole plugin/scripts corpus: `runCli` is ALSO a name four unrelated
  // checkers use for a DIFFERENT function (argv[] ⇒ exit code), and `sleep` has a one-line namesake
  // in driver-runtime.ts. Those are other symbols, not copies of these bodies — asserting "one
  // definition in the repo" would be false and would make this ratchet un-passable rather than
  // informative. What the twins must not do is re-declare these helpers, and that is asserted both
  // here and in the next test; the body-level scan after it re-runs the finding's own predicate on
  // the two files it named.
  for (const name of HELPERS) {
    const defs = [BASE, ...TWINS].filter((f) => defines(sourceOf(f), name));
    assert.deepEqual(defs, [BASE], `${name} must be defined ONLY in ${BASE}; found in: ${defs.join(", ") || "none"}`);
  }
});

test("neither twin re-defines a helper, and each IMPORTS it from the base (extracted ≠ deleted)", () => {
  for (const file of TWINS) {
    const src = sourceOf(file);
    for (const name of HELPERS) {
      assert.equal(defines(src, name), false, `${file} still defines ${name}`);
      // `isIsoInstant` is consumed locally but ALSO re-exported for the module's own public
      // surface; it is imported in both cases.
      assert.equal(importsFromBase(src, name), true, `${file} does not import ${name} from the base`);
    }
  }
});

test("the finding's own predicate re-run: the pre-extraction copies are gone from BOTH twins", () => {
  // The exact bodies the finding called byte-identical, as they appeared in each twin's private copy.
  // Scope: the two files the finding named (the disposition it asked for is "these two stop carrying
  // the same body"). Other namesakes exist in the repo and are NOT copies of these bodies — see the
  // note in the previous test; recording them here is what keeps this assertion honest.
  const bodies = [
    "return typeof v === \"string\" && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}/.test(v);",
    "return new Promise((r) => setTimeout(r, ms));",
    "const stripTypes = cli.endsWith(\".ts\") ? [\"--experimental-strip-types\"] : [];",
    "if (!j || !Array.isArray(j.services) || !Number.isInteger(j.pid)) return null;",
    ".filter(([, v]) => typeof v !== \"object\")",
  ];
  for (const body of bodies) {
    for (const file of TWINS) {
      assert.equal(
        codeOnly(sourceOf(file)).includes(body),
        false,
        `${file} still carries a copy of body "${body.slice(0, 50)}…"`,
      );
    }
    assert.equal(codeOnly(sourceOf(BASE)).includes(body), true, `${BASE} lost the shared body "${body.slice(0, 50)}…"`);
  }
});

// ── behavior: the extraction changed no reading ─────────────────────────────────────────────────────

test("isIsoInstant: ISO-8601 instants YES, everything else NO", () => {
  assert.equal(isIsoInstant("2026-09-13T17:00:00.000Z"), true);
  assert.equal(isIsoInstant("2026-09-13T17:00:00"), true);
  assert.equal(isIsoInstant("2026-09-13T17:00:00+08:00"), true);
  assert.equal(isIsoInstant("2026-09-13"), false);
  assert.equal(isIsoInstant("not-a-date"), false);
  assert.equal(isIsoInstant(1757782800000), false);
  assert.equal(isIsoInstant(null), false);
  assert.equal(isIsoInstant(undefined), false);
});

test("sleep: resolves after the requested delay (Promise, never a throw)", async () => {
  const p = sleep(20);
  assert.equal(typeof p.then, "function");
  const started = Date.now();
  await p;
  // Lower bound only — an upper bound here would be a load-sensitive assertion (this repo has been
  // burned by those: a green suite on an idle host is not evidence about a loaded one).
  assert.ok(Date.now() - started >= 10, "sleep returned before its delay");
});

test("out: --json emits one pretty JSON document (parseable, exact value)", () => {
  const { text } = captureStdout(() => out(true, { ac: "A", verdict: "OK", readings: { k: 1 } }));
  assert.equal(text, JSON.stringify({ ac: "A", verdict: "OK", readings: { k: 1 } }, null, 2) + "\n");
  assert.deepEqual(JSON.parse(text), { ac: "A", verdict: "OK", readings: { k: 1 } });
});

test("out: non-json emits k=v scalars on ONE line, then one indented line per object field", () => {
  const { text } = captureStdout(() => out(false, { ac: "A", verdict: "OK", record_written: false, readings: { k: 1 } }));
  assert.equal(text, "ac=A verdict=OK record_written=false\n  readings: {\"k\":1}\n");
});

test("readServerCarrier: a well-formed carrier is returned as-is", () => {
  withTempDir("servercarrier-ok-", (dir) => {
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    const carrier = { pid: 4242, services: [{ name: "web", host: "127.0.0.1", port: 5000 }] };
    fs.writeFileSync(path.join(dir, SERVER_STATE_REL), JSON.stringify(carrier));
    assert.deepEqual(readServerCarrier(dir), carrier);
  });
});

test("readServerCarrier: absent / malformed / ill-shaped all read null (the copies' contract)", () => {
  withTempDir("servercarrier-bad-", (dir) => {
    assert.equal(readServerCarrier(dir), null, "absent carrier");
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    const p = path.join(dir, SERVER_STATE_REL);
    fs.writeFileSync(p, "{not json");
    assert.equal(readServerCarrier(dir), null, "unparseable carrier");
    fs.writeFileSync(p, JSON.stringify({ services: [] }));
    assert.equal(readServerCarrier(dir), null, "no integer pid");
    fs.writeFileSync(p, JSON.stringify({ pid: 1, services: "nope" }));
    assert.equal(readServerCarrier(dir), null, "services not an array");
  });
});

test("resolveCliPath: explicit wins only when it EXISTS; otherwise this checkout's bin/quay.ts", () => {
  withTempDir("resolvecli-", (dir) => {
    const explicit = path.join(dir, "explicit.js");
    fs.writeFileSync(explicit, "");
    assert.equal(resolveCliPath(explicit, dir), explicit);
    // An explicit path that does NOT exist is a USAGE outcome — it must NOT silently fall through to
    // the default (that would run a different CLI than the caller asked for).
    assert.equal(resolveCliPath(path.join(dir, "missing.js"), dir), null);

    assert.equal(resolveCliPath(undefined, dir), null, "no bin/quay.ts under a bare root");
    const devEntry = path.join(dir, "packages", "quay", "bin", "quay.ts");
    fs.mkdirSync(path.dirname(devEntry), { recursive: true });
    fs.writeFileSync(devEntry, "");
    assert.equal(resolveCliPath(undefined, dir), devEntry);
  });
});

test("cliArgv: a .ts entry gets --experimental-strip-types, a built .js entry does NOT", () => {
  const tsArgv = cliArgv("/x/quay.ts", ["server", "status"]);
  assert.deepEqual(tsArgv, [process.execPath, "--no-warnings", "--experimental-strip-types", "/x/quay.ts", "server", "status"]);
  const jsArgv = cliArgv("/x/quay.js", ["server", "status"]);
  assert.deepEqual(jsArgv, [process.execPath, "--no-warnings", "/x/quay.js", "server", "status"]);
});

test("runCli: executes the entry in cwd and reports exit/stdout/stderr + the argv actually used", () => {
  withTempDir("runcli-", (dir) => {
    const script = path.join(dir, "fixture.js");
    fs.writeFileSync(
      script,
      "process.stdout.write('out:' + process.argv.slice(2).join(','));\nprocess.stderr.write('err');\nprocess.exit(7);\n",
    );
    const r = runCli(script, ["a", "b"], dir);
    assert.equal(r.exit, 7);
    assert.equal(r.stdout, "out:a,b");
    assert.equal(r.stderr, "err");
    assert.deepEqual(r.argv, [process.execPath, "--no-warnings", script, "a", "b"]);
  });
});

// ── the one place the copies disagreed: preserved, not unified ──────────────────────────────────────

test("the restart verifier keeps its OWN 300 s CLI budget (the extraction did not unify it to 180 s)", () => {
  const code = codeOnly(sourceOf(RESTART));
  assert.match(code, /const RESTART_CLI_TIMEOUT_MS = 300000;/, "the restart verifier's 300 s budget is gone");
  // Every runCli call in this file must pass that budget. A zero count would make the assertion
  // vacuous, so the count is pinned too.
  const all = code.match(/\brunCli\(cli,/g) ?? [];
  const withBudget = code.match(/\brunCli\(cli,[^;]*?RESTART_CLI_TIMEOUT_MS\)/g) ?? [];
  assert.ok(all.length >= 1, "expected at least one runCli call in the restart verifier");
  assert.equal(withBudget.length, all.length, `${all.length - withBudget.length} runCli call(s) dropped the 300 s budget`);
});

test("the partial-stop verifier keeps the base's DEFAULT budget (no 4th argument)", () => {
  const code = codeOnly(sourceOf(PARTIAL));
  const all = code.match(/\brunCli\(cli,/g) ?? [];
  const withDefault = code.match(/\brunCli\(cli,\s*\[[^\]]*\],\s*root\)/g) ?? [];
  assert.ok(all.length >= 1, "expected at least one runCli call in the partial-stop verifier");
  assert.equal(withDefault.length, all.length, "a partial-stop runCli call changed its timeout budget");
});

// ── helper ────────────────────────────────────────────────────────────────────────────────────────

/** Capture everything written to stdout during `fn` (the emitters write through process.stdout). */
function captureStdout(fn) {
  const original = process.stdout.write;
  let text = "";
  process.stdout.write = (chunk) => {
    text += String(chunk);
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return { text };
}
