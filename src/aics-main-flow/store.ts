import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  AICS_MAIN_FLOW_VERSION,
  AicsMainFlowGateError,
  type AicsAuditRef,
  type AicsMainFlowBlockedReason,
  type AicsMainFlowInteraction,
  type AicsMainFlowReadModel,
  type AicsMainFlowStage,
  type AicsMainFlowState,
  type AttributionFinding,
  type AttributionReport,
  type CompanyGoal,
  type DispatchProposalReview,
  type DispatchToRoleRequest,
  type ObservationPackage,
  type ObservationSignal,
  type PlanningPackage,
  type RolePlanItem,
  type RoleResult,
  type TaskPackage,
} from "./types.js";

type EntityInput = {
  id?: string;
  auditRefs?: AicsAuditRef[];
};

export type CreateInteractionInput = EntityInput & {
  stage: AicsMainFlowStage;
  message: string;
  proposedNextAction?: string;
};

export type PrepareObservationInput = EntityInput & {
  title: string;
  summary: string;
  signals?: ObservationSignal[];
};

export type PrepareAttributionInput = EntityInput & {
  observationPackageId?: string;
  title: string;
  summary: string;
  findings?: AttributionFinding[];
};

export type CreateGoalCandidateInput = EntityInput & {
  attributionReportId?: string;
  title: string;
  owner: string;
  metric: string;
  target: string;
  rationale: string;
};

export type PreparePlanningInput = EntityInput & {
  goalId?: string;
  title: string;
  summary: string;
  rolePlanItems: Array<
    EntityInput & {
      title: string;
      roleCapabilityRef: string;
      taskIntent: string;
      expectedOutput: string;
      humanConfirmationRequired?: boolean;
    }
  >;
};

export type CreateDispatchProposalInput = EntityInput & {
  planningPackageId?: string;
  rolePlanItemId?: string;
  title: string;
  riskSummary: string;
  confirmationSummary: string;
};

export type MaterializeTaskPackageInput = EntityInput & {
  dispatchProposalReviewId?: string;
  title: string;
  taskText: string;
  request?: EntityInput & {
    roleListingId?: string;
    roleTitle?: string;
    workspaceDir?: string;
  };
};

export type RunApprovedTaskInput = {
  taskPackageId?: string;
  dispatchToRoleRequestId?: string;
  result?: EntityInput & {
    outcome: RoleResult["outcome"];
    summary: string;
    artifactRefs?: string[];
  };
};

type EntityTimestamps = {
  createdAt: number;
  updatedAt: number;
};

export function resolveAicsMainFlowStorePath(
  env: NodeJS.ProcessEnv = process.env,
  homedir?: () => string,
): string {
  return path.join(resolveStateDir(env, homedir), "aics-main-flow", "state.json");
}

export function createEmptyAicsMainFlowState(now = Date.now()): AicsMainFlowState {
  return {
    version: AICS_MAIN_FLOW_VERSION,
    updatedAt: now,
    interactions: [],
    observations: [],
    attributions: [],
    goals: [],
    planningPackages: [],
    rolePlanItems: [],
    dispatchProposalReviews: [],
    taskPackages: [],
    dispatchToRoleRequests: [],
    roleResults: [],
  };
}

function cloneState(state: AicsMainFlowState): AicsMainFlowState {
  return JSON.parse(JSON.stringify(state)) as AicsMainFlowState;
}

function latestByCreatedAt<T extends { createdAt: number }>(items: T[]): T | null {
  return items.reduce<T | null>(
    (latest, item) => (!latest || item.createdAt >= latest.createdAt ? item : latest),
    null,
  );
}

function makeId(prefix: string, explicitId?: string): string {
  return explicitId?.trim() || `${prefix}_${randomUUID()}`;
}

function timestamps(now: number): EntityTimestamps {
  return { createdAt: now, updatedAt: now };
}

function auditRefs(input: EntityInput | undefined): AicsAuditRef[] {
  return input?.auditRefs ? [...input.auditRefs] : [];
}

function confirmed<T extends { status: string }>(item: T | null): T | null {
  return item?.status === "confirmed" ? item : null;
}

function latestConfirmed<T extends { status: string; createdAt: number }>(items: T[]): T | null {
  return confirmed(latestByCreatedAt(items.filter((item) => item.status === "confirmed")));
}

