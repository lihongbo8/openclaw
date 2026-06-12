import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  AicsMainFlowStore,
  confirmDispatch,
  confirmGoal,
  confirmPlanning,
  createDispatchProposal,
  createGoalCandidate,
  createInteraction,
  materializeTaskPackage,
  prepareAttribution,
  prepareObservation,
  preparePlanning,
  runApprovedTask,
  type CreateDispatchProposalInput,
  type CreateGoalCandidateInput,
  type CreateInteractionInput,
  type MaterializeTaskPackageInput,
  type PrepareAttributionInput,
  type PrepareObservationInput,
  type PreparePlanningInput,
  type RunApprovedTaskInput,
} from "../../aics-main-flow/store.js";
import { AicsMainFlowGateError } from "../../aics-main-flow/types.js";
import type { AicsMainFlowStage } from "../../aics-main-flow/types.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  return typeof value === "boolean" ? value : undefined;
}

function objectParam(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = params[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayParam(params: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = params[key];
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object"),
      )
    : [];
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = stringParam(params, key);
  if (!value) {
    throw new Error(`missing required string param: ${key}`);
  }
  return value;
}

function toInteractionInput(params: Record<string, unknown>): CreateInteractionInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    stage: (stringParam(params, "stage") ?? "observation") as AicsMainFlowStage,
    message: requireString(params, "message"),
    ...(stringParam(params, "proposedNextAction")
      ? { proposedNextAction: stringParam(params, "proposedNextAction") }
      : {}),
  };
}

function toObservationInput(params: Record<string, unknown>): PrepareObservationInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    title: requireString(params, "title"),
    summary: requireString(params, "summary"),
    signals: arrayParam(params, "signals").map((signal, index) => ({
      id: stringParam(signal, "id") ?? `signal_${index + 1}`,
      title: stringParam(signal, "title") ?? "未命名观察信号",
      summary: stringParam(signal, "summary") ?? "",
      evidenceRefs: Array.isArray(signal.evidenceRefs)
        ? signal.evidenceRefs.filter((item): item is string => typeof item === "string")
        : [],
    })),
  };
}

function toAttributionInput(params: Record<string, unknown>): PrepareAttributionInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "observationPackageId")
      ? { observationPackageId: stringParam(params, "observationPackageId") }
      : {}),
    title: requireString(params, "title"),
    summary: requireString(params, "summary"),
    findings: arrayParam(params, "findings").map((finding, index) => ({
      id: stringParam(finding, "id") ?? `finding_${index + 1}`,
      title: stringParam(finding, "title") ?? "未命名归因发现",
      summary: stringParam(finding, "summary") ?? "",
      confidence:
        stringParam(finding, "confidence") === "low" ||
        stringParam(finding, "confidence") === "high"
          ? (stringParam(finding, "confidence") as "low" | "high")
          : "medium",
      observationSignalIds: Array.isArray(finding.observationSignalIds)
        ? finding.observationSignalIds.filter((item): item is string => typeof item === "string")
        : [],
    })),
  };
}

function toGoalInput(params: Record<string, unknown>): CreateGoalCandidateInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "attributionReportId")
      ? { attributionReportId: stringParam(params, "attributionReportId") }
      : {}),
    title: requireString(params, "title"),
    owner: requireString(params, "owner"),
    metric: requireString(params, "metric"),
    target: requireString(params, "target"),
    rationale: requireString(params, "rationale"),
  };
}

function toPlanningInput(params: Record<string, unknown>): PreparePlanningInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "goalId") ? { goalId: stringParam(params, "goalId") } : {}),
    title: requireString(params, "title"),
    summary: requireString(params, "summary"),
    rolePlanItems: arrayParam(params, "rolePlanItems").map((item) => ({
      ...(stringParam(item, "id") ? { id: stringParam(item, "id") } : {}),
      title: stringParam(item, "title") ?? "未命名岗位规划项",
      roleCapabilityRef: stringParam(item, "roleCapabilityRef") ?? "unassigned",
      taskIntent: stringParam(item, "taskIntent") ?? "",
      expectedOutput: stringParam(item, "expectedOutput") ?? "",
      humanConfirmationRequired: booleanParam(item, "humanConfirmationRequired") ?? true,
    })),
  };
}

