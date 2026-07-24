/**
 * Salary lookup helpers from hrms_state users/employees mirrors.
 * Pure: no DI deps. Username match is exact trim equality (case-sensitive quirk).
 */
export function getStateUsers(state) {
  const users = Array.isArray(state?.users) ? state.users : [];
  const employees = Array.isArray(state?.employees) ? state.employees : [];
  return { users, employees };
}

export function findUserSalary(state, username) {
  const u = String(username || '').trim();
  if (!u) return null;
  const { users, employees } = getStateUsers(state);
  const rec = users.find(x => String(x?.username || '').trim() === u) || employees.find(x => String(x?.username || '').trim() === u) || null;
  if (!rec) return null;
  const raw = (rec.salary !== undefined && rec.salary !== null && rec.salary !== '')
    ? rec.salary
    : ((rec.wage !== undefined && rec.wage !== null && rec.wage !== '')
      ? rec.wage
      : ((rec.baseSalary !== undefined && rec.baseSalary !== null && rec.baseSalary !== '')
        ? rec.baseSalary
        : ((rec.monthlySalary !== undefined && rec.monthlySalary !== null && rec.monthlySalary !== '')
          ? rec.monthlySalary
          : ((rec.pay !== undefined && rec.pay !== null && rec.pay !== '') ? rec.pay : null))));
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
