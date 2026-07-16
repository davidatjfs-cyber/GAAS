-- RLS Phase5全量推进第6批：6张表的唯一约束/索引补tenant_id
DO $$
BEGIN
  IF to_regclass('public.ingredient_categories') IS NOT NULL THEN
    ALTER TABLE ingredient_categories DROP CONSTRAINT IF EXISTS ingredient_categories_name_key;
    ALTER TABLE ingredient_categories ADD CONSTRAINT ingredient_categories_name_key UNIQUE (name, tenant_id);
  END IF;
  IF to_regclass('public.ingredient_library') IS NOT NULL THEN
    ALTER TABLE ingredient_library DROP CONSTRAINT IF EXISTS ingredient_library_name_key;
    ALTER TABLE ingredient_library ADD CONSTRAINT ingredient_library_name_key UNIQUE (name, tenant_id);
  END IF;
  IF to_regclass('public.dish_station_mapping') IS NOT NULL THEN
    DROP INDEX IF EXISTS idx_dsm_unique_assignment;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dsm_unique_assignment ON dish_station_mapping (store, station, dish_name, assignee_username, tenant_id);
  END IF;
  IF to_regclass('public.kitchen_exec_logs') IS NOT NULL THEN
    DROP INDEX IF EXISTS idx_kel_one_per_slot;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kel_one_per_slot ON kitchen_exec_logs (store, station, dish_name, employee_username, task_date, schedule_time, tenant_id);
  END IF;
  IF to_regclass('public.kitchen_step_logs') IS NOT NULL THEN
    DROP INDEX IF EXISTS idx_ksl_unique_slot;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ksl_unique_slot ON kitchen_step_logs (store, dish_name, step_seq, employee_username, task_date, schedule_time, tenant_id);
  END IF;
  IF to_regclass('public.kitchen_sop_steps') IS NOT NULL THEN
    ALTER TABLE kitchen_sop_steps DROP CONSTRAINT IF EXISTS uq_kitchen_sop_step;
    ALTER TABLE kitchen_sop_steps ADD CONSTRAINT uq_kitchen_sop_step UNIQUE (dish_name, store, step_seq, tenant_id);
  END IF;
END $$;
