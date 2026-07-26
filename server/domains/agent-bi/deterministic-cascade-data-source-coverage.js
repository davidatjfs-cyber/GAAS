/**
 * BI deterministic data-source coverage reply.
 */

/**
 * @param {object} deps
 * @returns {(text: string) => Promise<string>}
 */
export function createBuildBiDeterministicDataSourceCoverageReply(deps) {
  const { pool, isBiSourceEnabled } = deps;

  return async function buildBiDeterministicDataSourceCoverageReply(text) {
    const q = String(text || '').trim();
    if (!/(数据源|数据范围|能查什么|知道什么|覆盖|哪些表|可用数据)/.test(q)) return '';

    const sourceDefs = [
      { key: 'table_visit_records', label: '桌访记录（系统入库）', sql: `SELECT COUNT(*)::int AS c, MAX(date)::text AS latest FROM table_visit_records` },
      { key: 'daily_reports', label: '营业日报（系统）', sql: `SELECT COUNT(*)::int AS c, MAX(date)::text AS latest FROM daily_reports` },
      { key: 'bad_reviews', label: '差评报告（同步）', sql: `SELECT COUNT(*)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='negative_review'` },
      { key: 'opening_reports_bitable', label: '开档报告（同步）', sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='opening_report'` },
      { key: 'closing_reports_bitable', label: '收档报告（同步）', sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='closing_report'` },
      { key: 'meeting_reports_bitable', label: '例会报告（同步）', sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='meeting_report'` },
      { key: 'material_majixian_bitable', label: '马己仙原料收货（同步）', sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='material_report' AND lower(coalesce(agent_data->>'brand','')) LIKE '%maji%'` },
      { key: 'material_hongchao_bitable', label: '洪潮原料收货（同步）', sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='material_report' AND lower(coalesce(agent_data->>'brand','')) LIKE '%hong%'` },
    ];

    const lines = [];
    for (const s of sourceDefs) {
      if (!isBiSourceEnabled(s.key)) {
        lines.push(`- ${s.label}：已禁用`);
        continue;
      }
      try {
        const r = await pool().query(s.sql);
        const c = Number(r.rows?.[0]?.c || 0);
        const latest = String(r.rows?.[0]?.latest || '').trim() || '-';
        lines.push(`- ${s.label}：${c}条（latest=${latest}）`);
      } catch (_e) {
        lines.push(`- ${s.label}：查询失败`);
      }
    }

    return `当前 BI 可用数据源覆盖如下：\n${lines.join('\n')}\n\n说明：事实问答仅使用以上可用且可查询的数据源；缺失时将固定拒答。`;
  };
}
