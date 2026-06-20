---
summary: "AICS production-plus persona gate status and remediation plan"
title: "AICS Production-plus Persona Remediation"
---

# AICS Production-plus Persona Remediation

Date: 2026-06-16

This document records the current executable gate for "拟人化测试超过生产级" and
the next implementation plan. It is evidence-based: the current repository can
now run a local production-plus gate regression, but it still cannot claim real
business L3 completion without live Chrome/Playwright evidence from Dijie cloud
and the OpenClaw local app.

## Current Evidence

Implemented local assets:

- `scripts/aics-production-plus-persona.mjs`
- `scripts/persona/aics-persona-runner.mjs`
- `scripts/persona/aics-build-playwright-config.mjs`
- `scripts/persona/aics-playwright-persona.mjs`
- `scripts/persona/aics-selector-coverage.mjs`
- `scripts/persona/aics-production-plus-orchestrator.mjs`
- `scripts/persona/aics-final-manifest.mjs`
- `scripts/persona/aics-production-plus-gate-regression.mjs`
- `scripts/persona/aics-production-plus-readiness.mjs`
- `scripts/persona/aics-production-plus-completion-audit.mjs`
- `scripts/persona/evidence-schema.json`

Verified commands:

```bash
node scripts/run-vitest.mjs run --config test/vitest/vitest.tooling.config.ts test/scripts/aics-production-plus-persona.test.ts test/scripts/test-projects.test.ts
node scripts/persona/aics-final-manifest.mjs --run-id codex-manifest --out /private/tmp/aics-final-manifest.json
node scripts/persona/aics-build-playwright-config.mjs --out /private/tmp/aics-playwright-config-main-chat.json
node scripts/persona/aics-selector-coverage.mjs --out /private/tmp/aics-selector-coverage-main-chat.json --markdown /private/tmp/aics-selector-coverage-main-chat.md --strict
node scripts/persona/aics-production-plus-gate-regression.mjs
node scripts/persona/aics-production-plus-completion-audit.mjs --run-dir docs/aics-persona-runs/<runId> --out docs/aics-persona-runs/<runId>/completion-audit.json --markdown docs/aics-persona-runs/<runId>/completion-audit.md
node scripts/persona/aics-production-plus-orchestrator.mjs --api-seed --write-final-manifest /private/tmp/aics-orchestrator-main-chat/final-manifest.json --run-id codex-orchestrator-main-chat --output-dir /private/tmp/aics-orchestrator-main-chat
node scripts/aics-production-plus-persona.mjs --dry-run --run-id codex-dry-run-main-chat --output-dir /private/tmp/aics-persona-dry-run-main-chat
node scripts/persona/aics-production-plus-readiness.mjs --output-dir /private/tmp/aics-persona-readiness-main-chat --evidence /private/tmp/aics-persona-dry-run-main-chat/evidence.json
```

Current gate result:

- synthetic complete evidence with a valid PNG artifact can produce
  `production_plus_passed`.
- the config builder emits six standard personas and only env-backed
  credentials.
- the Playwright evidence collector supports page actions, screenshots,
  positive/negative assertions, persona-scoped API checks, and allowlisted id
  capture.
- the Playwright evidence collector writes redacted `console.ndjson` and
  `network-summary.ndjson` artifacts, records their row counts in `proof`, and
  keeps response bodies, bearer tokens, API keys, local paths, prompts, and user
  private data out of those artifacts.
- the orchestrator can run seed -> readiness -> config -> Playwright evidence ->
  final gate -> remediation in one command, and it stops at readiness when the
  real environment is missing.
- readiness inspects optional evidence instead of only checking that the file
  exists: invalid schema or a non-production-plus verdict blocks the run, while
  the readiness artifact only records schema error names and failed gate ids,
  not raw evidence content.
- `--production-plus-final` now treats CLI `--skip-preflight` as non-authoritative:
  final runs still execute readiness unless an internal test harness explicitly
  passes `allowProductionPlusSkipPreflight`. A fake Playwright pass path is test
  evidence only, not production evidence.
- the final manifest helper can generate the required coverage declaration from
  seed ids and validate placeholders/mismatches before the final run.
- the final Playwright config enforces a stable selector contract: every
  standard persona must include positive assertions, negative assertions, and
  at least one browser action backed by `data-testid`, `data-aics-persona`, or
  `data-aics-e2e`; final configs with text-only assertions, fragile CSS/action
  selectors, or `<placeholder>` ids are rejected before a production-plus run.
