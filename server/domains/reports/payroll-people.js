/**
 * Payroll report — people index from hrms_state + employees table fallback.
 */

export async function buildPayrollPeopleMaps(ctx, state0, store, tenantId) {
  const { dbListEmployeesForReports, isLegacyTestUsername } = ctx;
  const peopleByLower = new Map();
  const employeesList = Array.isArray(state0?.employees) ? state0.employees : [];
  const usersList = Array.isArray(state0?.users) ? state0.users : [];

  employeesList.forEach((p) => {
    const uRaw = String(p?.username || '').trim();
    const u = uRaw.toLowerCase();
    if (!u || isLegacyTestUsername(u)) return;
    if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
  });
  usersList.forEach((p) => {
    const uRaw = String(p?.username || '').trim();
    const u = uRaw.toLowerCase();
    if (!u || isLegacyTestUsername(u)) return;
    if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
  });

  if (!peopleByLower.size) {
    const dbEmps = await dbListEmployeesForReports({
      store,
      includeInactive: false,
      tenantId: tenantId || 'default',
    });
    for (const p of dbEmps) {
      const uRaw = String(p?.username || '').trim();
      const u = uRaw.toLowerCase();
      if (!u || isLegacyTestUsername(u)) continue;
      if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
    }
  }

  const knownUsers = new Set();
  const canonicalUsernameByLower = new Map();
  peopleByLower.forEach((p, u) => {
    knownUsers.add(u);
    canonicalUsernameByLower.set(u, String(p?.username || u).trim() || u);
  });

  const allPeople = Array.from(peopleByLower.values());
  const people = store
    ? allPeople.filter((p) => String(p?.store || '').trim() === store)
    : allPeople;

  return { peopleByLower, people, allPeople, knownUsers, canonicalUsernameByLower };
}
