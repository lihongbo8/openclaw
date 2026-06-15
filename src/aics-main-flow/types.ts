export const AICS_MAIN_FLOW_VERSION = 1;

export const AICS_MAIN_FLOW_STAGES = [
  "observation",
  "attribution",
  "goal",
  "planning",
  "dispatch",
  "role",
] as const;

export type AicsMainFlowStage = (typeof AICS_MAIN_FLOW_STAGES)[number];

export type AicsMainFlowObjectStatus =
  | "draft"
  | "prepared"
  | "candidate"
  | "confirmed"
  | "rejected"
  | "materialized"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export type AicsAuditRef = {
  id: string;
  kind: "chat" | "user-confirmation" | "system" | "dispatch" | "role-result";
  label: string;
  createdAt: number;
};

export type AicsMainFlowEntityBase = {
  id: string;
  status: AicsMainFlowObjectStatus;
  createdAt: number;
  updatedAt: number;
  auditRefs: AicsAuditRef[];
};

export type ObservationSignal = {
  id: string;
  title: string;
  summary: string;
  evidenceRefs: string[];
};

export type ObservationPackage = AicsMainFlowEntityBase & {
  kind: "ObservationPackage";
  title: string;
  summary: string;
  signals: ObservationSignal[];
};

export type AttributionFinding = {
  id: string;
  title: string;
  summary: string;
  confidence: "low" | "medium" | "high";
  observationSignalIds: string[];
};

export type AttributionReport = AicsMainFlowEntityBase & {
  kind: "AttributionReport";
  observationPackageId: string;
  title: string;
  summary: string;
  findings: AttributionFinding[];
};

export type CompanyGoal = AicsMainFlowEntityBase & {
  kind: "CompanyGoal";
  /** 归因报告 ID——CompanyGoal 是观察+归因+目标三方共同确认的结果 */
  attributionReportId: string;
  /** 观察包 ID——明确 CompanyGoal 的观察来源 */
  observationPackageId?: string;
  title: string;
  owner: string;
  metric: string;
  target: string;
  rationale: string;
};

export type RolePlanItem = AicsMainFlowEntityBase & {
  kind: "RolePlanItem";
  planningPackageId: string;
  title: string;
  /** 品类范围。品类通用能力和独特能力都按此归属。 */
  category?: string;
  roleCapabilityRef: string;
  taskIntent: string;
  expectedOutput: string;
  humanConfirmationRequired: boolean;
};

export type PlanningPackage = AicsMainFlowEntityBase & {
  kind: "PlanningPackage";
  goalId: string;
  title: string;
  summary: string;
  rolePlanItemIds: string[];
};

export type DispatchProposalReview = AicsMainFlowEntityBase & {
  kind: "DispatchProposalReview";
  planningPackageId: string;
  rolePlanItemId: string;
  title: string;
  riskSummary: string;
  confirmationSummary: string;
};

export type TaskPackage = AicsMainFlowEntityBase & {
  kind: "TaskPackage";
  goalId: string;
  planningPackageId: string;
  rolePlanItemId: string;
  dispatchProposalReviewId: string;
  title: string;
  taskText: string;
  category?: string;
  requiredCapabilityRefs?: string[];
};

export type DispatchToRoleRequest = AicsMainFlowEntityBase & {
  kind: "DispatchToRoleRequest";
  taskPackageId: string;
  rolePlanItemId: string;
  roleListingId?: string;
  roleTitle?: string;
  workspaceDir?: string;
  category?: string;
  requiredCapabilityRefs?: string[];
  allowedTools?: string[];
  allowedSkills?: string[];
  capabilityRequestId?: string;
  confirmExecution: true;
};

export type RoleResult = AicsMainFlowEntityBase & {
  kind: "RoleResult";
  taskPackageId: string;
  dispatchToRoleRequestId: string;
  outcome: "succeeded" | "failed" | "blocked";
  summary: string;
  artifactRefs: string[];
};

export type AicsMainFlowInteraction = AicsMainFlowEntityBase & {
  kind: "Interaction";
  stage: AicsMainFlowStage;
  message: string;
  proposedNextAction?: string;
};

export type AicsMainFlowState = {
  version: typeof AICS_MAIN_FLOW_VERSION;
  updatedAt: number;
  interactions: AicsMainFlowInteraction[];
  observations: ObservationPackage[];
  attributions: AttributionReport[];
  goals: CompanyGoal[];
  planningPackages: PlanningPackage[];
  rolePlanItems: RolePlanItem[];
  dispatchProposalReviews: DispatchProposalReview[];
  taskPackages: TaskPackage[];
  dispatchToRoleRequests: DispatchToRoleRequest[];
  roleResults: RoleResult[];
  /** managementBreakdown: 已确认目标的经营拆解 */
  workBlocks?: Array<{
    id: string;
    goalId: string;
    name: string;
    purpose: string;
    progressGauge: string;
    status: string;
    blockedReason?: string;
    nextConfirm?: string;
    revision: number;
    isStale: boolean;
    createdAt: number;
    updatedAt: number;
  }>;
  workBlockRoles?: Array<{
    id: string;
    workBlockId: string;
    roleListingId: string;
    roleTitle: string;
    status: string;
    createdAt: number;
    updatedAt: number;
  }>;
  workBlockTaskCandidates?: Array<{
    id: string;
    workBlockId: string;
    roleId?: string;
    title: string;
    targetDeliverable: string;
    status: string;
    completionPct: number;
    blockedReason?: string;
    nextConfirm?: string;
    createdAt: number;
    updatedAt: number;
  }>;
};

export type AicsToolPermission = {
  id: string;
  label: string;
  kind: "read" | "execute" | "high_risk";
  status: "granted" | "needs_human_confirm" | "blocked";
};

