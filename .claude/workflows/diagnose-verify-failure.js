export const meta = {
  name: 'diagnose-verify-failure',
  description: 'Diagnose execute-milestone Verify phase failures: parse workflow journal, classify failures, auto-fix mechanical ones (stale-directive, hash-mismatch), delegate complex failures to a single LLM agent. DIR-073/M154, 2026-07-25.',
  phases: [
    { title: 'RunDiagnostic', detail: 'Run diagnose-verify-failure.ts script — classify + auto-fix mechanical failures' },
    { title: 'DiagnoseComplex', detail: 'ONE agent call: structured diagnosis for unfixable failures (only if any)' },
  ],
}

// ── Phase: RunDiagnostic ───────────────────────────────────────────────────────────────
// Runs the TypeScript diagnostic script in a single agent call (shell invocation).
// The agent extracts Verify check results from the execute-milestone workflow journal,
// writes them as a temp JSON file, runs diagnose-verify-failure.ts, and returns
// the DiagnosticResult.
phase('RunDiagnostic')

const runResult = await agent(
  `Run the verify failure diagnostic for the charter at ${args.charterFile || '<missing charter>'}.

You have ONE job: extract Verify check results from the most recent execute-milestone workflow run, then run the diagnostic script.

## Step 1: Find the workflow journal
Read the execute-milestone workflow journal from the most recent run. The journal is maintained by the Claude Code harness — check the workflow history for the last execute-milestone run. Extract the Verify phase check results.

The check results must be an array of objects with shape: {check, ok, detail, source}
- check: "ceiling-check" | "gate-hash" | "line-budget" | "domain-misfit" | "dogfood-evidence"
- ok: boolean (true = pass, false = fail)
- detail: string (stdout or error message)
- source: "script" (run by mechanical-checks agent) | "agent" (LLM judgment)

The execute-milestone workflow logs Verify results as a JSON array in its return value's \`verifyJournal\` field or in the log output. Look for the log line containing \`"Verify phase" \` and parse the JSON array from it. Look for \`"verifyJournal":\` in any JSON output.

## Step 2: Write results to temp file
Write the extracted check results as a JSON array to a temp file: /tmp/diagnose-verify-results-<timestamp>.json

## Step 3: Run the diagnostic script
Run: \`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.ts --results /tmp/diagnose-verify-results-<timestamp>.json --charter ${args.charterFile || ''} --workspace-root ${args.workspaceRoot || '.'} --json\`

Parse the stdout JSON as DiagnosticResult.

## Step 4: Return
Return the complete DiagnosticResult:
\`\`\`
{
  autoFixed: [{check, action, recheckPass}],
  unfixable: [{check, classification, detail}],
  retryReady: boolean
}
\`\`\`

If you cannot find any journal (no prior execute-milestone run), return {autoFixed: [], unfixable: [], retryReady: false, error: "no journal found"}.
If the diagnostic script exits with code 3 (nothing to fix), return {autoFixed: [], unfixable: [], retryReady: true}.`,
  {
    phase: 'RunDiagnostic',
    schema: {
      type: 'object',
      required: ['autoFixed', 'unfixable', 'retryReady'],
      properties: {
        autoFixed: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              check: { type: 'string' },
              action: { type: 'string' },
              recheckPass: { type: 'boolean' },
            },
          },
        },
        unfixable: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              check: { type: 'string' },
              classification: { type: 'string' },
              detail: { type: 'string' },
            },
          },
        },
        retryReady: { type: 'boolean' },
        error: { type: 'string' },
      },
    },
  },
)

log(`Diagnostic script complete: autoFixed=${runResult?.autoFixed?.length || 0}, unfixable=${runResult?.unfixable?.length || 0}, retryReady=${runResult?.retryReady}`)

// ── Phase: DiagnoseComplex ─────────────────────────────────────────────────────────────
// Only runs when there are unfixable failures that need LLM judgment.
const unfixable = runResult?.unfixable || [];
let diagnoses = [];

if (unfixable.length > 0) {
  phase('DiagnoseComplex')

  const complexResult = await agent(
    `Diagnose complex Verify failures that could not be auto-fixed. You receive structured failure data and must produce actionable diagnoses.

Unfixable failures:
${JSON.stringify(unfixable, null, 2)}

Charter file: ${args.charterFile || '<not provided>'}

For EACH unfixable failure, produce a structured diagnosis:
- **check**: which check failed
- **diagnosis**: what specifically is wrong (1-3 sentences, concrete)
- **fixable**: true | false — can the loop fix this autonomously, or does it need human intervention?
- **suggestedAction**: what to do next (1 sentence)

Return {diagnoses: [{check, diagnosis, fixable, suggestedAction}]}.

Guidelines:
- line-budget-exceeded: typically needs scope reduction or a phase/stage plan → human intervention (fixable: false)
- domain-misfit: the Done-when list may have items not covered by inherited-core.md methodology — analyze whether it's a genuine gap or a misclassification
- dogfood-evidence-gap: iteration reports lack pasted evidence near claimed-met clauses — suggests the build agent didn't paste evidence, OR the report is incomplete
- unknown: anything not in the known classification taxonomy`,
    {
      phase: 'DiagnoseComplex',
      schema: {
        type: 'object',
        required: ['diagnoses'],
        properties: {
          diagnoses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                check: { type: 'string' },
                diagnosis: { type: 'string' },
                fixable: { type: 'boolean' },
                suggestedAction: { type: 'string' },
              },
            },
          },
        },
      },
    },
  )

  diagnoses = complexResult?.diagnoses || [];
  log(`Complex diagnosis complete: ${diagnoses.length} failures diagnosed.`);
}

// ── Return ─────────────────────────────────────────────────────────────────────────────
const allFixable = (diagnoses || []).every(d => d.fixable !== false);
const retryReady = runResult?.retryReady || (allFixable && (runResult?.autoFixed || []).every(a => a.recheckPass));

return {
  autoFixed: runResult?.autoFixed || [],
  diagnoses: diagnoses || [],
  retryReady,
};
