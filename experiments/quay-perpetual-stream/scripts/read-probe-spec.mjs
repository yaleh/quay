// read-probe-spec.mjs — DIR-056: load and validate a probe spec from
// ${pluginRoot}/probes/${name}.md. A probe spec is a Markdown file with YAML
// frontmatter that declares the instrument, fallback, output_routing, and an
// objective body (the agent prompt). This module is the SINGLE implementation;
// routine-scheduler.mjs imports it. Tests import it directly. No re-implementation
// elsewhere (ADR-004 single-source discipline).
//
// Fail-closed contract:
//   file not found           → throws Error("PROBE-SPEC FAIL-CLOSED: ...")
//   malformed YAML           → throws Error("PROBE-SPEC FAIL-CLOSED: ...")
//   missing `instrument`     → throws Error("PROBE-SPEC FAIL-CLOSED: ...")
//
// Returns: { instrument, fallback, output_routing, objective }

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

/**
 * Parse YAML frontmatter and body from a Markdown string.
 * Frontmatter is delimited by leading `---\n` ... `---\n` (standard).
 * Returns { frontmatter: object, body: string }.
 * Throws if frontmatter is malformed YAML.
 */
export function parseFrontmatter(text) {
  const s = String(text);
  // Frontmatter must start at column 0, line 1
  if (!s.startsWith("---\n") && !s.startsWith("---\r\n")) {
    return { frontmatter: {}, body: s.trim() };
  }
  const rest = s.slice(4); // skip opening "---\n"
  // Find closing "---" on its own line
  const closeMatch = rest.match(/^---\s*$/m);
  if (!closeMatch) {
    // No closing delimiter — treat entire content as body, no frontmatter
    return { frontmatter: {}, body: s.trim() };
  }
  const closeIdx = closeMatch.index;
  const yamlText = rest.slice(0, closeIdx);
  const body = rest.slice(closeIdx + closeMatch[0].length).replace(/^\r?\n/, "").trim();
  let frontmatter;
  try {
    frontmatter = YAML.parse(yamlText) ?? {};
  } catch (e) {
    throw new Error(`PROBE-SPEC FAIL-CLOSED: malformed YAML frontmatter — ${e.message}`);
  }
  if (typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    throw new Error(`PROBE-SPEC FAIL-CLOSED: frontmatter must be a YAML mapping, got ${typeof frontmatter}`);
  }
  return { frontmatter, body };
}

/**
 * Load and validate a probe spec by name.
 *
 * @param {string} name        — probe name (e.g. "self-validation")
 * @param {string} pluginRoot  — absolute path to the plugin root (contains probes/)
 * @returns {{ instrument: string, fallback: string, output_routing: object, objective: string }}
 * @throws Error("PROBE-SPEC FAIL-CLOSED: ...") on any validation failure
 */
export function readProbeSpec(name, pluginRoot) {
  if (!name || typeof name !== "string" || !name.trim()) {
    throw new Error(`PROBE-SPEC FAIL-CLOSED: probe name must be a non-empty string (got ${JSON.stringify(name)})`);
  }
  if (!pluginRoot || typeof pluginRoot !== "string") {
    throw new Error(`PROBE-SPEC FAIL-CLOSED: pluginRoot must be a non-empty string (got ${JSON.stringify(pluginRoot)})`);
  }

  const specPath = path.join(pluginRoot, "probes", `${name.trim()}.md`);

  // Fail-closed: file not found
  if (!fs.existsSync(specPath)) {
    throw new Error(`PROBE-SPEC FAIL-CLOSED: probe spec not found at ${specPath}`);
  }

  let text;
  try {
    text = fs.readFileSync(specPath, "utf8");
  } catch (e) {
    throw new Error(`PROBE-SPEC FAIL-CLOSED: could not read ${specPath} — ${e.message}`);
  }

  let frontmatter, body;
  try {
    ({ frontmatter, body } = parseFrontmatter(text));
  } catch (e) {
    // re-throw with PROBE-SPEC prefix if not already set
    if (e.message.startsWith("PROBE-SPEC FAIL-CLOSED:")) throw e;
    throw new Error(`PROBE-SPEC FAIL-CLOSED: ${e.message}`);
  }

  // Required: instrument field
  if (!("instrument" in frontmatter) || frontmatter.instrument === undefined || frontmatter.instrument === null) {
    throw new Error(`PROBE-SPEC FAIL-CLOSED: probe spec "${name}" missing required field 'instrument' in frontmatter`);
  }
  const instrument = String(frontmatter.instrument).trim();

  // Optional: fallback (default "none")
  const fallback = frontmatter.fallback !== undefined && frontmatter.fallback !== null
    ? String(frontmatter.fallback).trim()
    : "none";

  // Optional: output_routing (default { default: "milestone-candidate" })
  let output_routing = { default: "milestone-candidate" };
  if (frontmatter.output_routing !== undefined && frontmatter.output_routing !== null) {
    if (typeof frontmatter.output_routing !== "object" || Array.isArray(frontmatter.output_routing)) {
      throw new Error(`PROBE-SPEC FAIL-CLOSED: probe spec "${name}" field 'output_routing' must be a YAML mapping`);
    }
    output_routing = { ...output_routing, ...frontmatter.output_routing };
  }

  // body is the agent prompt (objective)
  const objective = body;

  return { instrument, fallback, output_routing, objective };
}
