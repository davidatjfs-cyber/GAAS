-- Growth ontology business identifiers are only unique inside a tenant.
-- Global single-column primary keys cause cross-tenant ON CONFLICT updates and
-- are rejected by RLS when two tenants reuse an employee/store/order ID.

BEGIN;

DO $$
DECLARE
  item RECORD;
  constraint_name TEXT;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('growth_ontology_stores','store_id'),
    ('growth_ontology_customers','customer_id'),
    ('growth_ontology_dishes','dish_id'),
    ('growth_ontology_orders','order_id'),
    ('growth_ontology_employees','employee_id'),
    ('growth_ontology_campaigns','campaign_id'),
    ('growth_ontology_benefits','benefit_id'),
    ('growth_ontology_touches','touch_id'),
    ('growth_ontology_issues','issue_id'),
    ('growth_ontology_opportunities','opportunity_id'),
    ('growth_ontology_attributions','attribution_id'),
    ('growth_ontology_business_results','result_id')
  ) AS v(table_name,id_column)
  LOOP
    IF to_regclass('public.' || item.table_name) IS NULL THEN CONTINUE; END IF;
    SELECT conname INTO constraint_name
      FROM pg_constraint
     WHERE conrelid=to_regclass('public.' || item.table_name) AND contype='p'
     LIMIT 1;
    IF constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', item.table_name, constraint_name);
    END IF;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I PRIMARY KEY (tenant_id,%I)',
      item.table_name, item.table_name || '_pkey', item.id_column
    );
    constraint_name := NULL;
  END LOOP;
END $$;

COMMIT;
