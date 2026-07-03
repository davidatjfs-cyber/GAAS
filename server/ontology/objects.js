/**
 * Ontology Object Registry — 只读的对象/关系元数据，不引入新表、不改现有join方式
 *
 * 现状说明（如实反映，不是理想化设计）：
 *   - Store 在多数表里是通过门店名字符串关联的（如 master_tasks.store、sales_raw.store），
 *     不是外键 stores.id。knowledge-graph.js 的 STORE_NAME_ALIASES 就是在补这个洞。
 *     本注册表的 keyField 标注的是"代码里实际用来关联的字段"，不是"理想中该用的主键"。
 *   - links 只登记已经被代码实际使用的关联（能在 server/*.js 里 grep 到对应查询的），
 *     不登记"理论上可以关联但没人用"的关系，避免注册表和现实脱节。
 */

export const OBJECT_REGISTRY = {
  store: {
    table: 'stores',
    keyField: 'name',
    tenantScoped: true,
    identityNote: '多数业务表按门店名字符串关联，非 stores.id 外键；见 knowledge-graph.js#getStoreAliases',
    links: {
      employees: { to: 'employee', via: 'store' },
      health: { to: 'metric', via: 'entity_health_snapshot(entity_type=store)' },
    },
  },
  employee: {
    table: 'employees',
    keyField: 'username',
    tenantScoped: true, // migration 038 补了 tenant_id + RLS，registry此前是旧结论
    links: {
      store: { to: 'store', via: 'store' },
    },
  },
  metric: {
    table: 'metric_dictionary',
    keyField: 'metric_id',
    tenantScoped: true,
    identityNote: '口径唯一权威来源；查询一律走 data-executor.js#getMetricDef，禁止绕过',
    links: {},
  },
  task: {
    table: 'master_tasks',
    keyField: 'task_id',
    tenantScoped: true, // migration 042/082 补了 tenant_id + FORCE RLS，registry此前是旧结论
    identityNote: '按 store 文本字段关联门店，非外键',
    filterableFields: ['store'],
    dateField: 'created_at',
    links: {
      store: { to: 'store', via: 'store' },
    },
  },
  dish: {
    table: 'recipes',
    keyField: 'dish_name',
    tenantScoped: true,
    identityNote: 'store="*" 表示全门店通用配方；同一 dish_name 在不同 store 可有各自版本',
    links: {
      store: { to: 'store', via: 'store' },
    },
  },
};

export function getObject(type) {
  const def = OBJECT_REGISTRY[type];
  if (!def) throw new Error(`ontology: unknown object type "${type}"`);
  return def;
}

export function listObjectTypes() {
  return Object.keys(OBJECT_REGISTRY);
}

/** 校验注册表内部一致性：每条 link 指向的 to 类型必须已注册 */
export function validateRegistry(registry = OBJECT_REGISTRY) {
  const errors = [];
  for (const [type, def] of Object.entries(registry)) {
    for (const [linkName, link] of Object.entries(def.links || {})) {
      if (!registry[link.to]) {
        errors.push(`${type}.links.${linkName} -> unknown object type "${link.to}"`);
      }
    }
  }
  return errors;
}
