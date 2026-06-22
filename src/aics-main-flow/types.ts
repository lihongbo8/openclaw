import type { ObservationWorkspaceReadModel } from "./generic-observation-engine.js";

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
  | "blocked"
  | "cancelled";

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
  /** 当前值：来自观察层的真实事实或“待确认”，用于真人判断目标差距。 */
  currentValue?: string;
  target: string;
  /** 目标周期，例如 Q3 / 2026-07-01~2026-09-30。 */
  cycle?: string;
  rationale: string;
  /** 用人话说明为什么现在必须做这个目标。 */
  whyNow?: string;
  /** 来源观察信号，必须能追溯到 ObservationPackage。 */
  sourceObservationSignalIds?: string[];
  /** 来源归因发现，必须能追溯到 AttributionReport。 */
  sourceAttributionFindingIds?: string[];
  /** 进入规划前仍需处理的阻塞。 */
  blockedReasons?: string[];
  /** 目标是否满足进入规划的条件。 */
  readyForPlanning?: boolean;
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
  sourceSignalIds?: string[];
  sourceFindingIds?: string[];
  dispatchStatus?:
    | "not_dispatched"
    | "ready_for_dispatch"
    | "partially_dispatched"
    | "dispatched"
    | "blocked";
  dispatchProposalIds?: string[];
  capabilityMatchSummary?: string;
  blockedReasons?: string[];
  acceptanceCriteria?: string[];
};

export type PlanningPackage = AicsMainFlowEntityBase & {
  kind: "PlanningPackage";
  goalId: string;
  title: string;
  summary: string;
  rolePlanItemIds: string[];
  revision: number;
  sourceObservationPackageId?: string;
  sourceAttributionReportId?: string;
  statusReason?: string;
  supersededByPlanningPackageId?: string;
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
  entitlementId?: string;
  workspaceDir?: string;
  categoryCapabilityId?: string;
  category?: string;
  requiredCapabilityRefs?: string[];
  allowedTools?: string[];
  allowedSkills?: string[];
  capabilityBlockedReasons?: AicsMainFlowBlockedReason["code"][];
  capabilityRequestId?: string;
  confirmExecution?: boolean;
  costConfirmed?: boolean;
  ledgerRef?: string;
  toolSkillReady?: boolean;
  apiBindingReady?: boolean;
};

export type AicsToolSupplyResolution = {
  categoryCapabilityId: string;
  category: string;
  allowedTools: string[];
  allowedSkills: string[];
  dispatchReady: boolean;
  blockedReasons: string[];
};