function getReadiness(state: AicsMainFlowState) {
  const latestObservation = latestByCreatedAt(state.observations);
  const latestAttribution = latestByCreatedAt(state.attributions);
  const latestConfirmedGoal = latestConfirmed(state.goals);
  const latestConfirmedPlanning = latestConfirmed(state.planningPackages);
  const latestConfirmedDispatch = latestConfirmed(state.dispatchProposalReviews);
  const latestTaskPackage = latestByCreatedAt(state.taskPackages);
  const latestDispatchRequest = latestByCreatedAt(state.dispatchToRoleRequests);
  return {
    canPrepareAttribution: Boolean(latestObservation),
    canCreateGoalCandidate: Boolean(latestAttribution),
    canPreparePlanning: Boolean(latestConfirmedGoal),
    canCreateDispatchProposal: Boolean(latestConfirmedPlanning),
    canMaterializeTaskPackage: Boolean(latestConfirmedDispatch),
    canRunApprovedTask: Boolean(latestTaskPackage && latestDispatchRequest),
  };
}

export function getAicsMainFlowBlockedReasons(
  state: AicsMainFlowState,
): AicsMainFlowBlockedReason[] {
  const readiness = getReadiness(state);
  const reasons: AicsMainFlowBlockedReason[] = [];
  if (!readiness.canPrepareAttribution) {
    reasons.push({
      stage: "observation",
      code: "missing_observation_package",
      message: "ObservationPackage is required before attribution.",
    });
  }
  if (!readiness.canCreateGoalCandidate) {
    reasons.push({
      stage: "attribution",
      code: "missing_attribution_report",
      message: "AttributionReport is required before creating goal rationale.",
    });
  }
  if (!readiness.canPreparePlanning) {
    reasons.push({
      stage: "goal",
      code: "missing_confirmed_company_goal",
      message: "A user-confirmed CompanyGoal is required before planning.",
    });
  }
  if (!readiness.canCreateDispatchProposal) {
    reasons.push({
      stage: "planning",
      code: "missing_confirmed_planning_package",
      message: "A confirmed PlanningPackage with RolePlanItem entries is required before dispatch.",
    });
  }
  if (!readiness.canMaterializeTaskPackage) {
    reasons.push({
      stage: "dispatch",
      code: "missing_confirmed_dispatch_proposal",
      message:
        "A confirmed DispatchProposalReview is required before materializing a task package.",
    });
  }
  if (!latestByCreatedAt(state.taskPackages)) {
    reasons.push({
      stage: "role",
      code: "missing_task_package",
      message: "TaskPackage is required before role execution.",
    });
  }
  if (!latestByCreatedAt(state.dispatchToRoleRequests)) {
    reasons.push({
      stage: "role",
      code: "missing_dispatch_to_role_request",
      message: "DispatchToRoleRequest is required before role execution.",
    });
  }
  return reasons;
}

function requireGate(state: AicsMainFlowState, code: AicsMainFlowBlockedReason["code"]): void {
  const reason = getAicsMainFlowBlockedReasons(state).find((item) => item.code === code);
  if (reason) {
    throw new AicsMainFlowGateError(reason);
  }
}

export function createAicsMainFlowReadModel(state: AicsMainFlowState): AicsMainFlowReadModel {
  const blockedReasons = getAicsMainFlowBlockedReasons(state);
  const currentStage = blockedReasons[0]?.stage ?? "role";
  return {
    version: AICS_MAIN_FLOW_VERSION,
    updatedAt: state.updatedAt,
    currentStage,
    readiness: getReadiness(state),
    blockedReasons,
    latest: {
      observationPackage: latestByCreatedAt(state.observations),
      attributionReport: latestByCreatedAt(state.attributions),
      companyGoal: latestByCreatedAt(state.goals),
      planningPackage: latestByCreatedAt(state.planningPackages),
      rolePlanItem: latestByCreatedAt(state.rolePlanItems),
      dispatchProposalReview: latestByCreatedAt(state.dispatchProposalReviews),
      taskPackage: latestByCreatedAt(state.taskPackages),
      dispatchToRoleRequest: latestByCreatedAt(state.dispatchToRoleRequests),
      roleResult: latestByCreatedAt(state.roleResults),
    },
    counts: {
      observations: state.observations.length,
      attributions: state.attributions.length,
      goals: state.goals.length,
      planningPackages: state.planningPackages.length,
      rolePlanItems: state.rolePlanItems.length,
      dispatchProposalReviews: state.dispatchProposalReviews.length,
      taskPackages: state.taskPackages.length,
      dispatchToRoleRequests: state.dispatchToRoleRequests.length,
      roleResults: state.roleResults.length,
    },
  };
}

