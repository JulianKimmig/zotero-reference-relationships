# Native validation environment

Use Node >=22, system zip/unzip, Xvfb and official Zotero 10.0.7 Linux x86_64. No npm dependencies are required. The test runtime is `/tmp/reference-relationships-runtime/Zotero_linux-x86_64/zotero`; application version comes from app/application.ini, not the executable's Mozilla --version output.

## Commands

From the plugin directory:

```sh
npm test
npm run lint
npm run build
ZOTERO_BIN=/tmp/reference-relationships-runtime/Zotero_linux-x86_64/zotero npm run test:integration
ZOTERO_BIN=/tmp/reference-relationships-runtime/Zotero_linux-x86_64/zotero npm run test:sync -- /absolute/test-config.json
ZOTERO_BIN=/tmp/reference-relationships-runtime/Zotero_linux-x86_64/zotero node scripts/sync/feasibility.mjs /absolute/test-config.json
ZOTERO_BIN=/tmp/reference-relationships-runtime/Zotero_linux-x86_64/zotero node scripts/sync/publication.mjs /absolute/test-config.json
ZOTERO_BIN=/tmp/reference-relationships-runtime/Zotero_linux-x86_64/zotero node scripts/sync/ui.mjs /absolute/test-config.json
ZOTERO_BIN=/tmp/reference-relationships-runtime/Zotero_linux-x86_64/zotero node scripts/sync/catalog.mjs /absolute/test-config.json
ZOTERO_BIN=/tmp/reference-relationships-runtime/Zotero_linux-x86_64/zotero node scripts/sync/rules.mjs /absolute/test-config.json
```

Build creates a fresh production-only XPI in /tmp; it refuses overwriting an existing output and rejects missing/non-HTTPS update URLs. The real configured endpoint is https://raw.githubusercontent.com/JulianKimmig/zotero-reference-relationships/main/updates.json, published manually by the user. No agent push is part of this workflow.

Integration copies a dedicated controller, assigns that actual HTTPS URL, then launches a new profile and separate data directory under Xvfb. The controller uses the real AddonUpdateChecker for the production addon; the controller is not a separately distributed addon. Automatic test-profile updates/sync and first-run browser/office installation are disabled; native update-security requirements remain intact.

Required checks: isolation, updates-empty, startup, disable, reenable, window-open, window-close, uninstall, shutdown-enabled. Window readiness uses actual native tree-load promises and the visible one of both pinned/unpinned library-tab DOM nodes. The result must report exact dedicated paths and Zotero 10.0.7. The runner also checks the flushed process log for the observed plugin late-unload race.

## Observed evidence

2026-11-05: final Node suite passed 20 tests; syntax/file documentation/module-size checks passed for 10 JavaScript files. Final native run `/tmp/reference-relationships-integration-chnD2u/` exited zero with all nine checks. Its artifact was `/tmp/reference-relationships-build-VrfGcG/reference-relationships.xpi` (SHA-256 bbe4514237d8e6de3b916f3362f1a16ab6be1fa9544873953fa6c9d9b69c138b).

Earlier native probes established that missing update_url prevents installation and data URLs are disabled by native security. A real late-unload callback after app shutdown reproduced a relationshipRuntime TypeError; the regression rejected the actual captured log before the idempotent source fix. Final run has no such error.

The final native log still includes core-window/tag-selector shutdown diagnostics. Attribution and broader GUI quality remain to investigate before full product acceptance; passing scaffold checks alone do not certify relationship editing, storage, sync or all GUI behavior. Parent execution evidence and task files own authoritative current gate records.

## Signed storage experiments

The sync commands require three existing dedicated profiles: A1/A2 signed into one test account and B1 into another, both members of a writable group, plus a second group read-only for B. Configuration is a JSON object with `groups: {writable, restricted}` holding positive server group IDs and `clients: {a1, a2, b1}` holding distinct absolute `profile` and `data` paths. Close interactive clients before running. Keep `sync.autoSync` disabled. Commands create labeled synthetic notes in these test libraries; they never read authentication files. Each job restores original user.js bytes and removes only its own launch hooks. Evidence is retained privately in `/tmp`.

The prerequisite checks actual cross-client arrival, changed values and native permission denial. Feasibility exercises the actual note editor, merge/Undo/Redo, standalone authority after endpoint erase, and restart retrieval. Publication stages incomplete generations and genuine offline forks, detects conflicts, resolves both heads, and forces a real transaction rollback using the restricted group. The pure model is shared unchanged by Node and native tests. These bounded experiments are distinct from the production repository conformance commands and evidence recorded in the parent system of record.

The UI runner builds and hashes the production XPI, initializes a new anonymous
profile without copying any existing profile or authentication, then exercises
native menu/picker, preview/cancel, creation/editing/navigation, rapid selection,
and restart/removal. A1 creates labeled restricted-group references; B1 syncs
and verifies read-only UI and application rejection without authority changes.
Existing signed personal relationship authority is preserved. Repeating this
command creates a separate anonymous UI fixture; retain both result directories
when validating the two-fixture journey requirement.

The catalog runner uses a separate fresh anonymous client to create custom type
and field definitions through actual native controls, persist all five metadata
kinds, rename/retire the referenced type, reject invalid/stale edits, restart and
review a destructive metadata migration. Signed B1 independently verifies real
read-only catalog controls and publication denial. It preserves existing signed
authority. The production package excludes both test controllers.

The rule runner uses a fresh anonymous client and a separate restart phase to
verify one-generation inverse publication, independent roots/manual support,
diamond routes and immutable-root conditions, conflicts/stale revisions, the
fixed 100000-transition limit using 1000 pairs of real endpoints, retraction,
retyping and native metadata ownership. It does not provide a rule editor.
The existing UI runner also holds a real host transaction during Save: direct
nested writes must reject, while the event command waits for its own transaction
and publishes only after the host transaction is released.

Publication writes `progress.json` after each successful native job and `result.json` only at full completion. Resume an interrupted suite with `node scripts/sync/publication.mjs /absolute/test-config.json --resume /absolute/evidence-root` only with the same fixture semantics and controller revision. A process crash after a mutation is a failed job even if its private result says success: inspect it and verify its saved keys after a clean restart before recording completion; do not blindly replay the mutation. Missing dependencies stay pending, multiple complete heads stay conflict, and malformed or unknown envelopes fail explicitly.

For first-account identity testing, create the `feasibility:identity-seed` fixture in a genuinely unsigned-in isolated profile. After user sign-in/sync and close, add this profile as `clients.prelogin`, then run `node scripts/sync/identity.mjs /absolute/test-config.json /absolute/prelogin-result.json /absolute/sync-gate-result.json` with `ZOTERO_BIN` set. The verifier checks the expected account, unchanged item/note keys and payload hash, changed local-to-account URI, and actual arrival on A2. Never copy another profile's authentication material to simulate this transition.

No separate submodule documentation tree is maintained. Repository architecture, contracts, workflow ownership and task progress are recorded in the parent's existing system of record.
