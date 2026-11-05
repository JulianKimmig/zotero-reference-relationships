# Scaffold validation environment

Use Node >=22, system zip/unzip, Xvfb and official Zotero 10.0.7 Linux x86_64. No npm dependencies are required. The test runtime is `/tmp/reference-relationships-runtime/Zotero_linux-x86_64/zotero`; application version comes from app/application.ini, not the executable's Mozilla --version output.

## Commands

From the plugin directory:

```sh
npm test
npm run lint
npm run build
ZOTERO_BIN=/tmp/reference-relationships-runtime/Zotero_linux-x86_64/zotero npm run test:integration
```

Build creates a fresh production-only XPI in /tmp; it refuses overwriting an existing output and rejects missing/non-HTTPS update URLs. The real configured endpoint is https://raw.githubusercontent.com/JulianKimmig/zotero-reference-relationships/main/updates.json, published manually by the user. No agent push is part of this workflow.

Integration copies a dedicated controller, assigns that actual HTTPS URL, then launches a new profile and separate data directory under Xvfb. The controller uses the real AddonUpdateChecker for the production addon; the controller is not a separately distributed addon. Automatic test-profile updates/sync and first-run browser/office installation are disabled; native update-security requirements remain intact.

Required checks: isolation, updates-empty, startup, disable, reenable, window-open, window-close, uninstall, shutdown-enabled. Window readiness uses actual native tree-load promises and the visible one of both pinned/unpinned library-tab DOM nodes. The result must report exact dedicated paths and Zotero 10.0.7. The runner also checks the flushed process log for the observed plugin late-unload race.

## Observed evidence

2026-11-05: final Node suite passed 20 tests; syntax/file documentation/module-size checks passed for 10 JavaScript files. Final native run `/tmp/reference-relationships-integration-chnD2u/` exited zero with all nine checks. Its artifact was `/tmp/reference-relationships-build-VrfGcG/reference-relationships.xpi` (SHA-256 bbe4514237d8e6de3b916f3362f1a16ab6be1fa9544873953fa6c9d9b69c138b).

Earlier native probes established that missing update_url prevents installation and data URLs are disabled by native security. A real late-unload callback after app shutdown reproduced a relationshipRuntime TypeError; the regression rejected the actual captured log before the idempotent source fix. Final run has no such error.

The final native log still includes core-window/tag-selector shutdown diagnostics. Attribution and broader GUI quality remain to investigate before full product acceptance; passing scaffold checks do not certify the unfinished relationship editor, storage, sync or all GUI behavior. Parent execution evidence and TASK-002 own authoritative gate records. Test accounts/groups are not configured, so TASK-003 remains blocked.

No separate submodule documentation tree is maintained. Repository architecture, contracts, workflow ownership and task progress are recorded in the parent's existing system of record.
