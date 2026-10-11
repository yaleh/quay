#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/release-reading-sandbox.ts
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { appendFileSync, mkdirSync } from "node:fs";
import { spawnSync as spawnSync2 } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/git-runner.ts
import { spawnSync } from "node:child_process";
function git(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function nonEmptyLines(s) {
  return s.split("\n").map((x) => x.trim()).filter((x) => x.length > 0);
}
function revParseSha(root, revision) {
  const r = git(root, ["rev-parse", "--verify", "--quiet", revision]);
  if (r.status !== 0) return null;
  const sha = r.stdout.trim();
  return sha.length > 0 ? sha : null;
}
function enumerateReleaseRefs(root) {
  const r = git(root, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/release-*",
    "refs/heads/release/*"
  ]);
  if (r.status !== 0) return null;
  return nonEmptyLines(r.stdout).sort();
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/release-reading-sandbox.ts
var RELEASE_BRANCH_RE = /^release[\/-]/;
function shapeOf(branch) {
  return RELEASE_BRANCH_RE.test(branch) ? "release-branch" : "non-release-branch";
}
function jsonEscape(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function utcStamp(d = /* @__PURE__ */ new Date()) {
  return d.toISOString().replace(/\.\d+Z$/, "Z").replace(/[:]/g, "");
}
function buildSandbox(root, sha, branch) {
  const dir = mkdtempSync(join(tmpdir(), "release-reading-sandbox-"));
  try {
    const init = git(dir, ["init", "-q"]);
    if (init.status !== 0) {
      return { error: `git init failed in ${dir} (exit ${init.status}): ${init.stderr.trim()}` };
    }
    const fetch = git(dir, ["fetch", "-q", "--no-tags", root, sha]);
    if (fetch.status !== 0) {
      return {
        error: `could not fetch ${sha} from ${root} into the sandbox (exit ${fetch.status}): ${fetch.stderr.trim()} => the reading cannot be taken on a real object`
      };
    }
    const fetched = revParseSha(dir, "FETCH_HEAD^{commit}");
    if (fetched === null) {
      return { error: `the sandbox fetched ${sha} but FETCH_HEAD does not resolve to a commit` };
    }
    const co = git(dir, ["checkout", "-q", "-b", branch, fetched]);
    if (co.status !== 0) {
      return {
        error: `could not create branch ${JSON.stringify(branch)} at ${fetched.slice(0, 12)} in the sandbox (exit ${co.status}): ${co.stderr.trim()}`
      };
    }
    const sym = git(dir, ["symbolic-ref", "--short", "HEAD"]);
    const headBranch = sym.status === 0 && sym.stdout.trim().length > 0 ? sym.stdout.trim() : null;
    if (headBranch !== branch) {
      return {
        error: `the sandbox was created at ${dir} but its HEAD is ${JSON.stringify(headBranch)}, not ${JSON.stringify(branch)} \u2014 the reading would be about a branch that is not the one asked for`
      };
    }
    return { sandbox: { dir, branch, sha: fetched, headBranch } };
  } catch (e) {
    return { error: `building the sandbox failed: ${e?.message ?? String(e)}` };
  }
}
function takeReading(root, sandboxDir) {
  const resolver = join(root, "scripts", "resolve-version.ts");
  const r = spawnSync2(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", resolver, "--mode", "build", "--root", sandboxDir, "--json"],
    { encoding: "utf8" }
  );
  const exit = r.status ?? -1;
  const stdout = (r.stdout ?? "").trim();
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = null;
  }
  return {
    exit,
    version: typeof parsed?.version === "string" ? parsed.version : "",
    base: typeof parsed?.base === "string" ? parsed.base : "",
    evaluated: parsed?.evaluated === true,
    reason: typeof parsed?.reason === "string" ? parsed.reason : (r.stderr ?? "").trim(),
    parsed
  };
}
function traceAppend(file, line) {
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch (e) {
    return { ok: false, error: `could not create ${dirname(file)}: ${e?.message ?? String(e)}` };
  }
  const body = `{"ts":"${jsonEscape(line.ts)}","branch":"${jsonEscape(line.branch)}","sha":"${jsonEscape(line.sha)}","shape":"${jsonEscape(line.shape)}","version":"${jsonEscape(line.version)}","result":"${jsonEscape(line.result)}","exit":${line.exit}}`;
  try {
    appendFileSync(file, `${body}
`, "utf8");
  } catch (e) {
    return { ok: false, error: `could not append to ${file}: ${e?.message ?? String(e)}` };
  }
  return { ok: true };
}
function logMode(traceFile) {
  if (!existsSync(traceFile)) {
    process.stderr.write(
      `CAUSE=release-reading-trace-missing \u2014 no reading record at '${traceFile}': no reading has ever been recorded here. This is "never happened" \u2014 \u26D4 NOT the same as "happened and recorded nothing" (hard rule 3b/9)
`
    );
    return 4;
  }
  let text;
  try {
    if (!statSync(traceFile).isFile()) throw new Error("not a regular file");
    text = readFileSync(traceFile, "utf8");
  } catch (e) {
    process.stderr.write(
      `CAUSE=release-reading-trace-unreadable \u2014 '${traceFile}' exists but cannot be read (${e?.message ?? String(e)}); refusing to report "no reading recorded" for a record that could not be looked at (hard rule 3b)
`
    );
    return 5;
  }
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  for (const raw of lines) {
    let rec = null;
    try {
      rec = JSON.parse(raw);
    } catch {
      process.stdout.write(`  <unparseable record line: ${raw.slice(0, 120)}>
`);
      continue;
    }
    process.stdout.write(
      `${rec.ts ?? "-"}  ${rec.branch ?? "-"}  shape=${rec.shape ?? "-"}  version=${rec.version === "" ? "(none)" : rec.version ?? "-"}  result=${rec.result ?? "-"}  sha=${String(rec.sha ?? "-").slice(0, 12)}  exit=${rec.exit ?? "-"}
`
    );
  }
  process.stdout.write(`trace: ${lines.length} record(s) in ${traceFile}
`);
  return 0;
}
var usage = "usage: node --experimental-strip-types plugin/scripts/release-reading-sandbox.ts [--root <repo>] [--rev <rev>] [--branch <name>] [--trace <file>] [--json] [--keep]\n       node --experimental-strip-types plugin/scripts/release-reading-sandbox.ts --log [--trace <file>] [--root <repo>]";
function main(argv) {
  let root = process.cwd();
  let rev = "HEAD";
  let branch = "";
  let traceFile = "";
  let jsonMode = false;
  let keep = false;
  let log = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = resolve(argv[++i] ?? "");
    else if (a === "--rev") rev = argv[++i] ?? "";
    else if (a === "--branch") branch = argv[++i] ?? "";
    else if (a === "--trace") traceFile = resolve(argv[++i] ?? "");
    else if (a === "--json") jsonMode = true;
    else if (a === "--keep") keep = true;
    else if (a === "--log") log = true;
    else if (a === "-h" || a === "--help") {
      process.stdout.write(`${usage}
`);
      return 0;
    } else {
      process.stderr.write(`release-reading-sandbox: unknown arg: ${a}
${usage}
`);
      return 2;
    }
  }
  if (traceFile === "") traceFile = join(root, ".quay", "release-reading-sandbox.jsonl");
  if (log) return logMode(traceFile);
  if (rev === "") {
    process.stderr.write(`release-reading-sandbox: --rev requires a revision
${usage}
`);
    return 2;
  }
  if (branch === "") branch = `release/reading-${utcStamp()}`;
  const before = enumerateReleaseRefs(root);
  if (before === null) {
    process.stderr.write(
      `CAUSE=release-reading-source-unreadable \u2014 could not enumerate refs/heads/release-* in '${root}' (not a git repo, or git unavailable); "could not look" is \u26D4 not "none there"
`
    );
    return 2;
  }
  const sha = revParseSha(root, `${rev}^{commit}`);
  if (sha === null) {
    process.stderr.write(
      `CAUSE=release-reading-rev-unresolvable \u2014 '${rev}' does not resolve to a commit in '${root}'; there is nothing to take a reading of
`
    );
    return 2;
  }
  const built = buildSandbox(root, sha, branch);
  if (!built.sandbox) {
    process.stderr.write(`CAUSE=release-reading-sandbox-failed \u2014 ${built.error}
`);
    return 2;
  }
  const sb = built.sandbox;
  let reading;
  let removed = false;
  try {
    reading = takeReading(root, sb.dir);
  } finally {
    if (!keep) {
      try {
        rmSync(sb.dir, { recursive: true, force: true });
        removed = !existsSync(sb.dir);
      } catch {
        removed = false;
      }
    }
  }
  const after = enumerateReleaseRefs(root);
  const shape = shapeOf(branch);
  const result = reading.exit === 3 ? "not-evaluated" : reading.exit === 0 ? "taken" : "reading-error";
  const recorded = traceAppend(traceFile, {
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    branch,
    sha: sb.sha,
    shape,
    version: reading.version,
    result,
    exit: reading.exit
  });
  if (jsonMode) {
    process.stdout.write(
      `${JSON.stringify({
        evaluated: reading.evaluated,
        branch,
        sha: sb.sha,
        shape,
        version: reading.version,
        reading: reading.parsed,
        readingExit: reading.exit,
        sourceReleaseRefsBefore: before,
        sourceReleaseRefsAfter: after,
        sandbox: sb.dir,
        sandboxRemoved: removed,
        trace: traceFile,
        recorded: recorded.ok,
        traceError: recorded.ok ? null : recorded.error ?? null
      })}
`
    );
  } else {
    process.stdout.write(
      `release-reading-sandbox: source release refs BEFORE = ${before.length}${before.length ? ` [${before.join(", ")}]` : ""}
`
    );
    process.stdout.write(
      `release-reading-sandbox: sandbox=${sb.dir} (isolated git dir; the source repo holds no ref of it)
`
    );
    process.stdout.write(
      `release-reading-sandbox: branch=${branch} sha=${sb.sha} shape=${shape}
`
    );
    if (reading.evaluated) {
      process.stdout.write(
        `release-reading-sandbox: version=${reading.version} mode=build base=${reading.base} (${reading.reason})
`
      );
    } else {
      process.stdout.write(
        `release-reading-sandbox: NOT-EVALUATED (resolve-version exit ${reading.exit}): ${reading.reason}
`
      );
    }
    process.stdout.write(
      `release-reading-sandbox: source release refs AFTER = ${after === null ? "UNREADABLE" : after.length}${after && after.length ? ` [${after.join(", ")}]` : ""}
`
    );
    process.stdout.write(
      `release-reading-sandbox: sandbox ${removed ? "removed" : keep ? "KEPT (--keep)" : "NOT removed"}
`
    );
    process.stdout.write(
      `release-reading-sandbox: ${recorded.ok ? "recorded" : `NOT recorded (${recorded.error})`} \u2192 ${traceFile}
`
    );
  }
  if (!recorded.ok) {
    process.stderr.write(
      `CAUSE=release-reading-trace-write-failed \u2014 the reading above was taken, but it left no record in '${traceFile}' (hard rule 9)
`
    );
    return 2;
  }
  if (reading.exit === 0) return 0;
  if (reading.exit === 3) return 3;
  return 1;
}
process.exit(main(process.argv.slice(2)));
