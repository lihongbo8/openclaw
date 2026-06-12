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
  attributionReportId: string;
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
};

export type DispatchToRoleRequest = AicsMainFlowEntityBase & {
  kind: "DispatchToRoleRequest";
  taskPackageId: string;
  rolePlanItemId: string;
  roleListingId?: string;
  roleTitle?: string;
  workspaceDir?: string;
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
    | "missing_dispatch_to_role_request";
  message: string;
};

export type AicsMainFlowReadModel = {
  version: typeof AICS_MAIN_FLOW_VERSION;
  updatedAt: number;
  currentStage: AicsMainFlowStage;
  readiness: AicsMainFlowReadiness;
  blockedReasons: AicsMainFlowBlockedReason[];
  latest: {
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
