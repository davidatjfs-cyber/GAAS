import {
  PRODUCT_KNOWLEDGE,
  PRODUCT_KNOWLEDGE_VERSION,
  PRODUCT_MODULES,
  searchProductKnowledge,
} from '../services/sales/sales-product-knowledge.js';

/**
 * 将系统手册投影成轻量产品 ontology。
 * 源数据仍只有 PRODUCT_KNOWLEDGE 一份，避免 RAG、客户AI和Agent各自维护后漂移。
 */
export function getProductKnowledgeOntology() {
  const modules = Object.entries(PRODUCT_MODULES).map(([id, name]) => ({
    id: `module:${id}`,
    type: 'system_module',
    name,
  }));
  const capabilities = PRODUCT_KNOWLEDGE.map((item) => ({
    id: `capability:${item.id}`,
    type: 'system_capability',
    moduleId: `module:${item.module}`,
    name: item.title,
    keywords: item.keywords,
    roles: item.roles,
    steps: item.steps,
    limits: item.limits,
    sources: item.sources,
  }));
  const edges = PRODUCT_KNOWLEDGE.flatMap((item) => {
    const capabilityId = `capability:${item.id}`;
    const base = [{ from: `module:${item.module}`, relation: 'contains', to: capabilityId }];
    if (item.steps.length) base.push({ from: capabilityId, relation: 'has_procedure', to: `procedure:${item.id}` });
    if (item.roles) base.push({ from: capabilityId, relation: 'restricted_by', to: `role_policy:${item.roles}` });
    for (const source of item.sources) base.push({ from: capabilityId, relation: 'implemented_by', to: `source:${source}` });
    return base;
  });
  return { version: PRODUCT_KNOWLEDGE_VERSION, modules, capabilities, edges };
}

export function searchProductKnowledgeOntology(query, limit = 5) {
  return {
    version: PRODUCT_KNOWLEDGE_VERSION,
    results: searchProductKnowledge(query, { limit }).map((item) => ({
      id: `capability:${item.id}`,
      moduleId: `module:${item.module}`,
      module: PRODUCT_MODULES[item.module],
      title: item.title,
      answer: item.answer,
      steps: item.steps,
      roles: item.roles,
      limits: item.limits,
      sources: item.sources,
      score: item.score,
    })),
  };
}
