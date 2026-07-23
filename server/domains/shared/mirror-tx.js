/**
 * hrms_state 镜像写入：通用事务原语（表权威 + state 镜像同事务）。
 */
import { SHARED_TABLES } from '@gaas/shared';

/**
 * @param {import('pg').Pool} pool
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withMirrorWriteTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} tenantId
 * @returns {Promise<{ key: string, current: object, exists: boolean }>}
 */
export async function readHrmsStateForUpdate(client, tenantId) {
  const key = String(tenantId || 'default');
  const r = await client.query(
    `SELECT data FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = $1 FOR UPDATE`,
    [key]
  );
  const current = r.rows?.[0]?.data && typeof r.rows[0].data === 'object' ? r.rows[0].data : {};
  return { key, current, exists: !!r.rows?.[0] };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} tenantId
 * @param {object} nextData
 */
export async function writeHrmsState(client, tenantId, nextData) {
  const key = String(tenantId || 'default');
  const payload = nextData && typeof nextData === 'object' ? nextData : {};
  const existsR = await client.query(`SELECT 1 FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = $1`, [key]);
  if (existsR.rows?.[0]) {
    await client.query(
      `UPDATE ${SHARED_TABLES.HRMS_STATE} SET data = $2::jsonb, updated_at = NOW() WHERE key = $1`,
      [key, JSON.stringify(payload)]
    );
  } else {
    await client.query(
      `INSERT INTO ${SHARED_TABLES.HRMS_STATE} (key, data, updated_at) VALUES ($1, $2::jsonb, NOW())`,
      [key, JSON.stringify(payload)]
    );
  }
}

/**
 * 将 patches 合并进 current（纯函数，与 index mergeSharedStateFields 内层一致）。
 * @param {object} current
 * @param {object} patches
 * @param {object} [arrayIdFields]
 */
export function mergeFieldsIntoState(current, patches, arrayIdFields = {}) {
  const base = current && typeof current === 'object' ? current : {};
  const next = { ...base };
  for (const [field, patchValue] of Object.entries(patches)) {
    if (Array.isArray(patchValue)) {
      const idSpec = arrayIdFields[field];
      const existing = Array.isArray(base[field]) ? base[field].slice() : [];
      if (idSpec) {
        const getKey = Array.isArray(idSpec)
          ? (item) => idSpec.map((k) => String(item?.[k] || '')).join('|')
          : (item) => String(item?.[idSpec] || '');
        const existingMap = new Map(existing.map((e) => [getKey(e), e]));
        for (const item of patchValue) {
          existingMap.set(getKey(item), item);
        }
        const patchKeys = new Set(patchValue.map(getKey));
        const retained = existing.filter((e) => !patchKeys.has(getKey(e)));
        next[field] = [...patchValue, ...retained];
      } else {
        next[field] = [...patchValue, ...existing];
      }
    } else if (patchValue && typeof patchValue === 'object' && !Array.isArray(patchValue)) {
      next[field] = {
        ...(base[field] && typeof base[field] === 'object' ? base[field] : {}),
        ...patchValue,
      };
    } else {
      next[field] = patchValue;
    }
  }
  return next;
}

/**
 * 顶层字段浅合并写入（FOR UPDATE 内）。
 * @param {import('pg').PoolClient} client
 * @param {string} tenantId
 * @param {object} patchObject
 */
export async function patchHrmsStateFieldsOnClient(client, tenantId, patchObject) {
  if (!patchObject || typeof patchObject !== 'object' || !Object.keys(patchObject).length) {
    const { current } = await readHrmsStateForUpdate(client, tenantId);
    return current;
  }
  const { current } = await readHrmsStateForUpdate(client, tenantId);
  const next = { ...current, ...patchObject };
  await writeHrmsState(client, tenantId, next);
  return next;
}

/**
 * 数组/对象字段合并写入（FOR UPDATE 内）。
 * @param {import('pg').PoolClient} client
 * @param {string} tenantId
 * @param {object} patches
 * @param {object} [arrayIdFields]
 */
export async function mergeStateFieldsOnClient(client, tenantId, patches, arrayIdFields = {}) {
  if (!patches || typeof patches !== 'object' || !Object.keys(patches).length) {
    const { current } = await readHrmsStateForUpdate(client, tenantId);
    return current;
  }
  const { current } = await readHrmsStateForUpdate(client, tenantId);
  const next = mergeFieldsIntoState(current, patches, arrayIdFields);
  await writeHrmsState(client, tenantId, next);
  return next;
}
