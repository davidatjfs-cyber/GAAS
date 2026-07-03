/**
 * Metric Dictionary Lint — 只读检测 metric_dictionary 里的口径冲突/冗余
 *
 * 职责：
 *   - 发现同名不同 metric_id（同一中文名，公式/数据源不同 → 真实口径冲突）
 *   - 发现同公式不同 metric_id（完全相同的 formula+data_source，纯冗余注册）
 *   - 不做任何写入、不做取舍判断——冲突如何解决是业务决策，交给人工
 */

export function lintMetrics(rows) {
  const findings = [];

  const byName = new Map();
  const byFormula = new Map();

  for (const row of rows || []) {
    const name = row.name;
    const formulaKey = `${row.data_source}::${row.formula}`;

    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(row);

    if (!byFormula.has(formulaKey)) byFormula.set(formulaKey, []);
    byFormula.get(formulaKey).push(row);
  }

  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const distinctFormulas = new Set(group.map(r => `${r.data_source}::${r.formula}`));
    if (distinctFormulas.size > 1) {
      findings.push({
        type: 'conflicting_definition',
        name,
        metric_ids: group.map(r => r.metric_id),
        detail: group.map(r => ({ metric_id: r.metric_id, data_source: r.data_source, formula: r.formula }))
      });
    }
  }

  for (const [formulaKey, group] of byFormula) {
    if (group.length < 2) continue;
    const distinctNames = new Set(group.map(r => r.name));
    findings.push({
      type: distinctNames.size > 1 ? 'duplicate_formula_different_name' : 'redundant_registration',
      formula_key: formulaKey,
      metric_ids: group.map(r => r.metric_id),
      names: [...distinctNames]
    });
  }

  return findings;
}

export async function fetchAndLintMetrics(getAllMetricDefs) {
  const rows = await getAllMetricDefs();
  return lintMetrics(rows);
}
