import { getCategoryTemplate, SKILL_CATALOG, type SkillEntry } from "./skill-catalog.js";
import { ToolRegistry, type ToolRiskLevel } from "./tool-registry.js";
import {
  createToolSkillExecutionEngine,
  type ToolSkillExecutionResult,
} from "./tool-skill-execution-engine.js";

// ======================================================================
// CategoryCapabilityExecutionEngine: 品类能力执行引擎
// ======================================================================
//
// 职责：
// 1. 将品类模板中的 Skill 组合成一个品类能力包。
// 2. 为每个 Skill 匹配当前可用工具。
// 3. 执行时按品类能力包逐步调用 Tool/Skill Execution Engine。
//
// 不负责：
// - 岗位开发、岗位包生成或上架。
// - 岗位任务调度、账本或正式审计写入。
// - 绕过 allowedSkills / allowedTools / human confirm 门禁。

export type CategoryCapabilityComponentStatus =
  | "ready"
  | "skill_not_allowed"
  | "missing_tool"
  | "tool_not_allowed";

export type CategoryCapabilityReadiness = "ready" | "partial" | "blocked";

export type CategoryCapabilityComponent = {
  skillId: string;
  skillLabel: string;
  capability: string;
  toolRefs: string[];
  status: CategoryCapabilityComponentStatus;
  reason?: string;
};

export type CategoryCapabilityBundle = {
  categoryId: string;
  label: string;
  description: string;
  readiness: CategoryCapabilityReadiness;
  components: CategoryCapabilityComponent[];
  blockedReasons: string[];
};

export type ComposeCategoryCapabilityRequest = {
  categoryId: string;
  skillIds?: string[];
  allowedSkillIds?: string[];
  allowedToolRefs?: string[];
};

export type CategoryCapabilityExecutionRequest = ComposeCategoryCapabilityRequest & {
  requestId?: string;
  roleRunRef: string;
  workflowStepRef: string;
  input: Record<string, unknown>;
  inputBySkillId?: Record<string, Record<string, unknown>>;
  expectedOutput?: string;
  requireAllowedSkillMatch?: boolean;
  requireAllowedToolMatch?: boolean;
  riskLevel?: ToolRiskLevel;
  humanConfirmPolicy?: "auto" | "required" | "never";
  deadlineMs?: number;
};

export type CategoryCapabilitySkillExecutionRequest = {
  requestId?: string;
  categoryId?: string;
  roleRunRef: string;
  workflowStepRef: string;
  skillId: string;
  input: Record<string, unknown>;
  expectedOutput: string;
  allowedSkillIds?: string[];
  allowedToolRefs?: string[];
  requireAllowedSkillMatch?: boolean;
  requireAllowedToolMatch?: boolean;
  riskLevel?: ToolRiskLevel;
  humanConfirmPolicy?: "auto" | "required" | "never";
  deadlineMs?: number;
};

export type CategoryCapabilityExecutionStatus =
  | "succeeded"
  | "blocked"
  | "needs_human_confirm"
  | "failed";

export type CategoryCapabilityExecutionStep = {
  skillId: string;
  capability: string;
  ok: boolean;
  result: ToolSkillExecutionResult;
};

export type CategoryCapabilityExecutionResult = {
  requestId: string;
  categoryId: string;
  status: CategoryCapabilityExecutionStatus;
  bundle: CategoryCapabilityBundle;
  steps: CategoryCapabilityExecutionStep[];
  artifactRefs: string[];
  structuredOutputBySkillId: Record<string, Record<string, unknown>>;
  blockedReason?: string;
};

export type CategoryCapabilityExecutionEngine = {
  compose(request: ComposeCategoryCapabilityRequest): CategoryCapabilityBundle;
  execute(request: CategoryCapabilityExecutionRequest): Promise<CategoryCapabilityExecutionResult>;
  executeSkill(
    request: CategoryCapabilitySkillExecutionRequest,
  ): Promise<CategoryCapabilityExecutionStep>;
};

export function createCategoryCapabilityExecutionEngine(): CategoryCapabilityExecutionEngine {
  return {
    compose: composeCategoryCapability,

    async executeSkill(request) {
      return executeCategoryCapabilitySkill(request);
    },

    async execute(request) {
      const requestId = request.requestId ?? `category:${request.categoryId}:${Date.now()}`;
      const bundle = composeCategoryCapability(request);
      if (bundle.readiness !== "ready") {
        return {
          requestId,
          categoryId: request.categoryId,
          status: "blocked",
          bundle,
          steps: [],
          artifactRefs: [],
          structuredOutputBySkillId: {},
          blockedReason: bundle.blockedReasons.join("；") || "品类能力未就绪。",
        };
      }

      const steps: CategoryCapabilityExecutionStep[] = [];
      const artifactRefs: string[] = [];
      const structuredOutputBySkillId: Record<string, Record<string, unknown>> = {};

      for (const [index, component] of bundle.components.entries()) {
        const step = await executeCategoryCapabilitySkill({
          roleRunRef: request.roleRunRef,
          workflowStepRef: `${request.workflowStepRef}:${index + 1}:${component.skillId}`,
          skillId: component.skillId,
          input: request.inputBySkillId?.[component.skillId] ?? request.input,
          expectedOutput: request.expectedOutput ?? component.skillLabel,
          allowedSkillIds: request.allowedSkillIds,
          allowedToolRefs: request.allowedToolRefs,
          requireAllowedSkillMatch: request.requireAllowedSkillMatch,
          requireAllowedToolMatch: request.requireAllowedToolMatch,
          riskLevel: request.riskLevel,
          humanConfirmPolicy: request.humanConfirmPolicy,
          deadlineMs: request.deadlineMs,
        });
        const result = step.result;
        steps.push(step);
        artifactRefs.push(...result.response.artifactRefs);
        structuredOutputBySkillId[component.skillId] = result.response.structuredOutput;

        if (result.response.needHumanConfirm) {
          return {
            requestId,
            categoryId: request.categoryId,
            status: "needs_human_confirm",
            bundle,
            steps,
            artifactRefs,
            structuredOutputBySkillId,
            blockedReason: result.response.humanConfirmRequest ?? result.response.executionSummary,
          };
        }
        if (!result.ok) {
          return {
            requestId,
            categoryId: request.categoryId,
            status: result.response.blockedReason ? "blocked" : "failed",
            bundle,
            steps,
            artifactRefs,
            structuredOutputBySkillId,
            blockedReason: result.response.blockedReason ?? result.response.executionSummary,
          };
        }
      }

      return {
        requestId,
        categoryId: request.categoryId,
        status: "succeeded",
        bundle,
        steps,
        artifactRefs,
        structuredOutputBySkillId,
      };
    },
  };
}

