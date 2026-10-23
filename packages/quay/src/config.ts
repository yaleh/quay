// config.ts — FORWARDING re-export (tasks/gap-src-root-gate-cycle-break).
//
// The implementation moved DOWN to `core/config.ts`: `gate/**` used to import this src-ROOT file
// (`gate → ""`), while the src root imports gate (`"" → gate`) — together one directory-level SCC.
// Everything below the gate layer now lives in `core/`, and this path stays as the supported import
// surface for every historical consumer (tests, plugin/scripts, quay-native, docs probes).
//
// ⛔ Do not re-add implementation here: a `core/` module may not import this file, and a body kept
// here would put the src root back in the gate cycle the move removed.
export * from "./core/config.ts";

// The DECLARED release-branch model (`release:` section) — named explicitly so its supported
// import surface is visible here rather than buried in the `export *` above. The bodies live in
// `core/config.ts` (see the ⛔ above); this line only forwards them.
export {
  readReleaseConfig,
  parseReleaseConfig,
  RELEASE_CONFIG_DEFAULTS,
  RELEASE_ADVANCE_VALUES,
  type ReleaseConfig,
  type ReleaseAdvance,
  type ReleaseConfigResolution,
} from "./core/config.ts";