- the selector coverage audit extracts the final persona selectors, scans
  OpenClaw local UI, Dijie role marketplace vendor/admin UI, and the Dijie B2C
  storefront/user UI source roots, and produces JSON/Markdown
  missing-selector reports. Current source scan is covered:
  `required=19 covered=19 missing=0`.
- stable persona anchors now exist for vendor package creation/security,
  admin review/publish gate, storefront role detail/security projection, user
  execution/unauthorized gate, OpenClaw local operator/execution-token gate, and
  ledger/receivables cross-actor readback surfaces.
- the OpenClaw main chat gate is now stricter than a loose status flag:
  `openclawMainChat` must identify `path: main_chat`, a trusted source
  (`playwright` or `api_readback`), and either a passed selector/text assertion
  or a structured `provider-config-blocked` reason at stage `main_chat`.
- `openclawMainChat` is part of the evidence schema contract, so generated
  dry-run, self-check, browser-blocked, and final Playwright evidence must carry
  a structured main-chat object instead of relying on normalization.
- `modelTokenBilling` is part of the evidence schema contract: generated
  non-production evidence must carry `null`, while final Playwright evidence
  must carry an `api_readback` object with pricing, usage, cost, and
  `role_execution` attribution before the production-plus gate can pass.
- dry-run and fake-browser evidence remain `failed`.
- missing real environment remains readiness `blocked`.
- failed runs generate `evidence.json`, `remediation.md`, and `remediation.json`.
- `remediation.json` now carries a machine-readable `completionAudit` with
  objective, achieved/not-achieved status, proven gate ids, missing gate ids,
  and per-gate evidence/remediation. This keeps the improvement plan tied to
  the original production-plus objective instead of a softer local subset.
- `remediation.json` also carries a machine-readable `implementationPlan`
  grouped by runtime environment, persona coverage, readback traceability,
  artifact integrity, and OpenClaw local surfaces. Each group records the
  blocked gates and the next concrete remediation action.
- `remediation.md` now renders the full executable `Next Commands` sequence:
  endpoint readiness, final-manifest validation, then the `--seed-file`
  production-plus orchestrator run. The final command no longer uses
  scaffold-only `--api-seed`.
- `aics-production-plus-completion-audit.mjs` audits a completed run directory
  as a whole. It requires selector coverage, readiness, final Playwright config,
  raw persona evidence, retained screenshots/actions/console/network artifacts,
  top-level gate evidence, remediation contract, summary artifacts, and
  redacted-env artifact. Only `status=complete` can be used to claim the goal.
- the orchestrator now writes `completion-audit.json` and
  `completion-audit.md` automatically for every terminal stage. Failed stages
  keep an incomplete audit trail, and a passing gate without a complete run
  directory remains auditable as incomplete.
- final Playwright config carries the required readback IDs into raw persona
  evidence, and API captures can still supplement them. This lets
  `persona-evidence/persona-evidence.json` pass the production-plus gate
  independently instead of relying on the top-level runner to merge seed ids.
- readiness now has an explicit endpoint reachability mode. Final completion
  requires passed `DIJIE_CLOUD_BASE_URL reachable` and `OPENCLAW_LOCAL_URL
reachable` checks, while artifacts only expose field names, status codes, and
  reasons, never raw URLs or token values.
- blocked readiness Markdown now includes a `Next Commands` runbook and a
  `Secret Handling` section, so a failed preflight still produces a safe
  executable plan without leaking token values, private URLs, package bodies,
  prompt text, or user data.
- readiness JSON now includes machine-readable `blockedChecks` and
  `nextRequiredEnv`, so automation can identify the exact missing environment
  variables or endpoint probes without scraping Markdown.
- readiness now writes `env-template.sh` next to `readiness.json/md`. The
  template contains only env names and placeholders, so the next real-env run
  has a concrete shell checklist without copying token values, private URLs, or
  invalid input values into artifacts.
- final manifest artifacts are now part of the completion audit. The run
  directory must retain `resolved-seed.json`, `final-manifest.resolved.json`,
  and `final-manifest.validation.json`; the audit revalidates the manifest and
  compares its IDs and model-token billing declaration against raw persona
  evidence readback.
