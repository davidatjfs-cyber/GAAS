import { ensureStoreDutyBindingsTable } from '../../store-duty-bindings.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'store-duty-bindings', handler: 'service' });


let __storeDutyBindingsReady = false;

export async function ensureReady(pool) {
  if (__storeDutyBindingsReady) return;
  try {
    await ensureStoreDutyBindingsTable(pool);
    __storeDutyBindingsReady = true;
  } catch (e) {
    log.warn({ msg: 'store_duty_bindings_ensure_table_failed', err: e?.message || e });
  }
}

export async function listBindings(pool) {
  const rows = await pool.query(
    `SELECT id, username, store, access_level, is_primary_store,
            can_receive_ops, can_receive_performance, can_receive_food_safety, can_receive_approval,
            can_handle_ops, can_handle_food_safety, can_approve_hrms, can_view_employees,
            enabled, effective_from, effective_to, metadata, updated_at
       FROM store_duty_bindings
      ORDER BY enabled DESC, username ASC, is_primary_store DESC, store ASC, id ASC`
  );
  return rows.rows || [];
}

export async function upsertBinding(pool, body, tenantId) {
  const payload = body && typeof body === 'object' ? body : {};
  const username = String(payload.username || '').trim();
  const store = String(payload.store || '').trim();
  if (!username || !store) {
    const err = new Error('missing_username_or_store');
    err.code = 'missing_username_or_store';
    throw err;
  }
  const bool = (key) => Boolean(payload[key]);
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const tid = tenantId || 'default';
  const result = await pool.query(
    `INSERT INTO store_duty_bindings (
        username, store, access_level, is_primary_store,
        can_receive_ops, can_receive_performance, can_receive_food_safety, can_receive_approval,
        can_handle_ops, can_handle_food_safety, can_approve_hrms, can_view_employees,
        enabled, effective_from, effective_to, metadata, updated_at, tenant_id
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, NULLIF($14,'')::timestamptz, NULLIF($15,'')::timestamptz, $16::jsonb, now(), $17
      )
      ON CONFLICT (username, store, tenant_id) DO UPDATE SET
        access_level = EXCLUDED.access_level,
        is_primary_store = EXCLUDED.is_primary_store,
        can_receive_ops = EXCLUDED.can_receive_ops,
        can_receive_performance = EXCLUDED.can_receive_performance,
        can_receive_food_safety = EXCLUDED.can_receive_food_safety,
        can_receive_approval = EXCLUDED.can_receive_approval,
        can_handle_ops = EXCLUDED.can_handle_ops,
        can_handle_food_safety = EXCLUDED.can_handle_food_safety,
        can_approve_hrms = EXCLUDED.can_approve_hrms,
        can_view_employees = EXCLUDED.can_view_employees,
        enabled = EXCLUDED.enabled,
        effective_from = EXCLUDED.effective_from,
        effective_to = EXCLUDED.effective_to,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING *`,
    [
      username,
      store,
      String(payload.access_level || 'support').trim() || 'support',
      bool('is_primary_store'),
      bool('can_receive_ops'),
      bool('can_receive_performance'),
      bool('can_receive_food_safety'),
      bool('can_receive_approval'),
      bool('can_handle_ops'),
      bool('can_handle_food_safety'),
      bool('can_approve_hrms'),
      bool('can_view_employees'),
      payload.enabled !== false,
      String(payload.effective_from || '').trim(),
      String(payload.effective_to || '').trim(),
      JSON.stringify(metadata),
      tid,
    ]
  );
  if (bool('is_primary_store')) {
    await pool.query(
      `UPDATE store_duty_bindings
          SET is_primary_store = false, updated_at = now()
        WHERE lower(trim(username)) = lower(trim($1))
          AND lower(trim(store)) <> lower(trim($2))
          AND tenant_id = $3`,
      [username, store, tid]
    );
  }
  return result.rows?.[0] || null;
}

export async function deleteBinding(pool, id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    const err = new Error('invalid_id');
    err.code = 'invalid_id';
    throw err;
  }
  const result = await pool.query('DELETE FROM store_duty_bindings WHERE id = $1 RETURNING id', [numericId]);
  return result.rowCount > 0;
}