export function createInteraction(
  state: AicsMainFlowState,
  input: CreateInteractionInput,
  now = Date.now(),
): AicsMainFlowInteraction {
  const interaction: AicsMainFlowInteraction = {
    kind: "Interaction",
    id: makeId("interaction", input.id),
    status: "prepared",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    stage: input.stage,
    message: input.message,
    ...(input.proposedNextAction ? { proposedNextAction: input.proposedNextAction } : {}),
  };
  state.interactions.push(interaction);
  state.updatedAt = now;
  return interaction;
}

export function prepareObservation(
  state: AicsMainFlowState,
  input: PrepareObservationInput,
  now = Date.now(),
): ObservationPackage {
  const observation: ObservationPackage = {
    kind: "ObservationPackage",
    id: makeId("obs_pkg", input.id),
    status: "prepared",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    title: input.title,
    summary: input.summary,
    signals: input.signals ? [...input.signals] : [],
  };
  state.observations.push(observation);
  state.updatedAt = now;
  return observation;
}

export function prepareAttribution(
  state: AicsMainFlowState,
  input: PrepareAttributionInput,
  now = Date.now(),
): AttributionReport {
  requireGate(state, "missing_observation_package");
  const observationPackageId =
    input.observationPackageId ?? latestByCreatedAt(state.observations)?.id;
  if (
    !observationPackageId ||
    !state.observations.some((item) => item.id === observationPackageId)
  ) {
    throw new AicsMainFlowGateError({
      stage: "observation",
      code: "missing_observation_package",
      message: "ObservationPackage is required before attribution.",
    });
  }
  const attribution: AttributionReport = {
    kind: "AttributionReport",
    id: makeId("attr_report", input.id),
    status: "prepared",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    observationPackageId,
    title: input.title,
    summary: input.summary,
    findings: input.findings ? [...input.findings] : [],
  };
  state.attributions.push(attribution);
  state.updatedAt = now;
  return attribution;
}

export function createGoalCandidate(
  state: AicsMainFlowState,
  input: CreateGoalCandidateInput,
  now = Date.now(),
): CompanyGoal {
  requireGate(state, "missing_attribution_report");
  const attributionReportId =
    input.attributionReportId ?? latestByCreatedAt(state.attributions)?.id;
  if (!attributionReportId || !state.attributions.some((item) => item.id === attributionReportId)) {
    throw new AicsMainFlowGateError({
      stage: "attribution",
      code: "missing_attribution_report",
      message: "AttributionReport is required before creating goal rationale.",
    });
  }
  const goal: CompanyGoal = {
    kind: "CompanyGoal",
    id: makeId("goal", input.id),
    status: "candidate",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    attributionReportId,
    title: input.title,
    owner: input.owner,
    metric: input.metric,
    target: input.target,
    rationale: input.rationale,
  };
  state.goals.push(goal);
  state.updatedAt = now;
  return goal;
}

export function confirmGoal(
  state: AicsMainFlowState,
  goalId: string,
  now = Date.now(),
): CompanyGoal {
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal) {
    throw new AicsMainFlowGateError({
      stage: "goal",
      code: "missing_confirmed_company_goal",
      message: "CompanyGoal must exist before it can be confirmed.",
    });
  }
  goal.status = "confirmed";
  goal.updatedAt = now;
  state.updatedAt = now;
  return goal;
}

export function preparePlanning(
  state: AicsMainFlowState,
  input: PreparePlanningInput,
  now = Date.now(),
): PlanningPackage {
  requireGate(state, "missing_confirmed_company_goal");
  const goalId = input.goalId ?? latestConfirmed(state.goals)?.id;
  if (!goalId || !state.goals.some((item) => item.id === goalId && item.status === "confirmed")) {
    throw new AicsMainFlowGateError({
      stage: "goal",
      code: "missing_confirmed_company_goal",
      message: "A user-confirmed CompanyGoal is required before planning.",
    });
  }
  const planningPackageId = makeId("planning_pkg", input.id);
  const rolePlanItems: RolePlanItem[] = input.rolePlanItems.map((item) => ({
    kind: "RolePlanItem",
    id: makeId("role_plan_item", item.id),
    status: "prepared",
    ...timestamps(now),
    auditRefs: auditRefs(item),
    planningPackageId,
    title: item.title,
    roleCapabilityRef: item.roleCapabilityRef,
    taskIntent: item.taskIntent,
    expectedOutput: item.expectedOutput,
    humanConfirmationRequired: item.humanConfirmationRequired ?? true,
  }));
  const planning: PlanningPackage = {
    kind: "PlanningPackage",
    id: planningPackageId,
    status: "prepared",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    goalId,
    title: input.title,
    summary: input.summary,
    rolePlanItemIds: rolePlanItems.map((item) => item.id),
  };
  state.planningPackages.push(planning);
  state.rolePlanItems.push(...rolePlanItems);
  state.updatedAt = now;
  return planning;
}