- run metadata is now part of the completion audit. `resolved-seed.json`,
  `final-manifest.resolved.json`, `run-metadata.validation.json`, raw persona
  evidence, and top-level gate evidence must share one `runId`; the validation
  artifact must be `status=valid`, and raw/top-level evidence must carry valid
  `startedAt` / `endedAt` timestamps. The audit markdown includes validation
  mismatch/error details so a reviewer can see which artifact broke run
  coherence without reopening the raw JSON. The top-level gate evidence must
  also start from the same raw evidence timestamp and end after raw evidence
  collection, so older gate output cannot be spliced onto fresh Playwright
  evidence.
- the orchestrator now fail-closes before readiness/Playwright with
  `run_metadata_invalid` when an input seed or final manifest explicitly
  declares a `runId` that does not match the current `--run-id`.
- screenshot artifacts now need PNG signature, IHDR, and non-zero dimensions.
  An 8-byte signature-only fake PNG fails the screenshot gate, and
  `proof.screenshotCount` must match the retained valid screenshot file count.
- `scripts/persona/aics-production-plus-completion-audit.mjs` now checks the
  `remediation_contract`: completion cannot be `complete` unless
  `completionAudit` is achieved, `implementationPlan` is complete, every group
  is covered, and no gate is left ungrouped.
- completion audit Markdown now renders object evidence as JSON instead of
  `[object Object]`, so run metadata mismatches and validation errors remain
  reviewable in the human-readable report.

Latest local verification on 2026-06-16:

- `node scripts/persona/aics-selector-coverage.mjs --out /private/tmp/aics-selector-coverage-main-chat.json --markdown /private/tmp/aics-selector-coverage-main-chat.md --strict`
  passed with `required=19 covered=19 missing=0`.
- `node scripts/run-vitest.mjs run --config test/vitest/vitest.tooling.config.ts test/scripts/aics-production-plus-persona.test.ts test/scripts/test-projects.test.ts --reporter=dot`
  passed: 2 files, 193 tests, including the `modelTokenBilling` evidence
  schema contract, JSON schema / runner required-field alignment, and
  completion audit remediation-contract / endpoint-readiness / final-manifest
  consistency / run-metadata fail-closed / screenshot-dimension / forced
  endpoint-probe / readiness runbook / machine-readable readiness summary /
  safe env-template / Markdown evidence-format checks.
- `node scripts/run-vitest.mjs run --config test/vitest/vitest.tooling.config.ts test/scripts/aics-production-plus-persona.test.ts --reporter=dot`
  passed: 1 file, 53 tests, including the stricter OpenClaw main chat evidence
  checks, required model Token billing field checks, readiness evidence verdict
  inspection, machine-readable completion audit artifacts, and the new run
  directory completion audit CLI/remediation-contract / endpoint-readiness /
  final-manifest consistency / run-metadata fail-closed / screenshot-dimension /
  forced endpoint-probe / readiness runbook / machine-readable readiness
  summary / safe env-template / Markdown evidence-format checks.
- `node scripts/persona/aics-production-plus-completion-audit.mjs --run-dir <synthetic-complete-run> --out <run>/audit.json --markdown <run>/audit.md`
  returned `status: complete` for a complete synthetic production-plus run
  directory.
- `node scripts/persona/aics-production-plus-completion-audit.mjs --run-dir <dry-run-output> --out <run>/audit.json --markdown <run>/audit.md`
  returned `status: incomplete` with missing selector/readiness/config/persona
  artifact/final gate/remediation checks. This is expected and proves dry-run
  output cannot be claimed as production-plus completion.
- `node scripts/persona/aics-production-plus-gate-regression.mjs` passed. The
  positive fixture now writes a real 1x1 PNG artifact, while the invalid-PNG
  negative fixture still writes only non-PNG bytes, so screenshot validation is
  tested without weakening the production gate.
- `node scripts/aics-production-plus-persona.mjs --dry-run --run-id codex-dry-run-model-schema --output-dir /private/tmp/aics-persona-dry-run-model-schema`
  failed by design and wrote remediation with `modelTokenBilling: null` and no
  schema errors. This is expected: dry-run evidence must not pass
  production-plus.
- `node scripts/persona/aics-production-plus-orchestrator.mjs --api-seed --write-final-manifest /private/tmp/aics-orchestrator-main-chat/final-manifest.json --run-id codex-orchestrator-main-chat --output-dir /private/tmp/aics-orchestrator-main-chat`
  stopped at `final_manifest_invalid` because the seed still contains
  placeholder ids. This is expected until a real cloud/local run captures
  fresh ids.
