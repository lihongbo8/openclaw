import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  MemoryCandidateStore,
  MemoryConfirmService,
  FormalMemoryStore,
} from "../../aics-main-flow/memory-system.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = stringParam(params, key);
  if (!value) throw new Error(`missing required string param: ${key}`);
  return value;
}

function stringArrayParam(params: Record<string, unknown>, key: string): string[] {
  const value = params[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function respondError(respond: RespondFn, error: unknown): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)),
  );
}

export const aicsMemoryHandlers: GatewayRequestHandlers = {
  "aics.memory.candidates.list": ({ params, respond }) => {
    try {
      const limit = typeof params.limit === "number" ? params.limit : 50;
      const candidates = MemoryCandidateStore.listPending(limit);
      respond(true, { candidates });
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.memory.candidates.confirm": ({ params, respond }) => {
    try {
      const candidateId = requireString(params, "candidateId");
      const confirmedBy = stringParam(params, "confirmedBy") ?? "gateway-user";
      const result = MemoryConfirmService.confirmAndPromote(candidateId, confirmedBy);
      if ("error" in result) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
        return;
      }
      respond(true, { candidate: result.candidate, memory: result.memory });
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.memory.candidates.reject": ({ params, respond }) => {
    try {
      const candidateId = requireString(params, "candidateId");
      const reason = stringParam(params, "reason") ?? "rejected via Gateway";
      const result = MemoryCandidateStore.reject(candidateId, reason);
      if (!result) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Candidate not found: ${candidateId}`),
        );
        return;
      }
      respond(true, { candidateId, status: "rejected" });
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.memory.formal.search": ({ params, respond }) => {
    try {
      const query = stringParam(params, "query");
      const tags = stringArrayParam(params, "tags");
      const limit = typeof params.limit === "number" ? params.limit : 20;
      const memories = tags.length
        ? FormalMemoryStore.listByTags(tags, limit)
        : query
          ? FormalMemoryStore.search(query, limit)
          : FormalMemoryStore.listByScope("global", undefined, limit);
      respond(true, { memories });
    } catch (error) {
      respondError(respond, error);
    }
  },
};
