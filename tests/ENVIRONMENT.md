# TASK-002 validation environment

The selected runtime is official stable Zotero **10.0.7** on Linux, at
`/tmp/reference-relationships-runtime/Zotero_linux-x86_64/zotero`.
Node 22, native `zip`/`unzip`, and real `xvfb-run` are available. No npm
dependencies are required.

## Pending input

The user chose to publish the prepared production `updates.json` manually on
GitHub. The actual repository and HTTPS raw-file URL are pending. The parent
owns the production manifest and publication file; this harness does not edit
either. The reviewed update file contains only the production addon ID and an
empty `updates` list. No public controller metadata is required.

Builds require the production manifest to contain the actual HTTPS URL. The
integration runner copies the test controller into each disposable session and
sets its mandatory secure manifest URL to the same production URL. Automatic
extension updates are disabled in that test profile. The controller is a test
driver, not a separately distributed addon: the `updates-empty` gate invokes
the real `AddonUpdateChecker` only for the installed production addon.

## Validation state

- Initial tests failed before build/session implementation with
  `ERR_MODULE_NOT_FOUND`.
- The parent executed the expanded Node suite: **16 tests passed**, including rejection of missing/non-HTTPS update configuration. Final syntax/documentation/size lint passed for **9 files** after the runtime assertion refinement.
- The real runtime first rejected a controller missing the required update URL.
- A subsequent real runtime registered the data-URI controller but marked it
  `appDisabled`; its run ended at the bounded 120-second timeout. Evidence is
  retained at `/tmp/reference-relationships-integration-bn8qhY/`.
- The HTTPS session-provisioning helpers are covered by the passing Node tests; the production-only real update assertion and all actual lifecycle checks still require an actual hosted URL and a successful native run. The latest current build fails explicitly because the production manifest has no update_url. Do not retry the native run until the endpoint resolves; runtime lifecycle success has not been claimed.

After the parent configures and verifies the actual endpoint, run from the
plugin directory:

```sh
npm test
npm run lint
npm run build
ZOTERO_BIN=/tmp/reference-relationships-runtime/Zotero_linux-x86_64/zotero npm run test:integration
```

Each integration invocation builds a fresh production-only XPI in `/tmp`, uses
new dedicated profile and data directories with explicit `-datadir`, and retains
its process log and JSON result. The required result checks remain `isolation`,
`updates-empty`, `startup`, `disable`, `reenable`, `window-open`, `window-close`,
and `uninstall`; the returned runtime version must be exactly `10.0.7`.