- `node scripts/persona/aics-production-plus-readiness.mjs --output-dir /private/tmp/aics-persona-readiness-model-schema --evidence /private/tmp/aics-persona-dry-run-model-schema/evidence.json`
  returned `blocked`, as expected without real cloud/local URLs, tokens,
  public key, and production evidence.
- `pnpm tsgo:test:ui` and `pnpm tsgo:core` passed in OpenClaw.
- Dijie B2C storefront checks passed:
  `yarn test:aics-persona` and `yarn tsc --noEmit`.
- Dijie role marketplace `bun run lint` passed with 7 warnings and 0 errors.
- Dijie role marketplace full `bunx tsc -p packages/vendor/tsconfig.json --noEmit`
  and `bunx tsc -p packages/admin/tsconfig.json --noEmit` are not usable as
  green evidence yet because both fail on broad existing repository type debt
  outside the persona selector changes, including generated Medusa route
  modules, `seller_context` request typing, admin hook response types, and tax
  region form typings.

This proves the gate will not pass weak evidence. It does not prove the AICS
business flow has passed L3.

## L3 Required Gates

The production-plus verdict requires all of these gates:

- `schema_v2`
- `real_browser_application`
- `screenshots`
- `standard_personas`
- `persona_positive_assertions`
- `persona_negative_assertions`
- `negative_api_cross_checks`
- `required_ids_readback`
- `security_no_leaks`
- `console_network_clean`: zero console errors, zero network 5xx, valid
  `console.ndjson` and `network-summary.ndjson`, row counts matching evidence
  proof, and no raw token/API key/local path leakage in those artifacts.
- `fresh_final_probes`
- `openclaw_main_chat_path`
- `model_token_billing_readback`: API 管理必须通过 Playwright/API readback
  证明模型输入/输出单价、执行后的 `apiConnections.metadata.metering` 读回、以及
  `byConsumer.role_execution` 的 Token 和 CNY 费用归属；final manifest 只能声明期望，
  不能单独作为生产证据。

The six standard personas are:

- `developer`
- `admin_reviewer`
- `buyer_storefront`
- `user_center`
- `openclaw_local_operator`
- `ledger_receivables_reader`

## Current Remediation From Dry Run

The current dry run fails by design and produces these required changes:

- Use real Chrome/Playwright against real `http(s)` Dijie/OpenClaw pages.
- Write valid PNG screenshots into `screenshots/`.
- Cover all six standard personas with independent contexts.
- Add persona-scoped positive assertions.
- Add persona-scoped negative assertions.
- Add negative API cross-checks for unauthorized and cross-actor behavior.
- Capture required ids from real readback: package, listing, review,
  entitlement, execution, audit, and ledger.
- Generate a fresh API seed per run.
- Add final probes for developer submit, admin publish, buyer authorization,
  cloud execution, local sync, local execution, audit upload, ledger readback,
  receivables readback, cross-actor negatives, API id capture, model pricing,
  model metering readback, usage attribution, and screenshots.
- Read back model Token billing evidence after OpenClaw local role execution:
  provider/model, input/output CNY-per-million pricing, token totals, CNY cost,
  and `role_execution` attribution.
- Add an independent OpenClaw main chat path verdict.

## Implementation Plan

Recommended real-environment entry:

```bash
node scripts/persona/aics-production-plus-orchestrator.mjs \
  --seed-file docs/aics-persona-runs/<runId>/api-seed.json \
  --production-plus-final \
  --probe-endpoints \
  --final-manifest docs/aics-persona-runs/<runId>/final-manifest.json \
  --base-url "$DIJIE_CLOUD_BASE_URL" \
  --openclaw-url "$OPENCLAW_LOCAL_URL" \
  --run-id <runId> \
  --output-dir docs/aics-persona-runs/<runId>
```

`--probe-endpoints` is mandatory for the final `--production-plus-final` run.
The orchestrator also forces endpoint probes whenever `productionPlusFinal` is
enabled, so omitting the flag cannot silently create an incomplete final run.
The completion audit requires passed `DIJIE_CLOUD_BASE_URL reachable` and
`OPENCLAW_LOCAL_URL reachable` checks; an environment-only readiness pass is not
enough to claim production-plus completion.