export type AicsSkillPermission = {
  id: string;
  label: string;
  version: string;
  status: "granted" | "needs_human_confirm" | "blocked";
  outputSchema: "unified_json";
};

export type AicsCapabilityScope = "category_common" | "unique";

export type AicsCapability = {
  id: string;
  scope: AicsCapabilityScope;
  category: string;
  label: string;
  description: string;
  tools: AicsToolPermission[];
  skills: AicsSkillPermission[];
  approvalStatus: "approved" | "requested" | "rejected" | "blocked";
  humanConfirmRequired: boolean;
};

export type AicsUniqueCapabilityRequest = {
  id: string;
  category: string;
  rolePlanItemId?: string;
  taskPackageId?: string;
  missingCapability: string;
  capabilityType: "tool" | "skill" | "both";
  neededTools: string[];
  neededSkills: string[];
  reason: string;
  riskLevel: "low" | "medium" | "high";
  status: "requested" | "approved" | "rejected";
  humanConfirmRequired: true;
};

export type AicsCapabilityMatchResult = {
  rolePlanItemId: string;
  category: string;
  requiredCapabilityRef: string;
  commonCapabilityId: string;
  uniqueCapabilityRequestId?: string;
  status: "satisfied" | "needs_unique_capability" | "blocked";
  allowedTools: string[];
  allowedSkills: string[];
  missingTools: string[];
  missingSkills: string[];
  summary: string;
};

export type AicsMainFlowReadiness = {
  canPrepareAttribution: boolean;
  canCreateGoalCandidate: boolean;
  canPreparePlanning: boolean;
  canCreateDispatchProposal: boolean;
  canMaterializeTaskPackage: boolean;
  canRunApprovedTask: boolean;
};

export type AicsMainFlowBlockedReason = {
  stage: AicsMainFlowStage;
  code:
    | "missing_observation_package"
    | "missing_attribution_report"
    | "missing_confirmed_company_goal"
    | "missing_confirmed_planning_package"
    | "missing_confirmed_dispatch_proposal"
    | "missing_task_package"
    | "missing_dispatch_to_role_request"
    | "authorization_required"
    | "cost_not_confirmed";
  message: string;
};

export type AicsOperationCheckStatus = "ready" | "waiting" | "blocked" | "done";

export type AicsOperationCheck = {
  id: string;
  title: string;
  layer: "main_flow" | "support";
  status: AicsOperationCheckStatus;
  summary: string;
  routeTab:
    | "businessOverview"
    | "observation"
    | "attribution"
    | "goals"
    | "company"
    | "workboard"
    | "aics"
    | "skills"
    | "apiManagement"
    | "usage";
  blockedReason?: string;
  nextAction: string;
};

export type AicsMainFlowReadModel = {
  version: typeof AICS_MAIN_FLOW_VERSION;
  updatedAt: number;
  currentStage: AicsMainFlowStage;
  readiness: AicsMainFlowReadiness;
  blockedReasons: AicsMainFlowBlockedReason[];
  latest: {
    interaction: AicsMainFlowInteraction | null;
    observationPackage: ObservationPackage | null;
    attributionReport: AttributionReport | null;
    companyGoal: CompanyGoal | null;
    planningPackage: PlanningPackage | null;
    rolePlanItem: RolePlanItem | null;
    dispatchProposalReview: DispatchProposalReview | null;
    taskPackage: TaskPackage | null;
    dispatchToRoleRequest: DispatchToRoleRequest | null;
    roleResult: RoleResult | null;
  };
  counts: {
    interactions: number;
    observations: number;
    attributions: number;
    goals: number;
    planningPackages: number;
    rolePlanItems: number;
    dispatchProposalReviews: number;
    taskPackages: number;
    dispatchToRoleRequests: number;
    roleResults: number;
  };
  objects: {
    interactions: AicsMainFlowInteraction[];
    observations: ObservationPackage[];
    attributions: AttributionReport[];
    goals: CompanyGoal[];
    planningPackages: PlanningPackage[];
    rolePlanItems: RolePlanItem[];
    dispatchProposalReviews: DispatchProposalReview[];
    taskPackages: TaskPackage[];
    dispatchToRoleRequests: DispatchToRoleRequest[];
    roleResults: RoleResult[];
  };
  workBlocks?: Array<{
    id: string;
    goalId: string;
    name: string;
    purpose: string;
    progressGauge: string;
    status: string;
    blockedReason?: string;
    nextConfirm?: string;
    revision: number;
    isStale: boolean;
    createdAt: number;
    updatedAt: number;
  }>;
  workBlockRoles?: Array<{
    id: string;
    workBlockId: string;
    roleListingId: string;
    roleTitle: string;
    status: string;
    createdAt: number;
    updatedAt: number;
  }>;
  workBlockTaskCandidates?: Array<{
    id: string;
    workBlockId: string;
    roleId?: string;
    title: string;
    targetDeliverable: string;
    status: string;
    completionPct: number;
    blockedReason?: string;
    nextConfirm?: string;
    createdAt: number;
    updatedAt: number;
  }>;
  operationChecks: AicsOperationCheck[];
  capabilities: {
    categoryCommon: AicsCapability[];
    uniqueRequests: AicsUniqueCapabilityRequest[];
    matches: AicsCapabilityMatchResult[];
  };
};

export class AicsMainFlowGateError extends Error {
  readonly code: AicsMainFlowBlockedReason["code"];
  readonly stage: AicsMainFlowStage;

  constructor(reason: AicsMainFlowBlockedReason) {
    super(reason.message);
    this.name = "AicsMainFlowGateError";
    this.code = reason.code;
    this.stage = reason.stage;
  }
}
