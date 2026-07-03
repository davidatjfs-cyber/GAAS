-- Baseline snapshot: 143张此前只在server/*.js启动时CREATE TABLE IF NOT EXISTS里存在、
-- 从未被任何migrations文件追踪过的生产表结构（含索引/约束/RLS policy定义）。
-- 生成方式：pg_dump --schema-only 生产库(47.100.96.30)，按此前migrations/001-092.sql
-- 已覆盖的76张表之外的缺口表过滤而来，2026-07-03。
-- 5张一次性备份/临时表(_bak_/_legacy_后缀)不在此列，未纳入正式schema。
-- 说明：本文件只反映"结构此刻是什么"，不代表"结构应该是什么"——
-- 例如RLS策略在此环境是残留但未生效状态（relrowsecurity=false），
-- 多租户demo环境需要另行ENABLE ROW LEVEL SECURITY。

--
-- PostgreSQL database dump
--

-- Dumped from database version 14.23 (Ubuntu 14.23-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 14.23 (Ubuntu 14.23-0ubuntu0.22.04.1)

--
-- Name: ab_test_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS ab_test_results (
    id bigint NOT NULL,
    test_id bigint,
    result_date date NOT NULL,
    variant text NOT NULL,
    sent integer DEFAULT 0,
    impressions integer DEFAULT 0,
    clicks integer DEFAULT 0,
    orders integer DEFAULT 0,
    redemptions integer DEFAULT 0,
    revenue numeric(10,2) DEFAULT 0,
    conversion_rate numeric(6,4),
    created_at timestamp with time zone DEFAULT now(),
    metrics_json jsonb,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY ab_test_results FORCE ROW LEVEL SECURITY;

--
-- Name: ab_test_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS ab_test_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: ab_test_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE ab_test_results_id_seq OWNED BY ab_test_results.id;

--
-- Name: ab_test_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS ab_test_tasks (
    id bigint NOT NULL,
    test_name text NOT NULL,
    store_code text DEFAULT ''::text,
    test_type text NOT NULL,
    target_metric text DEFAULT 'redemption_rate'::text NOT NULL,
    variant_a jsonb DEFAULT '{}'::jsonb NOT NULL,
    variant_b jsonb DEFAULT '{}'::jsonb NOT NULL,
    rotation_config jsonb DEFAULT '{"a_days": [1, 2, 3], "b_days": [4, 5, 6, 0], "method": "time"}'::jsonb,
    start_date date NOT NULL,
    end_date date NOT NULL,
    min_sample_size integer DEFAULT 30,
    winner text DEFAULT ''::text,
    winner_lift numeric(5,2),
    ai_summary text DEFAULT ''::text,
    status text DEFAULT 'running'::text NOT NULL,
    created_by text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    promoted_rule_key text,
    target_kind text,
    target_rule_key text,
    mode text DEFAULT 'bound'::text,
    channel text,
    template_key text,
    metrics_schema jsonb,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY ab_test_tasks FORCE ROW LEVEL SECURITY;

--
-- Name: ab_test_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS ab_test_tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: ab_test_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE ab_test_tasks_id_seq OWNED BY ab_test_tasks.id;

--
-- Name: acceptance_checklists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS acceptance_checklists (
    id integer NOT NULL,
    anomaly_key text NOT NULL,
    checklist_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    min_word_count integer DEFAULT 0,
    require_photos boolean DEFAULT false,
    require_video boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY acceptance_checklists FORCE ROW LEVEL SECURITY;

--
-- Name: acceptance_checklists_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS acceptance_checklists_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: acceptance_checklists_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE acceptance_checklists_id_seq OWNED BY acceptance_checklists.id;

--
-- Name: action_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS action_plans (
    id integer NOT NULL,
    plan_id character varying(60) NOT NULL,
    title character varying(500) NOT NULL,
    goal text,
    store character varying(200),
    brand character varying(120),
    target_role character varying(60),
    status character varying(50) DEFAULT 'draft'::character varying,
    plan_data jsonb DEFAULT '{}'::jsonb,
    compliance_result jsonb DEFAULT '{}'::jsonb,
    graph_context jsonb DEFAULT '{}'::jsonb,
    approval_id character varying(100),
    created_by character varying(100),
    approved_by character varying(100),
    executed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY action_plans FORCE ROW LEVEL SECURITY;

--
-- Name: action_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS action_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: action_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE action_plans_id_seq OWNED BY action_plans.id;

--
-- Name: agent_admin_alert_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_admin_alert_log (
    id bigint NOT NULL,
    priority character(1) DEFAULT 'B'::bpchar NOT NULL,
    alert_type character varying(96) DEFAULT ''::character varying NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    dedupe_key character varying(320) DEFAULT ''::character varying NOT NULL,
    recipient_count integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_admin_alert_log FORCE ROW LEVEL SECURITY;

--
-- Name: agent_admin_alert_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS agent_admin_alert_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: agent_admin_alert_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE agent_admin_alert_log_id_seq OWNED BY agent_admin_alert_log.id;

--
-- Name: agent_autonomous_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_autonomous_logs (
    id integer NOT NULL,
    task_id text NOT NULL,
    status text NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_autonomous_logs FORCE ROW LEVEL SECURITY;

--
-- Name: agent_autonomous_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS agent_autonomous_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: agent_autonomous_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE agent_autonomous_logs_id_seq OWNED BY agent_autonomous_logs.id;

--
-- Name: agent_collaboration_archives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_collaboration_archives (
    id integer NOT NULL,
    session_id text NOT NULL,
    topic text NOT NULL,
    initiator text NOT NULL,
    participants jsonb NOT NULL,
    messages jsonb DEFAULT '[]'::jsonb,
    summary text,
    created_at timestamp with time zone,
    ended_at timestamp with time zone,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_collaboration_archives FORCE ROW LEVEL SECURITY;

--
-- Name: agent_collaboration_archives_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS agent_collaboration_archives_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: agent_collaboration_archives_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE agent_collaboration_archives_id_seq OWNED BY agent_collaboration_archives.id;

--
-- Name: agent_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    system_prompt text,
    model_name character varying(50) DEFAULT 'qwen-plus'::character varying,
    temperature numeric(3,2) DEFAULT 0.1,
    enabled boolean DEFAULT true,
    schedule_interval integer DEFAULT 30,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    prompt_template_id uuid,
    reply_template_id uuid,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_configs FORCE ROW LEVEL SECURITY;

--
-- Name: agent_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_memory (
    id integer NOT NULL,
    agent_id text NOT NULL,
    store text,
    memory_type text DEFAULT 'interaction'::text,
    content text NOT NULL,
    outcome text,
    outcome_score numeric,
    context jsonb,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_memory FORCE ROW LEVEL SECURITY;

--
-- Name: agent_memory_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS agent_memory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: agent_memory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE agent_memory_id_seq OWNED BY agent_memory.id;

--
-- Name: agent_prompt_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_prompt_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_key character varying(120) NOT NULL,
    agent_id character varying(50) NOT NULL,
    name character varying(120) NOT NULL,
    content text NOT NULL,
    enabled boolean DEFAULT true,
    is_builtin boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_prompt_templates FORCE ROW LEVEL SECURITY;

--
-- Name: agent_reply_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_reply_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_key character varying(120) NOT NULL,
    agent_id character varying(50) NOT NULL,
    name character varying(120) NOT NULL,
    content text NOT NULL,
    enabled boolean DEFAULT true,
    is_builtin boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_reply_templates FORCE ROW LEVEL SECURITY;

--
-- Name: agent_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category character varying(100) NOT NULL,
    assignee_role character varying(100) NOT NULL,
    normal_deduction integer DEFAULT 10,
    major_deduction integer DEFAULT 20,
    enabled boolean DEFAULT true,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_rules FORCE ROW LEVEL SECURITY;

--
-- Name: agent_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id text NOT NULL,
    user_id text NOT NULL,
    store text,
    agent text NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    context jsonb DEFAULT '{}'::jsonb,
    pending_question text,
    question_round integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_sessions FORCE ROW LEVEL SECURITY;

--
-- Name: agent_task_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_task_logs (
    id integer NOT NULL,
    agent_id text NOT NULL,
    task_type text NOT NULL,
    status text NOT NULL,
    execution_time_ms integer,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    has_evidence boolean DEFAULT false,
    evidence_violation boolean DEFAULT false,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_task_logs FORCE ROW LEVEL SECURITY;

--
-- Name: agent_task_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS agent_task_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: agent_task_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE agent_task_logs_id_seq OWNED BY agent_task_logs.id;

--
-- Name: agent_v2_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_v2_configs (
    id integer NOT NULL,
    config_key text NOT NULL,
    config_value jsonb NOT NULL,
    description text,
    version integer DEFAULT 1,
    updated_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

--
-- Name: agent_v2_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS agent_v2_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: agent_v2_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE agent_v2_configs_id_seq OWNED BY agent_v2_configs.id;

--
-- Name: agent_v2_cron_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_v2_cron_runs (
    id bigint NOT NULL,
    job_key text NOT NULL,
    run_ymd text NOT NULL,
    ok boolean NOT NULL,
    error text,
    source text DEFAULT 'cron'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_v2_cron_runs FORCE ROW LEVEL SECURITY;

--
-- Name: agent_v2_cron_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS agent_v2_cron_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: agent_v2_cron_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE agent_v2_cron_runs_id_seq OWNED BY agent_v2_cron_runs.id;

--
-- Name: agent_v2_data_alert_dedupe; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_v2_data_alert_dedupe (
    dedupe_key character varying(320) NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_v2_data_alert_dedupe FORCE ROW LEVEL SECURITY;

--
-- Name: agent_v2_morning_briefing_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_v2_morning_briefing_sends (
    id bigint NOT NULL,
    run_ymd text NOT NULL,
    username text NOT NULL,
    scope text NOT NULL,
    ok boolean DEFAULT false NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_v2_morning_briefing_sends FORCE ROW LEVEL SECURITY;

--
-- Name: agent_v2_morning_briefing_sends_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS agent_v2_morning_briefing_sends_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: agent_v2_morning_briefing_sends_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE agent_v2_morning_briefing_sends_id_seq OWNED BY agent_v2_morning_briefing_sends.id;

--
-- Name: agent_v2_pllm_monthly_report_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_v2_pllm_monthly_report_log (
    report_month character varying(7) NOT NULL,
    sent_at timestamp with time zone DEFAULT now(),
    recipient_count integer DEFAULT 0,
    sent_count integer DEFAULT 0,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_v2_pllm_monthly_report_log FORCE ROW LEVEL SECURITY;

--
-- Name: agent_v2_scheduled_report_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS agent_v2_scheduled_report_sends (
    id bigint NOT NULL,
    job_key text NOT NULL,
    run_ymd text NOT NULL,
    username text NOT NULL,
    scope text NOT NULL,
    ok boolean DEFAULT false NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY agent_v2_scheduled_report_sends FORCE ROW LEVEL SECURITY;

--
-- Name: agent_v2_scheduled_report_sends_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS agent_v2_scheduled_report_sends_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: agent_v2_scheduled_report_sends_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE agent_v2_scheduled_report_sends_id_seq OWNED BY agent_v2_scheduled_report_sends.id;

--
-- Name: anomaly_pending_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS anomaly_pending_notifications (
    id bigint NOT NULL,
    store text NOT NULL,
    brand text,
    rule_key text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    detail text,
    value jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    sent_at timestamp with time zone,
    error text,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY anomaly_pending_notifications FORCE ROW LEVEL SECURITY;

--
-- Name: anomaly_pending_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS anomaly_pending_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: anomaly_pending_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE anomaly_pending_notifications_id_seq OWNED BY anomaly_pending_notifications.id;

--
-- Name: anomaly_triggers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS anomaly_triggers (
    id integer NOT NULL,
    anomaly_key text NOT NULL,
    store text NOT NULL,
    brand text,
    severity text DEFAULT 'medium'::text NOT NULL,
    trigger_date date NOT NULL,
    trigger_value jsonb DEFAULT '{}'::jsonb,
    threshold_value jsonb DEFAULT '{}'::jsonb,
    task_id text,
    status text DEFAULT 'open'::text,
    assigned_role text,
    notify_target_role text,
    evidence_submitted jsonb DEFAULT '[]'::jsonb,
    resolution_code text,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY anomaly_triggers FORCE ROW LEVEL SECURITY;

--
-- Name: anomaly_triggers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS anomaly_triggers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: anomaly_triggers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE anomaly_triggers_id_seq OWNED BY anomaly_triggers.id;

--
-- Name: attendance_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS attendance_records (
    id integer NOT NULL,
    employee_username text NOT NULL,
    employee_name text,
    store text,
    record_date date NOT NULL,
    clock_in timestamp with time zone,
    clock_out timestamp with time zone,
    status text DEFAULT 'normal'::text,
    late_minutes integer DEFAULT 0,
    early_leave_minutes integer DEFAULT 0,
    overtime_minutes integer DEFAULT 0,
    notes text,
    source text DEFAULT 'system'::text,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY attendance_records FORCE ROW LEVEL SECURITY;

--
-- Name: attendance_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS attendance_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: attendance_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE attendance_records_id_seq OWNED BY attendance_records.id;

--
-- Name: attention_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS attention_scores (
    id text NOT NULL,
    username text NOT NULL,
    name text DEFAULT ''::text,
    store text DEFAULT ''::text,
    material_id text NOT NULL,
    material_title text DEFAULT ''::text,
    score integer DEFAULT 0,
    duration_seconds integer DEFAULT 0,
    total_samples integer DEFAULT 0,
    attentive_samples integer DEFAULT 0,
    avg_score integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY attention_scores FORCE ROW LEVEL SECURITY;

--
-- Name: auto_ops_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS auto_ops_runs (
    id bigint NOT NULL,
    job_key text NOT NULL,
    run_key text NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY auto_ops_runs FORCE ROW LEVEL SECURITY;

--
-- Name: auto_ops_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS auto_ops_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: auto_ops_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE auto_ops_runs_id_seq OWNED BY auto_ops_runs.id;

--
-- Name: automated_test_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS automated_test_results (
    id integer NOT NULL,
    test_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY automated_test_results FORCE ROW LEVEL SECURITY;

--
-- Name: automated_test_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS automated_test_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: automated_test_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE automated_test_results_id_seq OWNED BY automated_test_results.id;

--
-- Name: bitable_submissions_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS bitable_submissions_archive (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    direction character varying(10) DEFAULT 'in'::character varying NOT NULL,
    channel character varying(30) DEFAULT 'feishu'::character varying NOT NULL,
    sender_id character varying(200),
    sender_name character varying(200),
    sender_role character varying(60),
    routed_to character varying(60),
    content_type character varying(30) DEFAULT 'text'::character varying NOT NULL,
    content text,
    image_urls jsonb DEFAULT '[]'::jsonb,
    agent_response text,
    agent_data jsonb DEFAULT '{}'::jsonb,
    feishu_message_id character varying(200),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    feishu_open_id character varying(200),
    sender_username character varying(200),
    record_id character varying(100),
    updated_at timestamp without time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY bitable_submissions_archive FORCE ROW LEVEL SECURITY;

--
-- Name: brand_voice_samples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS brand_voice_samples (
    brand text NOT NULL,
    samples jsonb DEFAULT '[]'::jsonb NOT NULL,
    detected_style jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY brand_voice_samples FORCE ROW LEVEL SECURITY;

--
-- Name: business_entity_relations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS business_entity_relations (
    id integer NOT NULL,
    source_type character varying(50) NOT NULL,
    source_id character varying(300) NOT NULL,
    source_label character varying(300),
    target_type character varying(50) NOT NULL,
    target_id character varying(300) NOT NULL,
    target_label character varying(300),
    relation character varying(100) NOT NULL,
    weight real DEFAULT 1.0,
    metadata jsonb DEFAULT '{}'::jsonb,
    date date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY business_entity_relations FORCE ROW LEVEL SECURITY;

--
-- Name: business_entity_relations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS business_entity_relations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: business_entity_relations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE business_entity_relations_id_seq OWNED BY business_entity_relations.id;

--
-- Name: checkin_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS checkin_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(100) NOT NULL,
    store character varying(200),
    type character varying(20) DEFAULT 'clock_in'::character varying NOT NULL,
    check_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    latitude double precision,
    longitude double precision,
    distance_meters double precision,
    face_match boolean DEFAULT false,
    face_score double precision,
    photo_url text,
    status character varying(20) DEFAULT 'normal'::character varying NOT NULL,
    note text,
    confirmed_by character varying(100),
    confirmed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY checkin_records FORCE ROW LEVEL SECURITY;

--
-- Name: cn_holiday_calendar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS cn_holiday_calendar (
    day date NOT NULL,
    day_type text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

--
-- Name: config_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS config_audit_log (
    id integer NOT NULL,
    config_key text NOT NULL,
    action text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    changed_by text,
    changed_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY config_audit_log FORCE ROW LEVEL SECURITY;

--
-- Name: config_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS config_audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: config_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE config_audit_log_id_seq OWNED BY config_audit_log.id;

--
-- Name: content_performance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS content_performance (
    id bigint NOT NULL,
    content_date date NOT NULL,
    store_code text NOT NULL,
    channel text NOT NULL,
    content_type text NOT NULL,
    variant_tag text DEFAULT 'A'::text,
    dish_name text DEFAULT ''::text,
    impressions integer DEFAULT 0,
    clicks integer DEFAULT 0,
    saves integer DEFAULT 0,
    orders integer DEFAULT 0,
    notes text DEFAULT ''::text,
    created_by text DEFAULT 'manual'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    likes integer DEFAULT 0,
    comments integer DEFAULT 0,
    shares integer DEFAULT 0,
    new_followers integer DEFAULT 0,
    store_id text,
    content_title text,
    platform text,
    content_key text,
    suggestion_id bigint,
    scene text,
    audience_tag text,
    variable text,
    content_body text,
    winning_value text,
    losing_value text,
    redemptions integer DEFAULT 0,
    revenue numeric(10,2) DEFAULT 0,
    recorded_by text,
    published_at timestamp with time zone,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY content_performance FORCE ROW LEVEL SECURITY;

--
-- Name: content_performance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS content_performance_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: content_performance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE content_performance_id_seq OWNED BY content_performance.id;

--
-- Name: data_quality_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS data_quality_logs (
    id integer NOT NULL,
    data_source text NOT NULL,
    record_count integer DEFAULT 0,
    data_quality_score numeric(3,2) DEFAULT 1.0,
    issues jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY data_quality_logs FORCE ROW LEVEL SECURITY;

--
-- Name: data_quality_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS data_quality_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: data_quality_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE data_quality_logs_id_seq OWNED BY data_quality_logs.id;

--
-- Name: decision_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS decision_log (
    id bigint NOT NULL,
    store character varying(200) NOT NULL,
    brand character varying(100),
    decision_type character varying(60) DEFAULT 'action_plan'::character varying NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    agent character varying(60),
    source_task_id character varying(60),
    created_by character varying(60),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY decision_log FORCE ROW LEVEL SECURITY;

--
-- Name: decision_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS decision_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: decision_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE decision_log_id_seq OWNED BY decision_log.id;

--
-- Name: dish_library_costs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS dish_library_costs (
    id bigint NOT NULL,
    store character varying(200) NOT NULL,
    biz_type character varying(20) NOT NULL,
    dish_name character varying(255) NOT NULL,
    dish_price numeric(12,2),
    unit_cost numeric(12,2) DEFAULT 0 NOT NULL,
    source_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_record_id character varying(120),
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    brand character varying(50) DEFAULT '*'::character varying NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY dish_library_costs FORCE ROW LEVEL SECURITY;

--
-- Name: dish_library_costs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS dish_library_costs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: dish_library_costs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE dish_library_costs_id_seq OWNED BY dish_library_costs.id;

--
-- Name: dish_name_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS dish_name_aliases (
    id bigint NOT NULL,
    store character varying(200) DEFAULT '*'::character varying NOT NULL,
    biz_type character varying(20) DEFAULT '*'::character varying NOT NULL,
    alias_name character varying(255) NOT NULL,
    canonical_name character varying(255) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_by character varying(120),
    updated_by character varying(120),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY dish_name_aliases FORCE ROW LEVEL SECURITY;

--
-- Name: dish_name_aliases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS dish_name_aliases_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: dish_name_aliases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE dish_name_aliases_id_seq OWNED BY dish_name_aliases.id;

--
-- Name: dish_station_mapping; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS dish_station_mapping (
    id bigint NOT NULL,
    store character varying(200) NOT NULL,
    station character varying(100) NOT NULL,
    dish_name character varying(255) NOT NULL,
    is_prep boolean DEFAULT false,
    critical_step_name text,
    sop_id text,
    enabled boolean DEFAULT true,
    created_by character varying(120),
    created_at timestamp with time zone DEFAULT now(),
    assignee_username character varying(120) DEFAULT ''::character varying NOT NULL,
    assignee_name character varying(120) DEFAULT ''::character varying NOT NULL,
    scheduled_times jsonb DEFAULT '["09:00"]'::jsonb NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY dish_station_mapping FORCE ROW LEVEL SECURITY;

--
-- Name: dish_station_mapping_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS dish_station_mapping_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: dish_station_mapping_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE dish_station_mapping_id_seq OWNED BY dish_station_mapping.id;

--
-- Name: employee_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS employee_attachments (
    id integer NOT NULL,
    employee_id text NOT NULL,
    filename text NOT NULL,
    original_name text NOT NULL,
    url text NOT NULL,
    description text DEFAULT ''::text,
    uploaded_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY employee_attachments FORCE ROW LEVEL SECURITY;

--
-- Name: employee_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS employee_attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: employee_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE employee_attachments_id_seq OWNED BY employee_attachments.id;

--
-- Name: employee_training_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS employee_training_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id text NOT NULL,
    employee_name text NOT NULL,
    store text,
    training_type text NOT NULL,
    sop_id uuid,
    sop_title text,
    trigger_source text,
    problem_description text,
    exam_score numeric(5,2),
    total_questions integer,
    correct_count integer,
    attempts integer DEFAULT 1,
    passed boolean DEFAULT false,
    deadline date,
    passed_at timestamp with time zone,
    escalated boolean DEFAULT false,
    escalated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY employee_training_records FORCE ROW LEVEL SECURITY;

--
-- Name: employment_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS employment_records (
    id integer NOT NULL,
    employee_username text NOT NULL,
    employee_name text,
    store text,
    brand text,
    action_type text NOT NULL,
    action_date date NOT NULL,
    "position" text,
    department text,
    reason text,
    handover_to text,
    handover_status text DEFAULT 'pending'::text,
    documents jsonb DEFAULT '[]'::jsonb,
    salary_info jsonb DEFAULT '{}'::jsonb,
    created_by text,
    approved_by text,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY employment_records FORCE ROW LEVEL SECURITY;

--
-- Name: employment_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS employment_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: employment_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE employment_records_id_seq OWNED BY employment_records.id;

--
-- Name: entity_health_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS entity_health_snapshot (
    id integer NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id character varying(300) NOT NULL,
    entity_label character varying(300),
    health_score real DEFAULT 100,
    dimensions jsonb DEFAULT '{}'::jsonb,
    snapshot_date date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY entity_health_snapshot FORCE ROW LEVEL SECURITY;

--
-- Name: entity_health_snapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS entity_health_snapshot_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: entity_health_snapshot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE entity_health_snapshot_id_seq OWNED BY entity_health_snapshot.id;

--
-- Name: escalation_chains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS escalation_chains (
    id integer NOT NULL,
    brand text,
    store text,
    anomaly_key text,
    level integer DEFAULT 1 NOT NULL,
    target_role text NOT NULL,
    timeout_hours integer,
    auto_escalate boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY escalation_chains FORCE ROW LEVEL SECURITY;

--
-- Name: escalation_chains_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS escalation_chains_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: escalation_chains_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE escalation_chains_id_seq OWNED BY escalation_chains.id;

--
-- Name: exam_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS exam_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assignment_id uuid,
    user_key character varying(100) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    started_at timestamp without time zone,
    submitted_at timestamp without time zone,
    time_used_seconds integer,
    auto_submitted boolean DEFAULT false,
    set_index integer,
    total integer,
    correct integer,
    score integer,
    answers jsonb,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY exam_results FORCE ROW LEVEL SECURITY;

--
-- Name: feishu_generic_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS feishu_generic_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    app_token character varying(100) NOT NULL,
    table_id character varying(100) NOT NULL,
    record_id character varying(100) NOT NULL,
    fields jsonb,
    raw jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    config_key character varying(60),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY feishu_generic_records FORCE ROW LEVEL SECURITY;

--
-- Name: feishu_pending_pllm_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS feishu_pending_pllm_decisions (
    open_id text NOT NULL,
    task_id text NOT NULL,
    decision text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY feishu_pending_pllm_decisions FORCE ROW LEVEL SECURITY;

--
-- Name: feishu_pending_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS feishu_pending_replies (
    open_id text NOT NULL,
    task_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY feishu_pending_replies FORCE ROW LEVEL SECURITY;

--
-- Name: feishu_sync_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS feishu_sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type character varying(50) NOT NULL,
    table_id character varying(100) NOT NULL,
    record_id character varying(100),
    data jsonb,
    sync_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    error_message text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    processed_at timestamp without time zone,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY feishu_sync_logs FORCE ROW LEVEL SECURITY;

--
-- Name: growth_campaign_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_campaign_jobs (
    id bigint NOT NULL,
    campaign_id text,
    store_id text,
    value_yuan integer,
    valid_days integer,
    dormant_days integer,
    min_balance_fen integer,
    targets jsonb DEFAULT '[]'::jsonb NOT NULL,
    total integer DEFAULT 0,
    sent integer DEFAULT 0,
    failed integer DEFAULT 0,
    status text DEFAULT 'pending'::text NOT NULL,
    created_by text,
    result jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    kind text DEFAULT 'winback'::text NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_campaign_jobs FORCE ROW LEVEL SECURITY;

--
-- Name: growth_campaign_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_campaign_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_campaign_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_campaign_jobs_id_seq OWNED BY growth_campaign_jobs.id;

--
-- Name: growth_campaign_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_campaign_plans (
    id bigint NOT NULL,
    plan_id text,
    store_id text,
    campaign_id text,
    title text NOT NULL,
    channel text,
    voucher_template_id text,
    target_audience text DEFAULT 'all'::text,
    budget_fen integer DEFAULT 0,
    status text DEFAULT 'draft'::text,
    planned_start timestamp with time zone,
    planned_end timestamp with time zone,
    created_by text DEFAULT 'admin'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    source_template_id integer,
    recommended_poster_id bigint,
    coupon_value_fen integer DEFAULT 0,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_campaign_plans FORCE ROW LEVEL SECURITY;

--
-- Name: growth_campaign_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_campaign_plans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_campaign_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_campaign_plans_id_seq OWNED BY growth_campaign_plans.id;

--
-- Name: growth_churn_predictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_churn_predictions (
    id bigint NOT NULL,
    prediction_date date NOT NULL,
    store_code text DEFAULT ''::text NOT NULL,
    customer_id bigint NOT NULL,
    phone text,
    customer_name text,
    churn_score integer DEFAULT 100,
    risk_level text,
    factors jsonb DEFAULT '[]'::jsonb,
    last_visit_days integer,
    avg_visit_cycle_days integer,
    spend_trend_pct numeric(6,2),
    visit_trend integer,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_churn_predictions FORCE ROW LEVEL SECURITY;

--
-- Name: growth_churn_predictions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_churn_predictions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_churn_predictions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_churn_predictions_id_seq OWNED BY growth_churn_predictions.id;

--
-- Name: growth_content_calendar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_content_calendar (
    id bigint NOT NULL,
    item_id text,
    store_id text,
    channel text NOT NULL,
    publish_date date NOT NULL,
    title text NOT NULL,
    content_brief text,
    copy_text text,
    image_url text,
    campaign_id text,
    qr_scene text,
    status text DEFAULT 'draft'::text,
    assignee_username text,
    result_scan_count integer DEFAULT 0,
    result_revenue_fen integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_content_calendar FORCE ROW LEVEL SECURITY;

--
-- Name: growth_content_calendar_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_content_calendar_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_content_calendar_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_content_calendar_id_seq OWNED BY growth_content_calendar.id;

--
-- Name: growth_content_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_content_suggestions (
    id bigint NOT NULL,
    suggestion_key text NOT NULL,
    week_start date NOT NULL,
    store_code text,
    summary_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    feishu_pushed_at timestamp with time zone,
    generated_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_content_suggestions FORCE ROW LEVEL SECURITY;

--
-- Name: growth_content_suggestions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_content_suggestions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_content_suggestions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_content_suggestions_id_seq OWNED BY growth_content_suggestions.id;

--
-- Name: growth_coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_coupons (
    id bigint NOT NULL,
    coupon_id text NOT NULL,
    name text,
    type text DEFAULT 'cash'::text,
    value_fen integer DEFAULT 0,
    price_fen integer DEFAULT 0,
    valid_days integer DEFAULT 30,
    stock integer DEFAULT '-1'::integer,
    usage_rule text,
    dish_name text,
    is_active boolean DEFAULT true,
    store_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_coupons FORCE ROW LEVEL SECURITY;

--
-- Name: growth_coupons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_coupons_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_coupons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_coupons_id_seq OWNED BY growth_coupons.id;

--
-- Name: growth_customer_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_customer_profiles (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    phone text,
    openid text,
    store_id text,
    brand text,
    lifecycle_stage text DEFAULT 'new'::text,
    next_visit_probability numeric,
    best_contact_window text,
    preferred_visit_time text,
    avg_party_size numeric,
    visit_interval_days numeric,
    response_to_discount numeric,
    price_sensitivity numeric,
    adventurous_score numeric,
    health_conscious_score numeric,
    spicy_level numeric,
    occasion_date_score numeric,
    occasion_family_score numeric,
    occasion_business_score numeric,
    occasion_solo_score numeric,
    occasion_friends_score numeric,
    favorite_dishes jsonb DEFAULT '[]'::jsonb,
    disliked_signals jsonb DEFAULT '[]'::jsonb,
    semantic_tags jsonb DEFAULT '[]'::jsonb,
    source_signals jsonb DEFAULT '{}'::jsonb,
    profile_version integer DEFAULT 1,
    last_profiled_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    pos_order_count integer DEFAULT 0,
    pos_total_spend numeric DEFAULT 0,
    avg_check numeric,
    pos_dine_in_ratio numeric,
    pos_last_order_at timestamp with time zone,
    value_tier text DEFAULT 'low'::text,
    price_sensitive boolean DEFAULT false,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_customer_profiles FORCE ROW LEVEL SECURITY;

--
-- Name: growth_customer_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_customer_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_customer_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_customer_profiles_id_seq OWNED BY growth_customer_profiles.id;

--
-- Name: growth_delivery_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_delivery_logs (
    id bigint NOT NULL,
    delivery_key text,
    action_key text,
    rule_key text,
    customer_id bigint,
    store_id text,
    channel text NOT NULL,
    external_userid text,
    provider_msg_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    result jsonb DEFAULT '{}'::jsonb,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_delivery_logs FORCE ROW LEVEL SECURITY;

--
-- Name: growth_delivery_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_delivery_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_delivery_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_delivery_logs_id_seq OWNED BY growth_delivery_logs.id;

--
-- Name: growth_execution_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_execution_logs (
    id bigint NOT NULL,
    action_key text,
    strategy_key text,
    store_id text,
    action_type text NOT NULL,
    decision text NOT NULL,
    operator_username text,
    operator_role text,
    before_payload jsonb DEFAULT '{}'::jsonb,
    after_payload jsonb DEFAULT '{}'::jsonb,
    decision_reason text,
    result_summary text,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_execution_logs FORCE ROW LEVEL SECURITY;

--
-- Name: growth_execution_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_execution_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_execution_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_execution_logs_id_seq OWNED BY growth_execution_logs.id;

--
-- Name: growth_holdout_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_holdout_members (
    phone text NOT NULL,
    campaign_key text NOT NULL,
    store_id text,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_holdout_members FORCE ROW LEVEL SECURITY;

--
-- Name: growth_learnings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_learnings (
    id bigint NOT NULL,
    source_type text DEFAULT 'ab_test'::text NOT NULL,
    source_id text DEFAULT ''::text,
    store_code text DEFAULT ''::text,
    channel text DEFAULT ''::text,
    scene text DEFAULT ''::text,
    audience_tag text DEFAULT ''::text,
    variable text NOT NULL,
    winning_value text NOT NULL,
    losing_value text DEFAULT ''::text,
    effect_desc text DEFAULT ''::text,
    sample_size integer DEFAULT 0,
    confidence text DEFAULT 'medium'::text NOT NULL,
    valid_until date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_verified boolean DEFAULT false NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_learnings FORCE ROW LEVEL SECURITY;

--
-- Name: growth_learnings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_learnings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_learnings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_learnings_id_seq OWNED BY growth_learnings.id;

--
-- Name: growth_menu_health_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_menu_health_reports (
    id bigint NOT NULL,
    report_month text NOT NULL,
    store_code text DEFAULT ''::text NOT NULL,
    report_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    generated_by text,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_menu_health_reports FORCE ROW LEVEL SECURITY;

--
-- Name: growth_menu_health_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_menu_health_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_menu_health_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_menu_health_reports_id_seq OWNED BY growth_menu_health_reports.id;

--
-- Name: growth_profile_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_profile_signals (
    id bigint NOT NULL,
    customer_id bigint,
    signal_type text NOT NULL,
    signal_key text NOT NULL,
    signal_value text,
    signal_score numeric,
    source text,
    store_id text,
    campaign_id text,
    occurred_at timestamp with time zone DEFAULT now(),
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_profile_signals FORCE ROW LEVEL SECURITY;

--
-- Name: growth_profile_signals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_profile_signals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_profile_signals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_profile_signals_id_seq OWNED BY growth_profile_signals.id;

--
-- Name: growth_segment_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_segment_members (
    phone text NOT NULL,
    segment_key text NOT NULL,
    store_id text,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_segment_members FORCE ROW LEVEL SECURITY;

--
-- Name: growth_sms_suppression; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_sms_suppression (
    phone text NOT NULL,
    reason text NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_sms_suppression FORCE ROW LEVEL SECURITY;

--
-- Name: growth_solution_rounds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_solution_rounds (
    id bigint NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL,
    store character varying(200) NOT NULL,
    problem_key character varying(120) NOT NULL,
    problem_title character varying(255),
    round_no integer DEFAULT 1 NOT NULL,
    metric_label character varying(120),
    metric_key character varying(60),
    unit character varying(20),
    baseline_value numeric(14,2),
    origin_baseline numeric(14,2),
    target_value numeric(14,2),
    actual_value numeric(14,2),
    achievement_rate numeric(6,4),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    tasks_done_at timestamp with time zone,
    measure_end_date date,
    review_report jsonb,
    decision character varying(20),
    closed_at timestamp with time zone,
    created_by character varying(120)
);

--
-- Name: growth_solution_rounds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_solution_rounds_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_solution_rounds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_solution_rounds_id_seq OWNED BY growth_solution_rounds.id;

--
-- Name: growth_solution_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_solution_tasks (
    id bigint NOT NULL,
    round_id bigint NOT NULL,
    template_code character varying(80),
    title character varying(255) NOT NULL,
    description text,
    assignee_username character varying(120) NOT NULL,
    assignee_name character varying(120),
    due_date date,
    phase character varying(40),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    done_at timestamp with time zone,
    done_note text,
    reminder_count integer DEFAULT 0 NOT NULL,
    last_reminded_at timestamp with time zone,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: growth_solution_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_solution_tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_solution_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_solution_tasks_id_seq OWNED BY growth_solution_tasks.id;

--
-- Name: growth_stored_value_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_stored_value_members (
    card_no text NOT NULL,
    member_name text,
    phone text,
    level text,
    tags text,
    store_id text,
    balance_fen integer DEFAULT 0,
    last_consume_date date,
    last_recharge_date date,
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_stored_value_members FORCE ROW LEVEL SECURITY;

--
-- Name: growth_strategy_evaluations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_strategy_evaluations (
    id bigint NOT NULL,
    strategy_key text,
    store_id text,
    campaign_id text,
    title text NOT NULL,
    feasibility_score integer DEFAULT 0,
    fit_score integer DEFAULT 0,
    cost_risk_score integer DEFAULT 0,
    case_similarity_score integer DEFAULT 0,
    clarity_score integer DEFAULT 0,
    channel_score integer DEFAULT 0,
    reviewable_score integer DEFAULT 0,
    total_score numeric DEFAULT 0,
    detail jsonb DEFAULT '{}'::jsonb,
    feedback text,
    feedback_rating integer,
    status text DEFAULT 'proposed'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_strategy_evaluations FORCE ROW LEVEL SECURITY;

--
-- Name: growth_strategy_evaluations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_strategy_evaluations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_strategy_evaluations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_strategy_evaluations_id_seq OWNED BY growth_strategy_evaluations.id;

--
-- Name: growth_strategy_explanations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_strategy_explanations (
    id bigint NOT NULL,
    strategy_key text NOT NULL,
    store_id text,
    customer_segment text,
    why_this_audience text,
    why_now text,
    why_this_action text,
    expected_result text,
    historical_reference text,
    risk_notes text,
    evidence jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_strategy_explanations FORCE ROW LEVEL SECURITY;

--
-- Name: growth_strategy_explanations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_strategy_explanations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_strategy_explanations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_strategy_explanations_id_seq OWNED BY growth_strategy_explanations.id;

--
-- Name: growth_sync_failures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_sync_failures (
    id bigint NOT NULL,
    source text DEFAULT 'miniprogram'::text,
    event_type text,
    payload jsonb DEFAULT '{}'::jsonb,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_sync_failures FORCE ROW LEVEL SECURITY;

--
-- Name: growth_sync_failures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_sync_failures_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_sync_failures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_sync_failures_id_seq OWNED BY growth_sync_failures.id;

--
-- Name: growth_task_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_task_templates (
    id bigint NOT NULL,
    problem_key character varying(60) NOT NULL,
    code character varying(80) NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    assignee_role character varying(40) DEFAULT 'store_manager'::character varying NOT NULL,
    phase character varying(40),
    sort integer DEFAULT 0 NOT NULL,
    enabled boolean DEFAULT true NOT NULL
);

--
-- Name: growth_task_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_task_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_task_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_task_templates_id_seq OWNED BY growth_task_templates.id;

--
-- Name: growth_touch_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS growth_touch_rules (
    id bigint NOT NULL,
    rule_key text NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT true,
    priority integer DEFAULT 100,
    auto_execute boolean DEFAULT true,
    criteria jsonb DEFAULT '{}'::jsonb,
    action_type text DEFAULT 'send_message'::text NOT NULL,
    action_payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    owner text,
    note text,
    approved_by text,
    approved_at timestamp with time zone,
    last_run_at timestamp with time zone,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY growth_touch_rules FORCE ROW LEVEL SECURITY;

--
-- Name: growth_touch_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS growth_touch_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_touch_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE growth_touch_rules_id_seq OWNED BY growth_touch_rules.id;

--
-- Name: hr_rating_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS hr_rating_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    config_key character varying(80) NOT NULL,
    config jsonb NOT NULL,
    enabled boolean DEFAULT true,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY hr_rating_configs FORCE ROW LEVEL SECURITY;

--
-- Name: hrms_leave_domain; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS hrms_leave_domain (
    id text NOT NULL,
    leave_balance_overrides jsonb DEFAULT '{}'::jsonb,
    leave_balance_adjustments jsonb DEFAULT '[]'::jsonb,
    leave_cumulative_close_snapshots jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY hrms_leave_domain FORCE ROW LEVEL SECURITY;

--
-- Name: hrms_payroll_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS hrms_payroll_history (
    id bigint NOT NULL,
    record_type character varying(40) NOT NULL,
    username character varying(100),
    month character varying(7),
    store character varying(100),
    before_amount numeric(12,2),
    after_amount numeric(12,2),
    delta_amount numeric(12,2) GENERATED ALWAYS AS ((COALESCE(after_amount, (0)::numeric) - COALESCE(before_amount, (0)::numeric))) STORED,
    before_value jsonb,
    after_value jsonb,
    reason text,
    source character varying(60),
    operator_username character varying(100),
    operator_role character varying(60),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    idempotency_key character varying(200),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY hrms_payroll_history FORCE ROW LEVEL SECURITY;

--
-- Name: hrms_payroll_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS hrms_payroll_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: hrms_payroll_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE hrms_payroll_history_id_seq OWNED BY hrms_payroll_history.id;

--
-- Name: hrms_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS hrms_state (
    key text NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

--
-- Name: hrms_state_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS hrms_state_audit (
    id bigint NOT NULL,
    occurred_at timestamp with time zone DEFAULT now(),
    old_dr_count integer,
    new_dr_count integer,
    old_updated_at timestamp with time zone,
    new_updated_at timestamp with time zone,
    query text
);

--
-- Name: hrms_state_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS hrms_state_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: hrms_state_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE hrms_state_audit_id_seq OWNED BY hrms_state_audit.id;

--
-- Name: hrms_state_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS hrms_state_snapshots (
    id bigint NOT NULL,
    state_key text DEFAULT 'default'::text NOT NULL,
    data jsonb NOT NULL,
    byte_size integer,
    source text DEFAULT 'scheduled'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: hrms_state_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS hrms_state_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: hrms_state_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE hrms_state_snapshots_id_seq OWNED BY hrms_state_snapshots.id;

--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key text NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY idempotency_keys FORCE ROW LEVEL SECURITY;

--
-- Name: ingredient_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS ingredient_categories (
    id bigint NOT NULL,
    name character varying(100) NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY ingredient_categories FORCE ROW LEVEL SECURITY;

--
-- Name: ingredient_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS ingredient_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: ingredient_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE ingredient_categories_id_seq OWNED BY ingredient_categories.id;

--
-- Name: ingredient_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS ingredient_library (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(100),
    default_unit character varying(50),
    notes text,
    created_by character varying(120),
    created_at timestamp with time zone DEFAULT now(),
    brand character varying(100),
    spec character varying(200),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY ingredient_library FORCE ROW LEVEL SECURITY;

--
-- Name: ingredient_library_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS ingredient_library_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: ingredient_library_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE ingredient_library_id_seq OWNED BY ingredient_library.id;

--
-- Name: kitchen_exec_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS kitchen_exec_logs (
    id bigint NOT NULL,
    store character varying(200) NOT NULL,
    station character varying(100) NOT NULL,
    dish_name character varying(255) NOT NULL,
    employee_username character varying(120) NOT NULL,
    employee_name character varying(120),
    task_date date DEFAULT CURRENT_DATE NOT NULL,
    confirmed_at timestamp with time zone DEFAULT now(),
    note text,
    sop_id text,
    schedule_time character varying(20) DEFAULT ''::character varying NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY kitchen_exec_logs FORCE ROW LEVEL SECURITY;

--
-- Name: kitchen_exec_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS kitchen_exec_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: kitchen_exec_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE kitchen_exec_logs_id_seq OWNED BY kitchen_exec_logs.id;

--
-- Name: kitchen_sop_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS kitchen_sop_steps (
    id bigint NOT NULL,
    dish_name character varying(255) NOT NULL,
    store character varying(200) DEFAULT '*'::character varying NOT NULL,
    station character varying(100) NOT NULL,
    step_seq integer NOT NULL,
    action text NOT NULL,
    time_limit_seconds integer,
    quality_standard text,
    common_failure text,
    failure_action text,
    is_critical boolean DEFAULT false,
    feishu_record_id character varying(120),
    enabled boolean DEFAULT true,
    synced_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY kitchen_sop_steps FORCE ROW LEVEL SECURITY;

--
-- Name: kitchen_sop_steps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS kitchen_sop_steps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: kitchen_sop_steps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE kitchen_sop_steps_id_seq OWNED BY kitchen_sop_steps.id;

--
-- Name: kitchen_step_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS kitchen_step_logs (
    id bigint NOT NULL,
    store character varying(200) NOT NULL,
    station character varying(100) NOT NULL,
    dish_name character varying(255) NOT NULL,
    step_seq integer NOT NULL,
    step_action text,
    employee_username character varying(120) NOT NULL,
    employee_name character varying(120),
    task_date date DEFAULT CURRENT_DATE NOT NULL,
    punched_at timestamp with time zone DEFAULT now(),
    schedule_time character varying(20) DEFAULT ''::character varying NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY kitchen_step_logs FORCE ROW LEVEL SECURITY;

--
-- Name: kitchen_step_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS kitchen_step_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: kitchen_step_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE kitchen_step_logs_id_seq OWNED BY kitchen_step_logs.id;

--
-- Name: knowledge_edit_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS knowledge_edit_history (
    id bigint NOT NULL,
    knowledge_id uuid NOT NULL,
    field character varying(32) NOT NULL,
    old_value text,
    new_value text,
    editor character varying(100),
    editor_role character varying(50),
    edited_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY knowledge_edit_history FORCE ROW LEVEL SECURITY;

--
-- Name: knowledge_edit_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS knowledge_edit_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: knowledge_edit_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE knowledge_edit_history_id_seq OWNED BY knowledge_edit_history.id;

--
-- Name: kpi_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS kpi_snapshots (
    id integer NOT NULL,
    snapshot_date date NOT NULL,
    store text NOT NULL,
    brand text,
    ttfr_p90_minutes numeric(10,1),
    ttc_p90_hours numeric(10,1),
    timeout_rate numeric(5,2),
    false_positive_rate numeric(5,2),
    evidence_coverage_rate numeric(5,2),
    first_pass_rate numeric(5,2),
    avg_remind_count numeric(5,2),
    escalation_rate numeric(5,2),
    escalation_resolve_rate numeric(5,2),
    total_tasks integer DEFAULT 0,
    closed_tasks integer DEFAULT 0,
    overdue_tasks integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY kpi_snapshots FORCE ROW LEVEL SECURITY;

--
-- Name: kpi_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS kpi_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: kpi_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE kpi_snapshots_id_seq OWNED BY kpi_snapshots.id;

--
-- Name: kpi_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS kpi_targets (
    id integer NOT NULL,
    store text,
    brand text,
    metric_key text NOT NULL,
    target_value numeric NOT NULL,
    warning_value numeric,
    unit text,
    direction text DEFAULT 'lower_better'::text,
    period text DEFAULT 'monthly'::text,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY kpi_targets FORCE ROW LEVEL SECURITY;

--
-- Name: kpi_targets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS kpi_targets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: kpi_targets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE kpi_targets_id_seq OWNED BY kpi_targets.id;

--
-- Name: licenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS licenses (
    id integer NOT NULL,
    tenant_id character varying(80) NOT NULL,
    license_key text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    allowed_features jsonb DEFAULT '[]'::jsonb,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: COLUMN licenses.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN licenses.status IS 'active | revoked | expired';

--
-- Name: COLUMN licenses.last_seen_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN licenses.last_seen_at IS '最近一次心跳校验通过时间，用于离线宽限期判断';

--
-- Name: licenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS licenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: licenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE licenses_id_seq OWNED BY licenses.id;

--
-- Name: marketing_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id integer NOT NULL,
    store text,
    title text NOT NULL,
    description text,
    status text DEFAULT 'planned'::text,
    start_date date,
    end_date date,
    target_metric text,
    target_value numeric,
    actual_value numeric,
    budget_amount numeric,
    spent_amount numeric DEFAULT 0,
    notes text,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    evaluation_score numeric(3,1),
    evaluation_outcome text,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL,
    CONSTRAINT marketing_campaigns_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'active'::text, 'paused'::text, 'completed'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY marketing_campaigns FORCE ROW LEVEL SECURITY;

--
-- Name: marketing_campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS marketing_campaigns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: marketing_campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE marketing_campaigns_id_seq OWNED BY marketing_campaigns.id;

--
-- Name: marketing_payment_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS marketing_payment_rules (
    rule_key text NOT NULL,
    store_id text NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    target_tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    trigger_value text DEFAULT ''::text,
    member_template_id text DEFAULT ''::text NOT NULL,
    daily_user_limit integer,
    global_daily_limit integer,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY marketing_payment_rules FORCE ROW LEVEL SECURITY;

--
-- Name: marketing_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS marketing_templates (
    id integer NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    description text,
    actions jsonb,
    expected_roi numeric,
    budget_range text,
    duration_days integer DEFAULT 7,
    success_rate numeric,
    use_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    channel text DEFAULT ''::text,
    target_audience text DEFAULT 'all'::text,
    payload_template jsonb DEFAULT '{}'::jsonb,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY marketing_templates FORCE ROW LEVEL SECURITY;

--
-- Name: marketing_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS marketing_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: marketing_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE marketing_templates_id_seq OWNED BY marketing_templates.id;

--
-- Name: master_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS master_events (
    id integer NOT NULL,
    task_id text NOT NULL,
    event_type text NOT NULL,
    from_agent text,
    to_agent text,
    status_before text,
    status_after text,
    payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY master_events FORCE ROW LEVEL SECURITY;

--
-- Name: master_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS master_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: master_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE master_events_id_seq OWNED BY master_events.id;

--
-- Name: master_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS master_tasks (
    id integer NOT NULL,
    task_id text NOT NULL,
    status text DEFAULT 'pending_audit'::text NOT NULL,
    source text DEFAULT 'scheduled_audit'::text,
    source_ref text,
    current_agent text,
    category text,
    severity text DEFAULT 'medium'::text,
    store text,
    brand text,
    assignee_username text,
    assignee_role text,
    title text,
    detail text,
    source_data jsonb DEFAULT '{}'::jsonb,
    audit_result jsonb DEFAULT '{}'::jsonb,
    dispatch_data jsonb DEFAULT '{}'::jsonb,
    response_text text,
    response_images jsonb DEFAULT '[]'::jsonb,
    review_result jsonb DEFAULT '{}'::jsonb,
    settlement_data jsonb DEFAULT '{}'::jsonb,
    score_impact numeric(5,1) DEFAULT 0,
    feishu_msg_ids jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    dispatched_at timestamp with time zone,
    responded_at timestamp with time zone,
    resolved_at timestamp with time zone,
    settled_at timestamp with time zone,
    closed_at timestamp with time zone,
    timeout_at timestamp with time zone,
    escalation_level integer DEFAULT 0,
    escalated_to text,
    escalation_history jsonb DEFAULT '[]'::jsonb,
    sla_due_at timestamp with time zone,
    first_response_at timestamp with time zone,
    remind_count integer DEFAULT 0,
    evidence_refs jsonb DEFAULT '[]'::jsonb,
    resolution_code text,
    last_reminder_at timestamp with time zone,
    hr_performance_recorded boolean DEFAULT false,
    review_count integer DEFAULT 0,
    review_passed boolean,
    review_feedback text,
    response_at timestamp with time zone,
    parent_task_id text,
    related_task_ids jsonb DEFAULT '[]'::jsonb,
    created_from text,
    assignee_agent text,
    task_intent jsonb DEFAULT '{}'::jsonb,
    acceptance_rules jsonb DEFAULT '[]'::jsonb,
    evidence_requirements jsonb DEFAULT '[]'::jsonb,
    schedule_rule jsonb,
    next_run_at timestamp with time zone,
    priority text,
    last_activity_at timestamp with time zone,
    quality_score numeric(3,2),
    assignee_human text,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY master_tasks FORCE ROW LEVEL SECURITY;

--
-- Name: master_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS master_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: master_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE master_tasks_id_seq OWNED BY master_tasks.id;

--
-- Name: member_consumption; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS member_consumption (
    id bigint NOT NULL,
    order_no text NOT NULL,
    phone text,
    card_no text,
    member_level text,
    card_scheme text,
    member_name text,
    order_type text,
    order_source text,
    biz_date date,
    transaction_time timestamp with time zone,
    store text,
    amount numeric,
    store_label text,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: member_consumption_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS member_consumption_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: member_consumption_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE member_consumption_id_seq OWNED BY member_consumption.id;

--
-- Name: ops_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS ops_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    biz_date date NOT NULL,
    store character varying(200) NOT NULL,
    brand character varying(120),
    task_type character varying(60) NOT NULL,
    schedule_key character varying(100) NOT NULL,
    dedupe_key character varying(220) NOT NULL,
    title character varying(220) NOT NULL,
    instructions text,
    checklist jsonb DEFAULT '[]'::jsonb NOT NULL,
    required_photos integer DEFAULT 1 NOT NULL,
    assignee_username character varying(100) NOT NULL,
    assignee_role character varying(60) NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    due_at timestamp without time zone NOT NULL,
    completed_at timestamp without time zone,
    evidence_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    evidence_note text,
    feedback_score integer,
    feedback_text text,
    source character varying(60) DEFAULT 'ops_agent'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY ops_tasks FORCE ROW LEVEL SECURITY;

--
-- Name: platform_data_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS platform_data_cache (
    id integer NOT NULL,
    platform character varying(50) NOT NULL,
    store character varying(100) NOT NULL,
    data jsonb,
    fetched_at timestamp without time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY platform_data_cache FORCE ROW LEVEL SECURITY;

--
-- Name: platform_data_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS platform_data_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: platform_data_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE platform_data_cache_id_seq OWNED BY platform_data_cache.id;

--
-- Name: point_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS point_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    approval_id text,
    username text DEFAULT ''::text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    store text DEFAULT ''::text NOT NULL,
    item_name text DEFAULT ''::text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    points numeric(8,2) DEFAULT 0 NOT NULL,
    amount numeric(10,2) DEFAULT 0 NOT NULL,
    approved_at timestamp with time zone,
    approved_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY point_records FORCE ROW LEVEL SECURITY;

--
-- Name: pos_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS pos_order_items (
    id bigint NOT NULL,
    order_no text NOT NULL,
    store_name text,
    store_code text,
    biz_date date,
    sku text,
    dish_name text,
    spec text,
    tags text,
    unit_price numeric DEFAULT 0,
    qty numeric DEFAULT 0,
    unit text,
    amount_before_discount numeric DEFAULT 0,
    service_fee numeric DEFAULT 0,
    discount numeric DEFAULT 0,
    amount_after_discount numeric DEFAULT 0,
    category_mid text,
    category text,
    synced_at timestamp with time zone DEFAULT now(),
    department text,
    table_name text,
    table_area text,
    sale_type text,
    order_type text,
    order_source text,
    order_time timestamp with time zone,
    checkout_time timestamp with time zone,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY pos_order_items FORCE ROW LEVEL SECURITY;

--
-- Name: pos_order_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS pos_order_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: pos_order_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE pos_order_items_id_seq OWNED BY pos_order_items.id;

--
-- Name: pos_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS pos_orders (
    id bigint NOT NULL,
    order_no text NOT NULL,
    order_source text,
    biz_date date,
    order_time timestamp with time zone,
    checkout_time timestamp with time zone,
    order_status text,
    amount_before_discount numeric DEFAULT 0,
    total_discount numeric DEFAULT 0,
    amount_after_discount numeric DEFAULT 0,
    payment_method text,
    payment_count integer DEFAULT 0,
    member_name text,
    phone text,
    order_type text,
    table_no text,
    diners integer,
    duration text,
    store_id text,
    customer_id bigint,
    synced_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    seq_no text,
    store_name text,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY pos_orders FORCE ROW LEVEL SECURITY;

--
-- Name: pos_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS pos_orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: pos_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE pos_orders_id_seq OWNED BY pos_orders.id;

--
-- Name: recipe_component_ingredients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS recipe_component_ingredients (
    id bigint NOT NULL,
    component_id bigint NOT NULL,
    ingredient_name character varying(255) NOT NULL,
    quantity numeric(10,2),
    unit character varying(50),
    is_pack boolean DEFAULT false,
    notes text,
    sort_order integer DEFAULT 0,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY recipe_component_ingredients FORCE ROW LEVEL SECURITY;

--
-- Name: recipe_component_ingredients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS recipe_component_ingredients_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: recipe_component_ingredients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE recipe_component_ingredients_id_seq OWNED BY recipe_component_ingredients.id;

--
-- Name: recipe_component_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS recipe_component_steps (
    id bigint NOT NULL,
    component_id bigint NOT NULL,
    step_seq integer NOT NULL,
    instruction text NOT NULL,
    notes text,
    sort_order integer DEFAULT 0,
    media_url character varying(500),
    media_type character varying(20),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY recipe_component_steps FORCE ROW LEVEL SECURITY;

--
-- Name: recipe_component_steps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS recipe_component_steps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: recipe_component_steps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE recipe_component_steps_id_seq OWNED BY recipe_component_steps.id;

--
-- Name: recipe_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS recipe_components (
    id bigint NOT NULL,
    recipe_id bigint NOT NULL,
    name character varying(255) NOT NULL,
    notes text,
    sort_order integer DEFAULT 0,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY recipe_components FORCE ROW LEVEL SECURITY;

--
-- Name: recipe_components_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS recipe_components_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: recipe_components_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE recipe_components_id_seq OWNED BY recipe_components.id;

--
-- Name: recipes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS recipes (
    id bigint NOT NULL,
    dish_name character varying(255) NOT NULL,
    store character varying(200) DEFAULT '*'::character varying NOT NULL,
    station character varying(100),
    version character varying(20) DEFAULT '1.0'::character varying NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    notes text,
    created_by character varying(120),
    updated_by character varying(120),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    brand character varying(100),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY recipes FORCE ROW LEVEL SECURITY;

--
-- Name: recipes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS recipes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: recipes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE recipes_id_seq OWNED BY recipes.id;

--
-- Name: regression_check_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS regression_check_results (
    id integer NOT NULL,
    check_data jsonb NOT NULL,
    passed boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY regression_check_results FORCE ROW LEVEL SECURITY;

--
-- Name: regression_check_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS regression_check_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: regression_check_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE regression_check_results_id_seq OWNED BY regression_check_results.id;

--
-- Name: rhythm_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS rhythm_logs (
    id integer NOT NULL,
    rhythm_type text NOT NULL,
    execution_date date NOT NULL,
    execution_time time without time zone,
    status text DEFAULT 'success'::text,
    result_summary jsonb DEFAULT '{}'::jsonb,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY rhythm_logs FORCE ROW LEVEL SECURITY;

--
-- Name: rhythm_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS rhythm_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: rhythm_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE rhythm_logs_id_seq OWNED BY rhythm_logs.id;

--
-- Name: sales_growth_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS sales_growth_snapshot (
    id bigint NOT NULL,
    snapshot_date date NOT NULL,
    store_code text NOT NULL,
    dish_name text NOT NULL,
    category text DEFAULT ''::text,
    order_count integer DEFAULT 0,
    qty integer DEFAULT 0,
    revenue numeric(12,2) DEFAULT 0,
    avg_unit_price numeric(8,2),
    lunch_qty integer DEFAULT 0,
    dinner_qty integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY sales_growth_snapshot FORCE ROW LEVEL SECURITY;

--
-- Name: sales_growth_snapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS sales_growth_snapshot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: sales_growth_snapshot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE sales_growth_snapshot_id_seq OWNED BY sales_growth_snapshot.id;

--
-- Name: sales_raw; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS sales_raw (
    id integer NOT NULL,
    store text NOT NULL,
    biz_type text NOT NULL,
    slot text NOT NULL,
    date date NOT NULL,
    weekday integer,
    order_time timestamp with time zone,
    checkout_time timestamp with time zone,
    dish_name text,
    department text,
    category text,
    unit text,
    price numeric DEFAULT 0,
    qty numeric DEFAULT 0,
    sales_amount numeric DEFAULT 0,
    discount numeric DEFAULT 0,
    revenue numeric DEFAULT 0,
    source_file text,
    created_at timestamp with time zone DEFAULT now(),
    dish_code character varying(120),
    category_code character varying(120),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY sales_raw FORCE ROW LEVEL SECURITY;

--
-- Name: sales_raw_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS sales_raw_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: sales_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE sales_raw_id_seq OWNED BY sales_raw.id;

--
-- Name: scheduler_heartbeat; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS scheduler_heartbeat (
    task_name text NOT NULL,
    last_beat timestamp with time zone DEFAULT now(),
    run_count bigint DEFAULT 0,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY scheduler_heartbeat FORCE ROW LEVEL SECURITY;

--
-- Name: schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS schedules (
    id integer NOT NULL,
    store text NOT NULL,
    employee_username text NOT NULL,
    employee_name text,
    shift_date date NOT NULL,
    shift_type text DEFAULT 'normal'::text NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    is_rest boolean DEFAULT false,
    notes text,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY schedules FORCE ROW LEVEL SECURITY;

--
-- Name: schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE schedules_id_seq OWNED BY schedules.id;

--
-- Name: sop_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS sop_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    source_review_id uuid,
    store text NOT NULL,
    brand text,
    event_detail text NOT NULL,
    analysis text,
    improvement_actions text,
    created_by text,
    confirmed_by text,
    confirmed_at timestamp with time zone,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY sop_cases FORCE ROW LEVEL SECURITY;

--
-- Name: sop_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS sop_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dish_name text NOT NULL,
    station text NOT NULL,
    store text,
    title text NOT NULL,
    category text DEFAULT 'product'::text,
    version integer DEFAULT 1,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY sop_definitions FORCE ROW LEVEL SECURITY;

--
-- Name: sop_distributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS sop_distributions (
    id integer NOT NULL,
    sop_version_id integer,
    employee_username text NOT NULL,
    employee_name text,
    store text,
    distributed_at timestamp with time zone DEFAULT now(),
    feishu_msg_id text,
    read_at timestamp with time zone,
    read_confirmed boolean DEFAULT false,
    quiz_score numeric(5,2),
    quiz_passed boolean,
    quiz_completed_at timestamp with time zone,
    quiz_answers jsonb DEFAULT '[]'::jsonb,
    reminder_count integer DEFAULT 0,
    last_reminder_at timestamp with time zone,
    status text DEFAULT 'sent'::text,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY sop_distributions FORCE ROW LEVEL SECURITY;

--
-- Name: sop_distributions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS sop_distributions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: sop_distributions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE sop_distributions_id_seq OWNED BY sop_distributions.id;

--
-- Name: sop_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS sop_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sop_id uuid,
    step_id uuid,
    question text NOT NULL,
    options jsonb,
    correct_answer text NOT NULL,
    explanation text,
    difficulty text DEFAULT 'medium'::text,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY sop_questions FORCE ROW LEVEL SECURITY;

--
-- Name: sop_quiz_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS sop_quiz_questions (
    id integer NOT NULL,
    sop_id text NOT NULL,
    question text NOT NULL,
    options jsonb DEFAULT '[]'::jsonb NOT NULL,
    correct_answer integer NOT NULL,
    explanation text,
    difficulty text DEFAULT 'easy'::text,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY sop_quiz_questions FORCE ROW LEVEL SECURITY;

--
-- Name: sop_quiz_questions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS sop_quiz_questions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: sop_quiz_questions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE sop_quiz_questions_id_seq OWNED BY sop_quiz_questions.id;

--
-- Name: sop_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS sop_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sop_id uuid,
    seq integer NOT NULL,
    action text NOT NULL,
    responsible_role text,
    time_limit_seconds integer,
    quality_standard text,
    common_failure text,
    failure_action text,
    evidence_required text,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY sop_steps FORCE ROW LEVEL SECURITY;

--
-- Name: sop_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS sop_versions (
    id integer NOT NULL,
    sop_id text NOT NULL,
    title text NOT NULL,
    content text,
    version integer DEFAULT 1,
    category text,
    brand text,
    store text,
    target_roles text[] DEFAULT '{}'::text[],
    status text DEFAULT 'draft'::text,
    published_at timestamp with time zone,
    published_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY sop_versions FORCE ROW LEVEL SECURITY;

--
-- Name: sop_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS sop_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: sop_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE sop_versions_id_seq OWNED BY sop_versions.id;

--
-- Name: store_marketing_constraints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS store_marketing_constraints (
    id bigint NOT NULL,
    store_id text NOT NULL,
    brand text,
    min_discount_rate numeric,
    max_coupon_value_fen integer,
    monthly_budget_fen integer,
    max_touch_per_72h integer DEFAULT 1,
    cooldown_hours_after_payment integer DEFAULT 24,
    allowed_channels jsonb DEFAULT '[]'::jsonb,
    disallowed_campaign_types jsonb DEFAULT '[]'::jsonb,
    disallowed_dishes jsonb DEFAULT '[]'::jsonb,
    preferred_channels jsonb DEFAULT '[]'::jsonb,
    brand_voice_style text,
    execution_notes text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY store_marketing_constraints FORCE ROW LEVEL SECURITY;

--
-- Name: store_marketing_constraints_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS store_marketing_constraints_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: store_marketing_constraints_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE store_marketing_constraints_id_seq OWNED BY store_marketing_constraints.id;

--
-- Name: store_wecom_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS store_wecom_configs (
    id bigint NOT NULL,
    store_id text NOT NULL,
    corp_id text NOT NULL,
    corp_secret text NOT NULL,
    agent_id text DEFAULT ''::text,
    sender_userid text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY store_wecom_configs FORCE ROW LEVEL SECURITY;

--
-- Name: store_wecom_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS store_wecom_configs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: store_wecom_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE store_wecom_configs_id_seq OWNED BY store_wecom_configs.id;

--
-- Name: table_visit_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS table_visit_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    store character varying(200) NOT NULL,
    brand character varying(120),
    table_number character varying(20),
    guest_count integer DEFAULT 0,
    amount numeric(10,2) DEFAULT 0,
    has_reservation boolean DEFAULT false,
    dissatisfaction_dish text,
    feedback text,
    feishu_record_id character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    reservation_time time without time zone,
    customer_type character varying(50),
    order_type character varying(50),
    service_rating integer DEFAULT 0,
    food_rating integer DEFAULT 0,
    environment_rating integer DEFAULT 0,
    waiter_name character varying(100),
    promotion_info text,
    weather character varying(50),
    peak_hours boolean DEFAULT false,
    customer_complaint text,
    complaint_resolution text,
    satisfaction_level character varying(20),
    repeat_customer boolean DEFAULT false,
    special_requests text,
    payment_method character varying(50),
    order_duration integer DEFAULT 0,
    table_turnover integer DEFAULT 0,
    dish_recommendations text,
    allergic_info text,
    celebration_type character varying(50),
    visit_purpose character varying(100),
    companion_info text,
    customer_age character varying(20),
    customer_gender character varying(10),
    visit_frequency character varying(50),
    preferred_dishes text,
    unsatisfied_items text,
    suggested_improvements text,
    staff_performance text,
    facility_issues text,
    hygiene_rating integer DEFAULT 0,
    value_rating integer DEFAULT 0,
    ambiance_rating integer DEFAULT 0,
    noise_level character varying(20),
    temperature character varying(20),
    lighting character varying(20),
    music_volume character varying(20),
    seating_comfort character varying(20),
    queue_time integer DEFAULT 0,
    service_speed character varying(20),
    order_accuracy character varying(20),
    staff_attitude character varying(20),
    problem_resolution text,
    manager_intervention boolean DEFAULT false,
    compensation_provided text,
    follow_up_required boolean DEFAULT false,
    follow_up_details text,
    additional_notes text,
    rush_dish_content text,
    satisfaction_main_reason text,
    dissatisfaction_main_reason text,
    referral_channel text,
    first_visit_label text,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY table_visit_records FORCE ROW LEVEL SECURITY;

--
-- Name: task_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS task_assignments (
    id integer NOT NULL,
    task_id text NOT NULL,
    assignee_type text DEFAULT 'agent'::text NOT NULL,
    assignee_key text NOT NULL,
    assigned_by text,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    unassigned_at timestamp with time zone,
    assignment_reason text,
    metadata jsonb DEFAULT '{}'::jsonb,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY task_assignments FORCE ROW LEVEL SECURITY;

--
-- Name: task_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS task_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: task_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE task_assignments_id_seq OWNED BY task_assignments.id;

--
-- Name: task_evidences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS task_evidences (
    id bigint NOT NULL,
    task_id text NOT NULL,
    evidence_type text DEFAULT 'text'::text NOT NULL,
    content text,
    file_url text,
    submitted_by text,
    submitted_role text,
    review_status text DEFAULT 'pending'::text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY task_evidences FORCE ROW LEVEL SECURITY;

--
-- Name: task_evidences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS task_evidences_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: task_evidences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE task_evidences_id_seq OWNED BY task_evidences.id;

--
-- Name: task_experience_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS task_experience_logs (
    id integer NOT NULL,
    category text NOT NULL,
    store text,
    title_pattern text,
    assignee_agent text,
    resolution_code text,
    quality_score numeric(3,2),
    time_to_close_hours numeric(10,2),
    review_passed boolean,
    evidence_count integer DEFAULT 0,
    reminder_count integer DEFAULT 0,
    was_escalated boolean DEFAULT false,
    lessons_learned text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY task_experience_logs FORCE ROW LEVEL SECURITY;

--
-- Name: task_experience_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS task_experience_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: task_experience_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE task_experience_logs_id_seq OWNED BY task_experience_logs.id;

--
-- Name: task_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS task_locks (
    id integer NOT NULL,
    task_id text NOT NULL,
    lock_type text DEFAULT 'claim'::text NOT NULL,
    locked_by text NOT NULL,
    locked_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY task_locks FORCE ROW LEVEL SECURITY;

--
-- Name: task_locks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS task_locks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: task_locks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE task_locks_id_seq OWNED BY task_locks.id;

--
-- Name: task_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS task_reviews (
    id bigint NOT NULL,
    task_id text NOT NULL,
    decision text NOT NULL,
    comment text,
    reviewed_by text,
    reviewed_role text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY task_reviews FORCE ROW LEVEL SECURITY;

--
-- Name: task_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS task_reviews_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: task_reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE task_reviews_id_seq OWNED BY task_reviews.id;

--
-- Name: task_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS task_runs (
    id integer NOT NULL,
    task_id text NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    run_status text DEFAULT 'started'::text NOT NULL,
    run_result jsonb DEFAULT '{}'::jsonb,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY task_runs FORCE ROW LEVEL SECURITY;

--
-- Name: task_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS task_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: task_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE task_runs_id_seq OWNED BY task_runs.id;

--
-- Name: telemetry_anomalies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS telemetry_anomalies (
    id integer NOT NULL,
    source_tenant_id character varying(80) NOT NULL,
    source_key character varying(200),
    data jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now()
);

--
-- Name: telemetry_anomalies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS telemetry_anomalies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: telemetry_anomalies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE telemetry_anomalies_id_seq OWNED BY telemetry_anomalies.id;

--
-- Name: telemetry_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS telemetry_campaigns (
    id integer NOT NULL,
    source_tenant_id character varying(80) NOT NULL,
    source_key character varying(200),
    data jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now()
);

--
-- Name: telemetry_campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS telemetry_campaigns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: telemetry_campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE telemetry_campaigns_id_seq OWNED BY telemetry_campaigns.id;

--
-- Name: telemetry_collect_cursor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS telemetry_collect_cursor (
    id integer NOT NULL,
    source_tenant_id character varying(80) NOT NULL,
    data jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now()
);

--
-- Name: telemetry_collect_cursor_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS telemetry_collect_cursor_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: telemetry_collect_cursor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE telemetry_collect_cursor_id_seq OWNED BY telemetry_collect_cursor.id;

--
-- Name: telemetry_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS telemetry_conversations (
    id integer NOT NULL,
    source_tenant_id character varying(80) NOT NULL,
    source_key character varying(200),
    data jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now()
);

--
-- Name: telemetry_conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS telemetry_conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: telemetry_conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE telemetry_conversations_id_seq OWNED BY telemetry_conversations.id;

--
-- Name: telemetry_daily_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS telemetry_daily_reports (
    id integer NOT NULL,
    source_tenant_id character varying(80) NOT NULL,
    source_key character varying(200),
    data jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now()
);

--
-- Name: telemetry_daily_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS telemetry_daily_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: telemetry_daily_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE telemetry_daily_reports_id_seq OWNED BY telemetry_daily_reports.id;

--
-- Name: telemetry_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS telemetry_events (
    id integer NOT NULL,
    source_tenant_id character varying(80) NOT NULL,
    source_key character varying(200),
    data jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now()
);

--
-- Name: telemetry_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS telemetry_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: telemetry_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE telemetry_events_id_seq OWNED BY telemetry_events.id;

--
-- Name: telemetry_ingest_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS telemetry_ingest_log (
    id integer NOT NULL,
    source_tenant_id character varying(80) NOT NULL,
    batch_types text[],
    row_counts integer[],
    total_rows integer,
    received_at timestamp with time zone DEFAULT now()
);

--
-- Name: telemetry_ingest_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS telemetry_ingest_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: telemetry_ingest_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE telemetry_ingest_log_id_seq OWNED BY telemetry_ingest_log.id;

--
-- Name: temp_staffing_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS temp_staffing_requests (
    id integer NOT NULL,
    store text NOT NULL,
    brand text,
    requested_by text NOT NULL,
    request_date date NOT NULL,
    needed_count integer DEFAULT 1,
    shift_type text,
    reason text,
    priority text DEFAULT 'normal'::text,
    status text DEFAULT 'pending'::text,
    approved_by text,
    assigned_staff jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY temp_staffing_requests FORCE ROW LEVEL SECURITY;

--
-- Name: temp_staffing_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS temp_staffing_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: temp_staffing_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE temp_staffing_requests_id_seq OWNED BY temp_staffing_requests.id;

--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS tenants (
    tenant_id character varying(80) NOT NULL,
    name character varying(200) NOT NULL,
    mode character varying(20) DEFAULT 'managed'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: COLUMN tenants.mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN tenants.mode IS 'managed(我们部署运营) | licensed(客户自有服务器租赁)';

--
-- Name: COLUMN tenants.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN tenants.status IS 'active | suspended | terminated';

--
-- Name: training_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS training_assignments (
    id integer NOT NULL,
    employee_username character varying(100) NOT NULL,
    topic_id integer NOT NULL,
    assigned_by character varying(100),
    due_date date,
    note text,
    created_at timestamp without time zone DEFAULT now(),
    require_practice boolean DEFAULT false,
    reminder_meta jsonb DEFAULT '{}'::jsonb,
    source character varying(30) DEFAULT 'manual'::character varying,
    related_track_id character varying(64),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY training_assignments FORCE ROW LEVEL SECURITY;

--
-- Name: training_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS training_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: training_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE training_assignments_id_seq OWNED BY training_assignments.id;

--
-- Name: training_certifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS training_certifications (
    id integer NOT NULL,
    session_id integer NOT NULL,
    employee_username character varying(100) NOT NULL,
    topic_id integer NOT NULL,
    media_url character varying(500),
    media_type character varying(20),
    ai_verdict character varying(20),
    ai_feedback text,
    ai_raw_response jsonb,
    manager_verdict character varying(20),
    manager_note text,
    manager_reviewed_by character varying(100),
    certified_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    ai_step_scores jsonb,
    ai_total_score integer,
    review_status character varying(20) DEFAULT 'pending'::character varying,
    manager_score integer,
    final_score integer,
    valid_until date,
    status character varying(20) DEFAULT 'valid'::character varying,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY training_certifications FORCE ROW LEVEL SECURITY;

--
-- Name: training_certifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS training_certifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: training_certifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE training_certifications_id_seq OWNED BY training_certifications.id;

--
-- Name: training_plan_phases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS training_plan_phases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid,
    week integer NOT NULL,
    phase_name text NOT NULL,
    sop_ids uuid[],
    exam_count integer DEFAULT 20,
    pass_score numeric(5,2) DEFAULT 90,
    status text DEFAULT 'pending'::text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY training_plan_phases FORCE ROW LEVEL SECURITY;

--
-- Name: training_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS training_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id text NOT NULL,
    employee_name text NOT NULL,
    store text,
    start_date date NOT NULL,
    status text DEFAULT 'active'::text,
    current_week integer DEFAULT 1,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY training_plans FORCE ROW LEVEL SECURITY;

--
-- Name: training_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS training_sessions (
    id integer NOT NULL,
    employee_username character varying(100) NOT NULL,
    topic_id integer NOT NULL,
    chat_history jsonb DEFAULT '[]'::jsonb,
    quiz_questions jsonb DEFAULT '[]'::jsonb,
    quiz_answers jsonb DEFAULT '[]'::jsonb,
    quiz_score integer,
    quiz_passed boolean DEFAULT false,
    status character varying(20) DEFAULT 'learning'::character varying,
    started_at timestamp without time zone DEFAULT now(),
    quiz_passed_at timestamp without time zone,
    certified_at timestamp without time zone,
    quiz_history jsonb DEFAULT '[]'::jsonb,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY training_sessions FORCE ROW LEVEL SECURITY;

--
-- Name: training_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS training_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: training_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE training_sessions_id_seq OWNED BY training_sessions.id;

--
-- Name: training_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS training_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    target_role text NOT NULL,
    assignee_username text NOT NULL,
    store text NOT NULL,
    brand text,
    status text DEFAULT 'pending'::text NOT NULL,
    progress_data jsonb DEFAULT '{}'::jsonb,
    due_date date,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY training_tasks FORCE ROW LEVEL SECURITY;

--
-- Name: training_topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS training_topics (
    id integer NOT NULL,
    title character varying(100) NOT NULL,
    "position" text NOT NULL,
    description text,
    key_points jsonb DEFAULT '[]'::jsonb,
    practice_task text,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_by character varying(100),
    created_at timestamp without time zone DEFAULT now(),
    kb_article_ids uuid[] DEFAULT '{}'::uuid[],
    store character varying(100) DEFAULT ''::character varying,
    step_rubric jsonb,
    promotion_required boolean DEFAULT false,
    validity_days integer DEFAULT 180,
    level character varying(20),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY training_topics FORCE ROW LEVEL SECURITY;

--
-- Name: training_topics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS training_topics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: training_topics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE training_topics_id_seq OWNED BY training_topics.id;

--
-- Name: user_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS user_reads (
    username character varying(100) NOT NULL,
    module character varying(50) NOT NULL,
    item_key character varying(160) NOT NULL,
    read_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY user_reads FORCE ROW LEVEL SECURITY;

--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS user_sessions (
    username character varying(100) NOT NULL,
    session_nonce character varying(64) NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY user_sessions FORCE ROW LEVEL SECURITY;

--
-- Name: wechat_work_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS wechat_work_customers (
    id bigint NOT NULL,
    external_userid text,
    name text,
    phone text,
    store_id text,
    note text,
    bind_customer_id bigint,
    import_batch text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id character varying(80) DEFAULT 'default'::character varying NOT NULL
);

ALTER TABLE ONLY wechat_work_customers FORCE ROW LEVEL SECURITY;

--
-- Name: wechat_work_customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS wechat_work_customers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: wechat_work_customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE wechat_work_customers_id_seq OWNED BY wechat_work_customers.id;

--
-- Name: ab_test_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY ab_test_results ALTER COLUMN id SET DEFAULT nextval('ab_test_results_id_seq'::regclass);

--
-- Name: ab_test_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY ab_test_tasks ALTER COLUMN id SET DEFAULT nextval('ab_test_tasks_id_seq'::regclass);

--
-- Name: acceptance_checklists id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY acceptance_checklists ALTER COLUMN id SET DEFAULT nextval('acceptance_checklists_id_seq'::regclass);

--
-- Name: action_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY action_plans ALTER COLUMN id SET DEFAULT nextval('action_plans_id_seq'::regclass);

--
-- Name: agent_admin_alert_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_admin_alert_log ALTER COLUMN id SET DEFAULT nextval('agent_admin_alert_log_id_seq'::regclass);

--
-- Name: agent_autonomous_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_autonomous_logs ALTER COLUMN id SET DEFAULT nextval('agent_autonomous_logs_id_seq'::regclass);

--
-- Name: agent_collaboration_archives id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_collaboration_archives ALTER COLUMN id SET DEFAULT nextval('agent_collaboration_archives_id_seq'::regclass);

--
-- Name: agent_memory id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_memory ALTER COLUMN id SET DEFAULT nextval('agent_memory_id_seq'::regclass);

--
-- Name: agent_task_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_task_logs ALTER COLUMN id SET DEFAULT nextval('agent_task_logs_id_seq'::regclass);

--
-- Name: agent_v2_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_v2_configs ALTER COLUMN id SET DEFAULT nextval('agent_v2_configs_id_seq'::regclass);

--
-- Name: agent_v2_cron_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_v2_cron_runs ALTER COLUMN id SET DEFAULT nextval('agent_v2_cron_runs_id_seq'::regclass);

--
-- Name: agent_v2_morning_briefing_sends id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_v2_morning_briefing_sends ALTER COLUMN id SET DEFAULT nextval('agent_v2_morning_briefing_sends_id_seq'::regclass);

--
-- Name: agent_v2_scheduled_report_sends id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_v2_scheduled_report_sends ALTER COLUMN id SET DEFAULT nextval('agent_v2_scheduled_report_sends_id_seq'::regclass);

--
-- Name: anomaly_pending_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY anomaly_pending_notifications ALTER COLUMN id SET DEFAULT nextval('anomaly_pending_notifications_id_seq'::regclass);

--
-- Name: anomaly_triggers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY anomaly_triggers ALTER COLUMN id SET DEFAULT nextval('anomaly_triggers_id_seq'::regclass);

--
-- Name: attendance_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY attendance_records ALTER COLUMN id SET DEFAULT nextval('attendance_records_id_seq'::regclass);

--
-- Name: auto_ops_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY auto_ops_runs ALTER COLUMN id SET DEFAULT nextval('auto_ops_runs_id_seq'::regclass);

--
-- Name: automated_test_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY automated_test_results ALTER COLUMN id SET DEFAULT nextval('automated_test_results_id_seq'::regclass);

--
-- Name: business_entity_relations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY business_entity_relations ALTER COLUMN id SET DEFAULT nextval('business_entity_relations_id_seq'::regclass);

--
-- Name: config_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY config_audit_log ALTER COLUMN id SET DEFAULT nextval('config_audit_log_id_seq'::regclass);

--
-- Name: content_performance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY content_performance ALTER COLUMN id SET DEFAULT nextval('content_performance_id_seq'::regclass);

--
-- Name: data_quality_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY data_quality_logs ALTER COLUMN id SET DEFAULT nextval('data_quality_logs_id_seq'::regclass);

--
-- Name: decision_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY decision_log ALTER COLUMN id SET DEFAULT nextval('decision_log_id_seq'::regclass);

--
-- Name: dish_library_costs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY dish_library_costs ALTER COLUMN id SET DEFAULT nextval('dish_library_costs_id_seq'::regclass);

--
-- Name: dish_name_aliases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY dish_name_aliases ALTER COLUMN id SET DEFAULT nextval('dish_name_aliases_id_seq'::regclass);

--
-- Name: dish_station_mapping id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY dish_station_mapping ALTER COLUMN id SET DEFAULT nextval('dish_station_mapping_id_seq'::regclass);

--
-- Name: employee_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY employee_attachments ALTER COLUMN id SET DEFAULT nextval('employee_attachments_id_seq'::regclass);

--
-- Name: employment_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY employment_records ALTER COLUMN id SET DEFAULT nextval('employment_records_id_seq'::regclass);

--
-- Name: entity_health_snapshot id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY entity_health_snapshot ALTER COLUMN id SET DEFAULT nextval('entity_health_snapshot_id_seq'::regclass);

--
-- Name: escalation_chains id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY escalation_chains ALTER COLUMN id SET DEFAULT nextval('escalation_chains_id_seq'::regclass);

--
-- Name: growth_campaign_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_campaign_jobs ALTER COLUMN id SET DEFAULT nextval('growth_campaign_jobs_id_seq'::regclass);

--
-- Name: growth_campaign_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_campaign_plans ALTER COLUMN id SET DEFAULT nextval('growth_campaign_plans_id_seq'::regclass);

--
-- Name: growth_churn_predictions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_churn_predictions ALTER COLUMN id SET DEFAULT nextval('growth_churn_predictions_id_seq'::regclass);

--
-- Name: growth_content_calendar id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_content_calendar ALTER COLUMN id SET DEFAULT nextval('growth_content_calendar_id_seq'::regclass);

--
-- Name: growth_content_suggestions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_content_suggestions ALTER COLUMN id SET DEFAULT nextval('growth_content_suggestions_id_seq'::regclass);

--
-- Name: growth_coupons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_coupons ALTER COLUMN id SET DEFAULT nextval('growth_coupons_id_seq'::regclass);

--
-- Name: growth_customer_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_customer_profiles ALTER COLUMN id SET DEFAULT nextval('growth_customer_profiles_id_seq'::regclass);

--
-- Name: growth_delivery_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_delivery_logs ALTER COLUMN id SET DEFAULT nextval('growth_delivery_logs_id_seq'::regclass);

--
-- Name: growth_execution_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_execution_logs ALTER COLUMN id SET DEFAULT nextval('growth_execution_logs_id_seq'::regclass);

--
-- Name: growth_learnings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_learnings ALTER COLUMN id SET DEFAULT nextval('growth_learnings_id_seq'::regclass);

--
-- Name: growth_menu_health_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_menu_health_reports ALTER COLUMN id SET DEFAULT nextval('growth_menu_health_reports_id_seq'::regclass);

--
-- Name: growth_profile_signals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_profile_signals ALTER COLUMN id SET DEFAULT nextval('growth_profile_signals_id_seq'::regclass);

--
-- Name: growth_solution_rounds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_solution_rounds ALTER COLUMN id SET DEFAULT nextval('growth_solution_rounds_id_seq'::regclass);

--
-- Name: growth_solution_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_solution_tasks ALTER COLUMN id SET DEFAULT nextval('growth_solution_tasks_id_seq'::regclass);

--
-- Name: growth_strategy_evaluations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_strategy_evaluations ALTER COLUMN id SET DEFAULT nextval('growth_strategy_evaluations_id_seq'::regclass);

--
-- Name: growth_strategy_explanations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_strategy_explanations ALTER COLUMN id SET DEFAULT nextval('growth_strategy_explanations_id_seq'::regclass);

--
-- Name: growth_sync_failures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_sync_failures ALTER COLUMN id SET DEFAULT nextval('growth_sync_failures_id_seq'::regclass);

--
-- Name: growth_task_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_task_templates ALTER COLUMN id SET DEFAULT nextval('growth_task_templates_id_seq'::regclass);

--
-- Name: growth_touch_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY growth_touch_rules ALTER COLUMN id SET DEFAULT nextval('growth_touch_rules_id_seq'::regclass);

--
-- Name: hrms_payroll_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY hrms_payroll_history ALTER COLUMN id SET DEFAULT nextval('hrms_payroll_history_id_seq'::regclass);

--
-- Name: hrms_state_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY hrms_state_audit ALTER COLUMN id SET DEFAULT nextval('hrms_state_audit_id_seq'::regclass);

--
-- Name: hrms_state_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY hrms_state_snapshots ALTER COLUMN id SET DEFAULT nextval('hrms_state_snapshots_id_seq'::regclass);

--
-- Name: ingredient_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY ingredient_categories ALTER COLUMN id SET DEFAULT nextval('ingredient_categories_id_seq'::regclass);

--
-- Name: ingredient_library id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY ingredient_library ALTER COLUMN id SET DEFAULT nextval('ingredient_library_id_seq'::regclass);

--
-- Name: kitchen_exec_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY kitchen_exec_logs ALTER COLUMN id SET DEFAULT nextval('kitchen_exec_logs_id_seq'::regclass);

--
-- Name: kitchen_sop_steps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY kitchen_sop_steps ALTER COLUMN id SET DEFAULT nextval('kitchen_sop_steps_id_seq'::regclass);

--
-- Name: kitchen_step_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY kitchen_step_logs ALTER COLUMN id SET DEFAULT nextval('kitchen_step_logs_id_seq'::regclass);

--
-- Name: knowledge_edit_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY knowledge_edit_history ALTER COLUMN id SET DEFAULT nextval('knowledge_edit_history_id_seq'::regclass);

--
-- Name: kpi_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY kpi_snapshots ALTER COLUMN id SET DEFAULT nextval('kpi_snapshots_id_seq'::regclass);

--
-- Name: kpi_targets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY kpi_targets ALTER COLUMN id SET DEFAULT nextval('kpi_targets_id_seq'::regclass);

--
-- Name: licenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY licenses ALTER COLUMN id SET DEFAULT nextval('licenses_id_seq'::regclass);

--
-- Name: marketing_campaigns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY marketing_campaigns ALTER COLUMN id SET DEFAULT nextval('marketing_campaigns_id_seq'::regclass);

--
-- Name: marketing_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY marketing_templates ALTER COLUMN id SET DEFAULT nextval('marketing_templates_id_seq'::regclass);

--
-- Name: master_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY master_events ALTER COLUMN id SET DEFAULT nextval('master_events_id_seq'::regclass);

--
-- Name: master_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY master_tasks ALTER COLUMN id SET DEFAULT nextval('master_tasks_id_seq'::regclass);

--
-- Name: member_consumption id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY member_consumption ALTER COLUMN id SET DEFAULT nextval('member_consumption_id_seq'::regclass);

--
-- Name: platform_data_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY platform_data_cache ALTER COLUMN id SET DEFAULT nextval('platform_data_cache_id_seq'::regclass);

--
-- Name: pos_order_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY pos_order_items ALTER COLUMN id SET DEFAULT nextval('pos_order_items_id_seq'::regclass);

--
-- Name: pos_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY pos_orders ALTER COLUMN id SET DEFAULT nextval('pos_orders_id_seq'::regclass);

--
-- Name: recipe_component_ingredients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY recipe_component_ingredients ALTER COLUMN id SET DEFAULT nextval('recipe_component_ingredients_id_seq'::regclass);

--
-- Name: recipe_component_steps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY recipe_component_steps ALTER COLUMN id SET DEFAULT nextval('recipe_component_steps_id_seq'::regclass);

--
-- Name: recipe_components id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY recipe_components ALTER COLUMN id SET DEFAULT nextval('recipe_components_id_seq'::regclass);

--
-- Name: recipes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY recipes ALTER COLUMN id SET DEFAULT nextval('recipes_id_seq'::regclass);

--
-- Name: regression_check_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY regression_check_results ALTER COLUMN id SET DEFAULT nextval('regression_check_results_id_seq'::regclass);

--
-- Name: rhythm_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY rhythm_logs ALTER COLUMN id SET DEFAULT nextval('rhythm_logs_id_seq'::regclass);

--
-- Name: sales_growth_snapshot id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY sales_growth_snapshot ALTER COLUMN id SET DEFAULT nextval('sales_growth_snapshot_id_seq'::regclass);

--
-- Name: sales_raw id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY sales_raw ALTER COLUMN id SET DEFAULT nextval('sales_raw_id_seq'::regclass);

--
-- Name: schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY schedules ALTER COLUMN id SET DEFAULT nextval('schedules_id_seq'::regclass);

--
-- Name: sop_distributions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY sop_distributions ALTER COLUMN id SET DEFAULT nextval('sop_distributions_id_seq'::regclass);

--
-- Name: sop_quiz_questions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY sop_quiz_questions ALTER COLUMN id SET DEFAULT nextval('sop_quiz_questions_id_seq'::regclass);

--
-- Name: sop_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY sop_versions ALTER COLUMN id SET DEFAULT nextval('sop_versions_id_seq'::regclass);

--
-- Name: store_marketing_constraints id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY store_marketing_constraints ALTER COLUMN id SET DEFAULT nextval('store_marketing_constraints_id_seq'::regclass);

--
-- Name: store_wecom_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY store_wecom_configs ALTER COLUMN id SET DEFAULT nextval('store_wecom_configs_id_seq'::regclass);

--
-- Name: task_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY task_assignments ALTER COLUMN id SET DEFAULT nextval('task_assignments_id_seq'::regclass);

--
-- Name: task_evidences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY task_evidences ALTER COLUMN id SET DEFAULT nextval('task_evidences_id_seq'::regclass);

--
-- Name: task_experience_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY task_experience_logs ALTER COLUMN id SET DEFAULT nextval('task_experience_logs_id_seq'::regclass);

--
-- Name: task_locks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY task_locks ALTER COLUMN id SET DEFAULT nextval('task_locks_id_seq'::regclass);

--
-- Name: task_reviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY task_reviews ALTER COLUMN id SET DEFAULT nextval('task_reviews_id_seq'::regclass);

--
-- Name: task_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY task_runs ALTER COLUMN id SET DEFAULT nextval('task_runs_id_seq'::regclass);

--
-- Name: telemetry_anomalies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY telemetry_anomalies ALTER COLUMN id SET DEFAULT nextval('telemetry_anomalies_id_seq'::regclass);

--
-- Name: telemetry_campaigns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY telemetry_campaigns ALTER COLUMN id SET DEFAULT nextval('telemetry_campaigns_id_seq'::regclass);

--
-- Name: telemetry_collect_cursor id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY telemetry_collect_cursor ALTER COLUMN id SET DEFAULT nextval('telemetry_collect_cursor_id_seq'::regclass);

--
-- Name: telemetry_conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY telemetry_conversations ALTER COLUMN id SET DEFAULT nextval('telemetry_conversations_id_seq'::regclass);

--
-- Name: telemetry_daily_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY telemetry_daily_reports ALTER COLUMN id SET DEFAULT nextval('telemetry_daily_reports_id_seq'::regclass);

--
-- Name: telemetry_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY telemetry_events ALTER COLUMN id SET DEFAULT nextval('telemetry_events_id_seq'::regclass);

--
-- Name: telemetry_ingest_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY telemetry_ingest_log ALTER COLUMN id SET DEFAULT nextval('telemetry_ingest_log_id_seq'::regclass);

--
-- Name: temp_staffing_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY temp_staffing_requests ALTER COLUMN id SET DEFAULT nextval('temp_staffing_requests_id_seq'::regclass);

--
-- Name: training_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY training_assignments ALTER COLUMN id SET DEFAULT nextval('training_assignments_id_seq'::regclass);

--
-- Name: training_certifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY training_certifications ALTER COLUMN id SET DEFAULT nextval('training_certifications_id_seq'::regclass);

--
-- Name: training_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY training_sessions ALTER COLUMN id SET DEFAULT nextval('training_sessions_id_seq'::regclass);

--
-- Name: training_topics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY training_topics ALTER COLUMN id SET DEFAULT nextval('training_topics_id_seq'::regclass);

--
-- Name: wechat_work_customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY wechat_work_customers ALTER COLUMN id SET DEFAULT nextval('wechat_work_customers_id_seq'::regclass);

--
-- Name: ab_test_results ab_test_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ab_test_results DROP CONSTRAINT IF EXISTS ab_test_results_pkey;
ALTER TABLE ab_test_results ADD CONSTRAINT ab_test_results_pkey PRIMARY KEY (id);

--
-- Name: ab_test_results ab_test_results_test_id_result_date_variant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ab_test_results DROP CONSTRAINT IF EXISTS ab_test_results_test_id_result_date_variant_key;
ALTER TABLE ab_test_results ADD CONSTRAINT ab_test_results_test_id_result_date_variant_key UNIQUE (test_id, result_date, variant);

--
-- Name: ab_test_tasks ab_test_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ab_test_tasks DROP CONSTRAINT IF EXISTS ab_test_tasks_pkey;
ALTER TABLE ab_test_tasks ADD CONSTRAINT ab_test_tasks_pkey PRIMARY KEY (id);

--
-- Name: acceptance_checklists acceptance_checklists_anomaly_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE acceptance_checklists DROP CONSTRAINT IF EXISTS acceptance_checklists_anomaly_key_key;
ALTER TABLE acceptance_checklists ADD CONSTRAINT acceptance_checklists_anomaly_key_key UNIQUE (anomaly_key);

--
-- Name: acceptance_checklists acceptance_checklists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE acceptance_checklists DROP CONSTRAINT IF EXISTS acceptance_checklists_pkey;
ALTER TABLE acceptance_checklists ADD CONSTRAINT acceptance_checklists_pkey PRIMARY KEY (id);

--
-- Name: action_plans action_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE action_plans DROP CONSTRAINT IF EXISTS action_plans_pkey;
ALTER TABLE action_plans ADD CONSTRAINT action_plans_pkey PRIMARY KEY (id);

--
-- Name: action_plans action_plans_plan_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE action_plans DROP CONSTRAINT IF EXISTS action_plans_plan_id_key;
ALTER TABLE action_plans ADD CONSTRAINT action_plans_plan_id_key UNIQUE (plan_id);

--
-- Name: agent_admin_alert_log agent_admin_alert_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_admin_alert_log DROP CONSTRAINT IF EXISTS agent_admin_alert_log_pkey;
ALTER TABLE agent_admin_alert_log ADD CONSTRAINT agent_admin_alert_log_pkey PRIMARY KEY (id);

--
-- Name: agent_autonomous_logs agent_autonomous_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_autonomous_logs DROP CONSTRAINT IF EXISTS agent_autonomous_logs_pkey;
ALTER TABLE agent_autonomous_logs ADD CONSTRAINT agent_autonomous_logs_pkey PRIMARY KEY (id);

--
-- Name: agent_collaboration_archives agent_collaboration_archives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_collaboration_archives DROP CONSTRAINT IF EXISTS agent_collaboration_archives_pkey;
ALTER TABLE agent_collaboration_archives ADD CONSTRAINT agent_collaboration_archives_pkey PRIMARY KEY (id);

--
-- Name: agent_collaboration_archives agent_collaboration_archives_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_collaboration_archives DROP CONSTRAINT IF EXISTS agent_collaboration_archives_session_id_key;
ALTER TABLE agent_collaboration_archives ADD CONSTRAINT agent_collaboration_archives_session_id_key UNIQUE (session_id);

--
-- Name: agent_configs agent_configs_agent_id_tenant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS agent_configs_agent_id_tenant_key;
ALTER TABLE agent_configs ADD CONSTRAINT agent_configs_agent_id_tenant_key UNIQUE (agent_id, tenant_id);

--
-- Name: agent_configs agent_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS agent_configs_pkey;
ALTER TABLE agent_configs ADD CONSTRAINT agent_configs_pkey PRIMARY KEY (id);

--
-- Name: agent_memory agent_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_memory DROP CONSTRAINT IF EXISTS agent_memory_pkey;
ALTER TABLE agent_memory ADD CONSTRAINT agent_memory_pkey PRIMARY KEY (id);

--
-- Name: agent_prompt_templates agent_prompt_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_prompt_templates DROP CONSTRAINT IF EXISTS agent_prompt_templates_pkey;
ALTER TABLE agent_prompt_templates ADD CONSTRAINT agent_prompt_templates_pkey PRIMARY KEY (id);

--
-- Name: agent_prompt_templates agent_prompt_templates_template_key_tenant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_prompt_templates DROP CONSTRAINT IF EXISTS agent_prompt_templates_template_key_tenant_key;
ALTER TABLE agent_prompt_templates ADD CONSTRAINT agent_prompt_templates_template_key_tenant_key UNIQUE (template_key, tenant_id);

--
-- Name: agent_reply_templates agent_reply_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_reply_templates DROP CONSTRAINT IF EXISTS agent_reply_templates_pkey;
ALTER TABLE agent_reply_templates ADD CONSTRAINT agent_reply_templates_pkey PRIMARY KEY (id);

--
-- Name: agent_reply_templates agent_reply_templates_template_key_tenant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_reply_templates DROP CONSTRAINT IF EXISTS agent_reply_templates_template_key_tenant_key;
ALTER TABLE agent_reply_templates ADD CONSTRAINT agent_reply_templates_template_key_tenant_key UNIQUE (template_key, tenant_id);

--
-- Name: agent_rules agent_rules_category_tenant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_rules DROP CONSTRAINT IF EXISTS agent_rules_category_tenant_key;
ALTER TABLE agent_rules ADD CONSTRAINT agent_rules_category_tenant_key UNIQUE (category, tenant_id);

--
-- Name: agent_rules agent_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_rules DROP CONSTRAINT IF EXISTS agent_rules_pkey;
ALTER TABLE agent_rules ADD CONSTRAINT agent_rules_pkey PRIMARY KEY (id);

--
-- Name: agent_sessions agent_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_sessions DROP CONSTRAINT IF EXISTS agent_sessions_pkey;
ALTER TABLE agent_sessions ADD CONSTRAINT agent_sessions_pkey PRIMARY KEY (session_id);

--
-- Name: agent_task_logs agent_task_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_task_logs DROP CONSTRAINT IF EXISTS agent_task_logs_pkey;
ALTER TABLE agent_task_logs ADD CONSTRAINT agent_task_logs_pkey PRIMARY KEY (id);

--
-- Name: agent_v2_configs agent_v2_configs_config_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_v2_configs DROP CONSTRAINT IF EXISTS agent_v2_configs_config_key_key;
ALTER TABLE agent_v2_configs ADD CONSTRAINT agent_v2_configs_config_key_key UNIQUE (config_key);

--
-- Name: agent_v2_configs agent_v2_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_v2_configs DROP CONSTRAINT IF EXISTS agent_v2_configs_pkey;
ALTER TABLE agent_v2_configs ADD CONSTRAINT agent_v2_configs_pkey PRIMARY KEY (id);

--
-- Name: agent_v2_cron_runs agent_v2_cron_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_v2_cron_runs DROP CONSTRAINT IF EXISTS agent_v2_cron_runs_pkey;
ALTER TABLE agent_v2_cron_runs ADD CONSTRAINT agent_v2_cron_runs_pkey PRIMARY KEY (id);

--
-- Name: agent_v2_data_alert_dedupe agent_v2_data_alert_dedupe_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_v2_data_alert_dedupe DROP CONSTRAINT IF EXISTS agent_v2_data_alert_dedupe_pkey;
ALTER TABLE agent_v2_data_alert_dedupe ADD CONSTRAINT agent_v2_data_alert_dedupe_pkey PRIMARY KEY (dedupe_key, tenant_id);

--
-- Name: agent_v2_morning_briefing_sends agent_v2_morning_briefing_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_v2_morning_briefing_sends DROP CONSTRAINT IF EXISTS agent_v2_morning_briefing_sends_pkey;
ALTER TABLE agent_v2_morning_briefing_sends ADD CONSTRAINT agent_v2_morning_briefing_sends_pkey PRIMARY KEY (id);

--
-- Name: agent_v2_morning_briefing_sends agent_v2_morning_briefing_sends_run_ymd_username_scope_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_v2_morning_briefing_sends DROP CONSTRAINT IF EXISTS agent_v2_morning_briefing_sends_run_ymd_username_scope_key;
ALTER TABLE agent_v2_morning_briefing_sends ADD CONSTRAINT agent_v2_morning_briefing_sends_run_ymd_username_scope_key UNIQUE (run_ymd, username, scope, tenant_id);

--
-- Name: agent_v2_pllm_monthly_report_log agent_v2_pllm_monthly_report_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_v2_pllm_monthly_report_log DROP CONSTRAINT IF EXISTS agent_v2_pllm_monthly_report_log_pkey;
ALTER TABLE agent_v2_pllm_monthly_report_log ADD CONSTRAINT agent_v2_pllm_monthly_report_log_pkey PRIMARY KEY (report_month);

--
-- Name: agent_v2_scheduled_report_sends agent_v2_scheduled_report_sen_job_key_run_ymd_username_scop_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_v2_scheduled_report_sends DROP CONSTRAINT IF EXISTS agent_v2_scheduled_report_sen_job_key_run_ymd_username_scop_key;
ALTER TABLE agent_v2_scheduled_report_sends ADD CONSTRAINT agent_v2_scheduled_report_sen_job_key_run_ymd_username_scop_key UNIQUE (job_key, run_ymd, username, scope, tenant_id);

--
-- Name: agent_v2_scheduled_report_sends agent_v2_scheduled_report_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_v2_scheduled_report_sends DROP CONSTRAINT IF EXISTS agent_v2_scheduled_report_sends_pkey;
ALTER TABLE agent_v2_scheduled_report_sends ADD CONSTRAINT agent_v2_scheduled_report_sends_pkey PRIMARY KEY (id);

--
-- Name: anomaly_pending_notifications anomaly_pending_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE anomaly_pending_notifications DROP CONSTRAINT IF EXISTS anomaly_pending_notifications_pkey;
ALTER TABLE anomaly_pending_notifications ADD CONSTRAINT anomaly_pending_notifications_pkey PRIMARY KEY (id);

--
-- Name: anomaly_triggers anomaly_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE anomaly_triggers DROP CONSTRAINT IF EXISTS anomaly_triggers_pkey;
ALTER TABLE anomaly_triggers ADD CONSTRAINT anomaly_triggers_pkey PRIMARY KEY (id);

--
-- Name: attendance_records attendance_records_employee_username_record_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_employee_username_record_date_key;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_employee_username_record_date_key UNIQUE (employee_username, record_date, tenant_id);

--
-- Name: attendance_records attendance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_pkey;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_pkey PRIMARY KEY (id);

--
-- Name: attention_scores attention_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE attention_scores DROP CONSTRAINT IF EXISTS attention_scores_pkey;
ALTER TABLE attention_scores ADD CONSTRAINT attention_scores_pkey PRIMARY KEY (id);

--
-- Name: auto_ops_runs auto_ops_runs_job_key_run_key_tenant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE auto_ops_runs DROP CONSTRAINT IF EXISTS auto_ops_runs_job_key_run_key_tenant_key;
ALTER TABLE auto_ops_runs ADD CONSTRAINT auto_ops_runs_job_key_run_key_tenant_key UNIQUE (job_key, run_key, tenant_id);

--
-- Name: auto_ops_runs auto_ops_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE auto_ops_runs DROP CONSTRAINT IF EXISTS auto_ops_runs_pkey;
ALTER TABLE auto_ops_runs ADD CONSTRAINT auto_ops_runs_pkey PRIMARY KEY (id);

--
-- Name: automated_test_results automated_test_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE automated_test_results DROP CONSTRAINT IF EXISTS automated_test_results_pkey;
ALTER TABLE automated_test_results ADD CONSTRAINT automated_test_results_pkey PRIMARY KEY (id);

--
-- Name: bitable_submissions_archive bitable_submissions_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE bitable_submissions_archive DROP CONSTRAINT IF EXISTS bitable_submissions_archive_pkey;
ALTER TABLE bitable_submissions_archive ADD CONSTRAINT bitable_submissions_archive_pkey PRIMARY KEY (id);

--
-- Name: brand_voice_samples brand_voice_samples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE brand_voice_samples DROP CONSTRAINT IF EXISTS brand_voice_samples_pkey;
ALTER TABLE brand_voice_samples ADD CONSTRAINT brand_voice_samples_pkey PRIMARY KEY (brand);

--
-- Name: business_entity_relations business_entity_relations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE business_entity_relations DROP CONSTRAINT IF EXISTS business_entity_relations_pkey;
ALTER TABLE business_entity_relations ADD CONSTRAINT business_entity_relations_pkey PRIMARY KEY (id);

--
-- Name: checkin_records checkin_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE checkin_records DROP CONSTRAINT IF EXISTS checkin_records_pkey;
ALTER TABLE checkin_records ADD CONSTRAINT checkin_records_pkey PRIMARY KEY (id);

--
-- Name: cn_holiday_calendar cn_holiday_calendar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE cn_holiday_calendar DROP CONSTRAINT IF EXISTS cn_holiday_calendar_pkey;
ALTER TABLE cn_holiday_calendar ADD CONSTRAINT cn_holiday_calendar_pkey PRIMARY KEY (day);

--
-- Name: config_audit_log config_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE config_audit_log DROP CONSTRAINT IF EXISTS config_audit_log_pkey;
ALTER TABLE config_audit_log ADD CONSTRAINT config_audit_log_pkey PRIMARY KEY (id);

--
-- Name: content_performance content_performance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE content_performance DROP CONSTRAINT IF EXISTS content_performance_pkey;
ALTER TABLE content_performance ADD CONSTRAINT content_performance_pkey PRIMARY KEY (id);

--
-- Name: data_quality_logs data_quality_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE data_quality_logs DROP CONSTRAINT IF EXISTS data_quality_logs_pkey;
ALTER TABLE data_quality_logs ADD CONSTRAINT data_quality_logs_pkey PRIMARY KEY (id);

--
-- Name: decision_log decision_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE decision_log DROP CONSTRAINT IF EXISTS decision_log_pkey;
ALTER TABLE decision_log ADD CONSTRAINT decision_log_pkey PRIMARY KEY (id);

--
-- Name: dish_library_costs dish_library_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE dish_library_costs DROP CONSTRAINT IF EXISTS dish_library_costs_pkey;
ALTER TABLE dish_library_costs ADD CONSTRAINT dish_library_costs_pkey PRIMARY KEY (id);

--
-- Name: dish_name_aliases dish_name_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE dish_name_aliases DROP CONSTRAINT IF EXISTS dish_name_aliases_pkey;
ALTER TABLE dish_name_aliases ADD CONSTRAINT dish_name_aliases_pkey PRIMARY KEY (id);

--
-- Name: dish_station_mapping dish_station_mapping_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE dish_station_mapping DROP CONSTRAINT IF EXISTS dish_station_mapping_pkey;
ALTER TABLE dish_station_mapping ADD CONSTRAINT dish_station_mapping_pkey PRIMARY KEY (id);

--
-- Name: employee_attachments employee_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE employee_attachments DROP CONSTRAINT IF EXISTS employee_attachments_pkey;
ALTER TABLE employee_attachments ADD CONSTRAINT employee_attachments_pkey PRIMARY KEY (id);

--
-- Name: employee_training_records employee_training_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE employee_training_records DROP CONSTRAINT IF EXISTS employee_training_records_pkey;
ALTER TABLE employee_training_records ADD CONSTRAINT employee_training_records_pkey PRIMARY KEY (id);

--
-- Name: employment_records employment_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE employment_records DROP CONSTRAINT IF EXISTS employment_records_pkey;
ALTER TABLE employment_records ADD CONSTRAINT employment_records_pkey PRIMARY KEY (id);

--
-- Name: entity_health_snapshot entity_health_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE entity_health_snapshot DROP CONSTRAINT IF EXISTS entity_health_snapshot_pkey;
ALTER TABLE entity_health_snapshot ADD CONSTRAINT entity_health_snapshot_pkey PRIMARY KEY (id);

--
-- Name: escalation_chains escalation_chains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE escalation_chains DROP CONSTRAINT IF EXISTS escalation_chains_pkey;
ALTER TABLE escalation_chains ADD CONSTRAINT escalation_chains_pkey PRIMARY KEY (id);

--
-- Name: exam_results exam_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE exam_results DROP CONSTRAINT IF EXISTS exam_results_pkey;
ALTER TABLE exam_results ADD CONSTRAINT exam_results_pkey PRIMARY KEY (id);

--
-- Name: feishu_generic_records feishu_generic_records_app_token_table_id_record_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE feishu_generic_records DROP CONSTRAINT IF EXISTS feishu_generic_records_app_token_table_id_record_id_key;
ALTER TABLE feishu_generic_records ADD CONSTRAINT feishu_generic_records_app_token_table_id_record_id_key UNIQUE (app_token, table_id, record_id, tenant_id);

--
-- Name: feishu_generic_records feishu_generic_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE feishu_generic_records DROP CONSTRAINT IF EXISTS feishu_generic_records_pkey;
ALTER TABLE feishu_generic_records ADD CONSTRAINT feishu_generic_records_pkey PRIMARY KEY (id);

--
-- Name: feishu_pending_pllm_decisions feishu_pending_pllm_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE feishu_pending_pllm_decisions DROP CONSTRAINT IF EXISTS feishu_pending_pllm_decisions_pkey;
ALTER TABLE feishu_pending_pllm_decisions ADD CONSTRAINT feishu_pending_pllm_decisions_pkey PRIMARY KEY (open_id, tenant_id);

--
-- Name: feishu_pending_replies feishu_pending_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE feishu_pending_replies DROP CONSTRAINT IF EXISTS feishu_pending_replies_pkey;
ALTER TABLE feishu_pending_replies ADD CONSTRAINT feishu_pending_replies_pkey PRIMARY KEY (open_id, tenant_id);

--
-- Name: feishu_sync_logs feishu_sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE feishu_sync_logs DROP CONSTRAINT IF EXISTS feishu_sync_logs_pkey;
ALTER TABLE feishu_sync_logs ADD CONSTRAINT feishu_sync_logs_pkey PRIMARY KEY (id);

--
-- Name: growth_campaign_jobs growth_campaign_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_campaign_jobs DROP CONSTRAINT IF EXISTS growth_campaign_jobs_pkey;
ALTER TABLE growth_campaign_jobs ADD CONSTRAINT growth_campaign_jobs_pkey PRIMARY KEY (id);

--
-- Name: growth_campaign_plans growth_campaign_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_campaign_plans DROP CONSTRAINT IF EXISTS growth_campaign_plans_pkey;
ALTER TABLE growth_campaign_plans ADD CONSTRAINT growth_campaign_plans_pkey PRIMARY KEY (id);

--
-- Name: growth_campaign_plans growth_campaign_plans_plan_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_campaign_plans DROP CONSTRAINT IF EXISTS growth_campaign_plans_plan_id_key;
ALTER TABLE growth_campaign_plans ADD CONSTRAINT growth_campaign_plans_plan_id_key UNIQUE (plan_id, tenant_id);

--
-- Name: growth_churn_predictions growth_churn_predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_churn_predictions DROP CONSTRAINT IF EXISTS growth_churn_predictions_pkey;
ALTER TABLE growth_churn_predictions ADD CONSTRAINT growth_churn_predictions_pkey PRIMARY KEY (id);

--
-- Name: growth_churn_predictions growth_churn_predictions_prediction_date_store_code_custome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_churn_predictions DROP CONSTRAINT IF EXISTS growth_churn_predictions_prediction_date_store_code_custome_key;
ALTER TABLE growth_churn_predictions ADD CONSTRAINT growth_churn_predictions_prediction_date_store_code_custome_key UNIQUE (prediction_date, store_code, customer_id, tenant_id);

--
-- Name: growth_content_calendar growth_content_calendar_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_content_calendar DROP CONSTRAINT IF EXISTS growth_content_calendar_item_id_key;
ALTER TABLE growth_content_calendar ADD CONSTRAINT growth_content_calendar_item_id_key UNIQUE (item_id, tenant_id);

--
-- Name: growth_content_calendar growth_content_calendar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_content_calendar DROP CONSTRAINT IF EXISTS growth_content_calendar_pkey;
ALTER TABLE growth_content_calendar ADD CONSTRAINT growth_content_calendar_pkey PRIMARY KEY (id);

--
-- Name: growth_content_suggestions growth_content_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_content_suggestions DROP CONSTRAINT IF EXISTS growth_content_suggestions_pkey;
ALTER TABLE growth_content_suggestions ADD CONSTRAINT growth_content_suggestions_pkey PRIMARY KEY (id);

--
-- Name: growth_content_suggestions growth_content_suggestions_suggestion_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_content_suggestions DROP CONSTRAINT IF EXISTS growth_content_suggestions_suggestion_key_key;
ALTER TABLE growth_content_suggestions ADD CONSTRAINT growth_content_suggestions_suggestion_key_key UNIQUE (suggestion_key, tenant_id);

--
-- Name: growth_coupons growth_coupons_coupon_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_coupons DROP CONSTRAINT IF EXISTS growth_coupons_coupon_id_key;
ALTER TABLE growth_coupons ADD CONSTRAINT growth_coupons_coupon_id_key UNIQUE (coupon_id, tenant_id);

--
-- Name: growth_coupons growth_coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_coupons DROP CONSTRAINT IF EXISTS growth_coupons_pkey;
ALTER TABLE growth_coupons ADD CONSTRAINT growth_coupons_pkey PRIMARY KEY (id);

--
-- Name: growth_customer_profiles growth_customer_profiles_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_customer_profiles DROP CONSTRAINT IF EXISTS growth_customer_profiles_customer_id_key;
ALTER TABLE growth_customer_profiles ADD CONSTRAINT growth_customer_profiles_customer_id_key UNIQUE (customer_id, tenant_id);

--
-- Name: growth_customer_profiles growth_customer_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_customer_profiles DROP CONSTRAINT IF EXISTS growth_customer_profiles_pkey;
ALTER TABLE growth_customer_profiles ADD CONSTRAINT growth_customer_profiles_pkey PRIMARY KEY (id);

--
-- Name: growth_delivery_logs growth_delivery_logs_delivery_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_delivery_logs DROP CONSTRAINT IF EXISTS growth_delivery_logs_delivery_key_key;
ALTER TABLE growth_delivery_logs ADD CONSTRAINT growth_delivery_logs_delivery_key_key UNIQUE (delivery_key, tenant_id);

--
-- Name: growth_delivery_logs growth_delivery_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_delivery_logs DROP CONSTRAINT IF EXISTS growth_delivery_logs_pkey;
ALTER TABLE growth_delivery_logs ADD CONSTRAINT growth_delivery_logs_pkey PRIMARY KEY (id);

--
-- Name: growth_execution_logs growth_execution_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_execution_logs DROP CONSTRAINT IF EXISTS growth_execution_logs_pkey;
ALTER TABLE growth_execution_logs ADD CONSTRAINT growth_execution_logs_pkey PRIMARY KEY (id);

--
-- Name: growth_holdout_members growth_holdout_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_holdout_members DROP CONSTRAINT IF EXISTS growth_holdout_members_pkey;
ALTER TABLE growth_holdout_members ADD CONSTRAINT growth_holdout_members_pkey PRIMARY KEY (phone, campaign_key, tenant_id);

--
-- Name: growth_learnings growth_learnings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_learnings DROP CONSTRAINT IF EXISTS growth_learnings_pkey;
ALTER TABLE growth_learnings ADD CONSTRAINT growth_learnings_pkey PRIMARY KEY (id);

--
-- Name: growth_menu_health_reports growth_menu_health_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_menu_health_reports DROP CONSTRAINT IF EXISTS growth_menu_health_reports_pkey;
ALTER TABLE growth_menu_health_reports ADD CONSTRAINT growth_menu_health_reports_pkey PRIMARY KEY (id);

--
-- Name: growth_menu_health_reports growth_menu_health_reports_report_month_store_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_menu_health_reports DROP CONSTRAINT IF EXISTS growth_menu_health_reports_report_month_store_code_key;
ALTER TABLE growth_menu_health_reports ADD CONSTRAINT growth_menu_health_reports_report_month_store_code_key UNIQUE (report_month, store_code, tenant_id);

--
-- Name: growth_profile_signals growth_profile_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_profile_signals DROP CONSTRAINT IF EXISTS growth_profile_signals_pkey;
ALTER TABLE growth_profile_signals ADD CONSTRAINT growth_profile_signals_pkey PRIMARY KEY (id);

--
-- Name: growth_segment_members growth_segment_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_segment_members DROP CONSTRAINT IF EXISTS growth_segment_members_pkey;
ALTER TABLE growth_segment_members ADD CONSTRAINT growth_segment_members_pkey PRIMARY KEY (phone, segment_key, tenant_id);

--
-- Name: growth_sms_suppression growth_sms_suppression_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_sms_suppression DROP CONSTRAINT IF EXISTS growth_sms_suppression_pkey;
ALTER TABLE growth_sms_suppression ADD CONSTRAINT growth_sms_suppression_pkey PRIMARY KEY (phone, tenant_id);

--
-- Name: growth_solution_rounds growth_solution_rounds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_solution_rounds DROP CONSTRAINT IF EXISTS growth_solution_rounds_pkey;
ALTER TABLE growth_solution_rounds ADD CONSTRAINT growth_solution_rounds_pkey PRIMARY KEY (id);

--
-- Name: growth_solution_tasks growth_solution_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_solution_tasks DROP CONSTRAINT IF EXISTS growth_solution_tasks_pkey;
ALTER TABLE growth_solution_tasks ADD CONSTRAINT growth_solution_tasks_pkey PRIMARY KEY (id);

--
-- Name: growth_stored_value_members growth_stored_value_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_stored_value_members DROP CONSTRAINT IF EXISTS growth_stored_value_members_pkey;
ALTER TABLE growth_stored_value_members ADD CONSTRAINT growth_stored_value_members_pkey PRIMARY KEY (card_no, tenant_id);

--
-- Name: growth_strategy_evaluations growth_strategy_evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_strategy_evaluations DROP CONSTRAINT IF EXISTS growth_strategy_evaluations_pkey;
ALTER TABLE growth_strategy_evaluations ADD CONSTRAINT growth_strategy_evaluations_pkey PRIMARY KEY (id);

--
-- Name: growth_strategy_evaluations growth_strategy_evaluations_strategy_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_strategy_evaluations DROP CONSTRAINT IF EXISTS growth_strategy_evaluations_strategy_key_key;
ALTER TABLE growth_strategy_evaluations ADD CONSTRAINT growth_strategy_evaluations_strategy_key_key UNIQUE (strategy_key, tenant_id);

--
-- Name: growth_strategy_explanations growth_strategy_explanations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_strategy_explanations DROP CONSTRAINT IF EXISTS growth_strategy_explanations_pkey;
ALTER TABLE growth_strategy_explanations ADD CONSTRAINT growth_strategy_explanations_pkey PRIMARY KEY (id);

--
-- Name: growth_sync_failures growth_sync_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_sync_failures DROP CONSTRAINT IF EXISTS growth_sync_failures_pkey;
ALTER TABLE growth_sync_failures ADD CONSTRAINT growth_sync_failures_pkey PRIMARY KEY (id);

--
-- Name: growth_task_templates growth_task_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_task_templates DROP CONSTRAINT IF EXISTS growth_task_templates_pkey;
ALTER TABLE growth_task_templates ADD CONSTRAINT growth_task_templates_pkey PRIMARY KEY (id);

--
-- Name: growth_task_templates growth_task_templates_problem_key_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_task_templates DROP CONSTRAINT IF EXISTS growth_task_templates_problem_key_code_key;
ALTER TABLE growth_task_templates ADD CONSTRAINT growth_task_templates_problem_key_code_key UNIQUE (problem_key, code);

--
-- Name: growth_touch_rules growth_touch_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_touch_rules DROP CONSTRAINT IF EXISTS growth_touch_rules_pkey;
ALTER TABLE growth_touch_rules ADD CONSTRAINT growth_touch_rules_pkey PRIMARY KEY (id);

--
-- Name: growth_touch_rules growth_touch_rules_rule_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_touch_rules DROP CONSTRAINT IF EXISTS growth_touch_rules_rule_key_key;
ALTER TABLE growth_touch_rules ADD CONSTRAINT growth_touch_rules_rule_key_key UNIQUE (rule_key, tenant_id);

--
-- Name: hr_rating_configs hr_rating_configs_config_key_tenant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE hr_rating_configs DROP CONSTRAINT IF EXISTS hr_rating_configs_config_key_tenant_key;
ALTER TABLE hr_rating_configs ADD CONSTRAINT hr_rating_configs_config_key_tenant_key UNIQUE (config_key, tenant_id);

--
-- Name: hr_rating_configs hr_rating_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE hr_rating_configs DROP CONSTRAINT IF EXISTS hr_rating_configs_pkey;
ALTER TABLE hr_rating_configs ADD CONSTRAINT hr_rating_configs_pkey PRIMARY KEY (id);

--
-- Name: hrms_leave_domain hrms_leave_domain_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE hrms_leave_domain DROP CONSTRAINT IF EXISTS hrms_leave_domain_pkey;
ALTER TABLE hrms_leave_domain ADD CONSTRAINT hrms_leave_domain_pkey PRIMARY KEY (id);

--
-- Name: hrms_payroll_history hrms_payroll_history_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE hrms_payroll_history DROP CONSTRAINT IF EXISTS hrms_payroll_history_idempotency_key_key;
ALTER TABLE hrms_payroll_history ADD CONSTRAINT hrms_payroll_history_idempotency_key_key UNIQUE (idempotency_key, tenant_id);

--
-- Name: hrms_payroll_history hrms_payroll_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE hrms_payroll_history DROP CONSTRAINT IF EXISTS hrms_payroll_history_pkey;
ALTER TABLE hrms_payroll_history ADD CONSTRAINT hrms_payroll_history_pkey PRIMARY KEY (id);

--
-- Name: hrms_state_audit hrms_state_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE hrms_state_audit DROP CONSTRAINT IF EXISTS hrms_state_audit_pkey;
ALTER TABLE hrms_state_audit ADD CONSTRAINT hrms_state_audit_pkey PRIMARY KEY (id);

--
-- Name: hrms_state hrms_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE hrms_state DROP CONSTRAINT IF EXISTS hrms_state_pkey;
ALTER TABLE hrms_state ADD CONSTRAINT hrms_state_pkey PRIMARY KEY (key);

--
-- Name: hrms_state_snapshots hrms_state_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE hrms_state_snapshots DROP CONSTRAINT IF EXISTS hrms_state_snapshots_pkey;
ALTER TABLE hrms_state_snapshots ADD CONSTRAINT hrms_state_snapshots_pkey PRIMARY KEY (id);

--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE idempotency_keys DROP CONSTRAINT IF EXISTS idempotency_keys_pkey;
ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (key, tenant_id);

--
-- Name: ingredient_categories ingredient_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ingredient_categories DROP CONSTRAINT IF EXISTS ingredient_categories_name_key;
ALTER TABLE ingredient_categories ADD CONSTRAINT ingredient_categories_name_key UNIQUE (name, tenant_id);

--
-- Name: ingredient_categories ingredient_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ingredient_categories DROP CONSTRAINT IF EXISTS ingredient_categories_pkey;
ALTER TABLE ingredient_categories ADD CONSTRAINT ingredient_categories_pkey PRIMARY KEY (id);

--
-- Name: ingredient_library ingredient_library_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ingredient_library DROP CONSTRAINT IF EXISTS ingredient_library_name_key;
ALTER TABLE ingredient_library ADD CONSTRAINT ingredient_library_name_key UNIQUE (name, tenant_id);

--
-- Name: ingredient_library ingredient_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ingredient_library DROP CONSTRAINT IF EXISTS ingredient_library_pkey;
ALTER TABLE ingredient_library ADD CONSTRAINT ingredient_library_pkey PRIMARY KEY (id);

--
-- Name: kitchen_exec_logs kitchen_exec_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE kitchen_exec_logs DROP CONSTRAINT IF EXISTS kitchen_exec_logs_pkey;
ALTER TABLE kitchen_exec_logs ADD CONSTRAINT kitchen_exec_logs_pkey PRIMARY KEY (id);

--
-- Name: kitchen_sop_steps kitchen_sop_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE kitchen_sop_steps DROP CONSTRAINT IF EXISTS kitchen_sop_steps_pkey;
ALTER TABLE kitchen_sop_steps ADD CONSTRAINT kitchen_sop_steps_pkey PRIMARY KEY (id);

--
-- Name: kitchen_step_logs kitchen_step_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE kitchen_step_logs DROP CONSTRAINT IF EXISTS kitchen_step_logs_pkey;
ALTER TABLE kitchen_step_logs ADD CONSTRAINT kitchen_step_logs_pkey PRIMARY KEY (id);

--
-- Name: knowledge_edit_history knowledge_edit_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE knowledge_edit_history DROP CONSTRAINT IF EXISTS knowledge_edit_history_pkey;
ALTER TABLE knowledge_edit_history ADD CONSTRAINT knowledge_edit_history_pkey PRIMARY KEY (id);

--
-- Name: kpi_snapshots kpi_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE kpi_snapshots DROP CONSTRAINT IF EXISTS kpi_snapshots_pkey;
ALTER TABLE kpi_snapshots ADD CONSTRAINT kpi_snapshots_pkey PRIMARY KEY (id);

--
-- Name: kpi_snapshots kpi_snapshots_snapshot_date_store_tenant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE kpi_snapshots DROP CONSTRAINT IF EXISTS kpi_snapshots_snapshot_date_store_tenant_key;
ALTER TABLE kpi_snapshots ADD CONSTRAINT kpi_snapshots_snapshot_date_store_tenant_key UNIQUE (snapshot_date, store, tenant_id);

--
-- Name: kpi_targets kpi_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE kpi_targets DROP CONSTRAINT IF EXISTS kpi_targets_pkey;
ALTER TABLE kpi_targets ADD CONSTRAINT kpi_targets_pkey PRIMARY KEY (id);

--
-- Name: licenses licenses_license_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_license_key_key;
ALTER TABLE licenses ADD CONSTRAINT licenses_license_key_key UNIQUE (license_key);

--
-- Name: licenses licenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_pkey;
ALTER TABLE licenses ADD CONSTRAINT licenses_pkey PRIMARY KEY (id);

--
-- Name: marketing_campaigns marketing_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE marketing_campaigns DROP CONSTRAINT IF EXISTS marketing_campaigns_pkey;
ALTER TABLE marketing_campaigns ADD CONSTRAINT marketing_campaigns_pkey PRIMARY KEY (id);

--
-- Name: marketing_payment_rules marketing_payment_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE marketing_payment_rules DROP CONSTRAINT IF EXISTS marketing_payment_rules_pkey;
ALTER TABLE marketing_payment_rules ADD CONSTRAINT marketing_payment_rules_pkey PRIMARY KEY (rule_key);

--
-- Name: marketing_templates marketing_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE marketing_templates DROP CONSTRAINT IF EXISTS marketing_templates_pkey;
ALTER TABLE marketing_templates ADD CONSTRAINT marketing_templates_pkey PRIMARY KEY (id);

--
-- Name: master_events master_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE master_events DROP CONSTRAINT IF EXISTS master_events_pkey;
ALTER TABLE master_events ADD CONSTRAINT master_events_pkey PRIMARY KEY (id);

--
-- Name: master_tasks master_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE master_tasks DROP CONSTRAINT IF EXISTS master_tasks_pkey;
ALTER TABLE master_tasks ADD CONSTRAINT master_tasks_pkey PRIMARY KEY (id);

--
-- Name: master_tasks master_tasks_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE master_tasks DROP CONSTRAINT IF EXISTS master_tasks_task_id_key;
ALTER TABLE master_tasks ADD CONSTRAINT master_tasks_task_id_key UNIQUE (task_id);

--
-- Name: master_tasks master_tasks_task_id_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE master_tasks DROP CONSTRAINT IF EXISTS master_tasks_task_id_tenant_id_key;
ALTER TABLE master_tasks ADD CONSTRAINT master_tasks_task_id_tenant_id_key UNIQUE (task_id, tenant_id);

--
-- Name: member_consumption member_consumption_order_no_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE member_consumption DROP CONSTRAINT IF EXISTS member_consumption_order_no_tenant_id_key;
ALTER TABLE member_consumption ADD CONSTRAINT member_consumption_order_no_tenant_id_key UNIQUE (order_no, tenant_id);

--
-- Name: member_consumption member_consumption_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE member_consumption DROP CONSTRAINT IF EXISTS member_consumption_pkey;
ALTER TABLE member_consumption ADD CONSTRAINT member_consumption_pkey PRIMARY KEY (id);

--
-- Name: ops_tasks ops_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ops_tasks DROP CONSTRAINT IF EXISTS ops_tasks_pkey;
ALTER TABLE ops_tasks ADD CONSTRAINT ops_tasks_pkey PRIMARY KEY (id);

--
-- Name: platform_data_cache platform_data_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE platform_data_cache DROP CONSTRAINT IF EXISTS platform_data_cache_pkey;
ALTER TABLE platform_data_cache ADD CONSTRAINT platform_data_cache_pkey PRIMARY KEY (id);

--
-- Name: platform_data_cache platform_data_cache_platform_store_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE platform_data_cache DROP CONSTRAINT IF EXISTS platform_data_cache_platform_store_key;
ALTER TABLE platform_data_cache ADD CONSTRAINT platform_data_cache_platform_store_key UNIQUE (platform, store, tenant_id);

--
-- Name: point_records point_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE point_records DROP CONSTRAINT IF EXISTS point_records_pkey;
ALTER TABLE point_records ADD CONSTRAINT point_records_pkey PRIMARY KEY (id);

--
-- Name: pos_order_items pos_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE pos_order_items DROP CONSTRAINT IF EXISTS pos_order_items_pkey;
ALTER TABLE pos_order_items ADD CONSTRAINT pos_order_items_pkey PRIMARY KEY (id);

--
-- Name: pos_orders pos_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE pos_orders DROP CONSTRAINT IF EXISTS pos_orders_pkey;
ALTER TABLE pos_orders ADD CONSTRAINT pos_orders_pkey PRIMARY KEY (id);

--
-- Name: recipe_component_ingredients recipe_component_ingredients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE recipe_component_ingredients DROP CONSTRAINT IF EXISTS recipe_component_ingredients_pkey;
ALTER TABLE recipe_component_ingredients ADD CONSTRAINT recipe_component_ingredients_pkey PRIMARY KEY (id);

--
-- Name: recipe_component_steps recipe_component_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE recipe_component_steps DROP CONSTRAINT IF EXISTS recipe_component_steps_pkey;
ALTER TABLE recipe_component_steps ADD CONSTRAINT recipe_component_steps_pkey PRIMARY KEY (id);

--
-- Name: recipe_components recipe_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE recipe_components DROP CONSTRAINT IF EXISTS recipe_components_pkey;
ALTER TABLE recipe_components ADD CONSTRAINT recipe_components_pkey PRIMARY KEY (id);

--
-- Name: recipes recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_pkey;
ALTER TABLE recipes ADD CONSTRAINT recipes_pkey PRIMARY KEY (id);

--
-- Name: regression_check_results regression_check_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE regression_check_results DROP CONSTRAINT IF EXISTS regression_check_results_pkey;
ALTER TABLE regression_check_results ADD CONSTRAINT regression_check_results_pkey PRIMARY KEY (id);

--
-- Name: rhythm_logs rhythm_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE rhythm_logs DROP CONSTRAINT IF EXISTS rhythm_logs_pkey;
ALTER TABLE rhythm_logs ADD CONSTRAINT rhythm_logs_pkey PRIMARY KEY (id);

--
-- Name: sales_growth_snapshot sales_growth_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sales_growth_snapshot DROP CONSTRAINT IF EXISTS sales_growth_snapshot_pkey;
ALTER TABLE sales_growth_snapshot ADD CONSTRAINT sales_growth_snapshot_pkey PRIMARY KEY (id);

--
-- Name: sales_growth_snapshot sales_growth_snapshot_snapshot_date_store_code_dish_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sales_growth_snapshot DROP CONSTRAINT IF EXISTS sales_growth_snapshot_snapshot_date_store_code_dish_name_key;
ALTER TABLE sales_growth_snapshot ADD CONSTRAINT sales_growth_snapshot_snapshot_date_store_code_dish_name_key UNIQUE (snapshot_date, store_code, dish_name, tenant_id);

--
-- Name: sales_raw sales_raw_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sales_raw DROP CONSTRAINT IF EXISTS sales_raw_pkey;
ALTER TABLE sales_raw ADD CONSTRAINT sales_raw_pkey PRIMARY KEY (id);

--
-- Name: scheduler_heartbeat scheduler_heartbeat_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE scheduler_heartbeat DROP CONSTRAINT IF EXISTS scheduler_heartbeat_pkey;
ALTER TABLE scheduler_heartbeat ADD CONSTRAINT scheduler_heartbeat_pkey PRIMARY KEY (task_name);

--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_pkey;
ALTER TABLE schedules ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);

--
-- Name: schedules schedules_store_employee_username_shift_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_store_employee_username_shift_date_key;
ALTER TABLE schedules ADD CONSTRAINT schedules_store_employee_username_shift_date_key UNIQUE (store, employee_username, shift_date, tenant_id);

--
-- Name: sop_cases sop_cases_case_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sop_cases DROP CONSTRAINT IF EXISTS sop_cases_case_id_key;
ALTER TABLE sop_cases ADD CONSTRAINT sop_cases_case_id_key UNIQUE (case_id);

--
-- Name: sop_cases sop_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sop_cases DROP CONSTRAINT IF EXISTS sop_cases_pkey;
ALTER TABLE sop_cases ADD CONSTRAINT sop_cases_pkey PRIMARY KEY (id);

--
-- Name: sop_definitions sop_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sop_definitions DROP CONSTRAINT IF EXISTS sop_definitions_pkey;
ALTER TABLE sop_definitions ADD CONSTRAINT sop_definitions_pkey PRIMARY KEY (id);

--
-- Name: sop_distributions sop_distributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sop_distributions DROP CONSTRAINT IF EXISTS sop_distributions_pkey;
ALTER TABLE sop_distributions ADD CONSTRAINT sop_distributions_pkey PRIMARY KEY (id);

--
-- Name: sop_distributions sop_distributions_sop_version_id_employee_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sop_distributions DROP CONSTRAINT IF EXISTS sop_distributions_sop_version_id_employee_username_key;
ALTER TABLE sop_distributions ADD CONSTRAINT sop_distributions_sop_version_id_employee_username_key UNIQUE (sop_version_id, employee_username, tenant_id);

--
-- Name: sop_questions sop_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sop_questions DROP CONSTRAINT IF EXISTS sop_questions_pkey;
ALTER TABLE sop_questions ADD CONSTRAINT sop_questions_pkey PRIMARY KEY (id);

--
-- Name: sop_quiz_questions sop_quiz_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sop_quiz_questions DROP CONSTRAINT IF EXISTS sop_quiz_questions_pkey;
ALTER TABLE sop_quiz_questions ADD CONSTRAINT sop_quiz_questions_pkey PRIMARY KEY (id);

--
-- Name: sop_steps sop_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sop_steps DROP CONSTRAINT IF EXISTS sop_steps_pkey;
ALTER TABLE sop_steps ADD CONSTRAINT sop_steps_pkey PRIMARY KEY (id);

--
-- Name: sop_versions sop_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sop_versions DROP CONSTRAINT IF EXISTS sop_versions_pkey;
ALTER TABLE sop_versions ADD CONSTRAINT sop_versions_pkey PRIMARY KEY (id);

--
-- Name: store_marketing_constraints store_marketing_constraints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE store_marketing_constraints DROP CONSTRAINT IF EXISTS store_marketing_constraints_pkey;
ALTER TABLE store_marketing_constraints ADD CONSTRAINT store_marketing_constraints_pkey PRIMARY KEY (id);

--
-- Name: store_marketing_constraints store_marketing_constraints_store_id_tenant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE store_marketing_constraints DROP CONSTRAINT IF EXISTS store_marketing_constraints_store_id_tenant_key;
ALTER TABLE store_marketing_constraints ADD CONSTRAINT store_marketing_constraints_store_id_tenant_key UNIQUE (store_id, tenant_id);

--
-- Name: store_wecom_configs store_wecom_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE store_wecom_configs DROP CONSTRAINT IF EXISTS store_wecom_configs_pkey;
ALTER TABLE store_wecom_configs ADD CONSTRAINT store_wecom_configs_pkey PRIMARY KEY (id);

--
-- Name: store_wecom_configs store_wecom_configs_store_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE store_wecom_configs DROP CONSTRAINT IF EXISTS store_wecom_configs_store_id_key;
ALTER TABLE store_wecom_configs ADD CONSTRAINT store_wecom_configs_store_id_key UNIQUE (store_id, tenant_id);

--
-- Name: table_visit_records table_visit_records_feishu_record_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE table_visit_records DROP CONSTRAINT IF EXISTS table_visit_records_feishu_record_id_key;
ALTER TABLE table_visit_records ADD CONSTRAINT table_visit_records_feishu_record_id_key UNIQUE (feishu_record_id, tenant_id);

--
-- Name: table_visit_records table_visit_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE table_visit_records DROP CONSTRAINT IF EXISTS table_visit_records_pkey;
ALTER TABLE table_visit_records ADD CONSTRAINT table_visit_records_pkey PRIMARY KEY (id);

--
-- Name: task_assignments task_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE task_assignments DROP CONSTRAINT IF EXISTS task_assignments_pkey;
ALTER TABLE task_assignments ADD CONSTRAINT task_assignments_pkey PRIMARY KEY (id);

--
-- Name: task_evidences task_evidences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE task_evidences DROP CONSTRAINT IF EXISTS task_evidences_pkey;
ALTER TABLE task_evidences ADD CONSTRAINT task_evidences_pkey PRIMARY KEY (id);

--
-- Name: task_experience_logs task_experience_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE task_experience_logs DROP CONSTRAINT IF EXISTS task_experience_logs_pkey;
ALTER TABLE task_experience_logs ADD CONSTRAINT task_experience_logs_pkey PRIMARY KEY (id);

--
-- Name: task_locks task_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE task_locks DROP CONSTRAINT IF EXISTS task_locks_pkey;
ALTER TABLE task_locks ADD CONSTRAINT task_locks_pkey PRIMARY KEY (id);

--
-- Name: task_reviews task_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE task_reviews DROP CONSTRAINT IF EXISTS task_reviews_pkey;
ALTER TABLE task_reviews ADD CONSTRAINT task_reviews_pkey PRIMARY KEY (id);

--
-- Name: task_runs task_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE task_runs DROP CONSTRAINT IF EXISTS task_runs_pkey;
ALTER TABLE task_runs ADD CONSTRAINT task_runs_pkey PRIMARY KEY (id);

--
-- Name: telemetry_anomalies telemetry_anomalies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE telemetry_anomalies DROP CONSTRAINT IF EXISTS telemetry_anomalies_pkey;
ALTER TABLE telemetry_anomalies ADD CONSTRAINT telemetry_anomalies_pkey PRIMARY KEY (id);

--
-- Name: telemetry_campaigns telemetry_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE telemetry_campaigns DROP CONSTRAINT IF EXISTS telemetry_campaigns_pkey;
ALTER TABLE telemetry_campaigns ADD CONSTRAINT telemetry_campaigns_pkey PRIMARY KEY (id);

--
-- Name: telemetry_collect_cursor telemetry_collect_cursor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE telemetry_collect_cursor DROP CONSTRAINT IF EXISTS telemetry_collect_cursor_pkey;
ALTER TABLE telemetry_collect_cursor ADD CONSTRAINT telemetry_collect_cursor_pkey PRIMARY KEY (id);

--
-- Name: telemetry_conversations telemetry_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE telemetry_conversations DROP CONSTRAINT IF EXISTS telemetry_conversations_pkey;
ALTER TABLE telemetry_conversations ADD CONSTRAINT telemetry_conversations_pkey PRIMARY KEY (id);

--
-- Name: telemetry_daily_reports telemetry_daily_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE telemetry_daily_reports DROP CONSTRAINT IF EXISTS telemetry_daily_reports_pkey;
ALTER TABLE telemetry_daily_reports ADD CONSTRAINT telemetry_daily_reports_pkey PRIMARY KEY (id);

--
-- Name: telemetry_events telemetry_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE telemetry_events DROP CONSTRAINT IF EXISTS telemetry_events_pkey;
ALTER TABLE telemetry_events ADD CONSTRAINT telemetry_events_pkey PRIMARY KEY (id);

--
-- Name: telemetry_ingest_log telemetry_ingest_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE telemetry_ingest_log DROP CONSTRAINT IF EXISTS telemetry_ingest_log_pkey;
ALTER TABLE telemetry_ingest_log ADD CONSTRAINT telemetry_ingest_log_pkey PRIMARY KEY (id);

--
-- Name: temp_staffing_requests temp_staffing_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE temp_staffing_requests DROP CONSTRAINT IF EXISTS temp_staffing_requests_pkey;
ALTER TABLE temp_staffing_requests ADD CONSTRAINT temp_staffing_requests_pkey PRIMARY KEY (id);

--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_pkey;
ALTER TABLE tenants ADD CONSTRAINT tenants_pkey PRIMARY KEY (tenant_id);

--
-- Name: training_assignments training_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE training_assignments DROP CONSTRAINT IF EXISTS training_assignments_pkey;
ALTER TABLE training_assignments ADD CONSTRAINT training_assignments_pkey PRIMARY KEY (id);

--
-- Name: training_certifications training_certifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE training_certifications DROP CONSTRAINT IF EXISTS training_certifications_pkey;
ALTER TABLE training_certifications ADD CONSTRAINT training_certifications_pkey PRIMARY KEY (id);

--
-- Name: training_plan_phases training_plan_phases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE training_plan_phases DROP CONSTRAINT IF EXISTS training_plan_phases_pkey;
ALTER TABLE training_plan_phases ADD CONSTRAINT training_plan_phases_pkey PRIMARY KEY (id);

--
-- Name: training_plans training_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE training_plans DROP CONSTRAINT IF EXISTS training_plans_pkey;
ALTER TABLE training_plans ADD CONSTRAINT training_plans_pkey PRIMARY KEY (id);

--
-- Name: training_sessions training_sessions_employee_username_topic_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE training_sessions DROP CONSTRAINT IF EXISTS training_sessions_employee_username_topic_id_key;
ALTER TABLE training_sessions ADD CONSTRAINT training_sessions_employee_username_topic_id_key UNIQUE (employee_username, topic_id, tenant_id);

--
-- Name: training_sessions training_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE training_sessions DROP CONSTRAINT IF EXISTS training_sessions_pkey;
ALTER TABLE training_sessions ADD CONSTRAINT training_sessions_pkey PRIMARY KEY (id);

--
-- Name: training_tasks training_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE training_tasks DROP CONSTRAINT IF EXISTS training_tasks_pkey;
ALTER TABLE training_tasks ADD CONSTRAINT training_tasks_pkey PRIMARY KEY (id);

--
-- Name: training_tasks training_tasks_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE training_tasks DROP CONSTRAINT IF EXISTS training_tasks_task_id_key;
ALTER TABLE training_tasks ADD CONSTRAINT training_tasks_task_id_key UNIQUE (task_id);

--
-- Name: training_topics training_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE training_topics DROP CONSTRAINT IF EXISTS training_topics_pkey;
ALTER TABLE training_topics ADD CONSTRAINT training_topics_pkey PRIMARY KEY (id);

--
-- Name: business_entity_relations uq_ber_composite; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE business_entity_relations DROP CONSTRAINT IF EXISTS uq_ber_composite;
ALTER TABLE business_entity_relations ADD CONSTRAINT uq_ber_composite UNIQUE (source_type, source_id, target_type, target_id, relation, date);

--
-- Name: dish_library_costs uq_dish_library_costs_brand_biz_dish; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE dish_library_costs DROP CONSTRAINT IF EXISTS uq_dish_library_costs_brand_biz_dish;
ALTER TABLE dish_library_costs ADD CONSTRAINT uq_dish_library_costs_brand_biz_dish UNIQUE (brand, biz_type, dish_name, tenant_id);

--
-- Name: dish_name_aliases uq_dish_name_aliases_scope; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE dish_name_aliases DROP CONSTRAINT IF EXISTS uq_dish_name_aliases_scope;
ALTER TABLE dish_name_aliases ADD CONSTRAINT uq_dish_name_aliases_scope UNIQUE (store, biz_type, alias_name, tenant_id);

--
-- Name: entity_health_snapshot uq_entity_health_day; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE entity_health_snapshot DROP CONSTRAINT IF EXISTS uq_entity_health_day;
ALTER TABLE entity_health_snapshot ADD CONSTRAINT uq_entity_health_day UNIQUE (entity_type, entity_id, snapshot_date, tenant_id);

--
-- Name: kitchen_sop_steps uq_kitchen_sop_step; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE kitchen_sop_steps DROP CONSTRAINT IF EXISTS uq_kitchen_sop_step;
ALTER TABLE kitchen_sop_steps ADD CONSTRAINT uq_kitchen_sop_step UNIQUE (dish_name, store, step_seq, tenant_id);

--
-- Name: ops_tasks uq_ops_tasks_dedupe; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ops_tasks DROP CONSTRAINT IF EXISTS uq_ops_tasks_dedupe;
ALTER TABLE ops_tasks ADD CONSTRAINT uq_ops_tasks_dedupe UNIQUE (dedupe_key, tenant_id);

--
-- Name: recipes uq_recipe; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE recipes DROP CONSTRAINT IF EXISTS uq_recipe;
ALTER TABLE recipes ADD CONSTRAINT uq_recipe UNIQUE (dish_name, store, version, tenant_id);

--
-- Name: user_reads user_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE user_reads DROP CONSTRAINT IF EXISTS user_reads_pkey;
ALTER TABLE user_reads ADD CONSTRAINT user_reads_pkey PRIMARY KEY (username, module, item_key, tenant_id);

--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE user_sessions DROP CONSTRAINT IF EXISTS user_sessions_pkey;
ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (username, tenant_id);

--
-- Name: wechat_work_customers wechat_work_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE wechat_work_customers DROP CONSTRAINT IF EXISTS wechat_work_customers_pkey;
ALTER TABLE wechat_work_customers ADD CONSTRAINT wechat_work_customers_pkey PRIMARY KEY (id);

--
-- Name: bitable_submissions_archive_feishu_open_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS bitable_submissions_archive_feishu_open_id_created_at_idx ON bitable_submissions_archive USING btree (feishu_open_id, created_at DESC);

--
-- Name: bitable_submissions_archive_sender_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS bitable_submissions_archive_sender_id_created_at_idx ON bitable_submissions_archive USING btree (sender_id, created_at DESC);

--
-- Name: idx_ab_test_results_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ab_test_results_tenant ON ab_test_results USING btree (tenant_id);

--
-- Name: idx_ab_test_results_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ab_test_results_test ON ab_test_results USING btree (test_id, result_date DESC);

--
-- Name: idx_ab_test_results_test_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ab_test_results_test_date ON ab_test_results USING btree (test_id, result_date DESC, variant);

--
-- Name: idx_ab_test_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ab_test_tasks_status ON ab_test_tasks USING btree (status, end_date DESC);

--
-- Name: idx_ab_test_tasks_store_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ab_test_tasks_store_status ON ab_test_tasks USING btree (store_code, status, created_at DESC);

--
-- Name: idx_ab_test_tasks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ab_test_tasks_tenant ON ab_test_tasks USING btree (tenant_id);

--
-- Name: idx_acceptance_checklists_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_acceptance_checklists_tenant ON acceptance_checklists USING btree (tenant_id);

--
-- Name: idx_action_plans_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_action_plans_tenant ON action_plans USING btree (tenant_id);

--
-- Name: idx_agent_admin_alert_log_sh_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_admin_alert_log_sh_date ON agent_admin_alert_log USING btree (date(timezone('Asia/Shanghai'::text, sent_at)));

--
-- Name: idx_agent_admin_alert_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_admin_alert_log_tenant ON agent_admin_alert_log USING btree (tenant_id);

--
-- Name: idx_agent_autonomous_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_autonomous_logs_tenant ON agent_autonomous_logs USING btree (tenant_id);

--
-- Name: idx_agent_collaboration_archives_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_collaboration_archives_tenant ON agent_collaboration_archives USING btree (tenant_id);

--
-- Name: idx_agent_configs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_configs_tenant ON agent_configs USING btree (tenant_id);

--
-- Name: idx_agent_memory_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory USING btree (agent_id, store, created_at DESC);

--
-- Name: idx_agent_memory_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_memory_tenant ON agent_memory USING btree (tenant_id);

--
-- Name: idx_agent_memory_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON agent_memory USING btree (memory_type, outcome_score);

--
-- Name: idx_agent_prompt_templates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_prompt_templates_tenant ON agent_prompt_templates USING btree (tenant_id);

--
-- Name: idx_agent_reply_templates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_reply_templates_tenant ON agent_reply_templates USING btree (tenant_id);

--
-- Name: idx_agent_rules_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_rules_tenant ON agent_rules USING btree (tenant_id);

--
-- Name: idx_agent_sessions_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_sessions_state ON agent_sessions USING btree (state);

--
-- Name: idx_agent_sessions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_sessions_tenant ON agent_sessions USING btree (tenant_id);

--
-- Name: idx_agent_sessions_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated_at ON agent_sessions USING btree (updated_at);

--
-- Name: idx_agent_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_id ON agent_sessions USING btree (user_id);

--
-- Name: idx_agent_task_logs_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_task_logs_agent ON agent_task_logs USING btree (agent_id, created_at);

--
-- Name: idx_agent_task_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_task_logs_tenant ON agent_task_logs USING btree (tenant_id);

--
-- Name: idx_agent_task_logs_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_task_logs_type ON agent_task_logs USING btree (task_type, status);

--
-- Name: idx_agent_v2_configs_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_v2_configs_key ON agent_v2_configs USING btree (config_key);

--
-- Name: idx_agent_v2_configs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_v2_configs_tenant ON agent_v2_configs USING btree (tenant_id);

--
-- Name: idx_agent_v2_cron_runs_key_ymd; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_v2_cron_runs_key_ymd ON agent_v2_cron_runs USING btree (job_key, run_ymd, created_at DESC);

--
-- Name: idx_agent_v2_cron_runs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_v2_cron_runs_tenant ON agent_v2_cron_runs USING btree (tenant_id);

--
-- Name: idx_agent_v2_data_alert_dedupe_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_v2_data_alert_dedupe_tenant ON agent_v2_data_alert_dedupe USING btree (tenant_id);

--
-- Name: idx_agent_v2_morning_briefing_sends_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_v2_morning_briefing_sends_tenant ON agent_v2_morning_briefing_sends USING btree (tenant_id);

--
-- Name: idx_agent_v2_morning_briefing_sends_ymd_ok; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_v2_morning_briefing_sends_ymd_ok ON agent_v2_morning_briefing_sends USING btree (run_ymd, ok, updated_at DESC);

--
-- Name: idx_agent_v2_pllm_monthly_report_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_v2_pllm_monthly_report_log_tenant ON agent_v2_pllm_monthly_report_log USING btree (tenant_id);

--
-- Name: idx_agent_v2_scheduled_report_sends_job_ymd_ok; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_v2_scheduled_report_sends_job_ymd_ok ON agent_v2_scheduled_report_sends USING btree (job_key, run_ymd, ok, updated_at DESC);

--
-- Name: idx_agent_v2_scheduled_report_sends_job_ymd_username_scope_tena; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_v2_scheduled_report_sends_job_ymd_username_scope_tena ON agent_v2_scheduled_report_sends USING btree (job_key, run_ymd, username, scope, tenant_id);

--
-- Name: idx_agent_v2_scheduled_report_sends_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_agent_v2_scheduled_report_sends_tenant ON agent_v2_scheduled_report_sends USING btree (tenant_id);

--
-- Name: idx_anomaly_pending_notifications_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_anomaly_pending_notifications_tenant ON anomaly_pending_notifications USING btree (tenant_id);

--
-- Name: idx_anomaly_triggers_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_triggers_key_unique ON anomaly_triggers USING btree (anomaly_key, store, trigger_date, tenant_id);

--
-- Name: idx_anomaly_triggers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_anomaly_triggers_status ON anomaly_triggers USING btree (status, severity);

--
-- Name: idx_anomaly_triggers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_anomaly_triggers_tenant ON anomaly_triggers USING btree (tenant_id);

--
-- Name: idx_ap_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ap_status ON action_plans USING btree (status);

--
-- Name: idx_ap_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ap_store ON action_plans USING btree (store, status);

--
-- Name: idx_apn_rule_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_apn_rule_key ON anomaly_pending_notifications USING btree (rule_key, created_at);

--
-- Name: idx_apn_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_apn_status ON anomaly_pending_notifications USING btree (status, created_at);

--
-- Name: idx_attend_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_attend_user_date ON attendance_records USING btree (employee_username, record_date);

--
-- Name: idx_attendance_records_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant ON attendance_records USING btree (tenant_id);

--
-- Name: idx_attention_scores_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_attention_scores_tenant ON attention_scores USING btree (tenant_id);

--
-- Name: idx_attn_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_attn_created ON attention_scores USING btree (created_at);

--
-- Name: idx_attn_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_attn_material ON attention_scores USING btree (material_id);

--
-- Name: idx_attn_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_attn_username ON attention_scores USING btree (username);

--
-- Name: idx_auto_ops_runs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_auto_ops_runs_tenant ON auto_ops_runs USING btree (tenant_id);

--
-- Name: idx_automated_test_results_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_automated_test_results_tenant ON automated_test_results USING btree (tenant_id);

--
-- Name: idx_automated_test_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_automated_test_time ON automated_test_results USING btree (created_at);

--
-- Name: idx_autonomous_logs_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_autonomous_logs_task ON agent_autonomous_logs USING btree (task_id, created_at);

--
-- Name: idx_ber_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ber_composite ON business_entity_relations USING btree (source_type, source_id, target_type, target_id, relation, date);

--
-- Name: idx_ber_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ber_date ON business_entity_relations USING btree (date);

--
-- Name: idx_ber_relation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ber_relation ON business_entity_relations USING btree (relation);

--
-- Name: idx_ber_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ber_source ON business_entity_relations USING btree (source_type, source_id);

--
-- Name: idx_ber_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ber_target ON business_entity_relations USING btree (target_type, target_id);

--
-- Name: idx_bitable_submissions_archive_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_bitable_submissions_archive_tenant ON bitable_submissions_archive USING btree (tenant_id);

--
-- Name: idx_brand_voice_samples_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_brand_voice_samples_tenant ON brand_voice_samples USING btree (tenant_id);

--
-- Name: idx_business_entity_relations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_business_entity_relations_tenant ON business_entity_relations USING btree (tenant_id);

--
-- Name: idx_calendar_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_calendar_date ON growth_content_calendar USING btree (publish_date, store_id, channel);

--
-- Name: idx_checkin_records_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_checkin_records_tenant ON checkin_records USING btree (tenant_id);

--
-- Name: idx_checkin_store_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_checkin_store_time ON checkin_records USING btree (store, check_time);

--
-- Name: idx_checkin_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_checkin_time ON checkin_records USING btree (check_time);

--
-- Name: idx_checkin_username_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_checkin_username_time ON checkin_records USING btree (username, check_time);

--
-- Name: idx_churn_predictions_date_risk; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_churn_predictions_date_risk ON growth_churn_predictions USING btree (prediction_date DESC, store_code, risk_level);

--
-- Name: idx_cn_holiday_calendar_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_cn_holiday_calendar_tenant ON cn_holiday_calendar USING btree (tenant_id);

--
-- Name: idx_collaboration_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_collaboration_session ON agent_collaboration_archives USING btree (session_id, created_at);

--
-- Name: idx_config_audit_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_config_audit_key ON config_audit_log USING btree (config_key, changed_at DESC);

--
-- Name: idx_config_audit_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_config_audit_log_tenant ON config_audit_log USING btree (tenant_id);

--
-- Name: idx_content_performance_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_content_performance_channel ON content_performance USING btree (channel, content_type, content_date DESC);

--
-- Name: idx_content_performance_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_content_performance_date ON content_performance USING btree (content_date DESC, store_code);

--
-- Name: idx_content_performance_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_content_performance_store ON content_performance USING btree (store_code, channel, created_at DESC);

--
-- Name: idx_content_performance_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_content_performance_tenant ON content_performance USING btree (tenant_id);

--
-- Name: idx_data_quality_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_data_quality_logs_tenant ON data_quality_logs USING btree (tenant_id);

--
-- Name: idx_data_quality_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_data_quality_source ON data_quality_logs USING btree (data_source, created_at);

--
-- Name: idx_decision_log_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_decision_log_store ON decision_log USING btree (store, created_at DESC);

--
-- Name: idx_decision_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_decision_log_tenant ON decision_log USING btree (tenant_id);

--
-- Name: idx_decision_log_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_decision_log_type ON decision_log USING btree (decision_type, store);

--
-- Name: idx_dish_library_costs_brand_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_dish_library_costs_brand_lookup ON dish_library_costs USING btree (brand, biz_type, dish_name) WHERE (enabled = true);

--
-- Name: idx_dish_library_costs_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_dish_library_costs_lookup ON dish_library_costs USING btree (store, biz_type, dish_name) WHERE (enabled = true);

--
-- Name: idx_dish_library_costs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_dish_library_costs_tenant ON dish_library_costs USING btree (tenant_id);

--
-- Name: idx_dish_name_aliases_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_dish_name_aliases_lookup ON dish_name_aliases USING btree (store, biz_type, alias_name) WHERE (enabled = true);

--
-- Name: idx_dish_name_aliases_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_dish_name_aliases_tenant ON dish_name_aliases USING btree (tenant_id);

--
-- Name: idx_dish_station_mapping_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_dish_station_mapping_tenant ON dish_station_mapping USING btree (tenant_id);

--
-- Name: idx_dsm_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_dsm_lookup ON dish_station_mapping USING btree (store, station, enabled);

--
-- Name: idx_dsm_unique_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_dsm_unique_assignment ON dish_station_mapping USING btree (store, station, dish_name, assignee_username, tenant_id);

--
-- Name: idx_ehs_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ehs_entity ON entity_health_snapshot USING btree (entity_type, entity_id, snapshot_date DESC);

--
-- Name: idx_emp_att_emp_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_emp_att_emp_id ON employee_attachments USING btree (employee_id);

--
-- Name: idx_employ_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_employ_user ON employment_records USING btree (employee_username, action_type);

--
-- Name: idx_employee_attachments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_employee_attachments_tenant ON employee_attachments USING btree (tenant_id);

--
-- Name: idx_employee_training_records_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_employee_training_records_tenant ON employee_training_records USING btree (tenant_id);

--
-- Name: idx_employment_records_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_employment_records_tenant ON employment_records USING btree (tenant_id);

--
-- Name: idx_entity_health_snapshot_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_entity_health_snapshot_tenant ON entity_health_snapshot USING btree (tenant_id);

--
-- Name: idx_escalation_chains_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_escalation_chains_tenant ON escalation_chains USING btree (tenant_id);

--
-- Name: idx_evals_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_evals_store ON growth_strategy_evaluations USING btree (store_id, total_score DESC);

--
-- Name: idx_exam_results_assignment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_exam_results_assignment_id ON exam_results USING btree (assignment_id);

--
-- Name: idx_exam_results_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_exam_results_tenant ON exam_results USING btree (tenant_id);

--
-- Name: idx_exam_results_user_key_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_exam_results_user_key_created_at ON exam_results USING btree (user_key, created_at DESC);

--
-- Name: idx_feishu_generic_config; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_feishu_generic_config ON feishu_generic_records USING btree (config_key, updated_at DESC);

--
-- Name: idx_feishu_generic_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_feishu_generic_record ON feishu_generic_records USING btree (record_id);

--
-- Name: idx_feishu_generic_records_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_feishu_generic_records_tenant ON feishu_generic_records USING btree (tenant_id);

--
-- Name: idx_feishu_generic_table; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_feishu_generic_table ON feishu_generic_records USING btree (app_token, table_id, updated_at DESC);

--
-- Name: idx_feishu_pending_pllm_decisions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_feishu_pending_pllm_decisions_tenant ON feishu_pending_pllm_decisions USING btree (tenant_id);

--
-- Name: idx_feishu_pending_replies_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_feishu_pending_replies_tenant ON feishu_pending_replies USING btree (tenant_id);

--
-- Name: idx_feishu_sync_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_feishu_sync_logs_tenant ON feishu_sync_logs USING btree (tenant_id);

--
-- Name: idx_feishu_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_feishu_sync_status ON feishu_sync_logs USING btree (sync_status);

--
-- Name: idx_feishu_sync_table; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_feishu_sync_table ON feishu_sync_logs USING btree (table_id, created_at);

--
-- Name: idx_growth_campaign_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_campaign_jobs_status ON growth_campaign_jobs USING btree (status, created_at);

--
-- Name: idx_growth_campaign_jobs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_campaign_jobs_tenant ON growth_campaign_jobs USING btree (tenant_id);

--
-- Name: idx_growth_campaign_plans_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_campaign_plans_tenant ON growth_campaign_plans USING btree (tenant_id);

--
-- Name: idx_growth_churn_predictions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_churn_predictions_tenant ON growth_churn_predictions USING btree (tenant_id);

--
-- Name: idx_growth_content_calendar_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_content_calendar_tenant ON growth_content_calendar USING btree (tenant_id);

--
-- Name: idx_growth_content_suggestions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_content_suggestions_tenant ON growth_content_suggestions USING btree (tenant_id);

--
-- Name: idx_growth_content_suggestions_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_content_suggestions_week ON growth_content_suggestions USING btree (week_start DESC, store_code);

--
-- Name: idx_growth_coupons_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_coupons_tenant ON growth_coupons USING btree (tenant_id);

--
-- Name: idx_growth_customer_profiles_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_customer_profiles_store ON growth_customer_profiles USING btree (store_id, lifecycle_stage);

--
-- Name: idx_growth_customer_profiles_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_customer_profiles_tenant ON growth_customer_profiles USING btree (tenant_id);

--
-- Name: idx_growth_customer_profiles_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_customer_profiles_tier ON growth_customer_profiles USING btree (store_id, value_tier);

--
-- Name: idx_growth_customer_profiles_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_customer_profiles_updated ON growth_customer_profiles USING btree (updated_at DESC);

--
-- Name: idx_growth_delivery_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_delivery_logs_action ON growth_delivery_logs USING btree (action_key, created_at DESC);

--
-- Name: idx_growth_delivery_logs_msg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_delivery_logs_msg ON growth_delivery_logs USING btree (provider_msg_id, created_at DESC);

--
-- Name: idx_growth_delivery_logs_rule_phone_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_delivery_logs_rule_phone_status ON growth_delivery_logs USING btree (rule_key, status, ((payload ->> 'phone'::text)));

--
-- Name: idx_growth_delivery_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_delivery_logs_tenant ON growth_delivery_logs USING btree (tenant_id);

--
-- Name: idx_growth_execution_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_execution_logs_action ON growth_execution_logs USING btree (action_key, created_at DESC);

--
-- Name: idx_growth_execution_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_execution_logs_tenant ON growth_execution_logs USING btree (tenant_id);

--
-- Name: idx_growth_holdout_members_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_holdout_members_tenant ON growth_holdout_members USING btree (tenant_id);

--
-- Name: idx_growth_learnings_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_learnings_channel ON growth_learnings USING btree (channel, variable, created_at DESC);

--
-- Name: idx_growth_learnings_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_learnings_store ON growth_learnings USING btree (store_code, channel, created_at DESC);

--
-- Name: idx_growth_learnings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_learnings_tenant ON growth_learnings USING btree (tenant_id);

--
-- Name: idx_growth_menu_health_reports_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_menu_health_reports_tenant ON growth_menu_health_reports USING btree (tenant_id);

--
-- Name: idx_growth_profile_signals_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_profile_signals_customer ON growth_profile_signals USING btree (customer_id, occurred_at DESC);

--
-- Name: idx_growth_profile_signals_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_profile_signals_tenant ON growth_profile_signals USING btree (tenant_id);

--
-- Name: idx_growth_profile_signals_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_profile_signals_type ON growth_profile_signals USING btree (signal_type, signal_key, occurred_at DESC);

--
-- Name: idx_growth_segment_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_segment_key ON growth_segment_members USING btree (segment_key);

--
-- Name: idx_growth_segment_members_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_segment_members_tenant ON growth_segment_members USING btree (tenant_id);

--
-- Name: idx_growth_sms_suppression_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_sms_suppression_tenant ON growth_sms_suppression USING btree (tenant_id);

--
-- Name: idx_growth_stored_value_members_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_stored_value_members_tenant ON growth_stored_value_members USING btree (tenant_id);

--
-- Name: idx_growth_strategy_evaluations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_strategy_evaluations_tenant ON growth_strategy_evaluations USING btree (tenant_id);

--
-- Name: idx_growth_strategy_explanations_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_strategy_explanations_key ON growth_strategy_explanations USING btree (strategy_key, created_at DESC);

--
-- Name: idx_growth_strategy_explanations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_strategy_explanations_tenant ON growth_strategy_explanations USING btree (tenant_id);

--
-- Name: idx_growth_svm_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_svm_phone ON growth_stored_value_members USING btree (phone);

--
-- Name: idx_growth_svm_store_consume; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_svm_store_consume ON growth_stored_value_members USING btree (store_id, last_consume_date);

--
-- Name: idx_growth_sync_failures_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_sync_failures_tenant ON growth_sync_failures USING btree (tenant_id);

--
-- Name: idx_growth_touch_rules_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_touch_rules_enabled ON growth_touch_rules USING btree (enabled, priority, updated_at DESC);

--
-- Name: idx_growth_touch_rules_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_touch_rules_tenant ON growth_touch_rules USING btree (tenant_id);

--
-- Name: idx_hr_rating_configs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_hr_rating_configs_tenant ON hr_rating_configs USING btree (tenant_id);

--
-- Name: idx_hrms_leave_domain_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_hrms_leave_domain_tenant ON hrms_leave_domain USING btree (tenant_id);

--
-- Name: idx_hrms_payroll_history_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_hrms_payroll_history_tenant ON hrms_payroll_history USING btree (tenant_id);

--
-- Name: idx_hrms_state_snapshots_key_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_hrms_state_snapshots_key_created ON hrms_state_snapshots USING btree (state_key, created_at DESC);

--
-- Name: idx_idempotency_keys_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_tenant ON idempotency_keys USING btree (tenant_id);

--
-- Name: idx_ing_lib_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ing_lib_name ON ingredient_library USING btree (name);

--
-- Name: idx_ingredient_categories_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ingredient_categories_tenant ON ingredient_categories USING btree (tenant_id);

--
-- Name: idx_ingredient_library_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ingredient_library_tenant ON ingredient_library USING btree (tenant_id);

--
-- Name: idx_keh_knowledge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_keh_knowledge ON knowledge_edit_history USING btree (knowledge_id, edited_at DESC);

--
-- Name: idx_kel_date_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_kel_date_station ON kitchen_exec_logs USING btree (store, station, task_date);

--
-- Name: idx_kel_one_per_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_kel_one_per_slot ON kitchen_exec_logs USING btree (store, station, dish_name, employee_username, task_date, schedule_time, tenant_id);

--
-- Name: idx_kitchen_exec_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_kitchen_exec_logs_tenant ON kitchen_exec_logs USING btree (tenant_id);

--
-- Name: idx_kitchen_sop_steps_dish; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_kitchen_sop_steps_dish ON kitchen_sop_steps USING btree (dish_name, store, enabled);

--
-- Name: idx_kitchen_sop_steps_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_kitchen_sop_steps_tenant ON kitchen_sop_steps USING btree (tenant_id);

--
-- Name: idx_kitchen_step_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_kitchen_step_logs_tenant ON kitchen_step_logs USING btree (tenant_id);

--
-- Name: idx_knowledge_edit_history_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_knowledge_edit_history_tenant ON knowledge_edit_history USING btree (tenant_id);

--
-- Name: idx_kpi_snapshots_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_date ON kpi_snapshots USING btree (snapshot_date);

--
-- Name: idx_kpi_snapshots_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_store ON kpi_snapshots USING btree (store, snapshot_date);

--
-- Name: idx_kpi_snapshots_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_tenant ON kpi_snapshots USING btree (tenant_id);

--
-- Name: idx_kpi_targets_metric; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_kpi_targets_metric ON kpi_targets USING btree (metric_key, effective_from);

--
-- Name: idx_kpi_targets_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_kpi_targets_store ON kpi_targets USING btree (store, brand, metric_key);

--
-- Name: idx_kpi_targets_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_kpi_targets_tenant ON kpi_targets USING btree (tenant_id);

--
-- Name: idx_kpi_targets_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_targets_unique ON kpi_targets USING btree (COALESCE(store, '__all__'::text), COALESCE(brand, '__all__'::text), metric_key, effective_from, tenant_id);

--
-- Name: idx_ksl_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ksl_lookup ON kitchen_step_logs USING btree (store, dish_name, employee_username, task_date);

--
-- Name: idx_ksl_unique_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_ksl_unique_slot ON kitchen_step_logs USING btree (store, dish_name, step_seq, employee_username, task_date, schedule_time, tenant_id);

--
-- Name: idx_licenses_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses USING btree (status);

--
-- Name: idx_licenses_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_licenses_tenant ON licenses USING btree (tenant_id);

--
-- Name: idx_marketing_campaigns_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_tenant ON marketing_campaigns USING btree (tenant_id);

--
-- Name: idx_marketing_payment_rules_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_marketing_payment_rules_active ON marketing_payment_rules USING btree (active, store_id, priority);

--
-- Name: idx_marketing_payment_rules_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_marketing_payment_rules_tenant ON marketing_payment_rules USING btree (tenant_id);

--
-- Name: idx_marketing_templates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_marketing_templates_tenant ON marketing_templates USING btree (tenant_id);

--
-- Name: idx_master_events_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_events_task ON master_events USING btree (task_id, created_at);

--
-- Name: idx_master_events_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_events_tenant ON master_events USING btree (tenant_id);

--
-- Name: idx_master_tasks_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_assignee ON master_tasks USING btree (assignee_username, status);

--
-- Name: idx_master_tasks_assignee_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_assignee_agent ON master_tasks USING btree (assignee_agent);

--
-- Name: idx_master_tasks_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_category ON master_tasks USING btree (category);

--
-- Name: idx_master_tasks_created_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_created_from ON master_tasks USING btree (created_from);

--
-- Name: idx_master_tasks_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_deadline ON master_tasks USING btree (timeout_at);

--
-- Name: idx_master_tasks_last_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_last_activity ON master_tasks USING btree (last_activity_at);

--
-- Name: idx_master_tasks_last_activity_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_last_activity_at ON master_tasks USING btree (last_activity_at DESC);

--
-- Name: idx_master_tasks_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_parent ON master_tasks USING btree (parent_task_id);

--
-- Name: idx_master_tasks_parent_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_parent_task_id ON master_tasks USING btree (parent_task_id);

--
-- Name: idx_master_tasks_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_source ON master_tasks USING btree (source);

--
-- Name: idx_master_tasks_source_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_source_status ON master_tasks USING btree (source, status);

--
-- Name: idx_master_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_status ON master_tasks USING btree (status);

--
-- Name: idx_master_tasks_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_store ON master_tasks USING btree (store, status);

--
-- Name: idx_master_tasks_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_task_id ON master_tasks USING btree (task_id);

--
-- Name: idx_master_tasks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_master_tasks_tenant ON master_tasks USING btree (tenant_id);

--
-- Name: idx_menu_health_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_menu_health_month ON growth_menu_health_reports USING btree (report_month DESC, store_code);

--
-- Name: idx_mktcamp_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_mktcamp_status ON marketing_campaigns USING btree (status);

--
-- Name: idx_mktcamp_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_mktcamp_store ON marketing_campaigns USING btree (store);

--
-- Name: idx_mt_timeout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_mt_timeout ON master_tasks USING btree (timeout_at) WHERE ((timeout_at IS NOT NULL) AND (status <> ALL (ARRAY['resolved'::text, 'closed'::text, 'settled'::text])));

--
-- Name: idx_ops_tasks_assignee_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ops_tasks_assignee_status ON ops_tasks USING btree (assignee_username, status);

--
-- Name: idx_ops_tasks_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ops_tasks_due ON ops_tasks USING btree (due_at);

--
-- Name: idx_ops_tasks_store_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ops_tasks_store_date ON ops_tasks USING btree (store, biz_date);

--
-- Name: idx_ops_tasks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ops_tasks_tenant ON ops_tasks USING btree (tenant_id);

--
-- Name: idx_payroll_history_type_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_payroll_history_type_created ON hrms_payroll_history USING btree (record_type, created_at DESC);

--
-- Name: idx_payroll_history_user_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_payroll_history_user_month ON hrms_payroll_history USING btree (username, month, created_at DESC);

--
-- Name: idx_plans_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_plans_store ON growth_campaign_plans USING btree (store_id, status, created_at DESC);

--
-- Name: idx_platform_data_cache_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_platform_data_cache_tenant ON platform_data_cache USING btree (tenant_id);

--
-- Name: idx_point_records_approved_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_point_records_approved_at ON point_records USING btree (approved_at);

--
-- Name: idx_point_records_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_point_records_store ON point_records USING btree (store);

--
-- Name: idx_point_records_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_point_records_tenant ON point_records USING btree (tenant_id);

--
-- Name: idx_point_records_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_point_records_username ON point_records USING btree (username);

--
-- Name: idx_pos_items_cat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pos_items_cat ON pos_order_items USING btree (category) WHERE (category IS NOT NULL);

--
-- Name: idx_pos_items_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_items_dedupe ON pos_order_items USING btree (order_no, biz_date, store_code, COALESCE(sku, ''::text), COALESCE(dish_name, ''::text), COALESCE(spec, ''::text), COALESCE(tags, ''::text), unit_price, qty, COALESCE(unit, ''::text), amount_before_discount, service_fee, discount, amount_after_discount, COALESCE(category_mid, ''::text), COALESCE(category, ''::text), tenant_id);

--
-- Name: idx_pos_items_dish; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pos_items_dish ON pos_order_items USING btree (dish_name);

--
-- Name: idx_pos_items_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pos_items_order ON pos_order_items USING btree (order_no);

--
-- Name: idx_pos_order_items_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pos_order_items_tenant ON pos_order_items USING btree (tenant_id);

--
-- Name: idx_pos_orders_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pos_orders_customer ON pos_orders USING btree (customer_id) WHERE (customer_id IS NOT NULL);

--
-- Name: idx_pos_orders_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pos_orders_date ON pos_orders USING btree (biz_date DESC, store_id);

--
-- Name: idx_pos_orders_no; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_orders_no ON pos_orders USING btree (order_no, tenant_id);

--
-- Name: idx_pos_orders_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pos_orders_phone ON pos_orders USING btree (phone) WHERE ((phone IS NOT NULL) AND (phone <> ''::text));

--
-- Name: idx_pos_orders_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pos_orders_tenant ON pos_orders USING btree (tenant_id);

--
-- Name: idx_profiles_pos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_profiles_pos ON growth_customer_profiles USING btree (pos_order_count DESC) WHERE (pos_order_count > 0);

--
-- Name: idx_rc_recipe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_rc_recipe ON recipe_components USING btree (recipe_id, sort_order);

--
-- Name: idx_rci_component; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_rci_component ON recipe_component_ingredients USING btree (component_id, sort_order);

--
-- Name: idx_rcs_component; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_rcs_component ON recipe_component_steps USING btree (component_id, step_seq);

--
-- Name: idx_recipe_component_ingredients_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_recipe_component_ingredients_tenant ON recipe_component_ingredients USING btree (tenant_id);

--
-- Name: idx_recipe_component_steps_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_recipe_component_steps_tenant ON recipe_component_steps USING btree (tenant_id);

--
-- Name: idx_recipe_components_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_recipe_components_tenant ON recipe_components USING btree (tenant_id);

--
-- Name: idx_recipes_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_recipes_lookup ON recipes USING btree (dish_name, store, status);

--
-- Name: idx_recipes_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_recipes_tenant ON recipes USING btree (tenant_id);

--
-- Name: idx_regression_check_results_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_regression_check_results_tenant ON regression_check_results USING btree (tenant_id);

--
-- Name: idx_regression_check_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_regression_check_time ON regression_check_results USING btree (created_at);

--
-- Name: idx_rhythm_logs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_rhythm_logs_date ON rhythm_logs USING btree (execution_date, rhythm_type);

--
-- Name: idx_rhythm_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_rhythm_logs_tenant ON rhythm_logs USING btree (tenant_id);

--
-- Name: idx_sales_growth_snapshot_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sales_growth_snapshot_date ON sales_growth_snapshot USING btree (snapshot_date DESC, store_code);

--
-- Name: idx_sales_growth_snapshot_dish; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sales_growth_snapshot_dish ON sales_growth_snapshot USING btree (dish_name, snapshot_date DESC);

--
-- Name: idx_sales_growth_snapshot_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sales_growth_snapshot_tenant ON sales_growth_snapshot USING btree (tenant_id);

--
-- Name: idx_sales_raw_biz; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sales_raw_biz ON sales_raw USING btree (biz_type);

--
-- Name: idx_sales_raw_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sales_raw_category ON sales_raw USING btree (store, biz_type, category);

--
-- Name: idx_sales_raw_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sales_raw_lookup ON sales_raw USING btree (store, date, biz_type, slot, dish_name);

--
-- Name: idx_sales_raw_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sales_raw_slot ON sales_raw USING btree (slot);

--
-- Name: idx_sales_raw_source_file; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sales_raw_source_file ON sales_raw USING btree (source_file) WHERE (source_file IS NOT NULL);

--
-- Name: idx_sales_raw_store_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sales_raw_store_date ON sales_raw USING btree (store, date);

--
-- Name: idx_sales_raw_store_date_biz; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sales_raw_store_date_biz ON sales_raw USING btree (store, date, biz_type);

--
-- Name: idx_sales_raw_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sales_raw_tenant ON sales_raw USING btree (tenant_id);

--
-- Name: idx_sched_store_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sched_store_date ON schedules USING btree (store, shift_date);

--
-- Name: idx_scheduler_heartbeat_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_scheduler_heartbeat_tenant ON scheduler_heartbeat USING btree (tenant_id);

--
-- Name: idx_schedules_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_schedules_tenant ON schedules USING btree (tenant_id);

--
-- Name: idx_sop_cases_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_cases_status ON sop_cases USING btree (status);

--
-- Name: idx_sop_cases_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_cases_store ON sop_cases USING btree (store);

--
-- Name: idx_sop_cases_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_cases_tenant ON sop_cases USING btree (tenant_id);

--
-- Name: idx_sop_definitions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_definitions_tenant ON sop_definitions USING btree (tenant_id);

--
-- Name: idx_sop_dist_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_dist_emp ON sop_distributions USING btree (employee_username, status);

--
-- Name: idx_sop_dist_ver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_dist_ver ON sop_distributions USING btree (sop_version_id);

--
-- Name: idx_sop_distributions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_distributions_tenant ON sop_distributions USING btree (tenant_id);

--
-- Name: idx_sop_questions_sop; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_questions_sop ON sop_questions USING btree (sop_id);

--
-- Name: idx_sop_questions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_questions_tenant ON sop_questions USING btree (tenant_id);

--
-- Name: idx_sop_quiz_questions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_quiz_questions_tenant ON sop_quiz_questions USING btree (tenant_id);

--
-- Name: idx_sop_steps_sop; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_steps_sop ON sop_steps USING btree (sop_id, seq);

--
-- Name: idx_sop_steps_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_steps_tenant ON sop_steps USING btree (tenant_id);

--
-- Name: idx_sop_ver_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_ver_id ON sop_versions USING btree (sop_id, version);

--
-- Name: idx_sop_versions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sop_versions_tenant ON sop_versions USING btree (tenant_id);

--
-- Name: idx_store_marketing_constraints_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_store_marketing_constraints_active ON store_marketing_constraints USING btree (active, updated_at DESC);

--
-- Name: idx_store_marketing_constraints_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_store_marketing_constraints_tenant ON store_marketing_constraints USING btree (tenant_id);

--
-- Name: idx_store_wecom_configs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_store_wecom_configs_tenant ON store_wecom_configs USING btree (tenant_id);

--
-- Name: idx_sync_failures_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sync_failures_created ON growth_sync_failures USING btree (created_at DESC);

--
-- Name: idx_ta_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ta_due_date ON training_assignments USING btree (due_date);

--
-- Name: idx_ta_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ta_employee ON training_assignments USING btree (employee_username);

--
-- Name: idx_ta_related_track; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ta_related_track ON training_assignments USING btree (related_track_id);

--
-- Name: idx_ta_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ta_topic ON training_assignments USING btree (topic_id);

--
-- Name: idx_table_visit_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_table_visit_date ON table_visit_records USING btree (date);

--
-- Name: idx_table_visit_feishu_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_table_visit_feishu_id ON table_visit_records USING btree (feishu_record_id);

--
-- Name: idx_table_visit_rating; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_table_visit_rating ON table_visit_records USING btree (service_rating, food_rating, environment_rating);

--
-- Name: idx_table_visit_records_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_table_visit_records_tenant ON table_visit_records USING btree (tenant_id);

--
-- Name: idx_table_visit_satisfaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_table_visit_satisfaction ON table_visit_records USING btree (satisfaction_level);

--
-- Name: idx_table_visit_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_table_visit_store ON table_visit_records USING btree (store);

--
-- Name: idx_task_assignments_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_assignments_assignee ON task_assignments USING btree (assignee_key, assignee_type);

--
-- Name: idx_task_assignments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_assignments_task ON task_assignments USING btree (task_id);

--
-- Name: idx_task_assignments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_assignments_tenant ON task_assignments USING btree (tenant_id);

--
-- Name: idx_task_evidences_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_evidences_task_id ON task_evidences USING btree (task_id, created_at DESC);

--
-- Name: idx_task_evidences_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_evidences_tenant ON task_evidences USING btree (tenant_id);

--
-- Name: idx_task_experience_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_experience_agent ON task_experience_logs USING btree (assignee_agent);

--
-- Name: idx_task_experience_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_experience_category ON task_experience_logs USING btree (category);

--
-- Name: idx_task_experience_logs_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_experience_logs_category ON task_experience_logs USING btree (category);

--
-- Name: idx_task_experience_logs_category_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_experience_logs_category_store ON task_experience_logs USING btree (category, store);

--
-- Name: idx_task_experience_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_experience_logs_tenant ON task_experience_logs USING btree (tenant_id);

--
-- Name: idx_task_locks_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_locks_expires ON task_locks USING btree (expires_at) WHERE (expires_at IS NOT NULL);

--
-- Name: idx_task_locks_task_lock_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_locks_task_lock_type ON task_locks USING btree (task_id, lock_type);

--
-- Name: idx_task_locks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_locks_tenant ON task_locks USING btree (tenant_id);

--
-- Name: idx_task_reviews_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_reviews_task_id ON task_reviews USING btree (task_id, created_at DESC);

--
-- Name: idx_task_reviews_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_reviews_tenant ON task_reviews USING btree (tenant_id);

--
-- Name: idx_task_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs USING btree (run_status);

--
-- Name: idx_task_runs_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs USING btree (task_id);

--
-- Name: idx_task_runs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_task_runs_tenant ON task_runs USING btree (tenant_id);

--
-- Name: idx_tc_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tc_employee ON training_certifications USING btree (employee_username);

--
-- Name: idx_tc_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tc_session ON training_certifications USING btree (session_id);

--
-- Name: idx_temp_staff_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_temp_staff_store ON temp_staffing_requests USING btree (store, status);

--
-- Name: idx_temp_staffing_requests_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_temp_staffing_requests_tenant ON temp_staffing_requests USING btree (tenant_id);

--
-- Name: idx_training_assignments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_training_assignments_tenant ON training_assignments USING btree (tenant_id);

--
-- Name: idx_training_certifications_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_training_certifications_tenant ON training_certifications USING btree (tenant_id);

--
-- Name: idx_training_plan_phases_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_training_plan_phases_tenant ON training_plan_phases USING btree (tenant_id);

--
-- Name: idx_training_plans_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_training_plans_employee ON training_plans USING btree (employee_id);

--
-- Name: idx_training_plans_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_training_plans_status ON training_plans USING btree (status);

--
-- Name: idx_training_plans_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_training_plans_tenant ON training_plans USING btree (tenant_id);

--
-- Name: idx_training_sessions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_training_sessions_tenant ON training_sessions USING btree (tenant_id);

--
-- Name: idx_training_tasks_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_training_tasks_assignee ON training_tasks USING btree (assignee_username, status);

--
-- Name: idx_training_tasks_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_training_tasks_role ON training_tasks USING btree (target_role);

--
-- Name: idx_training_tasks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_training_tasks_tenant ON training_tasks USING btree (tenant_id);

--
-- Name: idx_training_topics_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_training_topics_tenant ON training_topics USING btree (tenant_id);

--
-- Name: idx_ts_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ts_employee ON training_sessions USING btree (employee_username);

--
-- Name: idx_ts_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ts_topic ON training_sessions USING btree (topic_id);

--
-- Name: idx_user_reads_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_reads_tenant ON user_reads USING btree (tenant_id);

--
-- Name: idx_user_reads_username_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_reads_username_module ON user_reads USING btree (username, module);

--
-- Name: idx_wechat_work_customers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_wechat_work_customers_tenant ON wechat_work_customers USING btree (tenant_id);

--
-- Name: idx_ww_external_userid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_ww_external_userid ON wechat_work_customers USING btree (external_userid, tenant_id) WHERE ((external_userid IS NOT NULL) AND (external_userid <> ''::text));

--
-- Name: idx_ww_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ww_phone ON wechat_work_customers USING btree (phone) WHERE ((phone IS NOT NULL) AND (phone <> ''::text));

--
-- Name: idx_ww_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ww_store ON wechat_work_customers USING btree (store_id, created_at DESC);

--
-- Name: uq_content_performance_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_performance_key ON content_performance USING btree (content_key) WHERE ((content_key IS NOT NULL) AND (content_key <> ''::text));

--
-- Name: uq_growth_learnings_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_learnings_source ON growth_learnings USING btree (source_type, source_id, tenant_id) WHERE ((source_id IS NOT NULL) AND (source_id <> ''::text));

--
-- Name: uq_solution_round_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uq_solution_round_open ON growth_solution_rounds USING btree (store, problem_key) WHERE ((status)::text <> 'closed'::text);

--
-- Name: uq_user_sessions_username; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_username ON user_sessions USING btree (username);

--
-- Name: uq_user_sessions_username_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_username_tenant ON user_sessions USING btree (username, tenant_id);

--
-- Name: feishu_generic_records trg_feishu_generic_records_bitable_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_feishu_generic_records_bitable_notify AFTER INSERT OR UPDATE OF fields, raw, config_key ON feishu_generic_records FOR EACH ROW EXECUTE FUNCTION feishu_generic_records_bitable_notify();

--
-- Name: hrms_state trg_hrms_state_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hrms_state_audit AFTER UPDATE ON hrms_state FOR EACH ROW EXECUTE FUNCTION audit_hrms_state_update();

--
-- Name: ab_test_results ab_test_results_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ab_test_results DROP CONSTRAINT IF EXISTS ab_test_results_test_id_fkey;
ALTER TABLE ab_test_results ADD CONSTRAINT ab_test_results_test_id_fkey FOREIGN KEY (test_id) REFERENCES ab_test_tasks(id) ON DELETE CASCADE;

--
-- Name: employee_training_records employee_training_records_sop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE employee_training_records DROP CONSTRAINT IF EXISTS employee_training_records_sop_id_fkey;
ALTER TABLE employee_training_records ADD CONSTRAINT employee_training_records_sop_id_fkey FOREIGN KEY (sop_id) REFERENCES sop_definitions(id);

--
-- Name: agent_configs fk_agent_prompt_template; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS fk_agent_prompt_template;
ALTER TABLE agent_configs ADD CONSTRAINT fk_agent_prompt_template FOREIGN KEY (prompt_template_id) REFERENCES agent_prompt_templates(id) ON DELETE SET NULL;

--
-- Name: agent_configs fk_agent_reply_template; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS fk_agent_reply_template;
ALTER TABLE agent_configs ADD CONSTRAINT fk_agent_reply_template FOREIGN KEY (reply_template_id) REFERENCES agent_reply_templates(id) ON DELETE SET NULL;

--
-- Name: growth_campaign_plans growth_campaign_plans_recommended_poster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_campaign_plans DROP CONSTRAINT IF EXISTS growth_campaign_plans_recommended_poster_id_fkey;
ALTER TABLE growth_campaign_plans ADD CONSTRAINT growth_campaign_plans_recommended_poster_id_fkey FOREIGN KEY (recommended_poster_id) REFERENCES generated_posters(id);

--
-- Name: growth_campaign_plans growth_campaign_plans_source_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_campaign_plans DROP CONSTRAINT IF EXISTS growth_campaign_plans_source_template_id_fkey;
ALTER TABLE growth_campaign_plans ADD CONSTRAINT growth_campaign_plans_source_template_id_fkey FOREIGN KEY (source_template_id) REFERENCES marketing_templates(id);

--
-- Name: growth_customer_profiles growth_customer_profiles_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_customer_profiles DROP CONSTRAINT IF EXISTS growth_customer_profiles_customer_id_fkey;
ALTER TABLE growth_customer_profiles ADD CONSTRAINT growth_customer_profiles_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES growth_customers(id) ON DELETE CASCADE;

--
-- Name: growth_profile_signals growth_profile_signals_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_profile_signals DROP CONSTRAINT IF EXISTS growth_profile_signals_customer_id_fkey;
ALTER TABLE growth_profile_signals ADD CONSTRAINT growth_profile_signals_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES growth_customers(id) ON DELETE SET NULL;

--
-- Name: growth_solution_tasks growth_solution_tasks_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE growth_solution_tasks DROP CONSTRAINT IF EXISTS growth_solution_tasks_round_id_fkey;
ALTER TABLE growth_solution_tasks ADD CONSTRAINT growth_solution_tasks_round_id_fkey FOREIGN KEY (round_id) REFERENCES growth_solution_rounds(id) ON DELETE CASCADE;

--
-- Name: licenses licenses_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_tenant_id_fkey;
ALTER TABLE licenses ADD CONSTRAINT licenses_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE;

--
-- Name: recipe_component_ingredients recipe_component_ingredients_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE recipe_component_ingredients DROP CONSTRAINT IF EXISTS recipe_component_ingredients_component_id_fkey;
ALTER TABLE recipe_component_ingredients ADD CONSTRAINT recipe_component_ingredients_component_id_fkey FOREIGN KEY (component_id) REFERENCES recipe_components(id) ON DELETE CASCADE;

--
-- Name: recipe_component_steps recipe_component_steps_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE recipe_component_steps DROP CONSTRAINT IF EXISTS recipe_component_steps_component_id_fkey;
ALTER TABLE recipe_component_steps ADD CONSTRAINT recipe_component_steps_component_id_fkey FOREIGN KEY (component_id) REFERENCES recipe_components(id) ON DELETE CASCADE;

--
-- Name: recipe_components recipe_components_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE recipe_components DROP CONSTRAINT IF EXISTS recipe_components_recipe_id_fkey;
ALTER TABLE recipe_components ADD CONSTRAINT recipe_components_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE;

--
-- Name: sop_distributions sop_distributions_sop_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sop_distributions DROP CONSTRAINT IF EXISTS sop_distributions_sop_version_id_fkey;
ALTER TABLE sop_distributions ADD CONSTRAINT sop_distributions_sop_version_id_fkey FOREIGN KEY (sop_version_id) REFERENCES sop_versions(id);

--
-- Name: sop_questions sop_questions_sop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sop_questions DROP CONSTRAINT IF EXISTS sop_questions_sop_id_fkey;
ALTER TABLE sop_questions ADD CONSTRAINT sop_questions_sop_id_fkey FOREIGN KEY (sop_id) REFERENCES sop_definitions(id) ON DELETE CASCADE;

--
-- Name: sop_questions sop_questions_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sop_questions DROP CONSTRAINT IF EXISTS sop_questions_step_id_fkey;
ALTER TABLE sop_questions ADD CONSTRAINT sop_questions_step_id_fkey FOREIGN KEY (step_id) REFERENCES sop_steps(id) ON DELETE SET NULL;

--
-- Name: sop_steps sop_steps_sop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE sop_steps DROP CONSTRAINT IF EXISTS sop_steps_sop_id_fkey;
ALTER TABLE sop_steps ADD CONSTRAINT sop_steps_sop_id_fkey FOREIGN KEY (sop_id) REFERENCES sop_definitions(id) ON DELETE CASCADE;

--
-- Name: task_assignments task_assignments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE task_assignments DROP CONSTRAINT IF EXISTS task_assignments_task_id_fkey;
ALTER TABLE task_assignments ADD CONSTRAINT task_assignments_task_id_fkey FOREIGN KEY (task_id) REFERENCES master_tasks(task_id) ON DELETE CASCADE;

--
-- Name: task_locks task_locks_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE task_locks DROP CONSTRAINT IF EXISTS task_locks_task_id_fkey;
ALTER TABLE task_locks ADD CONSTRAINT task_locks_task_id_fkey FOREIGN KEY (task_id) REFERENCES master_tasks(task_id) ON DELETE CASCADE;

--
-- Name: task_runs task_runs_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE task_runs DROP CONSTRAINT IF EXISTS task_runs_task_id_fkey;
ALTER TABLE task_runs ADD CONSTRAINT task_runs_task_id_fkey FOREIGN KEY (task_id) REFERENCES master_tasks(task_id) ON DELETE CASCADE;

--
-- Name: training_assignments training_assignments_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE training_assignments DROP CONSTRAINT IF EXISTS training_assignments_topic_id_fkey;
ALTER TABLE training_assignments ADD CONSTRAINT training_assignments_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES training_topics(id);

--
-- Name: training_certifications training_certifications_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE training_certifications DROP CONSTRAINT IF EXISTS training_certifications_session_id_fkey;
ALTER TABLE training_certifications ADD CONSTRAINT training_certifications_session_id_fkey FOREIGN KEY (session_id) REFERENCES training_sessions(id);

--
-- Name: training_plan_phases training_plan_phases_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE training_plan_phases DROP CONSTRAINT IF EXISTS training_plan_phases_plan_id_fkey;
ALTER TABLE training_plan_phases ADD CONSTRAINT training_plan_phases_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES training_plans(id) ON DELETE CASCADE;

--
-- Name: training_sessions training_sessions_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE training_sessions DROP CONSTRAINT IF EXISTS training_sessions_topic_id_fkey;
ALTER TABLE training_sessions ADD CONSTRAINT training_sessions_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES training_topics(id);

--
-- Name: ab_test_results tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON ab_test_results USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: ab_test_tasks tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON ab_test_tasks USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: acceptance_checklists tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON acceptance_checklists USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: action_plans tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON action_plans USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_admin_alert_log tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_admin_alert_log USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_autonomous_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_autonomous_logs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_collaboration_archives tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_collaboration_archives USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_configs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_configs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_memory tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_memory USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_prompt_templates tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_prompt_templates USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_reply_templates tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_reply_templates USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_rules tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_rules USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_sessions USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_task_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_task_logs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_v2_cron_runs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_v2_cron_runs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_v2_data_alert_dedupe tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_v2_data_alert_dedupe USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_v2_morning_briefing_sends tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_v2_morning_briefing_sends USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_v2_pllm_monthly_report_log tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_v2_pllm_monthly_report_log USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: agent_v2_scheduled_report_sends tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON agent_v2_scheduled_report_sends USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: anomaly_pending_notifications tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON anomaly_pending_notifications USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: anomaly_triggers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON anomaly_triggers USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: attendance_records tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON attendance_records USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: attention_scores tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON attention_scores USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: auto_ops_runs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON auto_ops_runs USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: automated_test_results tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON automated_test_results USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: bitable_submissions_archive tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON bitable_submissions_archive USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: brand_voice_samples tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON brand_voice_samples USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: business_entity_relations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON business_entity_relations USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: checkin_records tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON checkin_records USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: config_audit_log tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON config_audit_log USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: content_performance tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON content_performance USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: data_quality_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON data_quality_logs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: decision_log tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON decision_log USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: dish_library_costs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON dish_library_costs USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: dish_name_aliases tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON dish_name_aliases USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: dish_station_mapping tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON dish_station_mapping USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: employee_attachments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON employee_attachments USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: employee_training_records tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON employee_training_records USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: employment_records tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON employment_records USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: entity_health_snapshot tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON entity_health_snapshot USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: escalation_chains tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON escalation_chains USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: exam_results tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON exam_results USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: feishu_generic_records tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON feishu_generic_records USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: feishu_pending_pllm_decisions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON feishu_pending_pllm_decisions USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: feishu_pending_replies tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON feishu_pending_replies USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: feishu_sync_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON feishu_sync_logs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_campaign_jobs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_campaign_jobs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_campaign_plans tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_campaign_plans USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_churn_predictions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_churn_predictions USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_content_calendar tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_content_calendar USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_content_suggestions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_content_suggestions USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_coupons tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_coupons USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_customer_profiles tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_customer_profiles USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_delivery_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_delivery_logs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_execution_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_execution_logs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_holdout_members tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_holdout_members USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_learnings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_learnings USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_menu_health_reports tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_menu_health_reports USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_profile_signals tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_profile_signals USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_segment_members tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_segment_members USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_sms_suppression tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_sms_suppression USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_stored_value_members tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_stored_value_members USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_strategy_evaluations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_strategy_evaluations USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_strategy_explanations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_strategy_explanations USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_sync_failures tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_sync_failures USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: growth_touch_rules tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON growth_touch_rules USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: hr_rating_configs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON hr_rating_configs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: hrms_leave_domain tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON hrms_leave_domain USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: hrms_payroll_history tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON hrms_payroll_history USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: idempotency_keys tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON idempotency_keys USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: ingredient_categories tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON ingredient_categories USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: ingredient_library tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON ingredient_library USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: kitchen_exec_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON kitchen_exec_logs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: kitchen_sop_steps tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON kitchen_sop_steps USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: kitchen_step_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON kitchen_step_logs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: knowledge_edit_history tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON knowledge_edit_history USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: kpi_snapshots tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON kpi_snapshots USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: kpi_targets tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON kpi_targets USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: marketing_campaigns tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON marketing_campaigns USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: marketing_payment_rules tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON marketing_payment_rules USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: marketing_templates tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON marketing_templates USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: master_events tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON master_events USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: master_tasks tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON master_tasks USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: ops_tasks tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON ops_tasks USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: platform_data_cache tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON platform_data_cache USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: point_records tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON point_records USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: pos_order_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON pos_order_items USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: pos_orders tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON pos_orders USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: recipe_component_ingredients tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON recipe_component_ingredients USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: recipe_component_steps tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON recipe_component_steps USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: recipe_components tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON recipe_components USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: recipes tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON recipes USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: regression_check_results tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON regression_check_results USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: rhythm_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON rhythm_logs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: sales_growth_snapshot tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON sales_growth_snapshot USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: sales_raw tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON sales_raw USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: scheduler_heartbeat tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON scheduler_heartbeat USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: schedules tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON schedules USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: sop_cases tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON sop_cases USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: sop_definitions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON sop_definitions USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: sop_distributions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON sop_distributions USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: sop_questions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON sop_questions USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: sop_quiz_questions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON sop_quiz_questions USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: sop_steps tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON sop_steps USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: sop_versions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON sop_versions USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: store_marketing_constraints tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON store_marketing_constraints USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: store_wecom_configs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON store_wecom_configs USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: table_visit_records tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON table_visit_records USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: task_assignments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON task_assignments USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: task_evidences tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON task_evidences USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: task_experience_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON task_experience_logs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: task_locks tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON task_locks USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: task_reviews tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON task_reviews USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: task_runs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON task_runs USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: temp_staffing_requests tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON temp_staffing_requests USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: training_assignments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON training_assignments USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: training_certifications tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON training_certifications USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: training_plan_phases tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON training_plan_phases USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: training_plans tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON training_plans USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: training_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON training_sessions USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: training_tasks tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON training_tasks USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- Name: training_topics tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON training_topics USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: user_reads tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON user_reads USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: user_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON user_sessions USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: wechat_work_customers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON wechat_work_customers USING (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text))) WITH CHECK (((tenant_id)::text = COALESCE(NULLIF(current_setting('app.tenant_id'::text, true), ''::text), 'default'::text)));

--
-- PostgreSQL database dump complete
--

