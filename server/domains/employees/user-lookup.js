/**
 * User/employee lookup helpers: state first, optional DB fallback.
 * Used by points/checkin/daily-reports DI, promotion recipients, inventory-forecast, etc.
 */
export function createUserLookupHelpers({ pool, expandAgentStoreLabels }) {
  function stateFindUserRecord(state, username) {
    const u = String(username || '').trim();
    if (!u) return null;
    const users = Array.isArray(state?.users) ? state.users : [];
    const employees = Array.isArray(state?.employees) ? state.employees : [];
    // employees first – real users live there
    const all = employees.concat(users);
    return all.find(x => String(x?.username || '').trim().toLowerCase() === u.toLowerCase()) || null;
  }

  async function dbFindEmployeeRecord(username) {
    const u = String(username || '').trim();
    if (!u) return null;
    try {
      const r = await pool.query(
        `select username, name, role, store, department, position, status,
                join_date as "joinDate", created_at as "createdAt",
                coalesce(extra_json, '{}'::jsonb) as "extraJson"
           from employees
          where lower(username) = lower($1)
          limit 1`,
        [u]
      );
      const row = r.rows?.[0];
      if (!row) return null;
      const ex = row.extraJson && typeof row.extraJson === 'object' ? row.extraJson : {};
      const { ...rest } = row;
      const levelFromExtra = ex.level != null && ex.level !== '' ? String(ex.level).trim() : '';
      return { ...rest, level: levelFromExtra || String(rest.level || '').trim() };
    } catch (_) {
      return null;
    }
  }

  async function dbListEmployeesForReports({ store, includeInactive, tenantId }) {
    try {
      const params = [];
      const where = [];
      if (store) {
        const storeLabels = [
          ...new Set(expandAgentStoreLabels(store).map((s) => String(s).trim()).filter(Boolean))
        ];
        if (storeLabels.length) {
          params.push(storeLabels);
          where.push(`trim(store) = ANY($${params.length}::text[])`);
        }
      }
      if (!includeInactive) {
        where.push(`coalesce(status, '') not in ('inactive', '离职')`);
      }
      params.push(String(tenantId || 'default'));
      where.push(`tenant_id = $${params.length}`);
      const sql = `select username, name, role, store, department, position, status,
                          join_date as "joinDate", created_at as "createdAt",
                          extra_json->>'offboardingDate' as "offboardingDate",
                          extra_json->>'offboardingApproved' as "offboardingApproved",
                          extra_json->>'resignedAt' as "resignedAt",
                          coalesce(extra_json->>'coreTalent', 'false')::boolean as "coreTalent",
                          nullif(trim(coalesce(extra_json->>'level', extra_json->>'jobLevel', '')), '') as level
                     from employees
                     ${where.length ? ('where ' + where.join(' and ')) : ''}
                    order by name asc, username asc`;
      const r = await pool.query(sql, params);
      return Array.isArray(r.rows) ? r.rows : [];
    } catch (_) {
      return [];
    }
  }

  async function stateOrDbFindUserRecord(state, username) {
    return stateFindUserRecord(state, username) || await dbFindEmployeeRecord(username);
  }

  function pickMyStoreFromState(state, username) {
    const me = stateFindUserRecord(state, username) || {};
    const st = String(me?.store || '').trim();
    return st;
  }

  return {
    stateFindUserRecord,
    dbFindEmployeeRecord,
    dbListEmployeesForReports,
    stateOrDbFindUserRecord,
    pickMyStoreFromState,
  };
}