`--api-seed` is scaffold-only. It intentionally writes `ids: {}` and must fail
`--production-plus-final` manifest validation until real package/listing/review/
entitlement/execution/audit/ledger IDs have been read back from the actual
cloud and OpenClaw flow.

If readiness is blocked, the same output directory will contain
`readiness/readiness.md`, `evidence.json`, `remediation.md`, and
`remediation.json`; the readiness directory also writes `env-template.sh` with
only environment variable names and placeholders. Do not bypass that with
manually edited evidence. Use
`remediation.json.completionAudit.missingGateIds` as the authoritative list of
remaining production-plus gaps, and use
`remediation.json.implementationPlan.groups` as the executable improvement
plan for the next run.

Final manifest workflow:

```bash
node scripts/persona/aics-final-manifest.mjs \
  --seed docs/aics-persona-runs/<runId>/api-seed.json \
  --run-id <runId> \
  --out docs/aics-persona-runs/<runId>/final-manifest.json

node scripts/persona/aics-final-manifest.mjs \
  --validate \
  --seed docs/aics-persona-runs/<runId>/api-seed.json \
  --manifest docs/aics-persona-runs/<runId>/final-manifest.json
```

Generation can produce a scaffold with placeholder ids; validation must be
`valid` before a real production-plus verdict is trusted.

1. Connect the Playwright collector to real Dijie/OpenClaw pages.
   - Current status: runner exists and is covered with a fake Playwright runtime.
   - Current status: runner writes screenshots plus redacted console/network
     evidence artifacts for post-failure diagnosis.
   - Remaining work: run it against real `DIJIE_CLOUD_BASE_URL` and
     `OPENCLAW_LOCAL_URL`, then replace readiness scaffold selectors with stable
     production selectors.
   - Constraint: no raw bearer, token, prompt, package body, or user content in
     evidence.

2. Add API seed integration.
   - Reuse the real cloud/local bridge to create a fresh run id and ids.
   - Store only public or safe ids in `api-seed.json`.
   - Keep seed generation separate from the final verdict so a seed alone can
     never pass L3.

3. Stabilize UI selectors.
   - Current status: `--production-plus-final` rejects configs without stable
     `data-*` assertion selectors.
   - Current status: `scripts/persona/aics-selector-coverage.mjs` scans the
     local and cloud frontend source roots and fails in `--strict` mode when any
     selector is missing.
   - Current status: selector source coverage is now complete:
     `required=19 covered=19 missing=0`.
   - Current status: OpenClaw `/chat` has a stable `data-testid="main-chat"`
     anchor and the Playwright collector writes an independent
     `openclaw-main-chat.png` screenshot plus structured `openclawMainChat`
     evidence.
   - Remaining work: run real Playwright against live/local pages and prove the
     anchors render in the expected authenticated persona contexts without
     console errors, 5xx network responses, overlap, or stale-route mismatches.
   - Storefront/user center: prove role detail, authorization projection,
     execution detail, unauthorized gate, ledger readback, and receivables
     cross-actor gate render with seeded live ids.
   - Admin/reviewer: prove review console and unapproved listing gate render
     against the real review target.
   - OpenClaw local: prove local operator and execution-token gate render after
     role sync and local execution preflight.

4. Add negative UI/API probes.
   - Developer cannot submit partial/blocked package.
   - Anonymous buyer cannot authorize.
   - Buyer without entitlement cannot execute.
   - Vendor cannot read buyer execution or ledger.
   - Missing execution token, missing tool/skill/API binding, and missing
     provider config fail closed.

5. Promote readiness config to final config.
   - Readiness remains `blocked` until required URLs, tokens, public key, and
     local URL exist.
   - Final config must include a manifest declaring every final probe.
   - Current status: `--production-plus-final` already rejects configs that skip
     any required final-manifest coverage.

6. Connect release gate.
   - CI runs only schema/gate regression and dry-run fail-closed checks.
   - Local/pre-production runs execute the real browser/persona gate.
   - Release is blocked unless the latest real run has
     `production_plus_passed`.

## Non-goals

- Do not add real payment provider integration for this gate.
- Do not treat this gate as full SaaS/multi-tenant production readiness.
- Do not accept API-only, mock-only, screenshot-only, or manually edited
  evidence as L3 completion.