export function confirmPlanning(
  state: AicsMainFlowState,
  planningPackageId: string,
  now = Date.now(),
): PlanningPackage {
  const planning = state.planningPackages.find((item) => item.id === planningPackageId);
  if (!planning || planning.rolePlanItemIds.length === 0) {
    throw new AicsMainFlowGateError({
      stage: "planning",
      code: "missing_confirmed_planning_package",
      message: "PlanningPackage with RolePlanItem entries must exist before dispatch.",
    });
  }
  planning.status = "confirmed";
  planning.updatedAt = now;
  for (const item of state.rolePlanItems) {
    if (planning.rolePlanItemIds.includes(item.id)) {
      item.status = "confirmed";
      item.updatedAt = now;
    }
  }
  state.updatedAt = now;
  return planning;
}

export function createDispatchProposal(
  state: AicsMainFlowState,
  input: CreateDispatchProposalInput,
  now = Date.now(),
): DispatchProposalReview {
  requireGate(state, "missing_confirmed_planning_package");
  const planningPackageId = input.planningPackageId ?? latestConfirmed(state.planningPackages)?.id;
  const planning = state.planningPackages.find(
    (item) => item.id === planningPackageId && item.status === "confirmed",
  );
  const rolePlanItemId = input.rolePlanItemId ?? planning?.rolePlanItemIds[0];
  if (!planning || !rolePlanItemId || !planning.rolePlanItemIds.includes(rolePlanItemId)) {
    throw new AicsMainFlowGateError({
      stage: "planning",
      code: "missing_confirmed_planning_package",
      message: "A confirmed PlanningPackage with RolePlanItem entries is required before dispatch.",
    });
  }
  const proposal: DispatchProposalReview = {
    kind: "DispatchProposalReview",
    id: makeId("dispatch_review", input.id),
    status: "prepared",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    planningPackageId: planning.id,
    rolePlanItemId,
    title: input.title,
    riskSummary: input.riskSummary,
    confirmationSummary: input.confirmationSummary,
  };
  state.dispatchProposalReviews.push(proposal);
  state.updatedAt = now;
  return proposal;
}

export function confirmDispatch(
  state: AicsMainFlowState,
  dispatchProposalReviewId: string,
  now = Date.now(),
): DispatchProposalReview {
  const proposal = state.dispatchProposalReviews.find(
    (item) => item.id === dispatchProposalReviewId,
  );
  if (!proposal) {
    throw new AicsMainFlowGateError({
      stage: "dispatch",
      code: "missing_confirmed_dispatch_proposal",
      message: "DispatchProposalReview must exist before it can be confirmed.",
    });
  }
  proposal.status = "confirmed";
  proposal.updatedAt = now;
  state.updatedAt = now;
  return proposal;
}

export function materializeTaskPackage(
  state: AicsMainFlowState,
  input: MaterializeTaskPackageInput,
  now = Date.now(),
): { taskPackage: TaskPackage; dispatchToRoleRequest: DispatchToRoleRequest } {
  requireGate(state, "missing_confirmed_dispatch_proposal");
  const dispatchProposalReviewId =
    input.dispatchProposalReviewId ?? latestConfirmed(state.dispatchProposalReviews)?.id;
  const proposal = state.dispatchProposalReviews.find(
    (item) => item.id === dispatchProposalReviewId && item.status === "confirmed",
  );
  if (!proposal) {
    throw new AicsMainFlowGateError({
      stage: "dispatch",
      code: "missing_confirmed_dispatch_proposal",
      message:
        "A confirmed DispatchProposalReview is required before materializing a task package.",
    });
  }
  const planning = state.planningPackages.find((item) => item.id === proposal.planningPackageId);
  if (!planning) {
    throw new AicsMainFlowGateError({
      stage: "planning",
      code: "missing_confirmed_planning_package",
      message: "PlanningPackage is required before materializing a task package.",
    });
  }
  const taskPackage: TaskPackage = {
    kind: "TaskPackage",
    id: makeId("task_pkg", input.id),
    status: "materialized",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    goalId: planning.goalId,
    planningPackageId: planning.id,
    rolePlanItemId: proposal.rolePlanItemId,
    dispatchProposalReviewId: proposal.id,
    title: input.title,
    taskText: input.taskText,
  };
  const dispatchToRoleRequest: DispatchToRoleRequest = {
    kind: "DispatchToRoleRequest",
    id: makeId("dispatch_role_req", input.request?.id),
    status: "ready",
    ...timestamps(now),
    auditRefs: auditRefs(input.request),
    taskPackageId: taskPackage.id,
    rolePlanItemId: proposal.rolePlanItemId,
    ...(input.request?.roleListingId ? { roleListingId: input.request.roleListingId } : {}),
    ...(input.request?.roleTitle ? { roleTitle: input.request.roleTitle } : {}),
    ...(input.request?.workspaceDir ? { workspaceDir: input.request.workspaceDir } : {}),
    confirmExecution: true,
  };
  state.taskPackages.push(taskPackage);
  state.dispatchToRoleRequests.push(dispatchToRoleRequest);
  state.updatedAt = now;
  return { taskPackage, dispatchToRoleRequest };
}

