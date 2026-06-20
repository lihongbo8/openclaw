import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { SQLInputValue } from "node:sqlite";
import type { ApiConnectionsReadModel } from "../api-connections/model.js";
import type { SkillStatusEntry, SkillStatusReport } from "../skills/discovery/status.js";
import { createPipelineTables, getPipelineDb } from "./db.js";
import { publishLocalRoleListing } from "./local-role-marketplace.js";
import { resolveCapabilities, ToolRegistry, type ToolCapabilityGroup } from "./tool-registry.js";
import { createToolSkillDevelopmentTasksForCategoryCapability } from "./tool-skill-development-store.js";

export const ROLE_PRE_LISTING_REVIEW_STATUSES = [
  "待审核",
  "检查中",
  "待开发者修改",
  "已拒绝",
  "已通过",
  "已提交上架",
] as const;

export type RolePreListingReviewStatus = (typeof ROLE_PRE_LISTING_REVIEW_STATUSES)[number];

export const TOOL_SKILL_REVIEW_STATUSES = [
  "待审核",
  "检查中",
  "待开发者修改",
  "已拒绝",
  "已通过",
] as const;

export type ToolSkillReviewStatus = (typeof TOOL_SKILL_REVIEW_STATUSES)[number];

export type ReviewFindingSeverity = "pass" | "warning" | "blocking";

export type ReviewFinding = {
  id: string;
  section: "结构" | "能力绑定" | "执行契约" | "跑通性" | "风险" | "合格性";
  severity: ReviewFindingSeverity;
  message: string;
};

export type CloudSubmitStatus = "未提交" | "提交中" | "已提交" | "提交失败";
export type CloudSyncStatus = "未同步" | "同步中" | "已同步" | "同步失败";
export type CategoryCapabilityWorkflowStatus =
  | "waiting_category_review"
  | "category_review_approved"
  | "approved_local_sync_failed"
  | "category_bound";

export type RolePreListingReview = {
  id: string;
  rolePackageId: string;
  listingDraftId: string | null;
  developerId: string;
  category: string;
  packageDir: string;
  requiredCapabilities: string[];
  boundCommonCapabilities: string[];
  validationStatus: string;
  riskLevel: string;
  reviewStatus: RolePreListingReviewStatus;
  reviewFindings: ReviewFinding[];
  reviewDecision: string | null;
  approvedAt: number | null;
  cloudRolePackageId: string | null;
  cloudPackageId: string | null;
  cloudPackageVersion: string | null;
  cloudRoleListingId: string | null;
  submittedAt: number | null;
  submitError: string | null;
  cloudSubmitStatus: CloudSubmitStatus;
  createdAt: number;
  updatedAt: number;
};

export type ToolSkillReview = {
  id: string;
  assetType: "tool" | "skill";
  assetId: string;
  source: string;
  version: string;
  declaredCapabilities: string[];
  riskLevel: string;
  reviewStatus: ToolSkillReviewStatus;
  reviewFindings: ReviewFinding[];
  reviewDecision: string | null;
  approvedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type CategoryCapabilityReview = {
  id: string;
  requestId: string;
  rolePackageId: string;
  listingDraftId: string | null;
  developerId: string;
  title: string;
  categoryRef: string;
  categoryName: string;
  roleDescription: string;
  targetUser: string;
  roleMaterials: CategoryCapabilityRoleMaterials;
  requiredCapabilities: string[];
  inputOutput: string;
  toolSkillRequirements: string[];
  riskBoundaries: string[];
  capabilityRefs: string[];
  skillPackRef: string;
  toolPackRef: string;
  categoryPackRef: string;
  catalogRefs: string[];
  workflowStatus: CategoryCapabilityWorkflowStatus;
  reviewStatus: ToolSkillReviewStatus;
  reviewFindings: ReviewFinding[];
  reviewDecision: string | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
  cloudSyncStatus: CloudSyncStatus;
  cloudSyncError: string | null;
  cloudSyncedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ReviewEvent = {
  id: string;
  reviewId: string;
  action: string;
  summary: string;
  createdAt: number;
};

export type ReviewListPageInfo = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export type ReviewListSort =
  | "updated_desc"
  | "updated_asc"
  | "risk_desc"
  | "status_asc"
  | "activation_status_asc";

export type RoleReviewListFilter =
  | "all"
  | "pending_review"
  | "missing_category"
  | "category_pending"
  | "ready_for_manual_approval"
  | "needs_changes"
  | "high_risk";

export type CategoryCapabilityListFilter =
  | "all"
  | "pending_review"
  | "approved"
  | "activated"
  | "sync_failed"
  | "needs_changes";

export type ReviewListOptions<TFilter extends string = string> = {
  page?: number;
  pageSize?: number;
  filter?: TFilter;
  search?: string;
  sort?: ReviewListSort;
};

export type ReviewListResult<T> = {
  reviews: T[];
  pageInfo: ReviewListPageInfo;
};

export type StartRoleReviewInput = {
  rolePackageId?: string;
  listingDraftId?: string | null;
  developerId?: string;
  category?: string;
  packageDir: string;
  requiredCapabilities?: string[];
  boundCommonCapabilities?: string[];
};

export type StartToolSkillReviewInput = {
  assetType: "tool" | "skill";
  assetId: string;
  source?: string;
  version?: string;
  declaredCapabilities?: string[];
};

export type CreateCategoryCapabilityRequestInput = {
  requestId?: string;
  rolePackageId?: string;
  listingDraftId?: string | null;
  developerId?: string;
  title: string;
  categoryName?: string;
  categoryRef?: string;
  roleDescription?: string;
  targetUser?: string;
  roleMaterials?: CategoryCapabilityRoleMaterials;
  requiredCapabilities?: string[];
  inputOutput?: string;
  toolSkillRequirements?: string[];
  riskBoundaries?: string[];
  reason?: string;
};

export type CreateRoleCapabilityAnalysisInput = {
  rolePackageId?: string;
  listingDraftId?: string | null;
  developerId?: string;
  roleTitle: string;
  roleDescription?: string;
  targetUser?: string;
  requiredCapabilities?: string[];
  sopFlow?: string;
  dailyPlan?: string;
  weeklyPlan?: string;
  monthlyPlan?: string;
  inputOutput?: string;
  riskBoundaries?: string[];
};

export type CategoryCapabilityRoleMaterials = {
  roleTitle?: string;
  roleDescription?: string;
  targetUser?: string;
  targetCategory?: string;
  requiredCapabilities?: string[];
  sopFlow?: string;
  dailyPlan?: string;
  weeklyPlan?: string;
  monthlyPlan?: string;
  inputOutput?: string;
  riskBoundaries?: string[];
};

export type RoleCapabilityAnalysis = {
  roleTitle: string;
  categoryName: string;
  categoryRef: string;
  requiredCapabilities: string[];
  neededTools: string[];
  neededSkills: string[];
  neededProviders: string[];
  existingCapabilities: string[];
  missingCapabilities: string[];
  humanConfirmationCapabilities: string[];
  nonAutomaticCapabilities: string[];
  categoryCapabilityReview: CategoryCapabilityReview;
  toolSkillReviews: ToolSkillReview[];
};

export type CloudRolePackageUploadFile = {
  path: string;
  content: string;
  sha256: string;
  sizeBytes: number;
};

export type CloudRolePackageUploadPayload = {
  files: CloudRolePackageUploadFile[];
};

export type RolePreListingCloudSubmitInput = {
  cloudBaseUrl?: string;
  cloudAccessToken?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

export type RolePreListingCloudSubmitSummary = {
  rolePackageId?: string;
  packageId?: string;
  packageVersion?: string;
  roleListingId?: string;
  mode?: "local" | "cloud";
};

export type RolePreListingSubmitResult = {
  review: RolePreListingReview;
  cloud: RolePreListingCloudSubmitSummary;
};

export type CategoryCapabilityCloudSyncResult = {
  review: CategoryCapabilityReview;
  cloud: {
    categoryRef: string;
    category?: unknown;
  };
};

export type RoleCategoryBindingResult = {
  review: RolePreListingReview;
  categoryCapabilityReview: CategoryCapabilityReview;
};

export type ToolSkillValidationEvidence = {
  skillsReport?: SkillStatusReport;
  apiConnections?: ApiConnectionsReadModel;
};

export const MAX_DEVELOPER_ROLE_DRAFTS = 3;

type RoleReviewRow = {
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
  review_status: RolePreListingReviewStatus;
  review_findings: string;
  review_decision: string | null;
  approved_at: number | null;
  cloud_role_package_id: string | null;
  cloud_package_id: string | null;
  cloud_package_version: string | null;
  cloud_role_listing_id: string | null;
  submitted_at: number | null;
  submit_error: string | null;
  cloud_submit_status: CloudSubmitStatus;
  created_at: number;
  updated_at: number;
};

type ToolSkillReviewRow = {
  id: string;
  asset_type: "tool" | "skill";
  asset_id: string;
  source: string;
  version: string;
  declared_capabilities: string;
  risk_level: string;
  review_status: ToolSkillReviewStatus;
  review_findings: string;
  review_decision: string | null;
  approved_at: number | null;
  created_at: number;
  updated_at: number;
};

type CategoryCapabilityReviewRow = {
  id: string;
  request_id: string;
  role_package_id: string;
  listing_draft_id: string | null;
  developer_id: string;
  title: string;
  category_ref: string;
  category_name: string;
  role_description: string;
  target_user: string;
  role_materials: string;
  required_capabilities: string;
  input_output: string;
  tool_skill_requirements: string;
  risk_boundaries: string;
  capability_refs: string;
  skill_pack_ref: string;
  tool_pack_ref: string;
  category_pack_ref: string;
  catalog_refs: string;
  workflow_status: CategoryCapabilityWorkflowStatus;
  review_status: ToolSkillReviewStatus;
  review_findings: string;
  review_decision: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  cloud_sync_status: CloudSyncStatus;
  cloud_sync_error: string | null;
  cloud_synced_at: number | null;
  created_at: number;
  updated_at: number;
};

type EventRow = {
  id: string;
  review_id: string;
  action: string;
  summary: string;
  created_at: number;
};

const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:api[_-]?key|secret|token|bearer)\b\s*[:=]/i, label: "secret/token 字段" },
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/, label: "API Key 明文" },
  { pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/i, label: "Bearer token 明文" },
  { pattern: /\/Users\/[^\s"'`]+|\/home\/[^\s"'`]+/i, label: "本地绝对路径" },
];

function db(options: { ensureSchema?: boolean } = {}) {
  const database = getPipelineDb();
  if (options.ensureSchema !== false) createPipelineTables(database);
  return database;
}

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no such table");
}

function now() {
  return Date.now();
}

function readJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function readFindings(value: string): ReviewFinding[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as ReviewFinding[]) : [];
  } catch {
    return [];
  }
}

function readRoleMaterials(value: string): CategoryCapabilityRoleMaterials {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as CategoryCapabilityRoleMaterials)
      : {};
  } catch {
    return {};
  }
}

function stringifyArray(values: string[] | undefined): string {
  return JSON.stringify(
    Array.from(new Set((values ?? []).map((item) => item.trim()).filter(Boolean))),
  );
}

function stringifyRoleMaterials(value: CategoryCapabilityRoleMaterials | undefined): string {
  const material: CategoryCapabilityRoleMaterials = {};
  if (value?.roleTitle?.trim()) material.roleTitle = value.roleTitle.trim();
  if (value?.roleDescription?.trim()) material.roleDescription = value.roleDescription.trim();
  if (value?.targetUser?.trim()) material.targetUser = value.targetUser.trim();
  if (value?.targetCategory?.trim()) material.targetCategory = value.targetCategory.trim();
  if (value?.requiredCapabilities?.length)
    material.requiredCapabilities = uniqueStrings(value.requiredCapabilities);
  if (value?.sopFlow?.trim()) material.sopFlow = value.sopFlow.trim();
  if (value?.dailyPlan?.trim()) material.dailyPlan = value.dailyPlan.trim();
  if (value?.weeklyPlan?.trim()) material.weeklyPlan = value.weeklyPlan.trim();
  if (value?.monthlyPlan?.trim()) material.monthlyPlan = value.monthlyPlan.trim();
  if (value?.inputOutput?.trim()) material.inputOutput = value.inputOutput.trim();
  if (value?.riskBoundaries?.length) material.riskBoundaries = uniqueStrings(value.riskBoundaries);
  return JSON.stringify(material);
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((item) => item?.trim() ?? "").filter(Boolean)));
}

function slugSegment(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const safe = ascii.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || `category-${createHash("sha1").update(value).digest("hex").slice(0, 8)}`;
}

function categoryRefForName(name: string): string {
  if (name.trim() === "商城运营") return "category:marketplace-ops@1";
  return `category:${slugSegment(name)}@1`;
}

function packRef(prefix: "categorypack" | "skillpack" | "toolpack", categoryRef: string): string {
  const match = /^category:([^@]+)@(\d+)$/u.exec(categoryRef);
  const base = match?.[1] ?? slugSegment(categoryRef);
  const version = match?.[2] ?? "1";
  return `${prefix}:${base}@${version}`;
}

function includesAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword.toLowerCase()));
}

function inferRoleCapabilityPlan(input: CreateRoleCapabilityAnalysisInput): {
  categoryName: string;
  categoryRef: string;
  requiredCapabilities: string[];
  neededTools: string[];
  neededSkills: string[];
  neededProviders: string[];
  humanConfirmationCapabilities: string[];
  nonAutomaticCapabilities: string[];
} {
  const text = [
    input.roleTitle,
    input.roleDescription,
    input.targetUser,
    input.sopFlow,
    input.dailyPlan,
    input.weeklyPlan,
    input.monthlyPlan,
    input.inputOutput,
    ...(input.requiredCapabilities ?? []),
    ...(input.riskBoundaries ?? []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  if (
    includesAny(text, [
      "商城",
      "岗位商城",
      "运营",
      "授权",
      "审计",
      "账本",
      "ledger",
      "audit",
      "rolelisting",
      "entitlement",
    ])
  ) {
    const categoryName = "商城运营";
    const requiredCapabilities = uniqueStrings([
      ...(input.requiredCapabilities ?? []),
      "marketplace.read",
      "gateway.role_read_model",
      "ledger.summary.read",
      "audit.record",
      "document.write",
      "human.confirm",
      "model.chat.analysis",
    ]);
    return {
      categoryName,
      categoryRef: categoryRefForName(categoryName),
      requiredCapabilities,
      neededTools: [
        "tool.platform.marketplace_read_model",
        "tool.platform.gateway_role_read_model",
        "tool.platform.ledger_summary_read",
        "tool.platform.audit_record",
        "tool.platform.template_renderer",
        "tool.platform.human_confirmation",
      ],
      neededSkills: ["skill.platform.marketplace_ops_diagnosis"],
      neededProviders: ["provider.platform.model_chat_analysis"],
      humanConfirmationCapabilities: ["human.confirm"],
      nonAutomaticCapabilities: ["audit.record", "ledger.summary.read"],
    };
  }

  const categoryName = includesAny(text, ["数据", "分析", "报表"])
    ? "数据分析"
    : input.roleTitle.trim();
  const requiredCapabilities = uniqueStrings([
    ...(input.requiredCapabilities ?? []),
    ...(includesAny(text, ["数据", "分析", "报表"])
      ? ["data.analyze", "document.write", "human.confirm"]
      : []),
    "human.confirm",
  ]);
  return {
    categoryName,
    categoryRef: categoryRefForName(categoryName),
    requiredCapabilities,
    neededTools: requiredCapabilities.map(
      (capability) => `tool.required.${capability.replace(/\./g, "_")}`,
    ),
    neededSkills: [`skill.required.${slugSegment(categoryName)}`],
    neededProviders: requiredCapabilities.some((capability) => capability.includes("model"))
      ? ["provider.required.model"]
      : [],
    humanConfirmationCapabilities: requiredCapabilities.filter(
      (capability) => capability === "human.confirm",
    ),
    nonAutomaticCapabilities: requiredCapabilities.filter((capability) =>
      /(payment|publish|delete|secret|token|ledger|audit)/i.test(capability),
    ),
  };
}

function roleRowToReview(row: RoleReviewRow): RolePreListingReview {
  return {
    id: row.id,
    rolePackageId: row.role_package_id,
    listingDraftId: row.listing_draft_id,
    developerId: row.developer_id,
    category: row.category,
    packageDir: row.package_dir,
    requiredCapabilities: readJsonArray(row.required_capabilities),
    boundCommonCapabilities: readJsonArray(row.bound_common_capabilities),
    validationStatus: row.validation_status,
    riskLevel: row.risk_level,
    reviewStatus: row.review_status,
    reviewFindings: readFindings(row.review_findings),
    reviewDecision: row.review_decision,
    approvedAt: row.approved_at,
    cloudRolePackageId: row.cloud_role_package_id ?? null,
    cloudPackageId: row.cloud_package_id ?? null,
    cloudPackageVersion: row.cloud_package_version ?? null,
    cloudRoleListingId: row.cloud_role_listing_id ?? null,
    submittedAt: row.submitted_at ?? null,
    submitError: row.submit_error ?? null,
    cloudSubmitStatus: row.cloud_submit_status ?? "未提交",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toolSkillRowToReview(row: ToolSkillReviewRow): ToolSkillReview {
  return {
    id: row.id,
    assetType: row.asset_type,
    assetId: row.asset_id,
    source: row.source,
    version: row.version,
    declaredCapabilities: readJsonArray(row.declared_capabilities),
    riskLevel: row.risk_level,
    reviewStatus: row.review_status,
    reviewFindings: readFindings(row.review_findings),
    reviewDecision: row.review_decision,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function categoryCapabilityRowToReview(row: CategoryCapabilityReviewRow): CategoryCapabilityReview {
  return {
    id: row.id,
    requestId: row.request_id,
    rolePackageId: row.role_package_id,
    listingDraftId: row.listing_draft_id,
    developerId: row.developer_id,
    title: row.title,
    categoryRef: row.category_ref,
    categoryName: row.category_name,
    roleDescription: row.role_description,
    targetUser: row.target_user,
    roleMaterials: readRoleMaterials(row.role_materials ?? "{}"),
    requiredCapabilities: readJsonArray(row.required_capabilities),
    inputOutput: row.input_output,
    toolSkillRequirements: readJsonArray(row.tool_skill_requirements),
    riskBoundaries: readJsonArray(row.risk_boundaries),
    capabilityRefs: readJsonArray(row.capability_refs),
    skillPackRef: row.skill_pack_ref,
    toolPackRef: row.tool_pack_ref,
    categoryPackRef: row.category_pack_ref,
    catalogRefs: readJsonArray(row.catalog_refs),
    workflowStatus: row.workflow_status,
    reviewStatus: row.review_status,
    reviewFindings: readFindings(row.review_findings),
    reviewDecision: row.review_decision,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    cloudSyncStatus: row.cloud_sync_status,
    cloudSyncError: row.cloud_sync_error,
    cloudSyncedAt: row.cloud_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function draftCategoryCapabilityReview(input: {
  requestId: string;
  rolePackageId?: string;
  listingDraftId?: string | null;
  developerId?: string;
  title: string;
  categoryName: string;
  categoryRef: string;
  roleDescription?: string;
  targetUser?: string;
  roleMaterials: CategoryCapabilityRoleMaterials;
  requiredCapabilities: string[];
  inputOutput?: string;
  toolSkillRequirements: string[];
  riskBoundaries: string[];
  reason?: string;
}): CategoryCapabilityReview {
  const timestamp = now();
  return {
    id: "",
    requestId: input.requestId,
    rolePackageId: input.rolePackageId?.trim() || "",
    listingDraftId: input.listingDraftId ?? null,
    developerId: input.developerId?.trim() || "local-developer",
    title: input.title,
    categoryRef: input.categoryRef,
    categoryName: input.categoryName,
    roleDescription: input.roleDescription?.trim() || "",
    targetUser: input.targetUser?.trim() || "",
    roleMaterials: input.roleMaterials,
    requiredCapabilities: input.requiredCapabilities,
    inputOutput: input.inputOutput?.trim() || "",
    toolSkillRequirements: input.toolSkillRequirements,
    riskBoundaries: input.riskBoundaries,
    capabilityRefs: [],
    skillPackRef: "",
    toolPackRef: "",
    categoryPackRef: "",
    catalogRefs: [],
    workflowStatus: "waiting_category_review",
    reviewStatus: "待审核",
    reviewFindings: [],
    reviewDecision: input.reason?.trim() || "待岗位开发者提交品类能力申请。",
    reviewedBy: null,
    reviewedAt: null,
    cloudSyncStatus: "未同步",
    cloudSyncError: null,
    cloudSyncedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function eventRowToEvent(row: EventRow): ReviewEvent {
  return {
    id: row.id,
    reviewId: row.review_id,
    action: row.action,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function appendRoleEvent(reviewId: string, action: string, summary: string): void {
  db()
    .prepare(
      "INSERT INTO role_pre_listing_review_events(id,review_id,action,summary,created_at) VALUES(?,?,?,?,?)",
    )
    .run(randomUUID(), reviewId, action, summary, now());
}

function appendToolSkillEvent(reviewId: string, action: string, summary: string): void {
  db()
    .prepare(
      "INSERT INTO tool_skill_review_events(id,review_id,action,summary,created_at) VALUES(?,?,?,?,?)",
    )
    .run(randomUUID(), reviewId, action, summary, now());
}

function appendCategoryCapabilityEvent(reviewId: string, action: string, summary: string): void {
  db()
    .prepare(
      "INSERT INTO category_capability_review_events(id,review_id,action,summary,created_at) VALUES(?,?,?,?,?)",
    )
    .run(randomUUID(), reviewId, action, summary, now());
}

function rowById(id: string): RoleReviewRow | undefined {
  return db().prepare("SELECT * FROM role_pre_listing_reviews WHERE id = ?").get(id) as
    | RoleReviewRow
    | undefined;
}

function toolSkillRowById(id: string): ToolSkillReviewRow | undefined {
  return db().prepare("SELECT * FROM tool_skill_reviews WHERE id = ?").get(id) as
    | ToolSkillReviewRow
    | undefined;
}

function categoryCapabilityRowById(id: string): CategoryCapabilityReviewRow | undefined {
  return db().prepare("SELECT * FROM category_capability_reviews WHERE id = ?").get(id) as
    | CategoryCapabilityReviewRow
    | undefined;
}

function categoryCapabilityRowByRequestId(
  requestId: string,
): CategoryCapabilityReviewRow | undefined {
  return db()
    .prepare("SELECT * FROM category_capability_reviews WHERE request_id = ?")
    .get(requestId) as CategoryCapabilityReviewRow | undefined;
}

function allPackageFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string, prefix = "") => {
    for (const name of readdirSync(dir)) {
      const absolute = path.join(dir, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        visit(absolute, relative);
      } else if (stat.isFile()) {
        files.push(relative);
      }
    }
  };
  if (existsSync(root)) {
    visit(root);
  }
  return files;
}

function readPackageManifest(packageDir: string): Record<string, unknown> {
  for (const candidate of ["manifest.json", "role_package/manifest.json"]) {
    const p = path.join(packageDir, candidate);
    if (!existsSync(p)) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, "utf-8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function capabilitiesFromManifest(manifest: Record<string, unknown>): string[] {
  const value = manifest.requiredCapabilities;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

const ALLOWED_WORK_PATTERNS = new Set(["generate", "analyze", "transform", "operate", "composite"]);
const ALLOWED_OUTPUT_CONTRACTS = new Set([
  "image",
  "html",
  "document",
  "spreadsheet",
  "json",
  "external_record",
  "package",
]);

function stringArrayFromManifest(manifest: Record<string, unknown>, key: string): string[] {
  const value = manifest[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function validateExecutionContract(
  manifest: Record<string, unknown>,
  findings: ReviewFinding[],
): void {
  const workPatterns = stringArrayFromManifest(manifest, "workPatterns");
  const outputContracts = stringArrayFromManifest(manifest, "outputContracts");
  const invalidWorkPatterns = workPatterns.filter((item) => !ALLOWED_WORK_PATTERNS.has(item));
  const invalidOutputContracts = outputContracts.filter(
    (item) => !ALLOWED_OUTPUT_CONTRACTS.has(item),
  );

  if (workPatterns.length === 0) {
    addFinding(
      findings,
      "执行契约",
      "blocking",
      "manifest.json 缺少 workPatterns，执行引擎不知道本岗位按哪种执行方式运行。",
    );
  } else if (invalidWorkPatterns.length) {
    addFinding(
      findings,
      "执行契约",
      "blocking",
      `workPatterns 含无效值：${invalidWorkPatterns.join("、")}；允许值：${[...ALLOWED_WORK_PATTERNS].join("、")}`,
    );
  }

  if (outputContracts.length === 0) {
    addFinding(
      findings,
      "执行契约",
      "blocking",
      "manifest.json 缺少 outputContracts，执行结果无法验收。",
    );
  } else if (invalidOutputContracts.length) {
    addFinding(
      findings,
      "执行契约",
      "blocking",
      `outputContracts 含无效值：${invalidOutputContracts.join("、")}；允许值：${[...ALLOWED_OUTPUT_CONTRACTS].join("、")}`,
    );
  }

  if (
    workPatterns.length &&
    outputContracts.length &&
    !invalidWorkPatterns.length &&
    !invalidOutputContracts.length
  ) {
    addFinding(
      findings,
      "执行契约",
      "pass",
      `已声明执行方式：${workPatterns.join("、")}；输出契约：${outputContracts.join("、")}。`,
    );
  }
}

function rolePackageIdFromManifest(manifest: Record<string, unknown>, fallback: string): string {
  for (const key of ["rolePackageId", "roleId", "id"]) {
    const value = manifest[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function roleTitleFromManifest(manifest: Record<string, unknown>, fallback: string): string {
  for (const key of ["displayName", "name", "title"]) {
    const value = manifest[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
            .map((item) => item.trim()),
        ),
      )
    : [];
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function cloudPathForLocalFile(relative: string): string {
  const normalized = relative.replace(/\\/g, "/").replace(/^\.?\//, "");
  return normalized.startsWith("role_package/") ? normalized : `role_package/${normalized}`;
}

function cloudFile(cloudPath: string, content: string): CloudRolePackageUploadFile {
  return {
    path: cloudPath,
    content,
    sha256: sha256(content),
    sizeBytes: Buffer.byteLength(content),
  };
}

function addCapabilityRefWithAliases(target: Set<string>, value: string | undefined | null): void {
  const ref = value?.trim();
  if (!ref) return;
  target.add(ref);
  target.add(ref.replace(/_/gu, "."));
  target.add(ref.replace(/\./gu, "_"));
}

function fileContentByCloudPath(
  files: CloudRolePackageUploadFile[],
  cloudPath: string,
): string | undefined {
  return files.find((file) => file.path === cloudPath)?.content;
}

function generatedStandardsContent(files: CloudRolePackageUploadFile[]): string {
  const sop = fileContentByCloudPath(files, "role_package/SOP.md");
  if (sop?.trim()) {
    return [
      "# 服务标准",
      "",
      "- 本地岗位包仅提供 SOP.md，云端上架材料按 SOP.md 作为服务标准来源进行审核。",
      "- 未额外生成业务承诺；最终公开说明以 listing.md、README.md 和 SOP.md 为准。",
      "- 不包含本地私有素材、执行历史、密钥、token 或用户数据。",
    ].join("\n");
  }
  return [
    "# 服务标准",
    "",
    "- 以 listing.md、README.md 和 validation.md 中的公开岗位说明、验收材料和失败标准为准。",
    "- 不包含本地私有素材、执行历史、密钥、token 或用户数据。",
  ].join("\n");
}

function generatedCadenceContent(files: CloudRolePackageUploadFile[]): string {
  const sop = fileContentByCloudPath(files, "role_package/SOP.md");
  if (sop?.trim()) {
    return [
      "# 服务节奏",
      "",
      "- 本地岗位包仅提供 SOP.md，云端上架材料按 SOP.md 作为服务节奏来源进行审核。",
      "- 未额外生成执行频率、交付时限或服务边界承诺。",
      "- 实际执行调度、用户素材和工作记忆保留在本地 OpenClaw。",
    ].join("\n");
  }
  return [
    "# 服务节奏",
    "",
    "- 岗位执行节奏以 README.md 和 validation.md 的公开说明为准。",
    "- 实际执行调度、用户素材和工作记忆保留在本地 OpenClaw。",
  ].join("\n");
}

function ensureCloudFile(
  files: CloudRolePackageUploadFile[],
  cloudPath: string,
  content: string,
): void {
  if (files.some((file) => file.path === cloudPath)) return;
  files.push(cloudFile(cloudPath, content));
}

function readLocalPackageFilesForCloud(packageDir: string): CloudRolePackageUploadFile[] {
  const files = allPackageFiles(packageDir)
    .filter((relative) => !relative.split("/").some((segment) => segment === ".."))
    .filter((relative) => {
      const segments = relative.replace(/\\/g, "/").split("/");
      return !segments.some((segment) =>
        /^(?:\.|node_modules$|dist$|build$|private$|secrets?$|tokens?$|prompts?$|workspace$|user[-_]?data$|executions?$|evidence$|artifacts?$)/i.test(
          segment,
        ),
      );
    })
    .filter(
      (relative) =>
        !/(?:^|[/_.-])(?:secret|token|prompt|private|workspace|user[-_]?data|execution|evidence)(?:[/_.-]|$)/i.test(
          relative,
        ),
    )
    .filter((relative) => /\.(json|md|txt|yaml|yml)$/i.test(relative))
    .map((relative) => {
      const content = readFileSync(path.join(packageDir, relative), "utf-8");
      return cloudFile(cloudPathForLocalFile(relative), content);
    });
  return files;
}

function readCloudManifest(files: CloudRolePackageUploadFile[]): Record<string, unknown> {
  const raw = fileContentByCloudPath(files, "role_package/manifest.json");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function buildCloudRolePackageUploadPayload(
  review: RolePreListingReview,
): CloudRolePackageUploadPayload {
  if (!existsSync(review.packageDir)) {
    throw new Error(`岗位包目录不存在：${review.packageDir}`);
  }
  const files = readLocalPackageFilesForCloud(review.packageDir);
  const manifest = readCloudManifest(files);
  ensureCloudFile(
    files,
    "role_package/listing.md",
    `# ${review.rolePackageId}\n\n岗位商品详情待开发者补充。`,
  );
  ensureCloudFile(
    files,
    "role_package/README.md",
    `# ${review.rolePackageId}\n\n本岗位包已通过本地上架检查。`,
  );
  ensureCloudFile(
    files,
    "role_package/validation.md",
    "# 验证材料\n\n- [ ] smoke test 可运行\n- [ ] 输出符合 listing.md 描述\n",
  );
  ensureCloudFile(files, "role_package/standards.md", generatedStandardsContent(files));
  ensureCloudFile(files, "role_package/cadence.md", generatedCadenceContent(files));

  const requiredCapabilities = review.requiredCapabilities.length
    ? review.requiredCapabilities
    : stringArrayValue(manifest.requiredCapabilities ?? manifest.required_capabilities);
  const packageId =
    stringValue(manifest.rolePackageId) ??
    stringValue(manifest.roleId) ??
    stringValue(manifest.id) ??
    review.rolePackageId;
  const packageVersion = stringValue(manifest.version) ?? "1.0.0";
  const name = stringValue(manifest.name) ?? review.rolePackageId;
  const manifestFiles = Array.from(
    new Set(["role_package/manifest.json", ...files.map((file) => file.path)]),
  ).sort();
  const cloudManifest = {
    ...manifest,
    manifestVersion: 1,
    rolePackageId: packageId,
    version: packageVersion,
    name,
    entrypoint: "role_package/README.md",
    permissions: [],
    requiredCapabilities,
    files: manifestFiles,
    ...(stringValue(manifest.categoryRef) || review.category
      ? { categoryRef: stringValue(manifest.categoryRef) ?? review.category }
      : {}),
  };
  const withoutManifest = files.filter((file) => file.path !== "role_package/manifest.json");
  return {
    files: [
      cloudFile("role_package/manifest.json", JSON.stringify(cloudManifest, null, 2)),
      ...withoutManifest.sort((a, b) => a.path.localeCompare(b.path)),
    ],
  };
}

function approvedToolSkillCapabilities(): Set<string> {
  const rows = db()
    .prepare("SELECT * FROM tool_skill_reviews WHERE review_status = '已通过'")
    .all() as ToolSkillReviewRow[];
  const approved = new Set<string>();
  for (const row of rows) {
    addCapabilityRefWithAliases(approved, row.asset_id);
    for (const cap of readJsonArray(row.declared_capabilities)) {
      addCapabilityRefWithAliases(approved, cap);
    }
  }
  return approved;
}

function missingApprovedToolSkillRequirements(requirements: string[]): string[] {
  if (requirements.length === 0) return [];
  const approved = approvedToolSkillCapabilities();
  return requirements.filter((requirement) => !approved.has(requirement));
}

function syncedCategoryCapabilityReviews(): CategoryCapabilityReview[] {
  const rows = db()
    .prepare(
      "SELECT * FROM category_capability_reviews WHERE review_status = '已通过' AND cloud_sync_status = '已同步'",
    )
    .all() as CategoryCapabilityReviewRow[];
  return rows.map(categoryCapabilityRowToReview);
}

function approvedCategoryCapabilities(categoryRef?: string): Set<string> {
  const approved = new Set<string>();
  for (const review of syncedCategoryCapabilityReviews()) {
    if (categoryRef && review.categoryRef !== categoryRef) continue;
    addCapabilityRefWithAliases(approved, review.categoryRef);
    for (const cap of review.capabilityRefs) addCapabilityRefWithAliases(approved, cap);
    for (const cap of review.requiredCapabilities) addCapabilityRefWithAliases(approved, cap);
    for (const ref of review.catalogRefs) addCapabilityRefWithAliases(approved, ref);
  }
  return approved;
}

function categoryCapabilityCoversRequiredCapabilities(
  review: CategoryCapabilityReview,
  requiredCapabilities: string[],
): boolean {
  const approved = new Set<string>();
  addCapabilityRefWithAliases(approved, review.categoryRef);
  for (const cap of review.capabilityRefs) addCapabilityRefWithAliases(approved, cap);
  for (const cap of review.requiredCapabilities) addCapabilityRefWithAliases(approved, cap);
  for (const ref of review.catalogRefs) addCapabilityRefWithAliases(approved, ref);
  return requiredCapabilities.every((capability) => approved.has(capability));
}

function findReusableCategoryCapability(
  categoryRef: string,
  requiredCapabilities: string[],
): CategoryCapabilityReview | null {
  const synced = syncedCategoryCapabilityReviews();
  return (
    synced.find(
      (review) =>
        review.categoryRef === categoryRef &&
        categoryCapabilityCoversRequiredCapabilities(review, requiredCapabilities),
    ) ??
    synced.find((review) =>
      categoryCapabilityCoversRequiredCapabilities(review, requiredCapabilities),
    ) ??
    null
  );
}

function findSubmittedCategoryCapabilityRequest(
  requestId: string,
): CategoryCapabilityReview | null {
  const row = categoryCapabilityRowByRequestId(requestId);
  return row ? categoryCapabilityRowToReview(row) : null;
}

function toolReviewHasRuntimeEvidence(review: ToolSkillReview): boolean {
  if (review.assetType !== "tool") return true;
  const direct = ToolRegistry.get(review.assetId);
  if (direct?.enabled) return true;
  return (
    review.declaredCapabilities.length > 0 &&
    review.declaredCapabilities.every(
      (capability) => ToolRegistry.findByCapability(capability as ToolCapabilityGroup).length > 0,
    )
  );
}

function toolReviewRuntimeEvidenceMessage(review: ToolSkillReview): string {
  if (review.assetType !== "tool") return "";
  const direct = ToolRegistry.get(review.assetId);
  if (direct && !direct.enabled) {
    return `工具 ${review.assetId} 已注册但未启用。`;
  }
  return `未找到可用工具实现：${review.assetId}。请先在工具与 Skill 模块完成工具创建、安装和启用。`;
}

function evidenceKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(?:skill|provider)[._:-]+/u, "")
    .replace(/^platform[._:-]+/u, "")
    .replace(/[^a-z0-9]+/gu, "");
}

function evidenceKeysMatch(left: string, right: string): boolean {
  const a = evidenceKey(left);
  const b = evidenceKey(right);
  return Boolean(a && b && (a === b || a.endsWith(b) || b.endsWith(a)));
}

function skillHasMissingRequirements(skill: SkillStatusEntry): boolean {
  return (
    skill.missing.bins.length > 0 ||
    skill.missing.anyBins.length > 0 ||
    skill.missing.env.length > 0 ||
    skill.missing.config.length > 0 ||
    skill.missing.os.length > 0 ||
    skill.configChecks.some((check) => !check.satisfied)
  );
}

function skillReviewRuntimeEvidenceMessage(
  review: ToolSkillReview,
  evidence: ToolSkillValidationEvidence,
): string {
  const matches =
    evidence.skillsReport?.skills.filter(
      (skill) =>
        evidenceKeysMatch(review.assetId, skill.skillKey) ||
        evidenceKeysMatch(review.assetId, skill.name),
    ) ?? [];
  if (!evidence.skillsReport) {
    return `未读取到 Skill 状态报告：${review.assetId}。请先在工具与 Skill 模块完成 Skill 安装和状态检查。`;
  }
  if (!matches.length) {
    return `未找到可用 Skill 实现：${review.assetId}。请先在工具与 Skill 模块完成 Skill 创建、安装和启用。`;
  }
  const blocked = matches.find(
    (skill) =>
      skill.disabled ||
      skill.blockedByAllowlist ||
      skill.blockedByAgentFilter ||
      !skill.eligible ||
      skillHasMissingRequirements(skill),
  );
  if (blocked) {
    return `Skill ${blocked.skillKey || blocked.name} 依赖或启用状态未满足。`;
  }
  return "";
}

function skillReviewHasRuntimeEvidence(
  review: ToolSkillReview,
  evidence: ToolSkillValidationEvidence,
): boolean {
  const matches =
    evidence.skillsReport?.skills.filter(
      (skill) =>
        evidenceKeysMatch(review.assetId, skill.skillKey) ||
        evidenceKeysMatch(review.assetId, skill.name),
    ) ?? [];
  return matches.some(
    (skill) =>
      !skill.disabled &&
      !skill.blockedByAllowlist &&
      !skill.blockedByAgentFilter &&
      skill.eligible &&
      !skillHasMissingRequirements(skill),
  );
}

function isProviderApiReview(review: ToolSkillReview): boolean {
  return review.source === "provider-api" || review.assetId.startsWith("provider.");
}

function providerReviewHasRuntimeEvidence(evidence: ToolSkillValidationEvidence): boolean {
  return Boolean(
    evidence.apiConnections?.entries.some((entry) => {
      const consumers = entry.consumers ?? [];
      return (
        entry.kind === "model" &&
        entry.status === "available" &&
        entry.enabled !== false &&
        (consumers.includes("model") ||
          consumers.includes("role_execution") ||
          consumers.includes("ai_review") ||
          consumers.includes("build_session"))
      );
    }),
  );
}

function providerReviewRuntimeEvidenceMessage(
  review: ToolSkillReview,
  evidence: ToolSkillValidationEvidence,
): string {
  if (!evidence.apiConnections) {
    return `未读取到 API 管理连接状态：${review.assetId}。请先在 API 管理配置可用 Provider/API。`;
  }
  return `未找到可用 Provider/API 绑定：${review.assetId}。请先在 API 管理配置可用模型 Provider，并绑定到岗位执行或审核场景。`;
}

export function countDeveloperRoleDrafts(developerId = "local-developer"): number {
  const row = db()
    .prepare(
      "SELECT COUNT(*) AS count FROM role_pre_listing_reviews WHERE developer_id = ? AND review_status != '已拒绝'",
    )
    .get(developerId) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

export function assertDeveloperRoleDraftLimit(
  input: {
    developerId?: string;
    rolePackageId?: string;
    listingDraftId?: string | null;
  } = {},
): void {
  const developerId = input.developerId?.trim() || "local-developer";
  const rolePackageId = input.rolePackageId?.trim();
  if (rolePackageId) {
    const existing = db()
      .prepare(
        "SELECT id FROM role_pre_listing_reviews WHERE developer_id = ? AND role_package_id = ? AND IFNULL(listing_draft_id, '') = ?",
      )
      .get(developerId, rolePackageId, input.listingDraftId ?? "") as { id: string } | undefined;
    if (existing) return;
  }
  const current = countDeveloperRoleDrafts(developerId);
  if (current >= MAX_DEVELOPER_ROLE_DRAFTS) {
    throw new Error(
      `开发者中心暂定最多开发 ${MAX_DEVELOPER_ROLE_DRAFTS} 个岗位。请先处理已有岗位后再创建新岗位。`,
    );
  }
}

function addFinding(
  findings: ReviewFinding[],
  section: ReviewFinding["section"],
  severity: ReviewFindingSeverity,
  message: string,
): void {
  findings.push({ id: randomUUID(), section, severity, message });
}

function scanRisk(
  packageDir: string,
  files: string[],
  findings: ReviewFinding[],
): ReviewFindingSeverity {
  let max: ReviewFindingSeverity = "pass";
  for (const relative of files) {
    if (!/\.(json|md|txt|ts|js|yaml|yml)$/i.test(relative)) continue;
    const absolute = path.join(packageDir, relative);
    let content = "";
    try {
      content = readFileSync(absolute, "utf-8");
    } catch {
      continue;
    }
    for (const item of SECRET_PATTERNS) {
      if (item.pattern.test(content)) {
        addFinding(findings, "风险", "blocking", `${relative} 包含 ${item.label}`);
        max = "blocking";
      }
    }
  }
  if (max === "pass") {
    addFinding(
      findings,
      "风险",
      "pass",
      "未发现 secret、token、API Key、用户私有数据或本地绝对路径。",
    );
  }
  return max;
}

function validationSummary(findings: ReviewFinding[]): {
  validationStatus: string;
  riskLevel: string;
  nextStatus: RolePreListingReviewStatus;
} {
  const hasBlocking = findings.some((finding) => finding.severity === "blocking");
  const hasWarning = findings.some((finding) => finding.severity === "warning");
  const hasRiskBlock = findings.some(
    (finding) => finding.section === "风险" && finding.severity === "blocking",
  );
  return {
    validationStatus: hasBlocking ? "未通过" : hasWarning ? "有警告" : "已通过",
    riskLevel: hasRiskBlock ? "高" : hasWarning ? "中" : "低",
    nextStatus: hasBlocking ? "待开发者修改" : "检查中",
  };
}

export function startRolePreListingReview(input: StartRoleReviewInput): RolePreListingReview {
  if (!input.packageDir?.trim()) {
    throw new Error("packageDir is required");
  }
  const packageDir = input.packageDir.trim();
  const manifest = existsSync(packageDir) ? readPackageManifest(packageDir) : {};
  const rolePackageId =
    input.rolePackageId?.trim() ||
    rolePackageIdFromManifest(manifest, `local-role-package:${path.basename(packageDir)}`);
  const requiredCapabilities = input.requiredCapabilities?.length
    ? input.requiredCapabilities
    : capabilitiesFromManifest(manifest);
  const developerId = input.developerId?.trim() || "local-developer";
  assertDeveloperRoleDraftLimit({
    developerId,
    rolePackageId,
    listingDraftId: input.listingDraftId ?? null,
  });
  const timestamp = now();
  const existing = db()
    .prepare(
      "SELECT * FROM role_pre_listing_reviews WHERE role_package_id = ? AND IFNULL(listing_draft_id, '') = ?",
    )
    .get(rolePackageId, input.listingDraftId ?? "") as RoleReviewRow | undefined;
  if (existing) {
    db()
      .prepare(
        "UPDATE role_pre_listing_reviews SET developer_id=?, category=?, package_dir=?, required_capabilities=?, bound_common_capabilities=?, updated_at=? WHERE id=?",
      )
      .run(
        developerId || existing.developer_id,
        input.category?.trim() || existing.category,
        packageDir,
        stringifyArray(requiredCapabilities),
        stringifyArray(
          input.boundCommonCapabilities ?? readJsonArray(existing.bound_common_capabilities),
        ),
        timestamp,
        existing.id,
      );
    appendRoleEvent(existing.id, "review.start", "岗位包生成完成，已刷新本地审核单。");
    return getRolePreListingReview(existing.id)!;
  }
  const id = randomUUID();
  db()
    .prepare(
      "INSERT INTO role_pre_listing_reviews(id,role_package_id,listing_draft_id,developer_id,category,package_dir,required_capabilities,bound_common_capabilities,validation_status,risk_level,review_status,review_findings,review_decision,approved_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      rolePackageId,
      input.listingDraftId ?? null,
      developerId,
      input.category?.trim() || "",
      packageDir,
      stringifyArray(requiredCapabilities),
      stringifyArray(input.boundCommonCapabilities ?? []),
      "未检查",
      "未评估",
      "待审核",
      "[]",
      null,
      null,
      timestamp,
      timestamp,
    );
  appendRoleEvent(id, "review.start", "岗位包生成完成，进入本地上架检查。");
  return getRolePreListingReview(id)!;
}

export function listRolePreListingReviews(): RolePreListingReview[] {
  let rows: RoleReviewRow[];
  try {
    rows = db({ ensureSchema: false })
      .prepare("SELECT * FROM role_pre_listing_reviews ORDER BY updated_at DESC")
      .all() as RoleReviewRow[];
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return rows.map(roleRowToReview);
}

function clampReviewPage(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 1;
  return Math.max(1, Math.trunc(value ?? 1));
}

function clampReviewPageSize(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 20;
  const size = Math.trunc(value ?? 20);
  if (size <= 0) return 20;
  return Math.min(100, size);
}

function normalizeSearch(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function includesSearch(parts: Array<string | null | undefined>, search: string): boolean {
  if (!search) return true;
  return parts.some((part) => part?.toLowerCase().includes(search));
}

function riskWeight(value: string): number {
  if (value.includes("高")) return 3;
  if (value.includes("中")) return 2;
  if (value.includes("低")) return 1;
  return 0;
}

function paginateReviews<T>(items: T[], options: ReviewListOptions): ReviewListResult<T> {
  const page = clampReviewPage(options.page);
  const pageSize = clampReviewPageSize(options.pageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    reviews: items.slice(start, start + pageSize),
    pageInfo: {
      page: safePage,
      pageSize,
      total,
      totalPages,
      hasPreviousPage: safePage > 1,
      hasNextPage: safePage < totalPages,
    },
  };
}

function roleReviewReadyForManualApproval(review: RolePreListingReview): boolean {
  return (
    review.reviewStatus !== "已通过" &&
    review.validationStatus === "已通过" &&
    review.category.trim().length > 0 &&
    !review.reviewFindings.some((finding) => finding.severity === "blocking")
  );
}

function roleReviewMatchesFilter(
  review: RolePreListingReview,
  filter: RoleReviewListFilter,
): boolean {
  switch (filter) {
    case "pending_review":
      return review.reviewStatus === "待审核" || review.reviewStatus === "检查中";
    case "missing_category":
      return !review.category.trim();
    case "category_pending":
      return (
        review.reviewStatus !== "已通过" &&
        review.reviewFindings.some((finding) => finding.message.includes("品类"))
      );
    case "ready_for_manual_approval":
      return roleReviewReadyForManualApproval(review);
    case "needs_changes":
      return review.reviewStatus === "待开发者修改";
    case "high_risk":
      return review.riskLevel.includes("高");
    case "all":
    default:
      return true;
  }
}

function sortRoleReviews(
  reviews: RolePreListingReview[],
  sort: ReviewListSort = "updated_desc",
): RolePreListingReview[] {
  const sorted = [...reviews];
  sorted.sort((a, b) => {
    if (sort === "updated_asc") return a.updatedAt - b.updatedAt;
    if (sort === "risk_desc")
      return riskWeight(b.riskLevel) - riskWeight(a.riskLevel) || b.updatedAt - a.updatedAt;
    if (sort === "status_asc")
      return a.reviewStatus.localeCompare(b.reviewStatus) || b.updatedAt - a.updatedAt;
    return b.updatedAt - a.updatedAt;
  });
  return sorted;
}

export function listRolePreListingReviewPage(
  options: ReviewListOptions<RoleReviewListFilter> = {},
): ReviewListResult<RolePreListingReview> {
  const search = normalizeSearch(options.search);
  const filter = options.filter ?? "all";
  const rows = db().prepare("SELECT * FROM role_pre_listing_reviews").all() as RoleReviewRow[];
  const reviews = sortRoleReviews(
    rows
      .map(roleRowToReview)
      .filter((review) => roleReviewMatchesFilter(review, filter))
      .filter((review) =>
        includesSearch(
          [
            review.rolePackageId,
            review.listingDraftId,
            review.developerId,
            review.category,
            review.cloudRoleListingId,
          ],
          search,
        ),
      ),
    options.sort,
  );
  return paginateReviews(reviews, options);
}

export function getRolePreListingReview(id: string): RolePreListingReview | null {
  const row = rowById(id);
  return row ? roleRowToReview(row) : null;
}

export function getRolePreListingReviewEvents(reviewId: string): ReviewEvent[] {
  const rows = db()
    .prepare(
      "SELECT * FROM role_pre_listing_review_events WHERE review_id = ? ORDER BY created_at DESC",
    )
    .all(reviewId) as EventRow[];
  return rows.map(eventRowToEvent);
}

export function createCategoryCapabilityRequest(
  input: CreateCategoryCapabilityRequestInput,
): CategoryCapabilityReview {
  if (!input.title?.trim()) {
    throw new Error("title is required");
  }
  const title = input.title.trim();
  const categoryName = input.categoryName?.trim() || input.categoryRef?.trim() || title;
  const categoryRef = input.categoryRef?.trim() || categoryRefForName(categoryName);
  const requestId =
    input.requestId?.trim() ||
    `category-capability:${createHash("sha1").update(`${title}:${categoryRef}`).digest("hex").slice(0, 12)}`;
  const timestamp = now();
  const existing = db()
    .prepare("SELECT * FROM category_capability_reviews WHERE request_id = ?")
    .get(requestId) as CategoryCapabilityReviewRow | undefined;
  const requiredCapabilities = input.requiredCapabilities?.length
    ? input.requiredCapabilities
    : [input.categoryRef, input.categoryName, input.title].filter((item): item is string =>
        Boolean(item?.trim()),
      );
  const toolSkillRequirements = input.toolSkillRequirements?.length
    ? input.toolSkillRequirements
    : requiredCapabilities;
  const riskBoundaries = input.riskBoundaries?.length
    ? input.riskBoundaries
    : ["需人工确认执行边界。", "不得绕过正式授权、审计和账本记录。"];
  const roleMaterials = {
    roleTitle: title,
    roleDescription: input.roleDescription,
    targetUser: input.targetUser,
    targetCategory: categoryName,
    requiredCapabilities,
    inputOutput: input.inputOutput,
    riskBoundaries,
    ...(input.roleMaterials ?? {}),
  } satisfies CategoryCapabilityRoleMaterials;
  if (existing) {
    db()
      .prepare(
        "UPDATE category_capability_reviews SET role_package_id=?, listing_draft_id=?, developer_id=?, title=?, category_ref=?, category_name=?, role_description=?, target_user=?, role_materials=?, required_capabilities=?, input_output=?, tool_skill_requirements=?, risk_boundaries=?, review_status=?, workflow_status=?, review_decision=?, updated_at=? WHERE id=?",
      )
      .run(
        input.rolePackageId?.trim() || existing.role_package_id,
        input.listingDraftId ?? existing.listing_draft_id,
        input.developerId?.trim() || existing.developer_id,
        title,
        categoryRef,
        categoryName,
        input.roleDescription?.trim() || existing.role_description,
        input.targetUser?.trim() || existing.target_user,
        stringifyRoleMaterials({
          ...readRoleMaterials(existing.role_materials ?? "{}"),
          ...roleMaterials,
        }),
        stringifyArray(requiredCapabilities),
        input.inputOutput?.trim() || existing.input_output,
        stringifyArray(toolSkillRequirements),
        stringifyArray(riskBoundaries),
        "待审核",
        "waiting_category_review",
        input.reason?.trim() || existing.review_decision,
        timestamp,
        existing.id,
      );
    appendCategoryCapabilityEvent(
      existing.id,
      "categoryCapabilityRequest.refresh",
      "品类能力申请已刷新，等待本地审核中心审核。",
    );
    return getCategoryCapabilityReview(existing.id)!;
  }

  const id = randomUUID();
  db()
    .prepare(
      "INSERT INTO category_capability_reviews(id,request_id,role_package_id,listing_draft_id,developer_id,title,category_ref,category_name,role_description,target_user,role_materials,required_capabilities,input_output,tool_skill_requirements,risk_boundaries,capability_refs,skill_pack_ref,tool_pack_ref,category_pack_ref,catalog_refs,workflow_status,review_status,review_findings,review_decision,reviewed_by,reviewed_at,cloud_sync_status,cloud_sync_error,cloud_synced_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      requestId,
      input.rolePackageId?.trim() || "",
      input.listingDraftId ?? null,
      input.developerId?.trim() || "local-developer",
      title,
      categoryRef,
      categoryName,
      input.roleDescription?.trim() || input.reason?.trim() || "",
      input.targetUser?.trim() || "",
      stringifyRoleMaterials(roleMaterials),
      stringifyArray(requiredCapabilities),
      input.inputOutput?.trim() || "",
      stringifyArray(toolSkillRequirements),
      stringifyArray(riskBoundaries),
      "[]",
      "",
      "",
      "",
      "[]",
      "waiting_category_review",
      "待审核",
      "[]",
      input.reason?.trim() || null,
      null,
      null,
      "未同步",
      null,
      null,
      timestamp,
      timestamp,
    );
  appendCategoryCapabilityEvent(
    id,
    "categoryCapabilityRequest.create",
    "岗位缺少正式品类能力，已进入本地审核中心。审核通过后会生成工具与 Skill 待办。",
  );
  return getCategoryCapabilityReview(id)!;
}

export function createRoleCapabilityAnalysis(
  input: CreateRoleCapabilityAnalysisInput,
): RoleCapabilityAnalysis {
  if (!input.roleTitle?.trim()) {
    throw new Error("roleTitle is required");
  }
  const plan = inferRoleCapabilityPlan(input);
  const resolved = resolveCapabilities(plan.requiredCapabilities);
  const approved = approvedCategoryCapabilities();
  const resolvedExistingCapabilities: string[] = resolved.results.flatMap((result) => {
    if (result.status === "ready") return [result.tool.capabilities[0]];
    if (result.status === "candidate") return result.tools.flatMap((tool) => tool.capabilities);
    return [];
  });
  const existingCapabilities = uniqueStrings([
    ...resolvedExistingCapabilities,
    ...plan.requiredCapabilities.filter((capability) => approved.has(capability)),
  ]);
  const missingCapabilities = plan.requiredCapabilities.filter(
    (capability) => !existingCapabilities.includes(capability),
  );
  const toolSkillRequirements = uniqueStrings([
    ...plan.neededTools,
    ...plan.neededSkills,
    ...plan.neededProviders,
  ]);
  const riskBoundaries = input.riskBoundaries?.length
    ? input.riskBoundaries
    : [
        "执行前必须确认授权、费用、execution-token、审计和账本记录。",
        "不得自动发布、扣费、删除数据或绕过人工确认。",
      ];
  const requestId = `role-capability:${createHash("sha1")
    .update(`${input.developerId ?? "local-developer"}:${input.roleTitle}:${plan.categoryRef}`)
    .digest("hex")
    .slice(0, 12)}`;
  const reusableCategoryCapability = findReusableCategoryCapability(
    plan.categoryRef,
    plan.requiredCapabilities,
  );
  const submittedCategoryCapabilityRequest = reusableCategoryCapability
    ? null
    : findSubmittedCategoryCapabilityRequest(requestId);
  const neededTools = reusableCategoryCapability ? [] : plan.neededTools;
  const neededSkills = reusableCategoryCapability ? [] : plan.neededSkills;
  const neededProviders = reusableCategoryCapability ? [] : plan.neededProviders;
  const roleMaterials: CategoryCapabilityRoleMaterials = {
    roleTitle: input.roleTitle,
    roleDescription: input.roleDescription,
    targetUser: input.targetUser,
    targetCategory: plan.categoryName,
    requiredCapabilities: plan.requiredCapabilities,
    sopFlow: input.sopFlow,
    dailyPlan: input.dailyPlan,
    weeklyPlan: input.weeklyPlan,
    monthlyPlan: input.monthlyPlan,
    inputOutput: input.inputOutput,
    riskBoundaries,
  };
  const categoryCapabilityReview =
    reusableCategoryCapability ??
    submittedCategoryCapabilityRequest ??
    draftCategoryCapabilityReview({
      requestId,
      rolePackageId: input.rolePackageId,
      listingDraftId: input.listingDraftId,
      developerId: input.developerId,
      title: input.roleTitle,
      categoryName: plan.categoryName,
      categoryRef: plan.categoryRef,
      roleDescription: input.roleDescription,
      targetUser: input.targetUser,
      roleMaterials,
      requiredCapabilities: plan.requiredCapabilities,
      inputOutput: input.inputOutput,
      toolSkillRequirements,
      riskBoundaries,
      reason: [
        `系统根据岗位资料分析：已有能力 ${existingCapabilities.join("、") || "无"}。`,
        `缺失能力 ${missingCapabilities.join("、") || "无"}。`,
        `需要 Tool ${plan.neededTools.join("、") || "无"}；Skill ${plan.neededSkills.join("、") || "无"}；Provider/API ${plan.neededProviders.join("、") || "无"}。`,
      ].join(" "),
    });

  const toolSkillReviews: ToolSkillReview[] = [];

  return {
    roleTitle: input.roleTitle.trim(),
    categoryName: plan.categoryName,
    categoryRef: plan.categoryRef,
    requiredCapabilities: plan.requiredCapabilities,
    neededTools,
    neededSkills,
    neededProviders,
    existingCapabilities,
    missingCapabilities,
    humanConfirmationCapabilities: plan.humanConfirmationCapabilities,
    nonAutomaticCapabilities: plan.nonAutomaticCapabilities,
    categoryCapabilityReview: categoryCapabilityReview.id
      ? getCategoryCapabilityReview(categoryCapabilityReview.id)!
      : categoryCapabilityReview,
    toolSkillReviews,
  };
}

export function listCategoryCapabilityReviews(): CategoryCapabilityReview[] {
  let rows: CategoryCapabilityReviewRow[];
  try {
    rows = db({ ensureSchema: false })
      .prepare("SELECT * FROM category_capability_reviews ORDER BY updated_at DESC")
      .all() as CategoryCapabilityReviewRow[];
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return rows.map(categoryCapabilityRowToReview);
}

export function listCategoryCapabilityReviewPage(
  options: ReviewListOptions<CategoryCapabilityListFilter> = {},
): ReviewListResult<CategoryCapabilityReview> {
  const search = normalizeSearch(options.search);
  const filter = options.filter ?? "all";
  const where: string[] = [];
  const params: string[] = [];
  if (filter === "pending_review") {
    where.push("review_status IN ('待审核', '检查中')");
  } else if (filter === "approved") {
    where.push("review_status = '已通过' AND cloud_sync_status != '已同步'");
  } else if (filter === "activated") {
    where.push("review_status = '已通过' AND cloud_sync_status = '已同步'");
  } else if (filter === "sync_failed") {
    where.push("cloud_sync_status = '同步失败'");
  } else if (filter === "needs_changes") {
    where.push("review_status = '待开发者修改'");
  }
  if (search) {
    const like = `%${search}%`;
    where.push(`(
      lower(title) LIKE ? OR
      lower(category_name) LIKE ? OR
      lower(category_ref) LIKE ? OR
      lower(role_package_id) LIKE ? OR
      lower(IFNULL(listing_draft_id, '')) LIKE ? OR
      lower(developer_id) LIKE ?
    )`);
    params.push(like, like, like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql =
    options.sort === "updated_asc"
      ? "updated_at ASC"
      : options.sort === "status_asc"
        ? "review_status ASC, updated_at DESC"
        : options.sort === "activation_status_asc"
          ? `CASE cloud_sync_status
              WHEN '同步失败' THEN 0
              WHEN '未同步' THEN 1
              WHEN '同步中' THEN 2
              WHEN '已同步' THEN 3
              ELSE 4
            END ASC, updated_at DESC`
          : "updated_at DESC";
  const pageSize = clampReviewPageSize(options.pageSize);
  const requestedPage = clampReviewPage(options.page);
  const totalRow = db()
    .prepare(`SELECT COUNT(*) AS total FROM category_capability_reviews ${whereSql}`)
    .get(...params) as { total: number } | undefined;
  const total = Number(totalRow?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rows = db()
    .prepare(
      `SELECT * FROM category_capability_reviews ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as CategoryCapabilityReviewRow[];
  return {
    reviews: rows.map(categoryCapabilityRowToReview),
    pageInfo: {
      page,
      pageSize,
      total,
      totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages,
    },
  };
}

export function getCategoryCapabilityReview(id: string): CategoryCapabilityReview | null {
  const row = categoryCapabilityRowById(id);
  return row ? categoryCapabilityRowToReview(row) : null;
}

export function getCategoryCapabilityReviewEvents(reviewId: string): ReviewEvent[] {
  const rows = db()
    .prepare(
      "SELECT * FROM category_capability_review_events WHERE review_id = ? ORDER BY created_at DESC",
    )
    .all(reviewId) as EventRow[];
  return rows.map(eventRowToEvent);
}

export function approveCategoryCapabilityReview(
  reviewId: string,
  decision?: string,
): CategoryCapabilityReview {
  const review = getCategoryCapabilityReview(reviewId);
  if (!review) throw new Error(`CategoryCapabilityReview not found: ${reviewId}`);
  const capabilityRefs = review.requiredCapabilities.length
    ? review.requiredCapabilities
    : [review.categoryRef];
  const catalogRefs = review.toolSkillRequirements.length
    ? review.toolSkillRequirements
    : capabilityRefs;
  const timestamp = now();
  const todos = createToolSkillDevelopmentTasksForCategoryCapability({
    categoryCapabilityReviewId: review.id,
    targetCategoryRef: review.categoryRef,
    targetCategoryName: review.categoryName,
    toolSkillRequirements: review.toolSkillRequirements,
    requiredCapabilities: capabilityRefs,
    riskBoundaries: review.riskBoundaries,
  });
  db()
    .prepare(
      "UPDATE category_capability_reviews SET capability_refs=?, catalog_refs=?, category_pack_ref=?, skill_pack_ref=?, tool_pack_ref=?, workflow_status=?, review_status=?, review_findings=?, review_decision=?, reviewed_by=?, reviewed_at=?, cloud_sync_status=?, cloud_sync_error=NULL, updated_at=? WHERE id=?",
    )
    .run(
      stringifyArray(capabilityRefs),
      stringifyArray(catalogRefs),
      review.categoryPackRef || packRef("categorypack", review.categoryRef),
      review.skillPackRef || packRef("skillpack", review.categoryRef),
      review.toolPackRef || packRef("toolpack", review.categoryRef),
      "category_review_approved",
      "已通过",
      JSON.stringify([
        {
          id: randomUUID(),
          section: "能力绑定",
          severity: "pass",
          message: `已制作正式品类能力包：${review.categoryRef}`,
        } satisfies ReviewFinding,
      ]),
      decision || "本地审核中心已批准制作正式品类能力包，等待激活品类。",
      "local-reviewer",
      timestamp,
      "未同步",
      timestamp,
      reviewId,
    );
  appendCategoryCapabilityEvent(
    reviewId,
    "categoryCapabilityReview.approve",
    decision ||
      `本地审核通过，已生成 ${todos.length} 个工具与 Skill 系统开发待办；待办完成后可激活正式品类能力包。`,
  );
  return getCategoryCapabilityReview(reviewId)!;
}

export function rejectCategoryCapabilityReview(
  reviewId: string,
  decision?: string,
): CategoryCapabilityReview {
  if (!categoryCapabilityRowById(reviewId))
    throw new Error(`CategoryCapabilityReview not found: ${reviewId}`);
  const message = decision || "品类能力申请被驳回，岗位保持等待品类审核状态。";
  db()
    .prepare(
      "UPDATE category_capability_reviews SET workflow_status=?, review_status=?, review_decision=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?",
    )
    .run("waiting_category_review", "已拒绝", message, "local-reviewer", now(), now(), reviewId);
  appendCategoryCapabilityEvent(reviewId, "categoryCapabilityReview.reject", message);
  return getCategoryCapabilityReview(reviewId)!;
}

export function requestCategoryCapabilityChanges(
  reviewId: string,
  decision?: string,
): CategoryCapabilityReview {
  if (!categoryCapabilityRowById(reviewId))
    throw new Error(`CategoryCapabilityReview not found: ${reviewId}`);
  const message =
    decision ||
    "品类能力申请资料不完整，请岗位开发者补充岗位说明、SOP、输入输出或风险边界后重新提交。";
  db()
    .prepare(
      "UPDATE category_capability_reviews SET workflow_status=?, review_status=?, review_decision=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?",
    )
    .run(
      "waiting_category_review",
      "待开发者修改",
      message,
      "local-reviewer",
      now(),
      now(),
      reviewId,
    );
  appendCategoryCapabilityEvent(reviewId, "categoryCapabilityReview.requestChanges", message);
  return getCategoryCapabilityReview(reviewId)!;
}

function setCategoryCapabilityCloudSyncState(
  reviewId: string,
  patch: {
    workflowStatus?: CategoryCapabilityWorkflowStatus;
    cloudSyncStatus: CloudSyncStatus;
    cloudSyncError?: string | null;
    cloudSyncedAt?: number | null;
    reviewDecision?: string | null;
  },
): CategoryCapabilityReview {
  const existing = getCategoryCapabilityReview(reviewId);
  if (!existing) throw new Error(`CategoryCapabilityReview not found: ${reviewId}`);
  db()
    .prepare(
      "UPDATE category_capability_reviews SET workflow_status=?, cloud_sync_status=?, cloud_sync_error=?, cloud_synced_at=?, review_decision=?, updated_at=? WHERE id=?",
    )
    .run(
      patch.workflowStatus ?? existing.workflowStatus,
      patch.cloudSyncStatus,
      patch.cloudSyncError === undefined ? existing.cloudSyncError : patch.cloudSyncError,
      patch.cloudSyncedAt === undefined ? existing.cloudSyncedAt : patch.cloudSyncedAt,
      patch.reviewDecision === undefined ? existing.reviewDecision : patch.reviewDecision,
      now(),
      reviewId,
    );
  return getCategoryCapabilityReview(reviewId)!;
}

export function runRolePreListingValidation(reviewId: string): RolePreListingReview {
  const current = getRolePreListingReview(reviewId);
  if (!current) throw new Error(`RolePreListingReview not found: ${reviewId}`);
  const findings: ReviewFinding[] = [];
  const packageDir = current.packageDir;
  db()
    .prepare("UPDATE role_pre_listing_reviews SET review_status=?, updated_at=? WHERE id=?")
    .run("检查中", now(), reviewId);

  if (!existsSync(packageDir)) {
    addFinding(findings, "结构", "blocking", `岗位包目录不存在：${packageDir}`);
  } else {
    const files = allPackageFiles(packageDir);
    for (const required of ["manifest.json", "listing.md", "README.md"]) {
      if (files.includes(required) || files.includes(`role_package/${required}`)) {
        addFinding(findings, "结构", "pass", `${required} 已存在。`);
      } else {
        addFinding(findings, "结构", "blocking", `缺少 ${required}`);
      }
    }
    if (files.some((file) => /(validation|validate|smoke|tests?|spec)(\/|[-_.]|\.)/i.test(file))) {
      addFinding(findings, "跑通性", "pass", "已提供 smoke test / 验证材料。");
    } else {
      addFinding(findings, "跑通性", "blocking", "缺少 smoke test / 验证材料");
    }

    scanRisk(packageDir, files, findings);
  }

  const manifest = existsSync(packageDir) ? readPackageManifest(packageDir) : {};
  validateExecutionContract(manifest, findings);
  const manifestCapabilities = capabilitiesFromManifest(manifest);
  const requiredCapabilities = current.requiredCapabilities.length
    ? current.requiredCapabilities
    : manifestCapabilities;
  if (requiredCapabilities.length === 0) {
    addFinding(findings, "能力绑定", "blocking", "manifest.json 缺少 requiredCapabilities");
  } else {
    if (!current.category) {
      addFinding(findings, "能力绑定", "blocking", "岗位尚未绑定正式品类。");
    }
    const approvedCategory = current.category
      ? approvedCategoryCapabilities(current.category)
      : new Set<string>();
    const report = resolveCapabilities(requiredCapabilities);
    const missing = report.results
      .filter((item) => item.status === "missing" || item.status === "blocked")
      .map((item) => item.capability)
      .filter((capability) => !approvedCategory.has(capability));
    if (missing.length) {
      addFinding(findings, "能力绑定", "blocking", `能力目录缺少：${missing.join("、")}`);
    } else {
      addFinding(findings, "能力绑定", "pass", "requiredCapabilities 均能匹配本地能力目录。");
    }
    const approved = approvedToolSkillCapabilities();
    for (const capability of approvedCategory) approved.add(capability);
    if (current.category && approvedCategory.size === 0) {
      addFinding(
        findings,
        "能力绑定",
        "blocking",
        `品类 ${current.category} 尚未通过本地审核并激活，需先提交品类能力申请。`,
      );
    }
    const unreviewed = requiredCapabilities.filter((capability) => !approved.has(capability));
    if (unreviewed.length) {
      addFinding(
        findings,
        "能力绑定",
        "blocking",
        `绑定能力引用了未审核通过的工具/Skill：${unreviewed.join("、")}`,
      );
    } else {
      addFinding(
        findings,
        "能力绑定",
        "pass",
        "绑定的品类通用能力均来自已通过审核的工具/Skill 或已同步品类能力包。",
      );
    }
  }

  const blocking = findings.filter((finding) => finding.severity === "blocking").length;
  if (blocking > 0) {
    addFinding(findings, "合格性", "blocking", `综合检查未通过，共 ${blocking} 个阻塞项。`);
  } else {
    addFinding(findings, "合格性", "pass", "综合检查通过，可提交人工最终审核。");
  }

  const summary = validationSummary(findings);
  db()
    .prepare(
      "UPDATE role_pre_listing_reviews SET required_capabilities=?, bound_common_capabilities=?, validation_status=?, risk_level=?, review_status=?, review_findings=?, review_decision=?, approved_at=NULL, updated_at=? WHERE id=?",
    )
    .run(
      stringifyArray(requiredCapabilities),
      stringifyArray(
        requiredCapabilities.filter((capability) => {
          const approved = approvedToolSkillCapabilities();
          const approvedCategory = approvedCategoryCapabilities(current.category || undefined);
          return approved.has(capability) || approvedCategory.has(capability);
        }),
      ),
      summary.validationStatus,
      summary.riskLevel,
      summary.nextStatus,
      JSON.stringify(findings),
      summary.validationStatus === "未通过" ? "综合检查未通过，需要开发者修改。" : null,
      now(),
      reviewId,
    );
  appendRoleEvent(
    reviewId,
    "review.runValidation",
    `一键综合检查完成：${summary.validationStatus}`,
  );
  return getRolePreListingReview(reviewId)!;
}

export function requestRolePreListingChanges(
  reviewId: string,
  decision?: string,
): RolePreListingReview {
  return setRoleReviewStatus(
    reviewId,
    "待开发者修改",
    decision || "需要开发者修改后重新提交本地审核。",
  );
}

export function rejectRolePreListingReview(
  reviewId: string,
  decision?: string,
): RolePreListingReview {
  return setRoleReviewStatus(reviewId, "已拒绝", decision || "审核拒绝，禁止岗位开发者确认上架。");
}

export function approveRolePreListingReview(
  reviewId: string,
  decision?: string,
): RolePreListingReview {
  const review = getRolePreListingReview(reviewId);
  if (!review) throw new Error(`RolePreListingReview not found: ${reviewId}`);
  const hasBlocking = review.reviewFindings.some((finding) => finding.severity === "blocking");
  if (hasBlocking || review.validationStatus !== "已通过") {
    throw new Error("本地综合检查未通过，不能人工通过审核。");
  }
  if (!review.category) {
    throw new Error("岗位必须先绑定正式品类，才能人工通过审核。");
  }
  const approvedCategory = approvedCategoryCapabilities(review.category);
  const missingFromCategory = review.requiredCapabilities.filter(
    (capability) => !approvedCategory.has(capability),
  );
  if (approvedCategory.size === 0 || missingFromCategory.length > 0) {
    throw new Error(
      approvedCategory.size === 0
        ? `品类 ${review.category} 尚未通过本地审核并激活，不能人工通过审核。`
        : `品类 ${review.category} 未覆盖岗位能力：${missingFromCategory.join("、")}`,
    );
  }
  return setRoleReviewStatus(
    reviewId,
    "已通过",
    decision || "人工确认通过，允许岗位开发者确认上架。",
    now(),
  );
}

function setRoleSubmitState(
  reviewId: string,
  patch: {
    cloudRolePackageId?: string | null;
    cloudPackageId?: string | null;
    cloudPackageVersion?: string | null;
    cloudRoleListingId?: string | null;
    submittedAt?: number | null;
    submitError?: string | null;
    cloudSubmitStatus: CloudSubmitStatus;
    reviewStatus?: RolePreListingReviewStatus;
    reviewDecision?: string | null;
  },
): RolePreListingReview {
  const existing = getRolePreListingReview(reviewId);
  if (!existing) throw new Error(`RolePreListingReview not found: ${reviewId}`);
  const hasPatch = (key: keyof typeof patch): boolean =>
    Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined;
  const cloudRolePackageId: string | null = hasPatch("cloudRolePackageId")
    ? (patch.cloudRolePackageId ?? null)
    : existing.cloudRolePackageId;
  const cloudPackageId: string | null = hasPatch("cloudPackageId")
    ? (patch.cloudPackageId ?? null)
    : existing.cloudPackageId;
  const cloudPackageVersion: string | null = hasPatch("cloudPackageVersion")
    ? (patch.cloudPackageVersion ?? null)
    : existing.cloudPackageVersion;
  const cloudRoleListingId: string | null = hasPatch("cloudRoleListingId")
    ? (patch.cloudRoleListingId ?? null)
    : existing.cloudRoleListingId;
  const submittedAt: number | null = hasPatch("submittedAt")
    ? (patch.submittedAt ?? null)
    : existing.submittedAt;
  const submitError: string | null = hasPatch("submitError")
    ? (patch.submitError ?? null)
    : existing.submitError;
  const reviewStatus: RolePreListingReviewStatus = hasPatch("reviewStatus")
    ? (patch.reviewStatus ?? existing.reviewStatus)
    : existing.reviewStatus;
  const reviewDecision: string | null = hasPatch("reviewDecision")
    ? (patch.reviewDecision ?? null)
    : existing.reviewDecision;
  const params: SQLInputValue[] = [
    cloudRolePackageId,
    cloudPackageId,
    cloudPackageVersion,
    cloudRoleListingId,
    submittedAt,
    submitError,
    patch.cloudSubmitStatus,
    reviewStatus,
    reviewDecision,
    now(),
    reviewId,
  ];
  db()
    .prepare(
      "UPDATE role_pre_listing_reviews SET cloud_role_package_id=?, cloud_package_id=?, cloud_package_version=?, cloud_role_listing_id=?, submitted_at=?, submit_error=?, cloud_submit_status=?, review_status=?, review_decision=?, updated_at=? WHERE id=?",
    )
    .run(...params);
  return getRolePreListingReview(reviewId)!;
}

function sanitizeCloudSubmitError(message: string, token?: string): string {
  const bearerRedacted = message.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  return token ? bearerRedacted.split(token).join("[redacted]") : bearerRedacted;
}

function cloudString(payload: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function cloudRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cloudPackageString(
  payload: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  return cloudString(payload, ...keys) ?? cloudString(cloudRecord(payload, "package"), ...keys);
}

function isLocalhostCloudBaseUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function shouldUseLocalMarketplaceMode(params: {
  cloudBaseUrl?: string;
  cloudAccessToken?: string;
}): boolean {
  if (params.cloudAccessToken?.trim()) return false;
  return !params.cloudBaseUrl?.trim() || isLocalhostCloudBaseUrl(params.cloudBaseUrl);
}

function buildRoleListingUsageInstructions(review: RolePreListingReview): string {
  return [
    `使用者应提供 ${review.rolePackageId} 的任务目标、输入素材和验收要求。`,
    "岗位执行以 role_package/README.md、listing.md、standards.md、cadence.md 和 validation.md 的公开说明为准。",
    "本地私有执行材料、prompt、密钥、workspace 路径和用户数据不随上架申请上传。",
  ].join("\n");
}

async function postCloudJson(opts: {
  fetchFn: typeof fetch;
  cloudBaseUrl: string;
  cloudAccessToken: string;
  path: string;
  body?: unknown;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const response = await opts.fetchFn(new URL(opts.path, opts.cloudBaseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.cloudAccessToken}`,
        "content-type": "application/json",
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    let payload: Record<string, unknown> = {};
    try {
      const parsed = await response.json();
      payload =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      payload = {};
    }
    if (!response.ok || payload.ok === false) {
      const cloudError = cloudString(payload, "error", "message") ?? `HTTP ${response.status}`;
      throw new Error(`云端提交失败（${response.status}）：${cloudError}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("云端提交超时。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function syncCategoryCapabilityReviewToCloud(
  reviewId: string,
  input: RolePreListingCloudSubmitInput = {},
): Promise<CategoryCapabilityCloudSyncResult> {
  const review = getCategoryCapabilityReview(reviewId);
  if (!review) throw new Error(`CategoryCapabilityReview not found: ${reviewId}`);
  if (review.reviewStatus !== "已通过") {
    throw new Error("需要先通过本地审核中心制作正式品类能力包。");
  }
  const missingToolSkillRequirements = missingApprovedToolSkillRequirements(
    review.toolSkillRequirements,
  );
  if (missingToolSkillRequirements.length > 0) {
    const message = `品类能力包尚未完成，不能激活正式品类。请先在工具与 Skill 模块完成：${missingToolSkillRequirements.join("、")}`;
    setCategoryCapabilityCloudSyncState(reviewId, {
      workflowStatus: "category_review_approved",
      cloudSyncStatus: "同步失败",
      cloudSyncError: message,
      reviewDecision: message,
    });
    appendCategoryCapabilityEvent(reviewId, "categoryCapabilityReview.activateBlocked", message);
    throw new Error(message);
  }
  const cloudBaseUrl = input.cloudBaseUrl?.trim();
  const cloudAccessToken = input.cloudAccessToken?.trim();
  if (shouldUseLocalMarketplaceMode({ cloudBaseUrl, cloudAccessToken })) {
    const synced = setCategoryCapabilityCloudSyncState(reviewId, {
      workflowStatus: "category_review_approved",
      cloudSyncStatus: "已同步",
      cloudSyncError: null,
      cloudSyncedAt: now(),
      reviewDecision: "本地版已写入正式品类能力目录，开发者可绑定该品类。",
    });
    appendCategoryCapabilityEvent(
      reviewId,
      "categoryCapabilityReview.activateLocal",
      `本地正式品类能力已激活：${review.categoryRef}`,
    );
    return {
      review: synced,
      cloud: {
        categoryRef: review.categoryRef,
        category: {
          category_ref: review.categoryRef,
          sync_mode: "local",
        },
      },
    };
  }
  if (!cloudBaseUrl) {
    const message = "请先在 API 管理同步迭界AI云端连接的 Base URL。";
    setCategoryCapabilityCloudSyncState(reviewId, {
      workflowStatus: "approved_local_sync_failed",
      cloudSyncStatus: "同步失败",
      cloudSyncError: message,
      reviewDecision: message,
    });
    throw new Error(message);
  }
  if (!cloudAccessToken) {
    const message = "请先在 API 管理填写并同步迭界AI云端连接 Token。";
    setCategoryCapabilityCloudSyncState(reviewId, {
      workflowStatus: "approved_local_sync_failed",
      cloudSyncStatus: "同步失败",
      cloudSyncError: message,
      reviewDecision: message,
    });
    throw new Error(message);
  }

  setCategoryCapabilityCloudSyncState(reviewId, {
    cloudSyncStatus: "同步中",
    cloudSyncError: null,
    reviewDecision: "正在同步正式品类能力包到云端。",
  });
  const timeoutMs = Math.max(500, Math.min(30_000, input.timeoutMs ?? 10_000));
  try {
    const payload = await postCloudJson({
      fetchFn: input.fetchFn ?? fetch,
      cloudBaseUrl,
      cloudAccessToken,
      path: "/admin/dijie/role-categories",
      body: {
        categoryRef: review.categoryRef,
        name: review.categoryName,
        version: /^category:[^@]+@(\d+)$/u.exec(review.categoryRef)?.[1] ?? "1",
        description:
          review.roleDescription ||
          review.reviewDecision ||
          `由本地审核中心为 ${review.title} 制作的正式品类能力包。`,
        categoryPackRef: review.categoryPackRef || packRef("categorypack", review.categoryRef),
        skillPackRef: review.skillPackRef || packRef("skillpack", review.categoryRef),
        toolPackRef: review.toolPackRef || packRef("toolpack", review.categoryRef),
        catalogRefs: review.catalogRefs.length ? review.catalogRefs : review.capabilityRefs,
        capabilityRefs: review.capabilityRefs.length
          ? review.capabilityRefs
          : review.requiredCapabilities,
        reviewNote: review.reviewDecision || "本地审核中心已批准该品类能力包。",
      },
      timeoutMs,
    });
    const categoryRef = cloudString(payload, "categoryRef");
    if (!categoryRef) {
      throw new Error("云端品类同步响应缺少 categoryRef。");
    }
    const synced = setCategoryCapabilityCloudSyncState(reviewId, {
      workflowStatus: "category_review_approved",
      cloudSyncStatus: "已同步",
      cloudSyncError: null,
      cloudSyncedAt: now(),
      reviewDecision: "正式品类能力包已同步云端，开发者可刷新后绑定该品类。",
    });
    appendCategoryCapabilityEvent(
      reviewId,
      "categoryCapabilityReview.syncToCloud",
      `云端品类能力同步成功：${categoryRef}`,
    );
    return { review: synced, cloud: { categoryRef, category: payload.category } };
  } catch (error) {
    const message = sanitizeCloudSubmitError(
      error instanceof Error ? error.message : String(error),
      cloudAccessToken,
    );
    setCategoryCapabilityCloudSyncState(reviewId, {
      workflowStatus: "approved_local_sync_failed",
      cloudSyncStatus: "同步失败",
      cloudSyncError: message,
      reviewDecision: message,
    });
    appendCategoryCapabilityEvent(reviewId, "categoryCapabilityReview.syncToCloud.failed", message);
    throw new Error(message);
  }
}

function categoryCoversRoleCapabilities(
  roleReview: RolePreListingReview,
  categoryReview: CategoryCapabilityReview,
): boolean {
  const categoryCapabilities = new Set<string>();
  for (const capability of categoryReview.capabilityRefs.length
    ? categoryReview.capabilityRefs
    : categoryReview.requiredCapabilities) {
    addCapabilityRefWithAliases(categoryCapabilities, capability);
  }
  if (roleReview.requiredCapabilities.length === 0) {
    return roleReview.category === categoryReview.categoryRef;
  }
  return roleReview.requiredCapabilities.every((capability) =>
    categoryCapabilities.has(capability),
  );
}

function assertCategoryCanBindRole(
  roleReview: RolePreListingReview,
  categoryReview: CategoryCapabilityReview,
): void {
  if (categoryReview.developerId !== roleReview.developerId) {
    throw new Error("所选品类不属于当前岗位开发者，不能绑定。");
  }
  const sameDraft =
    Boolean(roleReview.listingDraftId) &&
    roleReview.listingDraftId === categoryReview.listingDraftId;
  const samePackage =
    Boolean(roleReview.rolePackageId) && roleReview.rolePackageId === categoryReview.rolePackageId;
  if (sameDraft || samePackage || categoryCoversRoleCapabilities(roleReview, categoryReview)) {
    return;
  }
  const categoryCapabilities = categoryReview.capabilityRefs.length
    ? categoryReview.capabilityRefs
    : categoryReview.requiredCapabilities;
  const missing = roleReview.requiredCapabilities.filter(
    (capability) => !categoryCapabilities.includes(capability),
  );
  throw new Error(
    `所选品类能力不覆盖当前岗位需求，不能绑定。缺少：${missing.join("、") || "当前岗位能力"}`,
  );
}

export function bindRolePreListingReviewCategory(
  reviewId: string,
  categoryCapabilityReviewId: string,
): RoleCategoryBindingResult {
  const roleReview = getRolePreListingReview(reviewId);
  if (!roleReview) throw new Error(`RolePreListingReview not found: ${reviewId}`);
  const categoryReview = getCategoryCapabilityReview(categoryCapabilityReviewId);
  if (!categoryReview)
    throw new Error(`CategoryCapabilityReview not found: ${categoryCapabilityReviewId}`);
  if (categoryReview.reviewStatus !== "已通过" || categoryReview.cloudSyncStatus !== "已同步") {
    throw new Error("所选品类还没有通过本地审核并同步成功，不能绑定。");
  }
  assertCategoryCanBindRole(roleReview, categoryReview);
  const capabilityRefs = categoryReview.capabilityRefs.length
    ? categoryReview.capabilityRefs
    : categoryReview.requiredCapabilities;
  db()
    .prepare(
      "UPDATE role_pre_listing_reviews SET category=?, required_capabilities=?, bound_common_capabilities=?, review_decision=?, updated_at=? WHERE id=?",
    )
    .run(
      categoryReview.categoryRef,
      stringifyArray(capabilityRefs),
      stringifyArray(capabilityRefs),
      `岗位开发者已绑定品类：${categoryReview.categoryName}（${categoryReview.categoryRef}）。`,
      now(),
      reviewId,
    );
  db()
    .prepare(
      "UPDATE category_capability_reviews SET workflow_status=?, review_decision=?, updated_at=? WHERE id=?",
    )
    .run(
      "category_bound",
      `开发者已将岗位 ${roleReview.rolePackageId} 绑定到正式品类 ${categoryReview.categoryRef}。`,
      now(),
      categoryCapabilityReviewId,
    );
  appendRoleEvent(reviewId, "review.bindCategory", `已绑定品类：${categoryReview.categoryName}`);
  appendCategoryCapabilityEvent(
    categoryCapabilityReviewId,
    "categoryCapabilityReview.boundToRole",
    `开发者已绑定岗位：${roleReview.rolePackageId}`,
  );
  return {
    review: getRolePreListingReview(reviewId)!,
    categoryCapabilityReview: getCategoryCapabilityReview(categoryCapabilityReviewId)!,
  };
}

export async function submitRolePreListingForListing(
  reviewId: string,
  input: RolePreListingCloudSubmitInput = {},
): Promise<RolePreListingSubmitResult> {
  const review = getRolePreListingReview(reviewId);
  if (!review) throw new Error(`RolePreListingReview not found: ${reviewId}`);
  if (review.reviewStatus !== "已通过") {
    throw new Error("需要先通过本地审核中心");
  }
  if (!review.category) {
    const message = "岗位必须先绑定正式品类，才能上架。";
    setRoleSubmitState(reviewId, {
      cloudSubmitStatus: "提交失败",
      submitError: message,
      reviewDecision: message,
    });
    throw new Error(message);
  }
  const approvedCategory = approvedCategoryCapabilities(review.category);
  const missingFromCategory = review.requiredCapabilities.filter(
    (capability) => !approvedCategory.has(capability),
  );
  if (approvedCategory.size === 0 || missingFromCategory.length) {
    const message =
      approvedCategory.size === 0
        ? `品类 ${review.category} 尚未通过本地审核并激活。`
        : `品类 ${review.category} 未覆盖岗位能力：${missingFromCategory.join("、")}`;
    setRoleSubmitState(reviewId, {
      cloudSubmitStatus: "提交失败",
      submitError: message,
      reviewDecision: message,
    });
    throw new Error(message);
  }
  const cloudBaseUrl = input.cloudBaseUrl?.trim();
  const cloudAccessToken = input.cloudAccessToken?.trim();
  if (shouldUseLocalMarketplaceMode({ cloudBaseUrl, cloudAccessToken })) {
    const manifest = existsSync(review.packageDir) ? readPackageManifest(review.packageDir) : {};
    const listing = publishLocalRoleListing({
      reviewId,
      rolePackageId: review.rolePackageId,
      title: roleTitleFromManifest(manifest, review.rolePackageId),
      categoryRef: review.category,
      requiredCapabilities: review.requiredCapabilities,
      authorizationFeeCents: 0,
    });
    const submittedAt = now();
    const submitted = setRoleSubmitState(reviewId, {
      cloudRoleListingId: listing.roleListingId,
      submittedAt,
      submitError: null,
      cloudSubmitStatus: "已提交",
      reviewStatus: "已提交上架",
      reviewDecision: "已通过本地上架检查，并生成本地正式 0 元岗位商品。",
    });
    appendRoleEvent(
      reviewId,
      "review.submitForListing.local",
      `已完成本地正式上架：${listing.roleListingId}`,
    );
    return {
      review: submitted,
      cloud: {
        mode: "local",
        roleListingId: listing.roleListingId,
        packageId: review.rolePackageId,
        packageVersion: "local",
      },
    };
  }
  if (!cloudBaseUrl) {
    const message = "请先在 API 管理同步迭界AI云端连接的 Base URL。";
    setRoleSubmitState(reviewId, {
      cloudSubmitStatus: "提交失败",
      submitError: message,
      reviewDecision: message,
    });
    throw new Error(message);
  }
  if (!cloudAccessToken) {
    const message = "请先在 API 管理填写并同步迭界AI云端连接 Token。";
    setRoleSubmitState(reviewId, {
      cloudSubmitStatus: "提交失败",
      submitError: message,
      reviewDecision: message,
    });
    throw new Error(message);
  }

  setRoleSubmitState(reviewId, {
    cloudSubmitStatus: "提交中",
    submitError: null,
    reviewDecision: "正在提交云端商城上架申请。",
  });
  const fetchFn = input.fetchFn ?? fetch;
  const timeoutMs = Math.max(500, Math.min(30_000, input.timeoutMs ?? 10_000));
  const cloud: RolePreListingCloudSubmitSummary = {};
  try {
    const packageUpload = buildCloudRolePackageUploadPayload(review);
    const packagePayload = await postCloudJson({
      fetchFn,
      cloudBaseUrl,
      cloudAccessToken,
      path: "/vendor/dijie/role-packages",
      body: packageUpload,
      timeoutMs,
    });
    cloud.rolePackageId = cloudString(packagePayload, "rolePackageId");
    cloud.packageId =
      cloudPackageString(packagePayload, "packageId") ??
      cloudString(packagePayload, "rolePackageId");
    cloud.packageVersion = cloudPackageString(packagePayload, "packageVersion");
    setRoleSubmitState(reviewId, {
      cloudRolePackageId: cloud.rolePackageId ?? null,
      cloudPackageId: cloud.packageId ?? null,
      cloudPackageVersion: cloud.packageVersion ?? null,
      cloudSubmitStatus: "提交中",
      submitError: null,
    });
    if (!cloud.packageId || !cloud.packageVersion) {
      throw new Error("云端岗位包上传响应缺少 packageId 或 packageVersion。");
    }

    const listingPayload = await postCloudJson({
      fetchFn,
      cloudBaseUrl,
      cloudAccessToken,
      path: "/vendor/dijie/role-listings",
      body: {
        packageId: cloud.packageId,
        packageVersion: cloud.packageVersion,
        title: review.rolePackageId,
        usageInstructions: buildRoleListingUsageInstructions(review),
        category: review.category || undefined,
        categoryRef: review.category || undefined,
      },
      timeoutMs,
    });
    cloud.roleListingId = cloudString(listingPayload, "roleListingId");
    if (!cloud.roleListingId) {
      throw new Error("云端岗位商品创建响应缺少 roleListingId。");
    }
    setRoleSubmitState(reviewId, {
      cloudRolePackageId: cloud.rolePackageId ?? null,
      cloudPackageId: cloud.packageId ?? null,
      cloudPackageVersion: cloud.packageVersion ?? null,
      cloudRoleListingId: cloud.roleListingId,
      cloudSubmitStatus: "提交中",
      submitError: null,
    });

    await postCloudJson({
      fetchFn,
      cloudBaseUrl,
      cloudAccessToken,
      path: `/vendor/dijie/role-listings/${encodeURIComponent(cloud.roleListingId)}/submit-review`,
      timeoutMs,
    });
    await postCloudJson({
      fetchFn,
      cloudBaseUrl,
      cloudAccessToken,
      path: `/admin/dijie/reviews/${encodeURIComponent(cloud.roleListingId)}/evaluations`,
      body: {
        roleStandardDecision: "pass",
        safetyComplianceDecision: "pass",
        pricingReasonabilityDecision: "pass",
        summary: "本地审核中心已通过岗位包结构、能力绑定、风险和上架合格性检查。",
      },
      timeoutMs,
    });
    await postCloudJson({
      fetchFn,
      cloudBaseUrl,
      cloudAccessToken,
      path: `/admin/dijie/reviews/${encodeURIComponent(cloud.roleListingId)}/finalize`,
      body: {
        finalResult: "approved",
        summary: "本地审核中心作为审核来源，批准该岗位商品进入云端正式上架。",
      },
      timeoutMs,
    });
    await postCloudJson({
      fetchFn,
      cloudBaseUrl,
      cloudAccessToken,
      path: `/vendor/dijie/role-listings/${encodeURIComponent(cloud.roleListingId)}/publish`,
      timeoutMs,
    });
    const submittedAt = now();
    const submitted = setRoleSubmitState(reviewId, {
      cloudRolePackageId: cloud.rolePackageId ?? null,
      cloudPackageId: cloud.packageId ?? null,
      cloudPackageVersion: cloud.packageVersion ?? null,
      cloudRoleListingId: cloud.roleListingId,
      submittedAt,
      submitError: null,
      cloudSubmitStatus: "已提交",
      reviewStatus: "已提交上架",
      reviewDecision: "已通过本地上架检查，并完成云端审核事实同步和正式上架。",
    });
    appendRoleEvent(
      reviewId,
      "review.submitForListing",
      `已完成云端商城正式上架：${cloud.roleListingId}`,
    );
    return { review: submitted, cloud };
  } catch (error) {
    const message = sanitizeCloudSubmitError(
      error instanceof Error ? error.message : String(error),
      cloudAccessToken,
    );
    const failed = setRoleSubmitState(reviewId, {
      cloudRolePackageId: cloud.rolePackageId ?? null,
      cloudPackageId: cloud.packageId ?? null,
      cloudPackageVersion: cloud.packageVersion ?? null,
      cloudRoleListingId: cloud.roleListingId ?? null,
      cloudSubmitStatus: "提交失败",
      submitError: message,
      reviewDecision: message,
    });
    appendRoleEvent(reviewId, "review.submitForListing.failed", message);
    throw new Error(message || failed.submitError || "云端提交失败。");
  }
}

function setRoleReviewStatus(
  reviewId: string,
  status: RolePreListingReviewStatus,
  decision: string,
  approvedAt: number | null = null,
): RolePreListingReview {
  if (!rowById(reviewId)) throw new Error(`RolePreListingReview not found: ${reviewId}`);
  db()
    .prepare(
      "UPDATE role_pre_listing_reviews SET review_status=?, review_decision=?, approved_at=?, updated_at=? WHERE id=?",
    )
    .run(status, decision, approvedAt, now(), reviewId);
  appendRoleEvent(reviewId, `review.${status}`, decision);
  return getRolePreListingReview(reviewId)!;
}

export function startToolSkillReview(input: StartToolSkillReviewInput): ToolSkillReview {
  if (!input.assetType || !input.assetId?.trim()) {
    throw new Error("assetType and assetId are required");
  }
  const timestamp = now();
  const version = input.version?.trim() || "";
  const existing = db()
    .prepare("SELECT * FROM tool_skill_reviews WHERE asset_type=? AND asset_id=? AND version=?")
    .get(input.assetType, input.assetId.trim(), version) as ToolSkillReviewRow | undefined;
  if (existing) {
    db()
      .prepare(
        "UPDATE tool_skill_reviews SET source=?, declared_capabilities=?, updated_at=? WHERE id=?",
      )
      .run(
        input.source?.trim() || existing.source,
        stringifyArray(input.declaredCapabilities ?? readJsonArray(existing.declared_capabilities)),
        timestamp,
        existing.id,
      );
    appendToolSkillEvent(existing.id, "toolSkillReview.start", "工具/Skill 审核单已刷新。");
    return getToolSkillReview(existing.id)!;
  }
  const id = randomUUID();
  db()
    .prepare(
      "INSERT INTO tool_skill_reviews(id,asset_type,asset_id,source,version,declared_capabilities,risk_level,review_status,review_findings,review_decision,approved_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      input.assetType,
      input.assetId.trim(),
      input.source?.trim() || "platform",
      version,
      stringifyArray(input.declaredCapabilities ?? [input.assetId.trim()]),
      "未评估",
      "待审核",
      "[]",
      null,
      null,
      timestamp,
      timestamp,
    );
  appendToolSkillEvent(id, "toolSkillReview.start", "平台工具/Skill 进入本地能力检查。");
  return getToolSkillReview(id)!;
}

export function listToolSkillReviews(): ToolSkillReview[] {
  const rows = db()
    .prepare("SELECT * FROM tool_skill_reviews ORDER BY updated_at DESC")
    .all() as ToolSkillReviewRow[];
  return rows.map(toolSkillRowToReview);
}

export function getToolSkillReview(id: string): ToolSkillReview | null {
  const row = toolSkillRowById(id);
  return row ? toolSkillRowToReview(row) : null;
}

export function getToolSkillReviewEvents(reviewId: string): ReviewEvent[] {
  const rows = db()
    .prepare("SELECT * FROM tool_skill_review_events WHERE review_id = ? ORDER BY created_at DESC")
    .all(reviewId) as EventRow[];
  return rows.map(eventRowToEvent);
}

export function runToolSkillValidation(
  reviewId: string,
  evidence: ToolSkillValidationEvidence = {},
): ToolSkillReview {
  const review = getToolSkillReview(reviewId);
  if (!review) throw new Error(`ToolSkillReview not found: ${reviewId}`);
  const findings: ReviewFinding[] = [];
  db()
    .prepare("UPDATE tool_skill_reviews SET review_status=?, updated_at=? WHERE id=?")
    .run("检查中", now(), reviewId);
  if (review.declaredCapabilities.length === 0) {
    addFinding(findings, "能力绑定", "blocking", "工具/Skill 未声明可供给能力。");
  } else {
    addFinding(findings, "能力绑定", "pass", `声明能力：${review.declaredCapabilities.join("、")}`);
  }
  if (review.assetType === "skill") {
    const message = skillReviewRuntimeEvidenceMessage(review, evidence);
    if (skillReviewHasRuntimeEvidence(review, evidence)) {
      addFinding(findings, "跑通性", "pass", "已找到启用且依赖满足的 Skill 实现。");
    } else {
      addFinding(findings, "跑通性", "blocking", message);
    }
  } else if (isProviderApiReview(review)) {
    if (providerReviewHasRuntimeEvidence(evidence)) {
      addFinding(findings, "跑通性", "pass", "已找到可用 Provider/API 绑定。");
    } else {
      addFinding(
        findings,
        "跑通性",
        "blocking",
        providerReviewRuntimeEvidenceMessage(review, evidence),
      );
    }
  } else if (review.assetType === "tool") {
    if (toolReviewHasRuntimeEvidence(review)) {
      addFinding(findings, "跑通性", "pass", "已找到启用的本地工具实现。");
    } else {
      addFinding(findings, "跑通性", "blocking", toolReviewRuntimeEvidenceMessage(review));
    }
  }
  const highRisk = review.declaredCapabilities.some((cap) =>
    /(write|shell|network|publish|payment|delete|secret|token)/i.test(cap),
  );
  if (highRisk) {
    addFinding(
      findings,
      "风险",
      "warning",
      "包含写入、网络发布、密钥或自动执行相关能力，需要人工确认。",
    );
  } else {
    addFinding(findings, "风险", "pass", "未发现高风险能力声明。");
  }
  addFinding(
    findings,
    "合格性",
    findings.some((item) => item.severity === "blocking") ? "blocking" : "pass",
    findings.some((item) => item.severity === "blocking")
      ? "工具/Skill 审核未通过。"
      : "工具/Skill 可进入人工最终审核。",
  );
  const status: ToolSkillReviewStatus = findings.some((finding) => finding.severity === "blocking")
    ? "待开发者修改"
    : "检查中";
  db()
    .prepare(
      "UPDATE tool_skill_reviews SET risk_level=?, review_status=?, review_findings=?, review_decision=?, approved_at=NULL, updated_at=? WHERE id=?",
    )
    .run(
      highRisk ? "中" : "低",
      status,
      JSON.stringify(findings),
      status === "待开发者修改" ? "工具/Skill 综合检查未通过。" : null,
      now(),
      reviewId,
    );
  appendToolSkillEvent(
    reviewId,
    "toolSkillReview.runValidation",
    `工具/Skill 综合检查完成：${status}`,
  );
  return getToolSkillReview(reviewId)!;
}

export function requestToolSkillChanges(reviewId: string, decision?: string): ToolSkillReview {
  return setToolSkillReviewStatus(
    reviewId,
    "待开发者修改",
    decision || "需要修改工具/Skill 后重新审核。",
  );
}

export function rejectToolSkillReview(reviewId: string, decision?: string): ToolSkillReview {
  return setToolSkillReviewStatus(
    reviewId,
    "已拒绝",
    decision || "工具/Skill 审核拒绝，不能绑定为品类通用能力。",
  );
}

export function approveToolSkillReview(reviewId: string, decision?: string): ToolSkillReview {
  const review = getToolSkillReview(reviewId);
  if (!review) throw new Error(`ToolSkillReview not found: ${reviewId}`);
  if (review.reviewStatus !== "检查中" || review.reviewFindings.length === 0) {
    throw new Error("请先在工具与 Skill 模块完成检查，再人工通过审核。");
  }
  const hasBlocking = review.reviewFindings.some((finding) => finding.severity === "blocking");
  if (hasBlocking) {
    throw new Error("工具/Skill 综合检查未通过，不能人工通过审核。");
  }
  return setToolSkillReviewStatus(
    reviewId,
    "已通过",
    decision || "人工确认通过，可绑定为品类通用能力。",
    now(),
  );
}

function setToolSkillReviewStatus(
  reviewId: string,
  status: ToolSkillReviewStatus,
  decision: string,
  approvedAt: number | null = null,
): ToolSkillReview {
  if (!toolSkillRowById(reviewId)) throw new Error(`ToolSkillReview not found: ${reviewId}`);
  db()
    .prepare(
      "UPDATE tool_skill_reviews SET review_status=?, review_decision=?, approved_at=?, updated_at=? WHERE id=?",
    )
    .run(status, decision, approvedAt, now(), reviewId);
  appendToolSkillEvent(reviewId, `toolSkillReview.${status}`, decision);
  return getToolSkillReview(reviewId)!;
}
