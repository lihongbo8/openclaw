import { randomUUID } from "node:crypto";
import { SKILL_CATALOG, type SkillEntry } from "./skill-catalog.js";
import { ToolExecutionDb, type ToolExecutionRecord } from "./tool-execution-db.js";
import {
  executeToolCall,
  ToolRegistry,
  type ToolCapabilityGroup,
  type ToolExecutionResponse,
  type ToolRiskLevel,
} from "./tool-registry.js";

// ======================================================================
// ToolSkillExecutionEngine
// ======================================================================
//
// 职责：
// 1. 将岗位工作流里的 Skill 调用解析为工具 capability。
// 2. 按调度层允许的 Skill/Tool 做执行前门禁。
// 3. 调用 ToolExecutionEngine。
// 4. 将工具执行结果写入 ToolExecutionDb。
//
// 不负责：
// - 创建岗位或调度任务。
// - 绕过人工确认执行高风险工具。
// - 写正式记忆或修改主流程状态。

export type ToolSkillExecutionRequest = {
  requestId?: string;
  roleRunRef: string;
  workflowStepRef: string;
  skillId?: string;
  capability?: ToolCapabilityGroup;
  input: Record<string, unknown>;
  expectedOutput: string;
  allowedSkillIds?: string[];
  allowedToolRefs?: string[];
  requireAllowedSkillMatch?: boolean;
  requireAllowedToolMatch?: boolean;
  riskLevel?: ToolRiskLevel;
  humanConfirmPolicy?: "auto" | "required" | "never";
  qualityRequirement?: string;
  deadlineMs?: number;
};

export type ToolSkillExecutionResult = {
  ok: boolean;
  requestId: string;
  skill?: Pick<SkillEntry, "skillId" | "label" | "capability">;
  response: ToolExecutionResponse;
  record?: ToolExecutionRecord;
};

export type ToolSkillExecutionEngine = {
  execute(request: ToolSkillExecutionRequest): Promise<ToolSkillExecutionResult>;
};

export function createToolSkillExecutionEngine(): ToolSkillExecutionEngine {
  return {
    async execute(request) {
      const requestId = request.requestId ?? randomUUID();
      const resolved = resolveSkillCapability(request);
      if (!resolved.ok) {
        return blockedResult(requestId, resolved.reason);
      }

      const skill = resolved.skill;
      const capability = resolved.capability;
      const skillGate = checkSkillAllowed(
        skill,
        request.allowedSkillIds,
        request.requireAllowedSkillMatch,
      );
      if (skillGate) {
        return blockedResult(requestId, skillGate, skill);
      }

      const candidateToolRefs = resolveAllowedToolRefs(
        capability,
        request.allowedToolRefs,
        request.requireAllowedToolMatch,
      );
      if (candidateToolRefs.status === "blocked") {
        return blockedResult(requestId, candidateToolRefs.reason, skill);
      }

      const startedAt = Date.now();
      const response = await executeToolCall({
        requestId,
        roleRunRef: request.roleRunRef,
        workflowStepRef: request.workflowStepRef,
        toolCapability: capability,
        ...(candidateToolRefs.refs.length ? { candidateToolRefs: candidateToolRefs.refs } : {}),
        input: request.input,
        expectedOutput: request.expectedOutput,
        riskLevel: request.riskLevel ?? "low",
        humanConfirmPolicy: request.humanConfirmPolicy ?? "auto",
        qualityRequirement:
          request.qualityRequirement ??
          skill?.qualityHints.join("；") ??
          "工具执行结果必须可验收。",
        deadlineMs: request.deadlineMs,
      });
      const durationMs = Math.max(0, Date.now() - startedAt);

      const record = ToolExecutionDb.record({
        requestId,
        roleRunRef: request.roleRunRef,
        workflowStepRef: request.workflowStepRef,
        toolRef: response.selectedToolRef,
        toolCapability: capability,
        inputSummary: summarizeInput(request.input),
        response,
        durationMs,
      });

      return {
        ok: !response.blockedReason && !response.needHumanConfirm,
        requestId,
        ...(skill ? { skill: pickSkill(skill) } : {}),
        response,
        record,
      };
    },
  };
}

function resolveSkillCapability(
  request: ToolSkillExecutionRequest,
):
  | { ok: true; skill?: SkillEntry; capability: ToolCapabilityGroup }
  | { ok: false; reason: string } {
  if (request.skillId) {
    const skill = SKILL_CATALOG[request.skillId];
    if (!skill) return { ok: false, reason: `未知 Skill: ${request.skillId}` };
    return { ok: true, skill, capability: skill.capability };
  }
  if (request.capability) return { ok: true, capability: request.capability };
  return { ok: false, reason: "缺少 skillId 或 capability，无法执行工具/Skill。" };
}

function checkSkillAllowed(
  skill: SkillEntry | undefined,
  allowedSkillIds?: string[],
  requireAllowedSkillMatch = false,
): string | null {
  if (!skill) {
    return requireAllowedSkillMatch ? "缺少 Skill 声明，无法通过本次调度允许列表。" : null;
  }
  if (!allowedSkillIds?.length) {
    return requireAllowedSkillMatch ? `Skill "${skill.skillId}" 未在本次调度允许列表中。` : null;
  }
  if (allowedSkillIds.includes(skill.skillId)) return null;
  return `Skill "${skill.skillId}" 未在本次调度允许列表中。`;
}

function resolveAllowedToolRefs(
  capability: ToolCapabilityGroup,
  allowedToolRefs?: string[],
  requireAllowedToolMatch = false,
): { status: "ready"; refs: string[] } | { status: "blocked"; reason: string } {
  if (!allowedToolRefs?.length) {
    return requireAllowedToolMatch
      ? {
          status: "blocked",
          reason: `capability "${capability}" 没有匹配本次调度允许的工具。`,
        }
      : { status: "ready", refs: [] };
  }

  const allowed = new Set(allowedToolRefs);
  const matching = ToolRegistry.findByCapability(capability).filter(
    (tool) => allowed.has(tool.toolId) || allowed.has(tool.name),
  );
  if (!matching.length) {
    return {
      status: "blocked",
      reason: `capability "${capability}" 没有匹配本次调度允许的工具。`,
    };
  }
  return { status: "ready", refs: matching.map((tool) => tool.toolId) };
}

function blockedResult(
  requestId: string,
  reason: string,
  skill?: SkillEntry,
): ToolSkillExecutionResult {
  return {
    ok: false,
    requestId,
    ...(skill ? { skill: pickSkill(skill) } : {}),
    response: {
      requestId,
      selectedToolRef: "blocked",
      artifactRefs: [],
      structuredOutput: {},
      executionSummary: reason,
      costSummary: { inputTokens: 0, outputTokens: 0, costCents: 0 },
      riskFlags: ["tool_skill_gate_blocked"],
      blockedReason: reason,
      needHumanConfirm: false,
      qualityCheckSummary: "blocked",
    },
  };
}

function pickSkill(skill: SkillEntry): Pick<SkillEntry, "skillId" | "label" | "capability"> {
  return {
    skillId: skill.skillId,
    label: skill.label,
    capability: skill.capability,
  };
}

function summarizeInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input).slice(0, 200);
  } catch {
    return "[unserializable input]";
  }
}