function toDispatchProposalInput(params: Record<string, unknown>): CreateDispatchProposalInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "planningPackageId")
      ? { planningPackageId: stringParam(params, "planningPackageId") }
      : {}),
    ...(stringParam(params, "rolePlanItemId")
      ? { rolePlanItemId: stringParam(params, "rolePlanItemId") }
      : {}),
    title: requireString(params, "title"),
    riskSummary: requireString(params, "riskSummary"),
    confirmationSummary: requireString(params, "confirmationSummary"),
  };
}

function toTaskPackageInput(params: Record<string, unknown>): MaterializeTaskPackageInput {
  const request = objectParam(params, "request");
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "dispatchProposalReviewId")
      ? { dispatchProposalReviewId: stringParam(params, "dispatchProposalReviewId") }
      : {}),
    title: requireString(params, "title"),
    taskText: requireString(params, "taskText"),
    request: {
      ...(stringParam(request, "id") ? { id: stringParam(request, "id") } : {}),
      ...(stringParam(request, "roleListingId")
        ? { roleListingId: stringParam(request, "roleListingId") }
        : {}),
      ...(stringParam(request, "roleTitle")
        ? { roleTitle: stringParam(request, "roleTitle") }
        : {}),
      ...(stringParam(request, "workspaceDir")
        ? { workspaceDir: stringParam(request, "workspaceDir") }
        : {}),
    },
  };
}

function toRunApprovedTaskInput(params: Record<string, unknown>): RunApprovedTaskInput {
  const result = objectParam(params, "result");
  const outcome = stringParam(result, "outcome");
  return {
    ...(stringParam(params, "taskPackageId")
      ? { taskPackageId: stringParam(params, "taskPackageId") }
      : {}),
    ...(stringParam(params, "dispatchToRoleRequestId")
      ? { dispatchToRoleRequestId: stringParam(params, "dispatchToRoleRequestId") }
      : {}),
    ...(outcome === "succeeded" || outcome === "failed" || outcome === "blocked"
      ? {
          result: {
            ...(stringParam(result, "id") ? { id: stringParam(result, "id") } : {}),
            outcome,
            summary: stringParam(result, "summary") ?? "",
            artifactRefs: Array.isArray(result.artifactRefs)
              ? result.artifactRefs.filter((item): item is string => typeof item === "string")
              : [],
          },
        }
      : {}),
  };
}

function respondError(respond: RespondFn, error: unknown): void {
  if (error instanceof AicsMainFlowGateError) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, error.message, {
        details: {
          code: error.code,
          stage: error.stage,
        },
      }),
    );
    return;
  }
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)),
  );
}

export const aicsMainFlowHandlers: GatewayRequestHandlers = {
  "aics.mainFlow.readModel.get": ({ respond }) => {
    try {
      respond(true, new AicsMainFlowStore().readModel());
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.interaction.create": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        createInteraction(state, toInteractionInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.observation.prepare": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        prepareObservation(state, toObservationInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.attribution.prepare": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        prepareAttribution(state, toAttributionInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.goal.candidate.create": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        createGoalCandidate(state, toGoalInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.goal.confirm": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        confirmGoal(state, requireString(params, "goalId")),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.planning.prepare": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        preparePlanning(state, toPlanningInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.planning.confirm": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        confirmPlanning(state, requireString(params, "planningPackageId")),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.dispatch.proposal.create": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        createDispatchProposal(state, toDispatchProposalInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.dispatch.confirm": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        confirmDispatch(state, requireString(params, "dispatchProposalReviewId")),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.dispatch.materializeTaskPackage": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        materializeTaskPackage(state, toTaskPackageInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.dispatch.runApprovedTask": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        runApprovedTask(state, toRunApprovedTaskInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
};
