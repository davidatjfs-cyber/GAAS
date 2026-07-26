/**
 * Turnover report — employee roster merge (state + DB + offboarding + employment_records).
 */
import { childLogger } from '../../utils/logger.js';
import {
  normalizeEmployeeDepartureDateForTurnover,
  employeeStoreMatchesTurnoverReportFilter,
  isEmployeeDepartedForTurnoverReport,
} from './helpers.js';

const log = childLogger({ domain: 'reports', handler: 'turnover-employees' });

export async function loadOffboardingDeparted(pool, month, tenantId, safeDateOnly) {
  const offDeparted = new Map();
  try {
    const obRes = await pool.query(
      `SELECT applicant_username, payload, status
       FROM approval_requests
       WHERE type = 'offboarding'
         AND status IN ('approved', 'pending')
         AND substring(COALESCE(
           payload->>'resignDate', payload->>'date', payload->>'resignationDate',
           created_at::text
         ), 1, 7) = $1
         AND tenant_id = $2
       ORDER BY created_at DESC`,
      [month, tenantId || 'default']
    );
    for (const ob of (obRes.rows || [])) {
      const p = typeof ob.payload === 'string' ? JSON.parse(ob.payload) : (ob.payload || {});
      const uname = String(ob.applicant_username || p?.username || p?.applicant || '').trim().toLowerCase();
      if (!uname || offDeparted.has(uname)) continue;
      const rd = safeDateOnly(p?.resignDate || p?.date || p?.resignationDate);
      const reason = String(p?.reason || '').trim();
      const depType = String(p?.departureType || '').trim();
      let isVoluntary = true;
      if (depType === 'involuntary' || depType === '被动') isVoluntary = false;
      else if (/劝退|辞退|裁员|开除|解雇|淘汰/.test(reason)) isVoluntary = false;
      offDeparted.set(uname, { resignDate: rd, reason, isVoluntary });
    }
  } catch (_) { /* ignore */ }
  return offDeparted;
}

export async function mergeTurnoverStoreEmployees(ctx, {
  state0,
  store,
  month,
  tenantId,
}) {
  const { dbListEmployeesForReports, expandAgentStoreLabels, pool, safeDateOnly } = ctx;

  let allEmployees = Array.isArray(state0.employees) ? state0.employees : [];
  const dbEmps = await dbListEmployeesForReports({
    store: store || '',
    includeInactive: true,
    tenantId: tenantId || 'default',
  });
  if (dbEmps.length) {
    const stateEmpByLower = new Map(allEmployees.map(e => [String(e?.username || '').trim().toLowerCase(), e]));
    const merged = [];
    const seen = new Set();
    for (const dbEmp of dbEmps) {
      const lower = String(dbEmp?.username || '').trim().toLowerCase();
      if (!lower || seen.has(lower)) continue;
      seen.add(lower);
      const stateEmp = stateEmpByLower.get(lower);
      if (stateEmp) {
        const lv =
          String(stateEmp?.level || '').trim() ||
          String(dbEmp?.level || '').trim();
        merged.push({
          ...dbEmp,
          ...stateEmp,
          status: String(stateEmp?.status || dbEmp?.status || ''),
          offboardingDate: stateEmp?.offboardingDate || dbEmp?.offboardingDate || '',
          offboardingApproved: stateEmp?.offboardingApproved ?? dbEmp?.offboardingApproved ?? dbEmp?.extra_json?.offboardingApproved ?? undefined,
          resignedAt: stateEmp?.resignedAt || dbEmp?.resignedAt || '',
          coreTalent: stateEmp?.coreTalent ?? dbEmp?.coreTalent ?? dbEmp?.extra_json?.coreTalent ?? false,
          level: lv
        });
      } else {
        merged.push(dbEmp);
      }
    }
    for (const e of allEmployees) {
      const lower = String(e?.username || '').trim().toLowerCase();
      if (!lower || seen.has(lower)) continue;
      seen.add(lower);
      merged.push(e);
    }
    allEmployees = merged;
  }

  const storeEmps = store
    ? allEmployees.filter((e) => employeeStoreMatchesTurnoverReportFilter(e?.store, store))
    : allEmployees;

  const offDeparted = await loadOffboardingDeparted(pool, month, tenantId, safeDateOnly);
  const empByLower = new Map(storeEmps.map(e => [String(e?.username || '').trim().toLowerCase(), e]));

  for (const [uname, info] of offDeparted) {
    if (!empByLower.has(uname)) {
      const stateEmp = Array.isArray(state0.employees) ? state0.employees.find(e => String(e?.username || '').toLowerCase() === uname) : null;
      const emp = stateEmp || {};
      emp.username = emp.username || uname;
      emp.name = emp.name || uname;
      emp.status = emp.status || '离职';
      emp.offboardingDate = emp.offboardingDate || info.resignDate || '';
      emp.resignedAt = emp.resignedAt || info.resignDate || '';
      storeEmps.push(emp);
      empByLower.set(uname, emp);
    }
  }

  try {
    const labels = store
      ? [...new Set(expandAgentStoreLabels(store).map((s) => String(s).trim()).filter(Boolean))]
      : [];
    const erParams = [month];
    let erSql = `
      SELECT DISTINCT ON (lower(trim(employee_username)))
        employee_username AS username,
        employee_name AS name,
        trim(store) AS store,
        position, department,
        action_date::text AS "actionDate",
        action_type
      FROM employment_records
      WHERE lower(trim(action_type)) IN ('resign', 'terminate', 'termination')
        AND (
          lower(trim(coalesce(status, ''))) = 'approved'
          OR trim(coalesce(status, '')) = ''
          OR status IS NULL
        )
        AND to_char(action_date, 'YYYY-MM') = $1`;
    if (labels.length) {
      erParams.push(labels);
      erSql += ` AND trim(store) = ANY($${erParams.length}::text[])`;
    }
    erParams.push(tenantId || 'default');
    erSql += ` AND tenant_id = $${erParams.length}`;
    erSql += ` ORDER BY lower(trim(employee_username)), action_date DESC`;
    const erRes = await pool.query(erSql, erParams);
    for (const row of erRes.rows || []) {
      const un = String(row.username || '').trim().toLowerCase();
      if (!un) continue;
      const synDate = normalizeEmployeeDepartureDateForTurnover({
        offboardingDate: row.actionDate,
        resignedAt: row.actionDate
      });
      if (!synDate || synDate < month + '-01' || synDate > month + '-31') continue;
      const existing = empByLower.get(un);
      if (existing) {
        if (!normalizeEmployeeDepartureDateForTurnover(existing)) {
          existing.offboardingDate = existing.offboardingDate || row.actionDate;
          existing.resignedAt = existing.resignedAt || row.actionDate;
        }
        if (!isEmployeeDepartedForTurnoverReport(existing) && synDate) {
          existing.status = '离职';
        }
        continue;
      }
      const syn = {
        username: row.username,
        name: row.name || row.username,
        store: String(row.store || '').trim(),
        position: String(row.position || '').trim(),
        department: String(row.department || '').trim(),
        role: '',
        level: '',
        status: '离职',
        offboardingDate: synDate,
        resignedAt: synDate,
        joinDate: '',
        coreTalent: false
      };
      storeEmps.push(syn);
      empByLower.set(un, syn);
    }
  } catch (e) {
    log.warn({ msg: 'turnover_employment_records_merge_failed', err: e?.message || String(e) });
  }

  return { storeEmps, empByLower, offDeparted };
}
