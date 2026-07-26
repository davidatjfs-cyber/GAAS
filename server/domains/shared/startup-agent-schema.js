/**
 * Listen-time agent pool wiring + schema ensure + legacy migration re-apply + agent schedulers
 * (Wave M5 peel from index.js app.listen).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { childLogger } from '../../utils/logger.js';
import {
  wireAgentPoolsOnStartup,
  runListenTimeSchemaEnsure,
  scheduleLlmHealthCheck,
  startAgentSubsystemsIfEnabled,
  runLegacyListenTimeMigrations,
  LISTEN_TIME_MIGRATION_SQL_NAMES,
  isAgentSchedulingDisabled,
} from './startup-agent-schema-helpers.js';

export { LISTEN_TIME_MIGRATION_SQL_NAMES, isAgentSchedulingDisabled };

const log = childLogger({ domain: 'shared', handler: 'startup-agent-schema' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../migrations');

export async function defaultReadMigrationSql(name) {
  return readFile(join(MIGRATIONS_DIR, `${name}.sql`), 'utf8');
}

/**
 * @param {object} deps
 */
export async function runStartupAgentSchemaBootstrap(deps) {
  const {
    runWithBootstrapTenantContext,
    allowSchemaChanges,
    env = process.env,
    ensureTenantRuntimeTables,
    ensureMasterTables,
    readMigrationSql = defaultReadMigrationSql,
  } = deps;

  if (allowSchemaChanges) {
    await runWithBootstrapTenantContext(async () => {
      await ensureTenantRuntimeTables();
    });
  }
  wireAgentPoolsOnStartup(deps);
  if (allowSchemaChanges) {
    await runWithBootstrapTenantContext(async () => {
      await ensureMasterTables();
    });
  }

  await runWithBootstrapTenantContext(async () => {
    await runListenTimeSchemaEnsure(deps, log);
  });

  scheduleLlmHealthCheck(deps.verifyLLMHealth, log);
  startAgentSubsystemsIfEnabled(deps, env, log);

  await runWithBootstrapTenantContext(async () => {
    await runLegacyListenTimeMigrations({ ...deps, readMigrationSql }, log);
  });
}
