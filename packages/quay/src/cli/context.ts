// cli/context.ts — the per-invocation context passed to each command handler
// by bin/quay.ts's dispatch. Migrated by gap-cli-import-command-migration-into-src
// so command handlers can live in src/cli/*.ts (import-callable, zero process
// derivation) while bin/quay.ts stays a thin argv→run→exit shell.
//
// The dispatch destructures `const [cmd, sub, ...rest] = argv` and pre-computes
// `{ flags, positional } = parseFlags(rest)` plus the --format/--json
// normalization (`wantsJson`). Command handlers receive those computed values
// plus the raw argv/sub/rest (verb-less commands and init/migrate/manager/run
// re-parse from [sub, ...rest] exactly as they did inside bin/quay.ts).

import type { CliFlags } from "./shared.ts";

export interface CliCtx {
  /** the full command line as dispatch received it — `[cmd, sub, ...rest]` */
  argv: string[];
  /** the second token (verb-less commands keep their task id here) */
  sub: string | undefined;
  /** tokens after sub */
  rest: string[];
  /** `parseFlags(rest)` — flags after sub (pre-dispatch --json validation applied) */
  flags: CliFlags;
  /** `parseFlags(rest).positional` */
  positional: string[];
  /** --json / --format json normalization result (null --format already errored) */
  wantsJson: boolean;
}