export function runApprovedTask(
  state: AicsMainFlowState,
  input: RunApprovedTaskInput,
  now = Date.now(),
): { dispatchToRoleRequest: DispatchToRoleRequest; roleResult: RoleResult | null } {
  requireGate(state, "missing_task_package");
  requireGate(state, "missing_dispatch_to_role_request");
  const taskPackageId = input.taskPackageId ?? latestByCreatedAt(state.taskPackages)?.id;
  const dispatchToRoleRequestId =
    input.dispatchToRoleRequestId ?? latestByCreatedAt(state.dispatchToRoleRequests)?.id;
  const taskPackage = state.taskPackages.find((item) => item.id === taskPackageId);
  const request = state.dispatchToRoleRequests.find(
    (item) => item.id === dispatchToRoleRequestId && item.taskPackageId === taskPackageId,
  );
  if (!taskPackage) {
    throw new AicsMainFlowGateError({
      stage: "role",
      code: "missing_task_package",
      message: "TaskPackage is required before role execution.",
    });
  }
  if (!request) {
    throw new AicsMainFlowGateError({
      stage: "role",
      code: "missing_dispatch_to_role_request",
      message: "DispatchToRoleRequest is required before role execution.",
    });
  }
  request.status = input.result ? "completed" : "running";
  request.updatedAt = now;
  taskPackage.status = input.result ? "completed" : "running";
  taskPackage.updatedAt = now;
  const roleResult: RoleResult | null = input.result
    ? {
        kind: "RoleResult" as const,
        id: makeId("role_result", input.result.id),
        status: input.result.outcome === "succeeded" ? "completed" : input.result.outcome,
        ...timestamps(now),
        auditRefs: auditRefs(input.result),
        taskPackageId: taskPackage.id,
        dispatchToRoleRequestId: request.id,
        outcome: input.result.outcome,
        summary: input.result.summary,
        artifactRefs: input.result.artifactRefs ? [...input.result.artifactRefs] : [],
      }
    : null;
  if (roleResult) {
    state.roleResults.push(roleResult);
  }
  state.updatedAt = now;
  return { dispatchToRoleRequest: request, roleResult };
}

function loadStateFromPath(storePath: string): AicsMainFlowState {
  if (!fs.existsSync(storePath)) {
    return createEmptyAicsMainFlowState();
  }
  const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as AicsMainFlowState;
  if (parsed.version !== AICS_MAIN_FLOW_VERSION) {
    return createEmptyAicsMainFlowState();
  }
  return parsed;
}

function saveStateToPath(storePath: string, state: AicsMainFlowState): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  fs.renameSync(tempPath, storePath);
}

export class AicsMainFlowStore {
  readonly storePath: string;

  constructor(storePath = resolveAicsMainFlowStorePath()) {
    this.storePath = storePath;
  }

  load(): AicsMainFlowState {
    return loadStateFromPath(this.storePath);
  }

  save(state: AicsMainFlowState): void {
    saveStateToPath(this.storePath, state);
  }

  readModel(): AicsMainFlowReadModel {
    return createAicsMainFlowReadModel(this.load());
  }

  update<T>(mutate: (state: AicsMainFlowState) => T): T {
    const state = cloneState(this.load());
    const result = mutate(state);
    this.save(state);
    return result;
  }
}
