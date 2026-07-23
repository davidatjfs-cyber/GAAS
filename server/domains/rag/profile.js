/**
 * Knowledge viewer profile for RAG audience filtering (extracted from index.js).
 */
export async function getKnowledgeViewerProfile(req, getSharedState) {
  const username = String(req.user?.username || '').trim();
  const role = String(req.user?.role || '').trim();
  if (!username) return { username: '', role: '', store: '', position: '' };
  try {
    const state = (await getSharedState()) || {};
    const employees = Array.isArray(state.employees) ? state.employees : [];
    const users = Array.isArray(state.users) ? state.users : [];
    const emp = employees.find((e) => String(e?.username || '').trim().toLowerCase() === username.toLowerCase()) || {};
    const usr = users.find((u) => String(u?.username || '').trim().toLowerCase() === username.toLowerCase()) || {};
    return {
      username,
      role,
      store: String(emp.store || usr.store || '').trim(),
      position: String(emp.position || usr.position || '').trim()
    };
  } catch (e) {
    return { username, role, store: '', position: '' };
  }
}