async function executeCategoryCapabilitySkill(
  request: CategoryCapabilitySkillExecutionRequest,
): Promise<CategoryCapabilityExecutionStep> {
  const skill = SKILL_CATALOG[request.skillId];
  const engine = createToolSkillExecutionEngine();
  const result = await engine.execute({
    requestId: request.requestId,
    roleRunRef: request.roleRunRef,
    workflowStepRef: request.workflowStepRef,
    skillId: request.skillId,
    input: request.input,
    expectedOutput: request.expectedOutput,
    allowedSkillIds: request.allowedSkillIds,
    allowedToolRefs: request.allowedToolRefs,
    requireAllowedSkillMatch: request.requireAllowedSkillMatch,
    requireAllowedToolMatch: request.requireAllowedToolMatch,
    riskLevel: request.riskLevel,
    humanConfirmPolicy: request.humanConfirmPolicy,
    deadlineMs: request.deadlineMs,
  });
  return {
    skillId: request.skillId,
    capability: skill?.capability ?? "unknown",
    ok: result.ok,
    result,
  };
}

export function composeCategoryCapability(
  request: ComposeCategoryCapabilityRequest,
): CategoryCapabilityBundle {
  const template = getCategoryTemplate(request.categoryId);
  if (!template) {
    return {
      categoryId: request.categoryId,
      label: request.categoryId,
      description: "",
      readiness: "blocked",
      components: [],
      blockedReasons: [`未知品类模板：${request.categoryId}`],
    };
  }

  const skills = selectSkills(template.skills, request.skillIds);
  const components = skills.map((skill) => componentForSkill(skill, request));
  const blockedReasons = components
    .filter((component) => component.status !== "ready")
    .map((component) => component.reason ?? `${component.skillId} 未就绪`);

  return {
    categoryId: template.categoryId,
    label: template.label,
    description: template.description,
    readiness: readinessFor(components),
    components,
    blockedReasons,
  };
}

function selectSkills(skills: SkillEntry[], skillIds?: string[]): SkillEntry[] {
  if (!skillIds?.length) return skills;
  const selected = new Set(skillIds);
  return skills.filter((skill) => selected.has(skill.skillId));
}

function componentForSkill(
  skill: SkillEntry,
  request: ComposeCategoryCapabilityRequest,
): CategoryCapabilityComponent {
  if (request.allowedSkillIds?.length && !request.allowedSkillIds.includes(skill.skillId)) {
    return {
      skillId: skill.skillId,
      skillLabel: skill.label,
      capability: skill.capability,
      toolRefs: [],
      status: "skill_not_allowed",
      reason: `Skill "${skill.skillId}" 未在本次品类能力允许列表中。`,
    };
  }

  const allMatchingTools = ToolRegistry.findByCapability(skill.capability);
  if (!allMatchingTools.length) {
    return {
      skillId: skill.skillId,
      skillLabel: skill.label,
      capability: skill.capability,
      toolRefs: [],
      status: "missing_tool",
      reason: `Skill "${skill.skillId}" 缺少 capability "${skill.capability}" 的可用工具。`,
    };
  }

  const matchingTools = request.allowedToolRefs?.length
    ? allMatchingTools.filter(
        (tool) =>
          request.allowedToolRefs!.includes(tool.toolId) ||
          request.allowedToolRefs!.includes(tool.name),
      )
    : allMatchingTools;

  if (!matchingTools.length) {
    return {
      skillId: skill.skillId,
      skillLabel: skill.label,
      capability: skill.capability,
      toolRefs: [],
      status: "tool_not_allowed",
      reason: `Skill "${skill.skillId}" 没有匹配本次品类能力允许的工具。`,
    };
  }

  return {
    skillId: skill.skillId,
    skillLabel: skill.label,
    capability: skill.capability,
    toolRefs: matchingTools.map((tool) => tool.toolId),
    status: "ready",
  };
}

function readinessFor(components: CategoryCapabilityComponent[]): CategoryCapabilityReadiness {
  if (!components.length) return "blocked";
  if (components.every((component) => component.status === "ready")) return "ready";
  if (components.some((component) => component.status === "ready")) return "partial";
  return "blocked";
}