export type RoleResultExecutionEvidence = {
  executionId?: string;
  roleListingId?: string;
  entitlementId?: string;
  ledgerRef?: string;
  workPatterns?: Array<"generate" | "analyze" | "transform" | "operate" | "composite">;
  outputContracts?: Array<
    "image" | "html" | "document" | "spreadsheet" | "json" | "external_record" | "package"
  >;
  inferredWorkPattern?: boolean;
  inferredOutputContract?: boolean;
  categoryCapabilityId?: string;
  businessCategory?: string;
  businessContext?: {
    businessCategory?: string;
    domainKnowledge?: string[];
    vocabulary?: string[];
    inputHints?: string[];
    qualityStandards?: string[];
    styleRules?: string[];
    metricRules?: string[];
    forbiddenActions?: string[];
  };
  executionPlan?: {
    executionId: string;
    workPatterns: Array<"generate" | "analyze" | "transform" | "operate" | "composite">;
    outputContracts: Array<
      "image" | "html" | "document" | "spreadsheet" | "json" | "external_record" | "package"
    >;
    categoryCapabilityId?: string;
    businessCategory?: string;
    currentState: string;
    targetState: string;
    gap: string;
    executionChoice: string;
    steps: Array<{
      stepIndex: number;
      stepName: string;
      workPattern: "generate" | "analyze" | "transform" | "operate" | "composite";
      expectedOutput: string;
      requiredSkills?: string[];
      requiredTools?: string[];
      validationRules?: string[];
      requiresHumanConfirm?: boolean;
    }>;
    validationRules: string[];
    riskCheckpoints: string[];
    inferredWorkPattern?: boolean;
    inferredOutputContract?: boolean;
  };
  validation?: {
    passed: boolean;
    checkedContracts: string[];
    failures: string[];
    warnings?: string[];
  };
  preflightSnapshot?: {
    checkedAt: number;
    taskDispatched: boolean;
    roleAuthorized: boolean;
    humanConfirmed: boolean;
    costConfirmed: boolean;
    toolSkillReady: boolean;
    apiBindingReady: boolean;
    ledgerRefPresent: boolean;
    allowedTools: string[];
    allowedSkills: string[];
    taskPackageId?: string;
    dispatchToRoleRequestId?: string;
    roleListingId?: string;
    entitlementId?: string;
  };
  memoryContext?: {
    query: string;
    generatedAt: number;
    formal: Array<{
      memoryId: string;
      type: string;
      title: string;
      content: string;
      source: {
        layer: string;
        entityId: string;
        entityType: string;
      };
      confidence: string;
      tags: string[];
      scope: string;
      scopeRef?: string;
      version: number;
    }>;
    recallError?: string;
  };
  memoryCandidates?: Array<{
    candidateId?: string;
    type: "role_experience" | "tool_experience" | "quality_feedback";
    title: string;
    content: string;
    source: {
      layer: "role" | "tool" | "planning" | "dispatch";
      entityId: string;
      entityType: string;
    };
    confidence: "low" | "medium" | "high";
    tags: string[];
    requiresHumanConfirm?: boolean;
    proposedBy?: string;
    proposedAt?: number;
    status?: "pending" | "confirmed" | "rejected";
  }>;
  steps?: Array<{
    stepIndex: number;
    stepName: string;
    status: string;
    inputSummary: string;
    outputSummary?: string;
    toolCalls: Array<{
      toolName: string;
      toolCallId: string;
      inputSummary: string;
      outputSummary?: string;
      durationMs: number;
      status: string;
      error?: string;
    }>;
  }>;
  toolUsage?: {
    totalToolCalls: number;
    successfulCalls: number;
    failedCalls: number;
  };
  modelUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costCents: number;
  };
  costSummary?: {
    authorizationFeeCents?: number;
    executionFeeCents?: number;
    modelUsageCostCents?: number;
    totalCostCents?: number;
    currency?: string;
    source?: string;
    ledgerRef?: string;
  };
  humanConfirmationRef?: string;
  modelUsageNotApplicable?: boolean;
  modelUsageNotApplicableReason?: string;
  businessDeliverables?: Array<{
    label: string;
    summary: string;
    ref?: string;
    status?: string;
  }>;
  /** 外部系统回读记录引用，例如 external_record:crm:case-123；属于业务产物证据，不是文件路径。 */
  externalRecordRefs?: string[];
  auditReadback?: Record<string, unknown>;
  ledgerReadback?: Record<string, unknown>;
  recoverySuggestion?: string;
};

export type RoleResult = AicsMainFlowEntityBase & {
  kind: "RoleResult";
  taskPackageId: string;
  dispatchToRoleRequestId: string;
  outcome: "succeeded" | "failed" | "blocked";
  summary: string;
  artifactRefs: string[];
  executionEvidence?: RoleResultExecutionEvidence;
};

export type AicsMainFlowInteraction = AicsMainFlowEntityBase & {
  kind: "Interaction";
  stage: AicsMainFlowStage;
  message: string;
  proposedNextAction?: string;
};

export type ObservationEvidenceRun = {
  id: string;
  planId: string;
  status: "completed" | "blocked" | "failed";
  observationPackageId?: string;
  acceptedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  missingCount: number;
  blockedReasons: string[];
  runResultJson: string;
  createdAt: number;
};

export type AicsMainFlowState = {
  version: typeof AICS_MAIN_FLOW_VERSION;
  updatedAt: number;
  interactions: AicsMainFlowInteraction[];
  observations: ObservationPackage[];
  observationEvidenceRuns?: ObservationEvidenceRun[];
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
  canEnterRoleExecution: boolean;
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
    | "execution_confirmation_required"
    | "cost_not_confirmed"
    | "duplicate_successful_execution"
    | "missing_category_binding"
    | "missing_tool_binding"
    | "missing_skill_binding"
    | "tool_skill_not_ready"
    | "missing_api_binding"
    | "skill_disabled"
    | "skill_missing_dependency"
    | "plugin_tool_disabled"
    | "missing_tool_permission"
    | "unique_capability_pending"
    | "cloud_capability_not_authorized"
    | "high_risk_needs_human_approval"
    | "unsupported_capability_route"
    | "actor_context_missing";
  message: string;
};

