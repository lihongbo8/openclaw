// ======================================================================
// AICS Pipeline Database — SQLite via node:sqlite + Kysely
// ======================================================================
//
// 三库架构：
//   aics-pipeline.db   五层管道 + 公司管理拆解
//   role-instances.db  岗位实例 + 运行步骤 + 产物
//   aics-memory.db     记忆候选 + 正式记忆
//
// 替代旧的 JSON 文件存储（state.json / store.json / candidates.jsonl）

import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { Kysely } from "kysely";
import { resolveStateDir } from "../config/paths.js";
import { getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";

// ═══ Database interfaces ═══

export interface PipelineDatabase {
  observations: ObservationRow;
  observation_signals: ObservationSignalRow;
  attributions: AttributionRow;
  attribution_findings: AttributionFindingRow;
  goals: GoalRow;
  work_blocks: WorkBlockRow;
  work_block_roles: WorkBlockRoleRow;
  work_block_task_candidates: WorkBlockTaskCandidateRow;
  planning_packages: PlanningPackageRow;
  role_plan_items: RolePlanItemRow;
  dispatch_proposal_reviews: DispatchProposalReviewRow;
  task_packages: TaskPackageRow;
  dispatch_to_role_requests: DispatchToRoleRequestRow;
  role_results: RoleResultRow;
  role_pre_listing_reviews: RolePreListingReviewRow;
  role_pre_listing_review_events: RolePreListingReviewEventRow;
  tool_skill_development_tasks: ToolSkillDevelopmentTaskRow;
  tool_skill_development_events: ToolSkillDevelopmentEventRow;
  tool_skill_reviews: ToolSkillReviewRow;
  tool_skill_review_events: ToolSkillReviewEventRow;
  local_role_listings: LocalRoleListingRow;
  local_role_entitlements: LocalRoleEntitlementRow;
  local_role_execution_audits: LocalRoleExecutionAuditRow;
  local_role_ledger_entries: LocalRoleLedgerEntryRow;
}

export interface ObservationRow {
  id: string;
  status: string;
  title: string;
  summary: string;
  created_at: number;
  updated_at: number;
  audit_refs: string;
}

export interface ObservationSignalRow {
  id: string;
  observation_id: string;
  title: string;
  summary: string;
  evidence_refs: string;
}

export interface AttributionRow {
  id: string;
  status: string;
  observation_package_id: string;
  title: string;
  summary: string;
  created_at: number;
  updated_at: number;
  audit_refs: string;
}

export interface AttributionFindingRow {
  id: string;
  attribution_id: string;
  title: string;
  summary: string;
  confidence: string;
  observation_signal_ids: string;
}

export interface GoalRow {
  id: string;
  status: string;
  attribution_report_id: string;
  observation_package_id: string | null;
  title: string;
  owner: string;
  metric: string;
  target: string;
  rationale: string;
  created_at: number;
  updated_at: number;
  audit_refs: string;
}

export interface WorkBlockRow {
  id: string;
  goal_id: string;
  name: string;
  purpose: string;
  progress_gauge: string;
  status: string;
  blocked_reason: string | null;
  next_confirm: string | null;
  revision: number;
  is_stale: number;
  created_at: number;
  updated_at: number;
}

export interface WorkBlockRoleRow {
  id: string;
  work_block_id: string;
  role_listing_id: string;
  role_title: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface WorkBlockTaskCandidateRow {
  id: string;
  work_block_id: string;
  role_id: string | null;
  title: string;
  target_deliverable: string;
  status: string;
  completion_pct: number;
  blocked_reason: string | null;
  next_confirm: string | null;
  created_at: number;
  updated_at: number;
}

export interface LocalRoleListingRow {
  role_listing_id: string;
  review_id: string;
  role_package_id: string;
  title: string;
  category_ref: string;
  required_capabilities: string;
  authorization_fee_cents: number;
  status: string;
  source: string;
  created_at: number;
  updated_at: number;
}

export interface LocalRoleEntitlementRow {
  entitlement_id: string;
  role_listing_id: string;
  account_id: string;
  status: string;
  source: string;
  created_at: number;
  updated_at: number;
}

export interface LocalRoleExecutionAuditRow {
  audit_record_id: string;
  execution_id: string;
  role_listing_id: string;
  entitlement_id: string;
  status: string;
  summary: string;
  ledger_ref: string;
  billing_summary: string;
  created_at: number;
}

export interface LocalRoleLedgerEntryRow {
  ledger_ref: string;
  execution_id: string;
  role_listing_id: string;
  entitlement_id: string;
  authorization_fee_cents: number;
  execution_fee_cents: number;
  source: string;
  status: string;
  created_at: number;
}

export interface PlanningPackageRow {
  id: string;
  status: string;
  goal_id: string;
  title: string;
  summary: string;
  revision: number;
  source_observation_package_id: string | null;
  source_attribution_report_id: string | null;
  status_reason: string | null;
  superseded_by_planning_package_id: string | null;
  created_at: number;
  updated_at: number;
  audit_refs: string;
}

export interface RolePlanItemRow {
  id: string;
  status: string;
  planning_package_id: string;
  title: string;
  category: string | null;
  role_capability_ref: string;
  task_intent: string;
  expected_output: string;
  human_confirmation_required: number;
  source_signal_ids: string;
  source_finding_ids: string;
  dispatch_status: string;
  dispatch_proposal_ids: string;
  capability_match_summary: string | null;
  blocked_reasons: string;
  acceptance_criteria: string;
  created_at: number;
  updated_at: number;
  audit_refs: string;
}

export interface DispatchProposalReviewRow {
  id: string;
  status: string;
  planning_package_id: string;
  role_plan_item_id: string;
  title: string;
  risk_summary: string;
  confirmation_summary: string;
  created_at: number;
  updated_at: number;
  audit_refs: string;
}

export interface TaskPackageRow {
  id: string;
  status: string;
  goal_id: string;
  planning_package_id: string;
  role_plan_item_id: string;
  dispatch_proposal_review_id: string;
  title: string;
  task_text: string;
  category: string | null;
  required_capability_refs: string;
  created_at: number;
  updated_at: number;
  audit_refs: string;
}

export interface DispatchToRoleRequestRow {
  id: string;
  status: string;
  task_package_id: string;
  role_plan_item_id: string;
  role_listing_id: string | null;
  role_title: string | null;
  entitlement_id: string | null;
  workspace_dir: string | null;
  category_capability_id: string | null;
  category: string | null;
  required_capability_refs: string;
  allowed_tools: string;
  allowed_skills: string;
  capability_blocked_reasons: string;
  capability_request_id: string | null;
  confirm_execution: number;
  cost_confirmed: number;
  ledger_ref: string | null;
  tool_skill_ready: number;
  api_binding_ready: number;
  created_at: number;
  updated_at: number;
  audit_refs: string;
}

export interface RoleResultRow {
  id: string;
  status: string;
  task_package_id: string;
  dispatch_to_role_request_id: string;
  outcome: string;
  summary: string;
  artifact_refs: string;
  execution_evidence: string | null;
  created_at: number;
  updated_at: number;
  audit_refs: string;
}

export interface RolePreListingReviewRow {
  id: string;
  role_package_id: string;
  listing_draft_id: string | null;
  developer_id: string;
  category: string;
  package_dir: string;
  required_capabilities: string;
  bound_common_capabilities: string;
  validation_status: string;
  risk_level: string;
  review_status: string;
  review_findings: string;
  review_decision: string | null;
  approved_at: number | null;
  cloud_role_package_id: string | null;
  cloud_package_id: string | null;
  cloud_package_version: string | null;
  cloud_role_listing_id: string | null;
  submitted_at: number | null;
  submit_error: string | null;
  cloud_submit_status: string;
  created_at: number;
  updated_at: number;
}

export interface RolePreListingReviewEventRow {
  id: string;
  review_id: string;
  action: string;
  summary: string;
  created_at: number;
}

export interface ToolSkillDevelopmentTaskRow {
  id: string;
  category_capability_review_id: string;
  target_category_ref: string;
  target_category_name: string;
  asset_type: string;
  asset_id: string;
  requirement_ref: string;
  required_capabilities: string;
  source_route: string;
  source_candidates: string;
  selected_source: string | null;
  development_status: string;
  acceptance_criteria: string;
  risk_boundaries: string;
  linked_review_id: string | null;
  blocked_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface ToolSkillDevelopmentEventRow {
  id: string;
  task_id: string;
  action: string;
  summary: string;
  created_at: number;
}

export interface ToolSkillReviewRow {
  id: string;
  asset_type: string;
  asset_id: string;
  source: string;
  version: string;
  declared_capabilities: string;
  risk_level: string;
  review_status: string;
  review_findings: string;
  review_decision: string | null;
  approved_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ToolSkillReviewEventRow {
  id: string;
  review_id: string;
  action: string;
  summary: string;
  created_at: number;
}

// ═══ Database paths ═══

function resolveStateDirEnv(): string {
  const env = process.env as Record<string, string | undefined>;
  return resolveStateDir(env, () => env.HOME ?? "/tmp");
}

export function resolvePipelineDbPath(): string {
  return path.join(resolveStateDirEnv(), "aics-pipeline.db");
}

export function resolveRoleInstancesDbPath(): string {
  return path.join(resolveStateDirEnv(), "role-instances.db");
}

export function resolveMemoryDbPath(): string {
  return path.join(resolveStateDirEnv(), "aics-memory.db");
}

// ═══ Connection management ═══

let _pipelineDb: DatabaseSync | null = null;
let _pipelineKysely: Kysely<PipelineDatabase> | null = null;

export function getPipelineDb() {
  if (!_pipelineDb) {
    const sqlite = requireNodeSqlite();
    const dbPath = resolvePipelineDbPath();
    const dir = path.dirname(dbPath);
    const { mkdirSync } = require("node:fs");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    _pipelineDb = new sqlite.DatabaseSync(dbPath);
    try {
      _pipelineDb.exec("PRAGMA journal_mode=WAL");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("readonly") && !message.includes("read-only")) {
        throw error;
      }
    }
    _pipelineDb.exec("PRAGMA foreign_keys=ON");
  }
  return _pipelineDb;
}

export function getPipelineKysely(): Kysely<PipelineDatabase> {
  if (!_pipelineKysely) {
    _pipelineKysely = getNodeSqliteKysely<PipelineDatabase>(getPipelineDb());
  }
  return _pipelineKysely;
}

export function closePipelineDb(): void {
  if (_pipelineDb) {
    _pipelineDb.close();
    _pipelineDb = null;
    _pipelineKysely = null;
  }
}

// ═══ Schema ═══

export function createPipelineTables(db = getPipelineDb()): void {
  // 主建表
  db.exec(`
    -- 观察层
    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'prepared',
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      audit_refs TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS observation_signals (
      id TEXT PRIMARY KEY,
      observation_id TEXT NOT NULL REFERENCES observations(id),
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      evidence_refs TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_signals_obs ON observation_signals(observation_id);

    CREATE TABLE IF NOT EXISTS observation_evidence_runs (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL,
      observation_package_id TEXT REFERENCES observations(id),
      accepted_count INTEGER NOT NULL DEFAULT 0,
      needs_review_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      missing_count INTEGER NOT NULL DEFAULT 0,
      blocked_reasons TEXT NOT NULL DEFAULT '[]',
      run_result_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_observation_evidence_runs_created ON observation_evidence_runs(created_at);

    -- 归因层
    CREATE TABLE IF NOT EXISTS attributions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'prepared',
      observation_package_id TEXT NOT NULL REFERENCES observations(id),
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      audit_refs TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS attribution_findings (
      id TEXT PRIMARY KEY,
      attribution_id TEXT NOT NULL REFERENCES attributions(id),
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      confidence TEXT NOT NULL DEFAULT 'low',
      observation_signal_ids TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_findings_attr ON attribution_findings(attribution_id);

    -- 目标层
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'candidate',
      attribution_report_id TEXT NOT NULL REFERENCES attributions(id),
      observation_package_id TEXT REFERENCES observations(id),
      title TEXT NOT NULL,
      owner TEXT NOT NULL DEFAULT '',
      metric TEXT NOT NULL DEFAULT '',
      current_value TEXT,
      target TEXT NOT NULL DEFAULT '',
      cycle TEXT,
      rationale TEXT NOT NULL DEFAULT '',
      why_now TEXT,
      source_observation_signal_ids TEXT NOT NULL DEFAULT '[]',
      source_attribution_finding_ids TEXT NOT NULL DEFAULT '[]',
      blocked_reasons TEXT NOT NULL DEFAULT '[]',
      ready_for_planning INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      audit_refs TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);


    -- 公司管理拆解（managementBreakdown）
    CREATE TABLE IF NOT EXISTS work_blocks (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id),
      name TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      progress_gauge TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      blocked_reason TEXT,
      next_confirm TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      is_stale INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wb_goal ON work_blocks(goal_id);

    CREATE TABLE IF NOT EXISTS work_block_roles (
      id TEXT PRIMARY KEY,
      work_block_id TEXT NOT NULL REFERENCES work_blocks(id),
      role_listing_id TEXT NOT NULL,
      role_title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'assigned',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wbr_work_block ON work_block_roles(work_block_id);

    CREATE TABLE IF NOT EXISTS work_block_task_candidates (
      id TEXT PRIMARY KEY,
      work_block_id TEXT NOT NULL REFERENCES work_blocks(id),
      role_id TEXT REFERENCES work_block_roles(id),
      title TEXT NOT NULL,
      target_deliverable TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'candidate',
      completion_pct INTEGER NOT NULL DEFAULT 0,
      blocked_reason TEXT,
      next_confirm TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wbtc_wb ON work_block_task_candidates(work_block_id);
    CREATE INDEX IF NOT EXISTS idx_wbtc_status ON work_block_task_candidates(status);

    -- 规划层
    CREATE TABLE IF NOT EXISTS planning_packages (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'prepared',
      goal_id TEXT NOT NULL REFERENCES goals(id),
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 1,
      source_observation_package_id TEXT REFERENCES observations(id),
      source_attribution_report_id TEXT REFERENCES attributions(id),
      status_reason TEXT,
      superseded_by_planning_package_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      audit_refs TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS role_plan_items (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'draft',
      planning_package_id TEXT NOT NULL REFERENCES planning_packages(id),
      title TEXT NOT NULL,
      category TEXT,
      role_capability_ref TEXT NOT NULL DEFAULT '',
      task_intent TEXT NOT NULL DEFAULT '',
      expected_output TEXT NOT NULL DEFAULT '',
      human_confirmation_required INTEGER NOT NULL DEFAULT 0,
      source_signal_ids TEXT NOT NULL DEFAULT '[]',
      source_finding_ids TEXT NOT NULL DEFAULT '[]',
      dispatch_status TEXT NOT NULL DEFAULT 'not_dispatched',
      dispatch_proposal_ids TEXT NOT NULL DEFAULT '[]',
      capability_match_summary TEXT,
      blocked_reasons TEXT NOT NULL DEFAULT '[]',
      acceptance_criteria TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      audit_refs TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_rpi_planning ON role_plan_items(planning_package_id);

    -- 调度层
    CREATE TABLE IF NOT EXISTS dispatch_proposal_reviews (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'prepared',
      planning_package_id TEXT NOT NULL REFERENCES planning_packages(id),
      role_plan_item_id TEXT NOT NULL REFERENCES role_plan_items(id),
      title TEXT NOT NULL,
      risk_summary TEXT NOT NULL DEFAULT '',
      confirmation_summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      audit_refs TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS task_packages (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'materialized',
      goal_id TEXT NOT NULL REFERENCES goals(id),
      planning_package_id TEXT NOT NULL REFERENCES planning_packages(id),
      role_plan_item_id TEXT NOT NULL REFERENCES role_plan_items(id),
      dispatch_proposal_review_id TEXT NOT NULL REFERENCES dispatch_proposal_reviews(id),
      title TEXT NOT NULL,
      task_text TEXT NOT NULL DEFAULT '',
      category TEXT,
      required_capability_refs TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      audit_refs TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_tp_status ON task_packages(status);

    CREATE TABLE IF NOT EXISTS dispatch_to_role_requests (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'ready',
      task_package_id TEXT NOT NULL REFERENCES task_packages(id),
      role_plan_item_id TEXT NOT NULL REFERENCES role_plan_items(id),
      role_listing_id TEXT,
      role_title TEXT,
      entitlement_id TEXT,
      workspace_dir TEXT,
      category_capability_id TEXT,
      category TEXT,
      required_capability_refs TEXT NOT NULL DEFAULT '[]',
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      allowed_skills TEXT NOT NULL DEFAULT '[]',
      capability_blocked_reasons TEXT NOT NULL DEFAULT '[]',
      capability_request_id TEXT,
      confirm_execution INTEGER NOT NULL DEFAULT 0,
      cost_confirmed INTEGER NOT NULL DEFAULT 0,
      ledger_ref TEXT,
      tool_skill_ready INTEGER NOT NULL DEFAULT 1,
      api_binding_ready INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      audit_refs TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_dtrr_task ON dispatch_to_role_requests(task_package_id);

    -- 执行结果
    CREATE TABLE IF NOT EXISTS role_results (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'completed',
      task_package_id TEXT NOT NULL REFERENCES task_packages(id),
      dispatch_to_role_request_id TEXT NOT NULL REFERENCES dispatch_to_role_requests(id),
      outcome TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      artifact_refs TEXT NOT NULL DEFAULT '[]',
      execution_evidence TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      audit_refs TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_rr_task ON role_results(task_package_id);

    -- 本地上架检查：岗位上架前检查
    CREATE TABLE IF NOT EXISTS role_pre_listing_reviews (
      id TEXT PRIMARY KEY,
      role_package_id TEXT NOT NULL,
      listing_draft_id TEXT,
      developer_id TEXT NOT NULL DEFAULT 'local-developer',
      category TEXT NOT NULL DEFAULT '',
      package_dir TEXT NOT NULL DEFAULT '',
      required_capabilities TEXT NOT NULL DEFAULT '[]',
      bound_common_capabilities TEXT NOT NULL DEFAULT '[]',
      validation_status TEXT NOT NULL DEFAULT '未检查',
      risk_level TEXT NOT NULL DEFAULT '未评估',
      review_status TEXT NOT NULL DEFAULT '待审核',
      review_findings TEXT NOT NULL DEFAULT '[]',
      review_decision TEXT,
      approved_at INTEGER,
      cloud_role_package_id TEXT,
      cloud_package_id TEXT,
      cloud_package_version TEXT,
      cloud_role_listing_id TEXT,
      submitted_at INTEGER,
      submit_error TEXT,
      cloud_submit_status TEXT NOT NULL DEFAULT '未提交',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rplr_status ON role_pre_listing_reviews(review_status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rplr_package_listing ON role_pre_listing_reviews(role_package_id, IFNULL(listing_draft_id, ''));

    CREATE TABLE IF NOT EXISTS role_pre_listing_review_events (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES role_pre_listing_reviews(id),
      action TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rplre_review ON role_pre_listing_review_events(review_id);

    -- 品类能力缺口研发任务：决定复用、开源、改造或自研，再进入工具 / Skill 审核
    CREATE TABLE IF NOT EXISTS tool_skill_development_tasks (
      id TEXT PRIMARY KEY,
      category_capability_review_id TEXT NOT NULL REFERENCES category_capability_reviews(id),
      target_category_ref TEXT NOT NULL DEFAULT '',
      target_category_name TEXT NOT NULL DEFAULT '',
      asset_type TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      requirement_ref TEXT NOT NULL,
      required_capabilities TEXT NOT NULL DEFAULT '[]',
      source_route TEXT NOT NULL DEFAULT 'build_in_house',
      source_candidates TEXT NOT NULL DEFAULT '[]',
      selected_source TEXT,
      development_status TEXT NOT NULL DEFAULT 'need_source_plan',
      acceptance_criteria TEXT NOT NULL DEFAULT '[]',
      risk_boundaries TEXT NOT NULL DEFAULT '[]',
      linked_review_id TEXT,
      blocked_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tsdt_category ON tool_skill_development_tasks(category_capability_review_id);
    CREATE INDEX IF NOT EXISTS idx_tsdt_status ON tool_skill_development_tasks(development_status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tsdt_category_requirement ON tool_skill_development_tasks(category_capability_review_id, requirement_ref);

    CREATE TABLE IF NOT EXISTS tool_skill_development_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tool_skill_development_tasks(id),
      action TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tsdte_task ON tool_skill_development_events(task_id);

    -- 本地能力检查：平台工具 / Skill 检查
    CREATE TABLE IF NOT EXISTS tool_skill_reviews (
      id TEXT PRIMARY KEY,
      asset_type TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'platform',
      version TEXT NOT NULL DEFAULT '',
      declared_capabilities TEXT NOT NULL DEFAULT '[]',
      risk_level TEXT NOT NULL DEFAULT '未评估',
      review_status TEXT NOT NULL DEFAULT '待审核',
      review_findings TEXT NOT NULL DEFAULT '[]',
      review_decision TEXT,
      approved_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tsr_status ON tool_skill_reviews(review_status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tsr_asset ON tool_skill_reviews(asset_type, asset_id, version);

    CREATE TABLE IF NOT EXISTS tool_skill_review_events (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES tool_skill_reviews(id),
      action TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tsre_review ON tool_skill_review_events(review_id);

    -- 本地品类能力申请：岗位缺品类时由审核中心制作正式品类能力包
    CREATE TABLE IF NOT EXISTS category_capability_reviews (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      role_package_id TEXT NOT NULL DEFAULT '',
      listing_draft_id TEXT,
      developer_id TEXT NOT NULL DEFAULT 'local-developer',
      title TEXT NOT NULL,
      category_ref TEXT NOT NULL,
      category_name TEXT NOT NULL,
      role_description TEXT NOT NULL DEFAULT '',
      target_user TEXT NOT NULL DEFAULT '',
      role_materials TEXT NOT NULL DEFAULT '{}',
      required_capabilities TEXT NOT NULL DEFAULT '[]',
      input_output TEXT NOT NULL DEFAULT '',
      tool_skill_requirements TEXT NOT NULL DEFAULT '[]',
      risk_boundaries TEXT NOT NULL DEFAULT '[]',
      capability_refs TEXT NOT NULL DEFAULT '[]',
      skill_pack_ref TEXT NOT NULL DEFAULT '',
      tool_pack_ref TEXT NOT NULL DEFAULT '',
      category_pack_ref TEXT NOT NULL DEFAULT '',
      catalog_refs TEXT NOT NULL DEFAULT '[]',
      workflow_status TEXT NOT NULL DEFAULT 'waiting_category_review',
      review_status TEXT NOT NULL DEFAULT '待审核',
      review_findings TEXT NOT NULL DEFAULT '[]',
      review_decision TEXT,
      reviewed_by TEXT,
      reviewed_at INTEGER,
      cloud_sync_status TEXT NOT NULL DEFAULT '未同步',
      cloud_sync_error TEXT,
      cloud_synced_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ccr_status ON category_capability_reviews(review_status);
    CREATE INDEX IF NOT EXISTS idx_ccr_cloud_sync ON category_capability_reviews(cloud_sync_status);
    CREATE INDEX IF NOT EXISTS idx_ccr_updated ON category_capability_reviews(updated_at);
    CREATE INDEX IF NOT EXISTS idx_ccr_developer ON category_capability_reviews(developer_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ccr_request ON category_capability_reviews(request_id);

    CREATE TABLE IF NOT EXISTS category_capability_review_events (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES category_capability_reviews(id),
      action TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ccre_review ON category_capability_review_events(review_id);

    -- 本地正式岗位商品：本地版本不部署 SaaS 时的正式 roleListing 事实
    CREATE TABLE IF NOT EXISTS local_role_listings (
      role_listing_id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES role_pre_listing_reviews(id),
      role_package_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category_ref TEXT NOT NULL DEFAULT '',
      required_capabilities TEXT NOT NULL DEFAULT '[]',
      authorization_fee_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'published',
      source TEXT NOT NULL DEFAULT 'local_review_center',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lrl_review ON local_role_listings(review_id);
    CREATE INDEX IF NOT EXISTS idx_lrl_status ON local_role_listings(status);

    -- 本地正式 0 元授权：本地版本不部署 SaaS 时的正式 RoleEntitlement 事实
    CREATE TABLE IF NOT EXISTS local_role_entitlements (
      entitlement_id TEXT PRIMARY KEY,
      role_listing_id TEXT NOT NULL REFERENCES local_role_listings(role_listing_id),
      account_id TEXT NOT NULL DEFAULT 'local-admin',
      status TEXT NOT NULL DEFAULT 'authorized',
      source TEXT NOT NULL DEFAULT 'zero_price',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lre_listing_account ON local_role_entitlements(role_listing_id, account_id);

    -- 本地执行审计事实：本地版不部署 SaaS 时的 RoleResult readback 证据
    CREATE TABLE IF NOT EXISTS local_role_execution_audits (
      audit_record_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      role_listing_id TEXT NOT NULL REFERENCES local_role_listings(role_listing_id),
      entitlement_id TEXT NOT NULL REFERENCES local_role_entitlements(entitlement_id),
      status TEXT NOT NULL DEFAULT 'completed',
      summary TEXT NOT NULL DEFAULT '',
      ledger_ref TEXT NOT NULL,
      billing_summary TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lrea_execution ON local_role_execution_audits(execution_id);
    CREATE INDEX IF NOT EXISTS idx_lrea_listing ON local_role_execution_audits(role_listing_id);

    -- 本地账本事实：本地 0 元授权和执行费用的可读回条目
    CREATE TABLE IF NOT EXISTS local_role_ledger_entries (
      ledger_ref TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      role_listing_id TEXT NOT NULL REFERENCES local_role_listings(role_listing_id),
      entitlement_id TEXT NOT NULL REFERENCES local_role_entitlements(entitlement_id),
      authorization_fee_cents INTEGER NOT NULL DEFAULT 0,
      execution_fee_cents INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'local_zero_price',
      status TEXT NOT NULL DEFAULT 'posted',
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lrle_execution ON local_role_ledger_entries(execution_id);
  `);

  // migration: add observation_package_id to goals table（兼容 ALTER 已存在的列）
  try {
    db.exec("ALTER TABLE goals ADD COLUMN observation_package_id TEXT REFERENCES observations(id)");
  } catch {
    /* already exists */
  }
  for (const sql of [
    "ALTER TABLE role_plan_items ADD COLUMN category TEXT",
    "ALTER TABLE planning_packages ADD COLUMN revision INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE planning_packages ADD COLUMN source_observation_package_id TEXT REFERENCES observations(id)",
    "ALTER TABLE planning_packages ADD COLUMN source_attribution_report_id TEXT REFERENCES attributions(id)",
    "ALTER TABLE planning_packages ADD COLUMN status_reason TEXT",
    "ALTER TABLE planning_packages ADD COLUMN superseded_by_planning_package_id TEXT",
    "ALTER TABLE role_plan_items ADD COLUMN source_signal_ids TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE role_plan_items ADD COLUMN source_finding_ids TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE role_plan_items ADD COLUMN dispatch_status TEXT NOT NULL DEFAULT 'not_dispatched'",
    "ALTER TABLE role_plan_items ADD COLUMN dispatch_proposal_ids TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE role_plan_items ADD COLUMN capability_match_summary TEXT",
    "ALTER TABLE role_plan_items ADD COLUMN blocked_reasons TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE role_plan_items ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE goals ADD COLUMN current_value TEXT",
    "ALTER TABLE goals ADD COLUMN cycle TEXT",
    "ALTER TABLE goals ADD COLUMN why_now TEXT",
    "ALTER TABLE goals ADD COLUMN source_observation_signal_ids TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE goals ADD COLUMN source_attribution_finding_ids TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE goals ADD COLUMN blocked_reasons TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE goals ADD COLUMN ready_for_planning INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE task_packages ADD COLUMN category TEXT",
    "ALTER TABLE task_packages ADD COLUMN required_capability_refs TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE dispatch_to_role_requests ADD COLUMN category TEXT",
    "ALTER TABLE dispatch_to_role_requests ADD COLUMN category_capability_id TEXT",
    "ALTER TABLE dispatch_to_role_requests ADD COLUMN required_capability_refs TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE dispatch_to_role_requests ADD COLUMN allowed_tools TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE dispatch_to_role_requests ADD COLUMN allowed_skills TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE dispatch_to_role_requests ADD COLUMN capability_blocked_reasons TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE dispatch_to_role_requests ADD COLUMN capability_request_id TEXT",
    "ALTER TABLE dispatch_to_role_requests ADD COLUMN entitlement_id TEXT",
    "ALTER TABLE dispatch_to_role_requests ADD COLUMN cost_confirmed INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE dispatch_to_role_requests ADD COLUMN ledger_ref TEXT",
    "ALTER TABLE dispatch_to_role_requests ADD COLUMN tool_skill_ready INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE dispatch_to_role_requests ADD COLUMN api_binding_ready INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE role_results ADD COLUMN execution_evidence TEXT",
    "ALTER TABLE role_pre_listing_reviews ADD COLUMN cloud_role_package_id TEXT",
    "ALTER TABLE role_pre_listing_reviews ADD COLUMN cloud_package_id TEXT",
    "ALTER TABLE role_pre_listing_reviews ADD COLUMN cloud_package_version TEXT",
    "ALTER TABLE role_pre_listing_reviews ADD COLUMN cloud_role_listing_id TEXT",
    "ALTER TABLE role_pre_listing_reviews ADD COLUMN submitted_at INTEGER",
    "ALTER TABLE role_pre_listing_reviews ADD COLUMN submit_error TEXT",
    "ALTER TABLE role_pre_listing_reviews ADD COLUMN cloud_submit_status TEXT NOT NULL DEFAULT '未提交'",
    "ALTER TABLE category_capability_reviews ADD COLUMN role_materials TEXT NOT NULL DEFAULT '{}'",
  ]) {
    try {
      db.exec(sql);
    } catch {
      /* already exists */
    }
  }
}

// ═══ Migration from JSON ═══

export function migrateFromJson(pipelineDb = getPipelineDb()): {
  migrated: number;
  errors: string[];
} {
  const errors: string[] = [];
  let migrated = 0;

  try {
    const fs = require("node:fs");
    const stateJsonPath = path.join(resolveStateDirEnv(), "aics-main-flow", "state.json");

    if (!fs.existsSync(stateJsonPath)) {
      return { migrated: 0, errors: ["未找到旧的 state.json"] };
    }

    const raw = fs.readFileSync(stateJsonPath, "utf-8");
    const state = JSON.parse(raw);

    const insert = (table: string, rows: Record<string, unknown>[]) => {
      if (!rows.length) return;
      const stmt = pipelineDb.prepare(
        `INSERT OR IGNORE INTO ${table} (${Object.keys(rows[0]).join(", ")}) VALUES (${Object.keys(
          rows[0],
        )
          .map(() => "?")
          .join(", ")})`,
      );
      for (const row of rows) {
        stmt.run(...(Object.values(row) as SQLInputValue[]));
        migrated++;
      }
    };

    // observations
    if (Array.isArray(state.observations)) {
      insert(
        "observations",
        state.observations.map((o: Record<string, unknown>) => ({
          id: o.id,
          status: o.status ?? "prepared",
          title: o.title ?? "",
          summary: o.summary ?? "",
          created_at: o.createdAt ?? Date.now(),
          updated_at: o.updatedAt ?? Date.now(),
          audit_refs: JSON.stringify(o.auditRefs ?? []),
        })),
      );

      // observation signals
      for (const o of state.observations) {
        if (Array.isArray((o as Record<string, unknown>).signals)) {
          insert(
            "observation_signals",
            ((o as Record<string, unknown>).signals as Array<Record<string, unknown>>).map(
              (s: Record<string, unknown>) => ({
                id: s.id,
                observation_id: o.id,
                title: s.title ?? "",
                summary: s.summary ?? "",
                evidence_refs: JSON.stringify(s.evidenceRefs ?? []),
              }),
            ),
          );
        }
      }
    }

    if (Array.isArray(state.observationEvidenceRuns)) {
      insert(
        "observation_evidence_runs",
        state.observationEvidenceRuns.map((run: Record<string, unknown>) => ({
          id: run.id,
          plan_id: run.planId,
          status: run.status ?? "blocked",
          observation_package_id: run.observationPackageId ?? null,
          accepted_count: run.acceptedCount ?? 0,
          needs_review_count: run.needsReviewCount ?? 0,
          rejected_count: run.rejectedCount ?? 0,
          missing_count: run.missingCount ?? 0,
          blocked_reasons: JSON.stringify(run.blockedReasons ?? []),
          run_result_json: run.runResultJson ?? "{}",
          created_at: run.createdAt ?? Date.now(),
        })),
      );
    }

    // attributions
    if (Array.isArray(state.attributions)) {
      insert(
        "attributions",
        state.attributions.map((a: Record<string, unknown>) => ({
          id: a.id,
          status: a.status ?? "prepared",
          observation_package_id: a.observationPackageId ?? "",
          title: a.title ?? "",
          summary: a.summary ?? "",
          created_at: a.createdAt ?? Date.now(),
          updated_at: a.updatedAt ?? Date.now(),
          audit_refs: JSON.stringify(a.auditRefs ?? []),
        })),
      );

      // attribution findings
      for (const a of state.attributions) {
        if (Array.isArray((a as Record<string, unknown>).findings)) {
          insert(
            "attribution_findings",
            ((a as Record<string, unknown>).findings as Array<Record<string, unknown>>).map(
              (f: Record<string, unknown>) => ({
                id: f.id,
                attribution_id: a.id,
                title: f.title ?? "",
                summary: f.summary ?? "",
                confidence: f.confidence ?? "low",
                observation_signal_ids: JSON.stringify(f.observationSignalIds ?? []),
              }),
            ),
          );
        }
      }
    }

    // goals
    if (Array.isArray(state.goals)) {
      insert(
        "goals",
        state.goals.map((g: Record<string, unknown>) => ({
          id: g.id,
          status: g.status ?? "candidate",
          attribution_report_id: g.attributionReportId ?? "",
          observation_package_id: g.observationPackageId ?? null,
          title: g.title ?? "",
          owner: g.owner ?? "",
          metric: g.metric ?? "",
          current_value: g.currentValue ?? "",
          target: g.target ?? "",
          cycle: g.cycle ?? "",
          rationale: g.rationale ?? "",
          why_now: g.whyNow ?? "",
          source_observation_signal_ids: JSON.stringify(g.sourceObservationSignalIds ?? []),
          source_attribution_finding_ids: JSON.stringify(g.sourceAttributionFindingIds ?? []),
          blocked_reasons: JSON.stringify(g.blockedReasons ?? []),
          ready_for_planning: g.readyForPlanning === false ? 0 : 1,
          created_at: g.createdAt ?? Date.now(),
          updated_at: g.updatedAt ?? Date.now(),
          audit_refs: JSON.stringify(g.auditRefs ?? []),
        })),
      );
    }

    // planning
    if (Array.isArray(state.planningPackages)) {
      insert(
        "planning_packages",
        state.planningPackages.map((p: Record<string, unknown>) => ({
          id: p.id,
          status: p.status ?? "prepared",
          goal_id: p.goalId ?? "",
          title: p.title ?? "",
          summary: p.summary ?? "",
          created_at: p.createdAt ?? Date.now(),
          updated_at: p.updatedAt ?? Date.now(),
          audit_refs: JSON.stringify(p.auditRefs ?? []),
        })),
      );
    }

    if (Array.isArray(state.rolePlanItems)) {
      insert(
        "role_plan_items",
        state.rolePlanItems.map((r: Record<string, unknown>) => ({
          id: r.id,
          status: r.status ?? "draft",
          planning_package_id: r.planningPackageId ?? "",
          title: r.title ?? "",
          role_capability_ref: r.roleCapabilityRef ?? "",
          task_intent: r.taskIntent ?? "",
          expected_output: r.expectedOutput ?? "",
          human_confirmation_required: (r.humanConfirmationRequired as number) ?? 0,
          created_at: r.createdAt ?? Date.now(),
          updated_at: r.updatedAt ?? Date.now(),
          audit_refs: JSON.stringify(r.auditRefs ?? []),
        })),
      );
    }

    // dispatch
    if (Array.isArray(state.dispatchProposalReviews)) {
      insert(
        "dispatch_proposal_reviews",
        state.dispatchProposalReviews.map((d: Record<string, unknown>) => ({
          id: d.id,
          status: d.status ?? "prepared",
          planning_package_id: d.planningPackageId ?? "",
          role_plan_item_id: d.rolePlanItemId ?? "",
          title: d.title ?? "",
          risk_summary: d.riskSummary ?? "",
          confirmation_summary: d.confirmationSummary ?? "",
          created_at: d.createdAt ?? Date.now(),
          updated_at: d.updatedAt ?? Date.now(),
          audit_refs: JSON.stringify(d.auditRefs ?? []),
        })),
      );
    }

    if (Array.isArray(state.taskPackages)) {
      insert(
        "task_packages",
        state.taskPackages.map((t: Record<string, unknown>) => ({
          id: t.id,
          status: t.status ?? "materialized",
          goal_id: t.goalId ?? "",
          planning_package_id: t.planningPackageId ?? "",
          role_plan_item_id: t.rolePlanItemId ?? "",
          dispatch_proposal_review_id: t.dispatchProposalReviewId ?? "",
          title: t.title ?? "",
          task_text: t.taskText ?? "",
          created_at: t.createdAt ?? Date.now(),
          updated_at: t.updatedAt ?? Date.now(),
          audit_refs: JSON.stringify(t.auditRefs ?? []),
        })),
      );
    }

    if (Array.isArray(state.dispatchToRoleRequests)) {
      insert(
        "dispatch_to_role_requests",
        state.dispatchToRoleRequests.map((r: Record<string, unknown>) => ({
          id: r.id,
          status: r.status ?? "ready",
          task_package_id: r.taskPackageId ?? "",
          role_plan_item_id: r.rolePlanItemId ?? "",
          role_listing_id: r.roleListingId ?? null,
          role_title: r.roleTitle ?? null,
          workspace_dir: r.workspaceDir ?? null,
          confirm_execution: 1,
          created_at: r.createdAt ?? Date.now(),
          updated_at: r.updatedAt ?? Date.now(),
          audit_refs: JSON.stringify(r.auditRefs ?? []),
        })),
      );
    }

    if (Array.isArray(state.roleResults)) {
      insert(
        "role_results",
        state.roleResults.map((r: Record<string, unknown>) => ({
          id: r.id,
          status: r.status ?? "completed",
          task_package_id: r.taskPackageId ?? "",
          dispatch_to_role_request_id: r.dispatchToRoleRequestId ?? "",
          outcome: r.outcome ?? "succeeded",
          summary: r.summary ?? "",
          artifact_refs: JSON.stringify(r.artifactRefs ?? []),
          execution_evidence: r.executionEvidence ? JSON.stringify(r.executionEvidence) : null,
          created_at: r.createdAt ?? Date.now(),
          updated_at: r.updatedAt ?? Date.now(),
          audit_refs: JSON.stringify(r.auditRefs ?? []),
        })),
      );
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { migrated, errors };
}

// ═══ Bootstrap ═══

/**
 * 初始化 pipeline 数据库：建表 + 自动迁移旧 JSON 数据（如果表为空且 JSON 存在）
 */
export function bootstrapPipelineDb(): void {
  const db = getPipelineDb();
  createPipelineTables(db);

  // 检查是否为空库且有旧 JSON 数据
  const row = db.prepare("SELECT COUNT(*) as cnt FROM observations").get() as
    | { cnt: number }
    | undefined;
  if (!row || row.cnt === 0) {
    const fs = require("node:fs");
    const stateJsonPath = path.join(resolveStateDirEnv(), "aics-main-flow", "state.json");
    if (fs.existsSync(stateJsonPath)) {
      migrateFromJson(db);
    }
  }
}

// ═══ Role Instances DB ═══

export interface RoleInstanceDatabase {
  role_instances: RoleInstanceRow;
  role_runs: RoleRunRow;
  role_execution_steps: RoleExecutionStepRow;
  role_artifacts: RoleArtifactRow;
}

export interface RoleInstanceRow {
  instance_id: string;
  role_listing_id: string;
  role_title: string;
  workspace_dir: string;
  entitlement_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface RoleRunRow {
  run_id: string;
  instance_id: string;
  task_package_id: string;
  execution_id: string;
  status: string;
  summary: string;
  error: string | null;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  rework_count: number;
}

export interface RoleExecutionStepRow {
  step_id: string;
  run_id: string;
  step_order: number;
  step_kind: string;
  description: string;
  status: string;
  tool_call_id: string | null;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
}

export interface RoleArtifactRow {
  artifact_id: string;
  run_id: string;
  rel_path: string;
  kind: string;
  size_bytes: number | null;
  sha256: string | null;
  created_at: number;
}

let _riDb: DatabaseSync | null = null;

export function getRoleInstancesDb(): DatabaseSync {
  if (!_riDb) {
    const sqlite = requireNodeSqlite();
    const dbPath = resolveRoleInstancesDbPath();
    const { mkdirSync } = require("node:fs");
    mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    _riDb = new sqlite.DatabaseSync(dbPath);
    _riDb.exec("PRAGMA journal_mode=WAL");
    _riDb.exec("PRAGMA foreign_keys=ON");
  }
  return _riDb;
}

export function createRoleInstanceTables(db = getRoleInstancesDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS role_instances (
      instance_id TEXT PRIMARY KEY,
      role_listing_id TEXT NOT NULL,
      role_title TEXT NOT NULL,
      workspace_dir TEXT NOT NULL,
      entitlement_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_runs (
      run_id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL REFERENCES role_instances(instance_id),
      task_package_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      summary TEXT NOT NULL DEFAULT '',
      error TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      duration_ms INTEGER,
      rework_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_runs_instance ON role_runs(instance_id);

    CREATE TABLE IF NOT EXISTS role_execution_steps (
      step_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES role_runs(run_id),
      step_order INTEGER NOT NULL,
      step_kind TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      tool_call_id TEXT,
      tool_name TEXT,
      tool_input TEXT,
      tool_output TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_steps_run ON role_execution_steps(run_id);

    CREATE TABLE IF NOT EXISTS role_artifacts (
      artifact_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES role_runs(run_id),
      rel_path TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER,
      sha256 TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_run ON role_artifacts(run_id);
  `);
}

export function closeRoleInstancesDb(): void {
  if (_riDb) {
    _riDb.close();
    _riDb = null;
  }
}

export function repairRoleInstancesDb(): { ok: true; dbPath: string; backupPaths: string[] } {
  closeRoleInstancesDb();
  const dbPath = resolveRoleInstancesDbPath();
  mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const backupPaths: string[] = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${dbPath}${suffix}`;
    if (!existsSync(source)) continue;
    const backup = `${source}.unreadable-${stamp}`;
    renameSync(source, backup);
    backupPaths.push(backup);
  }
  createRoleInstanceTables();
  return { ok: true, dbPath, backupPaths };
}

// ═══ Memory DB ═══

export interface MemoryDatabase {
  memory_candidates: MemoryCandidateRow;
  formal_memories: FormalMemoryRow;
}

export interface MemoryCandidateRow {
  candidate_id: string;
  type: string;
  title: string;
  content: string;
  source_layer: string;
  source_entity_id: string;
  source_entity_type: string;
  confidence: string;
  tags: string;
  requires_human_confirm: number;
  proposed_by: string;
  proposed_at: number;
  status: string;
  confirmed_by: string | null;
  confirmed_at: number | null;
  reject_reason: string | null;
  audit_refs: string;
}

export interface FormalMemoryRow {
  memory_id: string;
  candidate_id: string | null;
  type: string;
  title: string;
  content: string;
  source_layer: string;
  source_entity_id: string;
  confidence: string;
  tags: string;
  created_at: number;
  updated_at: number;
  scope: string;
  scope_ref: string | null;
  version: number;
}

let _memDb: DatabaseSync | null = null;

export function getMemoryDb(): DatabaseSync {
  if (!_memDb) {
    const sqlite = requireNodeSqlite();
    const dbPath = resolveMemoryDbPath();
    const { mkdirSync } = require("node:fs");
    mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    _memDb = new sqlite.DatabaseSync(dbPath);
    _memDb.exec("PRAGMA journal_mode=WAL");
    _memDb.exec("PRAGMA foreign_keys=ON");
  }
  return _memDb;
}

export function createMemoryTables(db = getMemoryDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_candidates (
      candidate_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_layer TEXT NOT NULL,
      source_entity_id TEXT NOT NULL,
      source_entity_type TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'medium',
      tags TEXT NOT NULL DEFAULT '[]',
      requires_human_confirm INTEGER NOT NULL DEFAULT 1,
      proposed_by TEXT NOT NULL,
      proposed_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      confirmed_by TEXT,
      confirmed_at INTEGER,
      reject_reason TEXT,
      audit_refs TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_mc_status ON memory_candidates(status);
    CREATE INDEX IF NOT EXISTS idx_mc_source ON memory_candidates(source_layer, source_entity_id);

    CREATE TABLE IF NOT EXISTS formal_memories (
      memory_id TEXT PRIMARY KEY,
      candidate_id TEXT REFERENCES memory_candidates(candidate_id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_layer TEXT NOT NULL,
      source_entity_id TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'medium',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      scope TEXT NOT NULL DEFAULT 'company',
      scope_ref TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_fm_type ON formal_memories(type);
    CREATE INDEX IF NOT EXISTS idx_fm_scope ON formal_memories(scope, scope_ref);
  `);

  // FTS (best-effort, may fail in some Node SQLite builds)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS formal_memories_fts USING fts5(
        title, content, tags,
        content='formal_memories',
        content_rowid='rowid'
      );
    `);
  } catch {
    /* FTS not available */
  }
}

export function closeMemoryDb(): void {
  if (_memDb) {
    _memDb.close();
    _memDb = null;
  }
}
