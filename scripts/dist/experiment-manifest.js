#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/experiment-manifest.ts
import fs2 from "node:fs";
import os from "node:os";
import path3 from "node:path";
import crypto from "node:crypto";
import { spawnSync as spawnSync2 } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/gate-script-base.ts
import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}
function git(args, cwd) {
  try {
    const stdout = execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf8", timeout: 1e4 }).trim();
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: "", error: e.message };
  }
}

// packages/quay/src/kernel/write-json-atomic.ts
import fs from "node:fs";
import path2 from "node:path";
import { randomBytes } from "node:crypto";
function writeJsonAtomic(p, value) {
  fs.mkdirSync(path2.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/experiment-manifest.ts
var EXPERIMENT_STATE_REL = path3.join(".quay", "experiments");
function experimentStateDir(root, experiment) {
  return path3.join(root, EXPERIMENT_STATE_REL, experiment);
}
function manifestFile(stateDir) {
  return path3.join(stateDir, "manifest.json");
}
function checkpointsFile(stateDir) {
  return path3.join(stateDir, "checkpoints.json");
}
function invalidationsFile(stateDir) {
  return path3.join(stateDir, "invalidations.json");
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}
function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
function computePolicyHash(config) {
  return sha256Hex(canonicalJson(config ?? null));
}
function computeIdentity(opts) {
  return {
    commit: opts.commit ?? null,
    host: opts.host ?? null,
    policyHash: computePolicyHash(opts.config ?? null)
  };
}
function identityMismatch(was, now) {
  const diffs = [];
  if (was.commit !== now.commit) diffs.push(`commit ${fmt(was.commit)} -> ${fmt(now.commit)}`);
  if (was.host !== now.host) diffs.push(`host ${fmt(was.host)} -> ${fmt(now.host)}`);
  if (was.policyHash !== now.policyHash) diffs.push(`policy ${was.policyHash.slice(0, 12)} -> ${now.policyHash.slice(0, 12)}`);
  return diffs.length === 0 ? null : diffs.join("; ");
}
function fmt(v) {
  return v === null ? "(none)" : v;
}
function computeStageInputsHash(manifest, stage) {
  return sha256Hex(canonicalJson({ inputs: manifest.inputs, stage: stage.inputs, id: stage.id }));
}
function readManifest(stateDir) {
  const res = readJson(manifestFile(stateDir));
  return { manifest: res.readable ? res.value : null, exists: res.exists, readable: res.readable, error: res.error };
}
function readCheckpoints(stateDir) {
  const res = readJson(checkpointsFile(stateDir));
  if (!res.exists) return { records: [], exists: false, readable: true, error: null };
  if (!res.readable) return { records: [], exists: true, readable: false, error: res.error };
  const records = Array.isArray(res.value?.records) ? res.value.records : [];
  return { records, exists: true, readable: true, error: null };
}
function readJson(file) {
  let text;
  try {
    text = fs2.readFileSync(file, "utf8");
  } catch (e) {
    const err = e;
    if (err?.code === "ENOENT") return { value: null, exists: false, readable: true, error: null };
    return { value: null, exists: true, readable: false, error: err?.code ?? String(e) };
  }
  try {
    return { value: JSON.parse(text), exists: true, readable: true, error: null };
  } catch (e) {
    return { value: null, exists: true, readable: false, error: `parse: ${e.message}` };
  }
}
function writeManifest(stateDir, manifest) {
  writeJsonAtomic(manifestFile(stateDir), manifest);
}
function writeCheckpoint(stateDir, checkpoint) {
  const current = readCheckpoints(stateDir);
  const records = current.records.filter((r) => r.stageId !== checkpoint.stageId);
  records.push(checkpoint);
  records.sort((a, b) => a.stageId < b.stageId ? -1 : a.stageId > b.stageId ? 1 : 0);
  writeJsonAtomic(checkpointsFile(stateDir), { records });
}
function readInvalidations(stateDir) {
  const res = readJson(invalidationsFile(stateDir));
  if (!res.readable) return [];
  return Array.isArray(res.value?.records) ? res.value.records : [];
}
function recordInvalidation(stateDir, record) {
  const records = readInvalidations(stateDir);
  records.push(record);
  writeJsonAtomic(invalidationsFile(stateDir), { records });
}
function smokeGate(manifest, checkpoints, identity) {
  const byId = /* @__PURE__ */ new Map();
  for (const r of checkpoints.records) byId.set(r.stageId, r);
  const smokeStages = manifest.stages.filter((s) => s.kind === "smoke");
  let satisfied = false;
  let reason = null;
  for (const s of smokeStages) {
    const cp = byId.get(s.id);
    if (!cp || !checkpoints.readable) continue;
    if (computeStageInputsHash(manifest, s) !== cp.inputsHash) continue;
    if (identityMismatch(cp.identity, identity) !== null) continue;
    if (cp.outputs.verdict === "pass") {
      satisfied = true;
      break;
    }
    reason = `smoke stage ${s.id} completed with verdict fail${cp.outputs.note ? ` (${cp.outputs.note})` : ""}`;
  }
  const required = smokeStages.length > 0;
  if (required && !satisfied && reason === null) {
    reason = `no passing smoke stage yet (${smokeStages.map((s) => s.id).join(", ")})`;
  }
  return { required, satisfied, reason };
}
function planResume(opts) {
  const { manifest, checkpoints, identity } = opts;
  const byId = /* @__PURE__ */ new Map();
  for (const r of checkpoints.records) byId.set(r.stageId, r);
  const smoke = smokeGate(manifest, checkpoints, identity);
  const entries = [];
  const run = [];
  const skip = [];
  const invalidated = [];
  const blocked = [];
  for (const stage of manifest.stages) {
    const cp = byId.get(stage.id) ?? null;
    const push = (disposition, reason) => {
      entries.push({ stageId: stage.id, kind: stage.kind, disposition, reason });
    };
    if (checkpoints.exists && !checkpoints.readable) {
      const reason = `checkpoints-unreadable: ${checkpoints.error ?? "unknown"}`;
      invalidated.push({ stageId: stage.id, reason, checkpoint: cp });
      run.push(stage.id);
      push("invalidated", reason);
      continue;
    }
    if (cp === null) {
      run.push(stage.id);
      if (stage.kind === "full" && smoke.required && !smoke.satisfied) {
        blocked.push({ stageId: stage.id, reason: smoke.reason ?? "smoke-not-passed" });
        push("blocked", smoke.reason);
      } else {
        push("run", "no checkpoint");
      }
      continue;
    }
    const inputsHash = computeStageInputsHash(manifest, stage);
    if (cp.inputsHash !== inputsHash) {
      const reason = `inputs-changed: ${cp.inputsHash.slice(0, 12)} -> ${inputsHash.slice(0, 12)}`;
      invalidated.push({ stageId: stage.id, reason, checkpoint: cp });
      run.push(stage.id);
      push("invalidated", reason);
      continue;
    }
    const mismatch = identityMismatch(cp.identity, identity);
    if (mismatch !== null) {
      const reason = `identity-changed: ${mismatch}`;
      invalidated.push({ stageId: stage.id, reason, checkpoint: cp });
      run.push(stage.id);
      push("invalidated", reason);
      continue;
    }
    skip.push(stage.id);
    push("skip", "checkpoint trusted (inputs + identity match)");
  }
  return {
    entries,
    run,
    skip,
    invalidated,
    blocked,
    checkpointsReadable: checkpoints.readable,
    smoke
  };
}
function runStages(opts) {
  const { manifest, stateDir, identity, execute } = opts;
  const nowMs = opts.nowMs ?? (() => Date.now());
  const plan = planResume({ manifest, checkpoints: readCheckpoints(stateDir), identity });
  for (const inv of plan.invalidated) {
    const stage = manifest.stages.find((s) => s.id === inv.stageId);
    recordInvalidation(stateDir, {
      stageId: inv.stageId,
      reason: inv.reason,
      wasInputsHash: inv.checkpoint?.inputsHash ?? null,
      wasIdentity: inv.checkpoint?.identity ?? null,
      nowInputsHash: stage ? computeStageInputsHash(manifest, stage) : "",
      nowIdentity: identity,
      at: new Date(nowMs()).toISOString()
    });
  }
  const ran = [];
  const blocked = [];
  for (const stage of manifest.stages) {
    if (!plan.run.includes(stage.id)) continue;
    if (stage.kind === "full") {
      const gate = smokeGate(manifest, readCheckpoints(stateDir), identity);
      if (gate.required && !gate.satisfied) {
        blocked.push({ stageId: stage.id, reason: gate.reason ?? "smoke-not-passed" });
        continue;
      }
    }
    const startedMs = nowMs();
    const outputs = execute(stage, { manifest, stateDir });
    const completedAt = new Date(nowMs()).toISOString();
    writeCheckpoint(stateDir, {
      stageId: stage.id,
      inputsHash: computeStageInputsHash(manifest, stage),
      identity,
      outputs: { ...outputs, wallMs: outputs.wallMs > 0 ? outputs.wallMs : nowMs() - startedMs },
      completedAt
    });
    ran.push(stage.id);
  }
  return {
    ran,
    skipped: [...plan.skip],
    invalidated: plan.invalidated.map(({ stageId, reason }) => ({ stageId, reason })),
    blocked,
    // The FINAL gate reading, not the entry snapshot: after the walk the reader needs to know whether
    // the smoke stage the full stages depend on ended up passing (⛔ an entry snapshot would report
    // "not satisfied" for a pass that happened three lines later).
    smoke: smokeGate(manifest, readCheckpoints(stateDir), identity)
  };
}
function resolveCommit(root) {
  const r = git(["rev-parse", "HEAD"], root);
  if (!r.ok) return null;
  return r.stdout === "" ? null : r.stdout;
}
function resolveHost() {
  const h = os.hostname();
  return h && h.trim() !== "" ? h.trim() : null;
}
function spawnStageExecutor() {
  return (stage, ctx) => {
    const outDir = path3.isAbsolute(ctx.manifest.outputDir) ? ctx.manifest.outputDir : path3.resolve(ctx.stateDir, ctx.manifest.outputDir);
    fs2.mkdirSync(outDir, { recursive: true });
    const startedMs = Date.now();
    const r = spawnSync2(stage.command[0] ?? "", stage.command.slice(1), {
      cwd: outDir,
      stdio: "inherit",
      env: { ...process.env, QUAY_EXPERIMENT_STAGE: stage.id, QUAY_EXPERIMENT_OUT: outDir }
    });
    const wallMs = Date.now() - startedMs;
    let measured = null;
    if (stage.measurementFile) {
      const mf = path3.resolve(outDir, stage.measurementFile);
      try {
        measured = JSON.parse(fs2.readFileSync(mf, "utf8"));
      } catch {
        measured = null;
      }
    }
    const num = (k) => {
      const v = measured?.[k];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    const artifacts = stage.expectedArtifacts.map((a) => path3.resolve(outDir, a)).filter((a) => fs2.existsSync(a));
    return {
      artifacts,
      filesPlanned: num("files_planned"),
      oomKill: num("oom_kill"),
      peakRssBytes: num("peak_rss_bytes"),
      wallMs,
      verdict: r.status === 0 ? "pass" : "fail",
      note: r.status === 0 ? null : `command exited ${r.status ?? `signal ${r.signal}`}`
    };
  };
}
function main(argv) {
  const task = flagValue(argv, "--task") ?? null;
  const root = flagValue(argv, "--root") ?? process.cwd();
  const wantJson = argv.includes("--json");
  const wantRun = argv.includes("--run");
  if (!task) {
    process.stderr.write("experiment-manifest: --task <id> is required\n");
    return 2;
  }
  const stateDir = experimentStateDir(root, task);
  const res = readManifest(stateDir);
  if (!res.exists) {
    process.stderr.write(`experiment-manifest: no manifest at ${manifestFile(stateDir)} \u2014 this task declares no resumable experiment
`);
    return 3;
  }
  if (!res.readable || !res.manifest) {
    process.stderr.write(`experiment-manifest: manifest at ${manifestFile(stateDir)} is present but NOT READABLE (${res.error}) \u2014 refusing to plan a resume against it
`);
    return 3;
  }
  const manifest = res.manifest;
  const measureRoot = flagValue(argv, "--measure-root") ?? root;
  const identity = computeIdentity({
    commit: flagValue(argv, "--commit") ?? resolveCommit(measureRoot),
    host: flagValue(argv, "--host") ?? resolveHost(),
    config: manifest.config
  });
  const plan = planResume({ manifest, checkpoints: readCheckpoints(stateDir), identity });
  if (wantRun) {
    const report = runStages({ manifest, stateDir, identity, execute: spawnStageExecutor() });
    process.stdout.write(`${JSON.stringify({ identity, report }, null, 2)}
`);
    return report.blocked.length > 0 && report.ran.length === 0 ? 1 : 0;
  }
  if (wantJson) {
    process.stdout.write(`${JSON.stringify({ identity, plan }, null, 2)}
`);
  } else {
    process.stdout.write(`experiment-manifest: ${manifest.experiment} \u2014 identity commit=${fmt(identity.commit)} host=${fmt(identity.host)} policy=${identity.policyHash.slice(0, 12)}
`);
    for (const e of plan.entries) {
      process.stdout.write(`  [${e.disposition}] ${e.stageId} (${e.kind})${e.reason ? ` \u2014 ${e.reason}` : ""}
`);
    }
    process.stdout.write(`  => run ${plan.run.length} / skip ${plan.skip.length} / invalidated ${plan.invalidated.length} / blocked ${plan.blocked.length}
`);
  }
  return 0;
}
var ENTRY_BASE = "experiment-manifest";
if (isDirectEntry(import.meta, process.argv[1], ENTRY_BASE)) process.exit(main(process.argv.slice(2)));
export {
  ENTRY_BASE,
  EXPERIMENT_STATE_REL,
  canonicalJson,
  checkpointsFile,
  computeIdentity,
  computePolicyHash,
  computeStageInputsHash,
  experimentStateDir,
  identityMismatch,
  invalidationsFile,
  main,
  manifestFile,
  planResume,
  readCheckpoints,
  readInvalidations,
  readManifest,
  recordInvalidation,
  resolveCommit,
  resolveHost,
  runStages,
  sha256Hex,
  smokeGate,
  spawnStageExecutor,
  writeCheckpoint,
  writeManifest
};