export type AicsMainFlowExecutionPreflight = {
  taskPackageId?: string;
  dispatchToRoleRequestId?: string;
  hasTaskPackage: boolean;
  hasDispatchToRoleRequest: boolean;
  hasEntitlement: boolean;
  hasExecutionConfirmation: boolean;
  hasCostConfirmation: boolean;
  hasToolSkillReadiness: boolean;
  hasApiBinding: boolean;
  blockedReasons: AicsMainFlowBlockedReason[];
  canRun: boolean;
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

export type AicsMainFlowRouteTab = AicsOperationCheck["routeTab"];

export type AicsStageGuidance = {
  stage: AicsMainFlowStage;
  title: string;
  description: string;
  primaryActionLabel: string;
  primaryActionTarget: AicsMainFlowRouteTab;
  nextStepLabel: string;
};

export type AicsStageProgress = {
  stage: AicsMainFlowStage;
  label: string;
  routeTab: AicsMainFlowRouteTab;
  status: "completed" | "current" | "available" | "blocked" | "locked";
  statusLabel: string;
  summary: string;
  nextAction: string;
  actionLabel: string;
  actionTab: AicsMainFlowRouteTab;
  evidenceCount: number;
  blockerCount: number;
};

export type AicsPrecondition = {
  id: string;
  label: string;
  status: "met" | "missing" | "blocked";
  message: string;
  fixTab?: AicsMainFlowRouteTab;
  fixActionLabel?: string;
};

export type AicsBlockerResolution = {
  code: AicsMainFlowBlockedReason["code"];
  humanMessage: string;
  impact: string;
  fixTab: AicsMainFlowRouteTab;
  fixActionLabel: string;
};

export type AicsHandoffPreview = {
  fromStage: AicsMainFlowStage;
  toStage: AicsMainFlowStage;
  outputLabel: string;
  outputCount: number;
  summary: string;
};

export type AicsOperatorRecommendation = {
  title: string;
  summary: string;
  severity: "info" | "warning" | "success";
  actionLabel: string;
  actionTab: AicsMainFlowRouteTab;
};

export type AicsAccountGoalMode = {
  accountLabel: string;
  status:
    | "needs_setup"
    | "ready_to_plan"
    | "ready_to_dispatch"
    | "ready_to_run"
    | "running"
    | "completed"
    | "blocked";
  headline: string;
  plainSummary: string;
  currentGoal?: {
    title: string;
    metric: string;
    target: string;
    owner: string;
    status: AicsMainFlowObjectStatus;
  };
  currentBlocker?: {
    title: string;
    reason: string;
    actionLabel: string;
    actionTab: AicsMainFlowRouteTab;
  };
  nextStep: {
    label: string;
    tab: AicsMainFlowRouteTab;
    reason: string;
  };
  chatCapabilities: {
    canReadAccountData: boolean;
    canCreateCandidates: boolean;
    cannotBypassMainFlow: boolean;
    humanLabel: string;
  };
  stageCards: Array<{
    label: string;
    statusLabel: string;
    nextAction: string;
    routeTab: AicsMainFlowRouteTab;
  }>;
};

export type AicsStageBoundary = {
  allowed: string[];
  prohibited: string[];
  evidenceRequired: string[];
};

export type AicsExecutionClosure = {
  status: "not_ready" | "ready_to_run" | "running" | "completed" | "blocked" | "failed";
  canRun: boolean;
  readinessChecks: Array<{
    label: string;
    status: "passed" | "missing";
    detail: string;
    targetTab?: "apiManagement" | "usage" | "skills" | "workboard" | "aics";
  }>;
  taskPackageId?: string;
  dispatchToRoleRequestId?: string;
  executionId?: string;
  roleListingId?: string;
  entitlementId?: string;
  businessResult?: {
    summary: string;
    artifactRefs: string[];
  };
  nextObservationCandidate?: {
    title: string;
    summary: string;
    artifactTitles: string[];
    auditComplete: boolean;
    ledgerComplete: boolean;
    modelUsageEvidence: "recorded" | "not_applicable" | "missing";
    failureReason?: string;
    recoveryActions: Array<{
      label: string;
      targetTab: "apiManagement" | "usage" | "skills" | "workboard" | "aics";
      reason: string;
    }>;
    boundary: string;
  };
  evidenceReadback: {
    hasRoleResult: boolean;
    hasBusinessArtifact: boolean;
    hasAudit: boolean;
    hasLedger: boolean;
    hasModelUsage: boolean;
    hasCostSummary: boolean;
    hasHumanConfirmation: boolean;
    modelUsageStatus?: "recorded" | "not_applicable" | "missing";
    modelUsageMessage?: string;
  };
  evidenceSummary: Array<{
    label: string;
    value: string;
    status: "available" | "missing";
  }>;
  missingEvidence: string[];
  productionFinalGate: {
    status: "not_evaluated";
    requiredVerdict: "production_plus_passed";
    reason: string;
    nextAction: string;
    operatorChecklist: Array<{
      label: string;
      detail: string;
      requiredInput?: string;
    }>;
    operatorSteps: Array<{
      step: string;
      status: "blocked" | "pending" | "ready";
      action: string;
      requiredInputs?: string[];
    }>;
    requiredInputs: string[];
    readinessCommand: string;
    finalCommand: string;
    secretHandling: string;
  };
  recoveryActions: Array<{
    label: string;
    targetTab: "apiManagement" | "usage" | "skills" | "workboard" | "aics";
    reason: string;
  }>;
};

export type AicsMainFlowReadModel = {
  version: typeof AICS_MAIN_FLOW_VERSION;
  updatedAt: number;
  currentStage: AicsMainFlowStage;
  readiness: AicsMainFlowReadiness;
  executionPreflight: AicsMainFlowExecutionPreflight;
  blockedReasons: AicsMainFlowBlockedReason[];
  stageGuidance: AicsStageGuidance;
  stageProgress: AicsStageProgress[];
  preconditions: AicsPrecondition[];
  blockerResolutions: AicsBlockerResolution[];
  handoffPreview: AicsHandoffPreview;
  operatorRecommendation: AicsOperatorRecommendation;
  accountGoalMode: AicsAccountGoalMode;
  stageBoundary: AicsStageBoundary;
  executionClosure: AicsExecutionClosure;
  observationWorkspace: ObservationWorkspaceReadModel;
  attributionSummary: {
    dimensions: string[];
    matchedDimensions: string[];
    topFindings: Array<{
      id: string;
      title: string;
      summary: string;
      confidence: AttributionFinding["confidence"];
      evidenceCount: number;
      dimension: string;
    }>;
    evidenceCount: number;
    missingEvidenceCount: number;
    lowConfidenceCount: number;
    canCreateGoalCandidate: boolean;
    userMessage: string;
    missingData: string[];
  };
  goalSummary: {
    hasGoal: boolean;
    goalId?: string;
    title?: string;
    statusLabel: string;
    metric?: string;
    currentValue?: string;
    target?: string;
    cycle?: string;
    owner?: string;
    observationSourceCount: number;
    attributionSourceCount: number;
    blockedReasons: string[];
    readyForPlanning: boolean;
    canConfirm: boolean;
    userMessage: string;
    nextAction: string;
  };
  planningSummary: {
    hasPlanning: boolean;
    planningPackageId?: string;
    title?: string;
    statusLabel: string;
    revision?: number;
    workBlockCount: number;
    dispatchableCount: number;
    blockedCount: number;
    missingAcceptanceCount: number;
    readyForDispatch: boolean;
    userMessage: string;
    nextAction: string;
    workBlocks: Array<{
      id: string;
      title: string;
      roleLabel: string;
      taskIntent: string;
      expectedOutput: string;
      acceptanceCount: number;
      dispatchable: boolean;
      blockedReason?: string;
    }>;
  };
  dispatchSummary: {
    hasConfirmedGoal: boolean;
    hasConfirmedPlanning: boolean;
    hasDispatchProposal: boolean;
    hasTaskPackage: boolean;
    hasDispatchQueue: boolean;
    authorized: boolean;
    apiReady: boolean;
    toolSkillReady: boolean;
    costReady: boolean;
    actorContextReady: boolean;
    dispatchableWorkBlockCount: number;
    canCreateDispatch: boolean;
    canEnterRoleExecution: boolean;
    userMessage: string;
    nextAction: string;
    boundary: string;
    checks: Array<{
      label: string;
      ok: boolean;
      detail: string;
      targetTab: AicsMainFlowRouteTab;
    }>;
  };
  roleExecutionSummary: {
    statusLabel: string;
    canRun: boolean;
    canMarkCompleted: boolean;
    hasBusinessResult: boolean;
    hasBusinessArtifact: boolean;
    hasAudit: boolean;
    hasLedger: boolean;
    hasModelUsage: boolean;
    missingEvidence: string[];
    businessResultSummary?: string;
    nextObservationReady: boolean;
    userMessage: string;
    nextAction: string;
    boundary: string;
    recoveryActions: Array<{
      label: string;
      targetTab: "apiManagement" | "usage" | "skills" | "workboard" | "aics";
      reason: string;
    }>;
  };
  nextObservationSummary: {
    hasCandidate: boolean;
    readyForReview: boolean;
    title: string;
    summary: string;
    artifactTitles: string[];
    auditComplete: boolean;
    ledgerComplete: boolean;
    modelUsageEvidence: "recorded" | "not_applicable" | "missing";
    failureReason?: string;
    recoveryActions: Array<{
      label: string;
      targetTab: "apiManagement" | "usage" | "skills" | "workboard" | "aics";
      reason: string;
    }>;
    userMessage: string;
    nextAction: string;
    boundary: string;
  };
  latest: {
    interaction: AicsMainFlowInteraction | null;
    observationPackage: ObservationPackage | null;
    observationEvidenceRun: ObservationEvidenceRun | null;
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
    observationEvidenceRuns: number;
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
    observationEvidenceRuns: ObservationEvidenceRun[];
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
