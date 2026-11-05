/** Check TypeScript source ownership, documentation and modularity after strict compiler validation. */
import { projectRoot } from './build.mts';
import { checkSources } from './source-check.mts';

/** Validate all shipped scripts, runtime sources and tests. @returns {Promise<void>} */
async function main() {
  console.log(`TypeScript ownership, documentation and size checked for ${await checkSources(projectRoot)} files`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
