-- RLS Phase5全量推进第4批：dish_name_aliases唯一约束补tenant_id，配合ON CONFLICT目标同步改
DO $$
BEGIN
  IF to_regclass('public.dish_name_aliases') IS NOT NULL THEN
    ALTER TABLE dish_name_aliases DROP CONSTRAINT IF EXISTS uq_dish_name_aliases_scope;
    ALTER TABLE dish_name_aliases ADD CONSTRAINT uq_dish_name_aliases_scope UNIQUE (store, biz_type, alias_name, tenant_id);
  END IF;
END $$;
