import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import {
  FormalMemoryStore,
  MemoryCandidateStore,
  type MemoryCandidateRecord,
  type MemorySource,
  type MemoryType,
} from "./memory-system.js";
import type {
  RoleExecutionContext,
  RoleExecutionOutcome,
  RoleExecutionPlan,
  RoleResult,
  RoleExecutor,
  LoadedRolePackage,
  BusinessContext,
  OutputContract,
  RolePackageManifest,
  WorkPattern,
} from "./role-execution-types.js";
import {
  createToolSkillExecutionEngine,
  type ToolSkillExecutionEngine,
} from "./tool-skill-execution-engine.js";
import type { RoleResultExecutionEvidence, TaskPackage } from "./types.js";

// ======================================================================
// RoleExecutionEngine: 岗位执行引擎
// ======================================================================
//
// 职责：
// 1. 从文件系统加载岗位包（manifest.json + listing + workflows + SOP + skills + templates）
// 2. 构建执行上下文（workspace, 模型配置, 工具池）
// 3. 通过抽象执行器执行任务
// 4. 分步记录执行过程
// 5. 生成结构化的 RoleResult
//
// 不负责：
// - 调度任务（由 Dispatcher 负责）
// - 修改 TaskPackage.status（由调度层负责）
// - 工具的具体实现（由工具层负责）
// - 正式记忆写入（只生成 memory_candidate）

export type RoleExecutionEngine = {
  /** 准备执行上下文：加载岗位包，创建工作区 */
  prepare(
    taskPackage: TaskPackage,
    options?: {
      workspaceRoot?: string;
      modelRef?: string;
      availableTools?: string[];
      allowedSkills?: string[];
      toolSkillEngine?: ToolSkillExecutionEngine;
      preflightSnapshot?: Partial<
        NonNullable<RoleResult["executionEvidence"]["preflightSnapshot"]>
      >;
      timeoutMs?: number;
      maxOutputChars?: number;
    },
  ): RoleExecutionContext;

  /** 执行并返回结果 */
  execute(context: RoleExecutionContext, executor: RoleExecutor): Promise<RoleResult>;
};

// ======================================================================
// 工厂函数
// ======================================================================

export function createRoleExecutionEngine(): RoleExecutionEngine {
  return {
    prepare(taskPackage, options = {}) {
      const {
        workspaceRoot = path.join(process.env.HOME ?? "/tmp", ".dijie-runtime/executions"),
        modelRef = "deepseek/deepseek-v4-pro",
        availableTools = [],
        allowedSkills = [],
        toolSkillEngine = createToolSkillExecutionEngine(),
        preflightSnapshot,
        timeoutMs = 300_000,
        maxOutputChars = 256_000,
      } = options;

      const executionId = randomUUID();
      const workspaceDir = path.join(workspaceRoot, executionId);
      mkdirSync(workspaceDir, { recursive: true });

      // 尝试从默认位置加载岗位包
      const rolePackage = tryLoadRolePackage(taskPackage);
      const memoryContext = buildMemoryContext(taskPackage, rolePackage);
      const executionPlan = buildExecutionPlan({
        executionId,
        taskPackage,
        rolePackage,
      });

      return {
        executionId,
        taskPackage,
        rolePackage,
        workspaceDir,
        modelRef,
        availableTools,
        allowedSkills,
        toolSkillEngine,
        preflightSnapshot: buildPreflightSnapshot({
          taskPackage,
          availableTools,
          allowedSkills,
          snapshot: preflightSnapshot,
        }),
        timeoutMs,
        maxOutputChars,
        memoryContext,
        executionPlan,
      };
    },

    async execute(context, executor) {
      const startedAt = Date.now();

      const preflightFailures = evaluatePreflightGate(context);
      if (preflightFailures.length > 0) {
        return buildPreflightBlockedResult(context, startedAt, preflightFailures);
      }

      if (context.executionPlan.workPatterns.includes("operate")) {
        return buildOperateBlockedResult(context, startedAt);
      }

      let executorResult: Awaited<ReturnType<RoleExecutor["execute"]>>;
      try {
        // 注入执行上下文到工作区
        await prepareWorkspace(context);

        // 执行
        executorResult = await executor.execute(context);
      } catch (error) {
        return buildExecutorFailedResult(context, startedAt, error);
      }
      const executorEvidence = executorResult.executionEvidence ?? {};

      const completedAt = Date.now();
      const durationMs = completedAt - startedAt;

      // 生成结果
      const executorOutcome = resolveOutcome(executorResult.outcome, durationMs, context.timeoutMs);
      const memoryCandidateRegistration = registerMemoryCandidates(
        context,
        executorEvidence.memoryCandidates,
      );
      const externalRecordRefs = normalizeStringRefs(executorEvidence.externalRecordRefs);
      const artifactRefs = uniqueItems([
        ...collectArtifacts(context.workspaceDir),
        ...externalRecordRefs,
      ]);
      const executorOutputContracts = normalizeOutputContracts(executorEvidence.outputContracts);
      const effectiveOutputContracts = executorOutputContracts.length
        ? executorOutputContracts
        : context.executionPlan.outputContracts;
      const outputValidation =
        executorOutcome === "succeeded"
          ? await validateOutputContracts(effectiveOutputContracts, artifactRefs)
          : {
              passed: true,
              checkedContracts: effectiveOutputContracts,
              failures: [],
            };
      const effectiveValidation =
        memoryCandidateRegistration.failures.length > 0
          ? {
              ...outputValidation,
              passed: false,
              failures: uniqueItems([
                ...outputValidation.failures,
                ...memoryCandidateRegistration.failures,
              ]),
            }
          : outputValidation;
      const validationBlocked =
        executorOutcome === "succeeded" && effectiveValidation.failures.length > 0;
      const outcome: RoleExecutionOutcome = validationBlocked ? "blocked" : executorOutcome;
      const blockedReason = validationBlocked
        ? `岗位执行产物验收未通过：${effectiveValidation.failures.join("；")}`
        : executorResult.error;
      const summary: string = validationBlocked
        ? (blockedReason ?? "")
        : (executorResult.output ?? "");

      const result: RoleResult = {
        executionId: context.executionId,
        taskPackageId: context.taskPackage.id,
        roleListingId:
          context.taskPackage.requiredCapabilityRefs?.[0] ?? context.taskPackage.rolePlanItemId,
        roleTitle: context.rolePackage.manifest.title,
        outcome,
        summary: summary.slice(0, context.maxOutputChars),
        artifactRefs,
        steps: executorResult.steps,
        modelUsage: executorResult.modelUsage,
        toolUsage: executorResult.toolUsage,
        executionEvidence: {
          executionId: context.executionId,
          workPatterns: context.executionPlan.workPatterns,
          outputContracts: effectiveOutputContracts,
          ...inferenceEvidence(context.executionPlan),
          businessCategory: context.executionPlan.businessCategory,
          ...(context.executionPlan.businessContext
            ? { businessContext: context.executionPlan.businessContext }
            : {}),
          executionPlan: context.executionPlan,
          preflightSnapshot: context.preflightSnapshot,
          memoryContext: context.memoryContext,
          steps: executorResult.steps.map((step) => ({
            stepIndex: step.stepIndex,
            stepName: step.stepName,
            status: step.status,
            inputSummary: step.inputSummary,
            ...(step.outputSummary ? { outputSummary: step.outputSummary } : {}),
            toolCalls: step.toolCalls.map((toolCall) => ({
              toolName: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              inputSummary: toolCall.inputSummary,
              ...(toolCall.outputSummary ? { outputSummary: toolCall.outputSummary } : {}),
              durationMs: toolCall.durationMs,
              status: toolCall.status,
              ...(toolCall.error ? { error: toolCall.error } : {}),
            })),
          })),
          toolUsage: executorResult.toolUsage,
          modelUsage: executorResult.modelUsage,
          ...omitExecutorOnlyEvidence(executorEvidence),
          ...(memoryCandidateRegistration.records.length
            ? { memoryCandidates: memoryCandidateRegistration.records }
            : {}),
          validation: mergeValidationEvidence(executorEvidence.validation, effectiveValidation),
          ...(outcome === "succeeded"
            ? {}
            : { recoverySuggestion: recoverySuggestionFor(outcome, blockedReason) }),
        },
        blockedReason,
        startedAt,
        completedAt,
        durationMs,
      };

      return result;
    },
  };
}

// ======================================================================
// 岗位包加载
// ======================================================================

function tryLoadRolePackage(taskPackage: TaskPackage): LoadedRolePackage {
  // 默认搜索路径
  const searchPaths = [
    // 从 TaskPackage 的 rolePlanItemId 推断路径
    path.join(process.env.HOME ?? "/tmp", "dijie-role-packages", taskPackage.rolePlanItemId),
    // 固定路径
    path.join(
      process.env.HOME ?? "/tmp",
      ".dijie-runtime/role-packages",
      taskPackage.rolePlanItemId,
    ),
  ];

  for (const pkgDir of searchPaths) {
    if (existsSync(pkgDir)) {
      return loadFromPath(pkgDir);
    }
  }

  // 返回默认包（无岗位包时的兜底）
  return createFallbackPackage(taskPackage);
}

function loadFromPath(pkgDir: string): LoadedRolePackage {
  const manifestPath = path.join(pkgDir, "manifest.json");
  const listingPath = path.join(pkgDir, "listing.md");
  const sopPath = path.join(pkgDir, "SOP.md");
  const skillsPath = path.join(pkgDir, "skills.md");
  const knowledgePath = path.join(pkgDir, "knowledge.md");
  const templatesPath = path.join(pkgDir, "templates.md");
  const validationPath = path.join(pkgDir, "validation.md");

  const manifest: RolePackageManifest = existsSync(manifestPath)
    ? tryParseJson(readFileSync(manifestPath, "utf-8"))
    : {
        roleId: "",
        title: path.basename(pkgDir),
        description: "",
        version: "0",
        requiredCapabilities: [],
        workflows: [],
        skills: [],
        knowledgeFiles: [],
        templateFiles: [],
        sopFiles: [],
      };

  return {
    manifest,
    listing: safeRead(listingPath),
    sopContent: safeRead(sopPath),
    skillsContent: safeRead(skillsPath),
    knowledgeContent: safeRead(knowledgePath),
    templatesContent: safeRead(templatesPath),
    validationRules: safeRead(validationPath),
    packageDir: pkgDir,
  };
}

function createFallbackPackage(taskPackage: TaskPackage): LoadedRolePackage {
  return {
    manifest: {
      roleId: taskPackage.rolePlanItemId,
      title: taskPackage.title,
      description: taskPackage.taskText,
      version: "0",
      requiredCapabilities: [],
      workflows: [],
      skills: [],
      knowledgeFiles: [],
      templateFiles: [],
      sopFiles: [],
    },
    listing: "",
    sopContent: "",
    skillsContent: "",
    knowledgeContent: "",
    templatesContent: "",
    validationRules: "",
    packageDir: "",
  };
}

// ======================================================================
// 工作区准备
// ======================================================================

async function prepareWorkspace(context: RoleExecutionContext): Promise<void> {
  // 将岗位包内容写入工作区，executor 可以读取
  const wsDir = context.workspaceDir;

  if (context.rolePackage.packageDir) {
    // 有真实岗位包时，在工作区创建一个 README
    const readme = [
      `# 岗位执行工作区`,
      `执行ID: ${context.executionId}`,
      `岗位: ${context.rolePackage.manifest.title}`,
      `能力需求: ${context.rolePackage.manifest.requiredCapabilities.join(", ") || "无"}`,
      `可用工具: ${context.availableTools.join(", ") || "无"}`,
      `授权 Skill: ${context.allowedSkills.join(", ") || "无"}`,
      `能力调用: 真实工具/Skill 必须通过 ToolSkillExecutionEngine，不能绕过授权出口。`,
      ``,
      `## 任务`,
      context.taskPackage.taskText,
      ``,
      `## 已确认记忆`,
      formatMemoryContext(context.memoryContext),
      ``,
      `## SOP`,
      context.rolePackage.sopContent || "（无标准操作流程）",
      ``,
      `## 技能`,
      context.rolePackage.skillsContent || "（无技能说明）",
      ``,
      `## 知识`,
      context.rolePackage.knowledgeContent || "（无知识库内容）",
      ``,
      `## 模板`,
      context.rolePackage.templatesContent || "（无模板）",
      ``,
      `## 验证规则`,
      context.rolePackage.validationRules || "（无验证规则）",
    ].join("\n");

    const readmePath = path.join(wsDir, "ROLE_TASK.md");
    const fs = await import("node:fs/promises");
    await fs.writeFile(readmePath, readme, "utf-8");
  }
}

function evaluatePreflightGate(context: RoleExecutionContext): string[] {
  const snapshot = context.preflightSnapshot;
  const failures: string[] = [];

  if (!snapshot.taskDispatched) failures.push("任务尚未由调度层正式派发");
  if (!snapshot.roleAuthorized) failures.push("岗位尚未授权或缺少岗位权益");
  if (!snapshot.humanConfirmed) failures.push("本次执行尚未人工确认");
  if (!snapshot.costConfirmed) failures.push("本次费用尚未确认");
  if (!snapshot.ledgerRefPresent) failures.push("缺少本次执行费用凭证");
  if (!snapshot.toolSkillReady) failures.push("工具与 Skill 尚未就绪");
  if (!snapshot.apiBindingReady) failures.push("API 绑定尚未就绪");

  const requiredSkills = requiredItemsFromPlan(context, "requiredSkills");
  const missingSkills = requiredSkills.filter((skill) => !snapshot.allowedSkills.includes(skill));
  if (missingSkills.length) failures.push(`缺少授权 Skill：${missingSkills.join(", ")}`);

  const requiredTools = requiredItemsFromPlan(context, "requiredTools");
  const missingTools = requiredTools.filter((tool) => !snapshot.allowedTools.includes(tool));
  if (missingTools.length) failures.push(`缺少授权工具：${missingTools.join(", ")}`);

  return failures;
}

function requiredItemsFromPlan(
  context: RoleExecutionContext,
  field: "requiredSkills" | "requiredTools",
): string[] {
  return uniqueItems(context.executionPlan.steps.flatMap((step) => step[field] ?? []));
}

function buildPreflightBlockedResult(
  context: RoleExecutionContext,
  startedAt: number,
  failures: string[],
): RoleResult {
  const completedAt = Date.now();
  const reason = `执行前检查未通过：${failures.join("；")}`;
  const step = {
    stepIndex: 0,
    stepName: "preflight_gate",
    status: "failed" as const,
    startedAt,
    completedAt,
    inputSummary: "检查派发、授权、人工确认、费用、工具/Skill 和 API 状态",
    outputSummary: reason,
    toolCalls: [],
    error: reason,
  };
  return {
    executionId: context.executionId,
    taskPackageId: context.taskPackage.id,
    roleListingId:
      context.taskPackage.requiredCapabilityRefs?.[0] ?? context.taskPackage.rolePlanItemId,
    roleTitle: context.rolePackage.manifest.title,
    outcome: "blocked",
    summary: reason,
    artifactRefs: [],
    steps: [step],
    modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
    toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
    executionEvidence: {
      executionId: context.executionId,
      workPatterns: context.executionPlan.workPatterns,
      outputContracts: context.executionPlan.outputContracts,
      ...inferenceEvidence(context.executionPlan),
      businessCategory: context.executionPlan.businessCategory,
      ...(context.executionPlan.businessContext
        ? { businessContext: context.executionPlan.businessContext }
        : {}),
      executionPlan: context.executionPlan,
      preflightSnapshot: context.preflightSnapshot,
      memoryContext: context.memoryContext,
      steps: [
        {
          stepIndex: step.stepIndex,
          stepName: step.stepName,
          status: step.status,
          inputSummary: step.inputSummary,
          outputSummary: step.outputSummary,
          toolCalls: [],
        },
      ],
      toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
      modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
      validation: {
        passed: false,
        checkedContracts: context.executionPlan.outputContracts,
        failures,
      },
      recoverySuggestion: recoverySuggestionFor("blocked", reason),
    },
    blockedReason: reason,
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
  };
}

function buildOperateBlockedResult(context: RoleExecutionContext, startedAt: number): RoleResult {
  const completedAt = Date.now();
  const reason =
    "operate 执行方式首版只支持门禁和人工确认框架，暂不自动执行外部写入、发布、删除、付款或投流。请先走人工确认和专用外部操作流程。";
  const step = {
    stepIndex: 1,
    stepName: "operate_preflight_gate",
    status: "failed" as const,
    startedAt,
    completedAt,
    inputSummary: "检查 operate 外部操作执行方式",
    outputSummary: reason,
    toolCalls: [],
    error: reason,
  };
  return {
    executionId: context.executionId,
    taskPackageId: context.taskPackage.id,
    roleListingId:
      context.taskPackage.requiredCapabilityRefs?.[0] ?? context.taskPackage.rolePlanItemId,
    roleTitle: context.rolePackage.manifest.title,
    outcome: "blocked",
    summary: reason,
    artifactRefs: [],
    steps: [step],
    modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
    toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
    executionEvidence: {
      executionId: context.executionId,
      workPatterns: context.executionPlan.workPatterns,
      outputContracts: context.executionPlan.outputContracts,
      ...inferenceEvidence(context.executionPlan),
      businessCategory: context.executionPlan.businessCategory,
      ...(context.executionPlan.businessContext
        ? { businessContext: context.executionPlan.businessContext }
        : {}),
      executionPlan: context.executionPlan,
      preflightSnapshot: context.preflightSnapshot,
      memoryContext: context.memoryContext,
      steps: [
        {
          stepIndex: step.stepIndex,
          stepName: step.stepName,
          status: step.status,
          inputSummary: step.inputSummary,
          outputSummary: step.outputSummary,
          toolCalls: [],
        },
      ],
      toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
      modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
      validation: {
        passed: false,
        checkedContracts: context.executionPlan.outputContracts,
        failures: [reason],
      },
      recoverySuggestion:
        "外部写入、发布、删除、付款和投流必须人工确认。请回到岗位执行页确认风险，或让系统开发者接入专用 operate 执行流程。",
    },
    blockedReason: reason,
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
  };
}

function buildExecutorFailedResult(
  context: RoleExecutionContext,
  startedAt: number,
  error: unknown,
): RoleResult {
  const completedAt = Date.now();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const reason = `岗位执行器异常：${errorMessage || "未知错误"}`;
  const artifactRefs = collectArtifacts(context.workspaceDir);
  const step = {
    stepIndex: 1,
    stepName: "workflow_runner",
    status: "failed" as const,
    startedAt,
    completedAt,
    inputSummary: "运行岗位执行器",
    outputSummary: reason,
    toolCalls: [],
    error: reason,
  };
  return {
    executionId: context.executionId,
    taskPackageId: context.taskPackage.id,
    roleListingId:
      context.taskPackage.requiredCapabilityRefs?.[0] ?? context.taskPackage.rolePlanItemId,
    roleTitle: context.rolePackage.manifest.title,
    outcome: "failed",
    summary: reason.slice(0, context.maxOutputChars),
    artifactRefs,
    steps: [step],
    modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
    toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
    executionEvidence: {
      executionId: context.executionId,
      workPatterns: context.executionPlan.workPatterns,
      outputContracts: context.executionPlan.outputContracts,
      ...inferenceEvidence(context.executionPlan),
      businessCategory: context.executionPlan.businessCategory,
      ...(context.executionPlan.businessContext
        ? { businessContext: context.executionPlan.businessContext }
        : {}),
      executionPlan: context.executionPlan,
      preflightSnapshot: context.preflightSnapshot,
      memoryContext: context.memoryContext,
      steps: [
        {
          stepIndex: step.stepIndex,
          stepName: step.stepName,
          status: step.status,
          inputSummary: step.inputSummary,
          outputSummary: step.outputSummary,
          toolCalls: [],
        },
      ],
      toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
      modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
      validation: {
        passed: false,
        checkedContracts: context.executionPlan.outputContracts,
        failures: [reason],
      },
      recoverySuggestion: recoverySuggestionFor("failed", reason),
    },
    blockedReason: reason,
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
  };
}

function inferenceEvidence(
  executionPlan: RoleExecutionPlan,
): Pick<RoleResultExecutionEvidence, "inferredWorkPattern" | "inferredOutputContract"> {
  return {
    ...(executionPlan.inferredWorkPattern ? { inferredWorkPattern: true } : {}),
    ...(executionPlan.inferredOutputContract ? { inferredOutputContract: true } : {}),
  };
}

function buildMemoryContext(
  taskPackage: TaskPackage,
  rolePackage: LoadedRolePackage,
): RoleExecutionContext["memoryContext"] {
  const requiredCapabilityRefs = taskPackage.requiredCapabilityRefs ?? [];
  const query = [
    taskPackage.title,
    taskPackage.taskText,
    taskPackage.category,
    rolePackage.manifest.title,
    ...requiredCapabilityRefs,
  ]
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .join("\n");

  try {
    const formalById = new Map<string, RoleExecutionContext["memoryContext"]["formal"][number]>();
    const textQueries = [
      taskPackage.title,
      taskPackage.taskText,
      rolePackage.manifest.title,
    ].filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    for (const textQuery of textQueries) {
      for (const memory of FormalMemoryStore.search(textQuery, 5)) {
        formalById.set(memory.memoryId, {
          memoryId: memory.memoryId,
          type: memory.type,
          title: memory.title,
          content: memory.content,
          source: memory.source,
          confidence: memory.confidence,
          tags: memory.tags,
          scope: memory.scope,
          scopeRef: memory.scopeRef,
          version: memory.version,
        });
      }
    }
    const tagQueries = [taskPackage.category, ...requiredCapabilityRefs].filter(
      (item): item is string => typeof item === "string" && Boolean(item.trim()),
    );
    if (tagQueries.length) {
      for (const memory of FormalMemoryStore.listByTags(tagQueries, 5)) {
        formalById.set(memory.memoryId, {
          memoryId: memory.memoryId,
          type: memory.type,
          title: memory.title,
          content: memory.content,
          source: memory.source,
          confidence: memory.confidence,
          tags: memory.tags,
          scope: memory.scope,
          scopeRef: memory.scopeRef,
          version: memory.version,
        });
      }
    }
    const formal = [...formalById.values()].slice(0, 5);
    return { query, generatedAt: Date.now(), formal };
  } catch (error) {
    return {
      query,
      generatedAt: Date.now(),
      formal: [],
      recallError: error instanceof Error ? error.message : String(error),
    };
  }
}

type MemoryCandidateEvidence = NonNullable<RoleResultExecutionEvidence["memoryCandidates"]>[number];

function registerMemoryCandidates(
  context: RoleExecutionContext,
  candidates: unknown,
): { records: MemoryCandidateEvidence[]; failures: string[] } {
  if (typeof candidates === "undefined") return { records: [], failures: [] };
  if (!Array.isArray(candidates)) {
    return {
      records: [],
      failures: ["候选记忆格式无效：memoryCandidates 必须是数组"],
    };
  }

  const records: MemoryCandidateEvidence[] = [];
  const failures: string[] = [];

  candidates.forEach((candidate, index) => {
    const normalized = normalizeMemoryCandidateProposal(context, candidate);
    if ("error" in normalized) {
      failures.push(`候选记忆 #${index + 1} 无效：${normalized.error}`);
      return;
    }

    try {
      const record = MemoryCandidateStore.propose(normalized.input);
      records.push(memoryCandidateRecordToEvidence(record));
    } catch (error) {
      failures.push(
        `候选记忆 #${index + 1} 写入失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  return { records, failures };
}

function normalizeMemoryCandidateProposal(
  context: RoleExecutionContext,
  candidate: unknown,
): { input: Parameters<typeof MemoryCandidateStore.propose>[0] } | { error: string } {
  if (!isRecord(candidate)) return { error: "必须是对象" };

  const type = parseMemoryType(candidate.type);
  if (!type) return { error: "type 必须是 role_experience、tool_experience 或 quality_feedback" };

  const title = stringValue(candidate.title, 160);
  if (!title) return { error: "title 不能为空" };

  const content = stringValue(candidate.content, 4_000);
  if (!content) return { error: "content 不能为空" };

  return {
    input: {
      type,
      title,
      content,
      source: normalizeMemorySource(context, candidate.source),
      confidence: parseConfidence(candidate.confidence) ?? "medium",
      tags: normalizeTags(candidate.tags),
      requiresHumanConfirm: true,
      proposedBy: stringValue(candidate.proposedBy, 120) || "role-execution-engine",
    },
  };
}

function memoryCandidateRecordToEvidence(record: MemoryCandidateRecord): MemoryCandidateEvidence {
  return {
    candidateId: record.candidateId,
    type: record.type,
    title: record.title,
    content: record.content,
    source: record.source,
    confidence: record.confidence,
    tags: record.tags,
    requiresHumanConfirm: record.requiresHumanConfirm,
    proposedBy: record.proposedBy,
    proposedAt: record.proposedAt,
    status: record.status,
  };
}

function normalizeMemorySource(context: RoleExecutionContext, source: unknown): MemorySource {
  if (!isRecord(source)) {
    return {
      layer: "role",
      entityId: context.executionId,
      entityType: "role_execution",
    };
  }
  return {
    layer: parseMemorySourceLayer(source.layer) ?? "role",
    entityId: stringValue(source.entityId, 160) || context.executionId,
    entityType: stringValue(source.entityType, 120) || "role_execution",
  };
}

function parseMemoryType(value: unknown): MemoryType | undefined {
  return value === "role_experience" || value === "tool_experience" || value === "quality_feedback"
    ? value
    : undefined;
}

function parseMemorySourceLayer(value: unknown): MemorySource["layer"] | undefined {
  return value === "role" || value === "tool" || value === "planning" || value === "dispatch"
    ? value
    : undefined;
}

function parseConfidence(value: unknown): "low" | "medium" | "high" | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueItems(
    value.map((item) => stringValue(item, 80)).filter((item): item is string => Boolean(item)),
  ).slice(0, 12);
}

function stringValue(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function omitExecutorOnlyEvidence(
  evidence: Partial<RoleResultExecutionEvidence>,
): Partial<RoleResultExecutionEvidence> {
  const { memoryCandidates: _memoryCandidates, ...rest } = evidence;
  return rest;
}

function buildPreflightSnapshot(params: {
  taskPackage: TaskPackage;
  availableTools: string[];
  allowedSkills: string[];
  snapshot?: Partial<NonNullable<RoleResult["executionEvidence"]["preflightSnapshot"]>>;
}): NonNullable<RoleResult["executionEvidence"]["preflightSnapshot"]> {
  const { taskPackage, availableTools, allowedSkills, snapshot } = params;
  return {
    checkedAt: snapshot?.checkedAt ?? Date.now(),
    taskDispatched:
      snapshot?.taskDispatched ??
      ["materialized", "ready", "running", "completed"].includes(taskPackage.status),
    roleAuthorized: snapshot?.roleAuthorized ?? false,
    humanConfirmed: snapshot?.humanConfirmed ?? false,
    costConfirmed: snapshot?.costConfirmed ?? false,
    toolSkillReady:
      snapshot?.toolSkillReady ?? (availableTools.length > 0 && allowedSkills.length > 0),
    apiBindingReady: snapshot?.apiBindingReady ?? false,
    ledgerRefPresent: snapshot?.ledgerRefPresent ?? false,
    allowedTools: snapshot?.allowedTools ?? availableTools,
    allowedSkills: snapshot?.allowedSkills ?? allowedSkills,
    taskPackageId: snapshot?.taskPackageId ?? taskPackage.id,
    ...(snapshot?.dispatchToRoleRequestId
      ? { dispatchToRoleRequestId: snapshot.dispatchToRoleRequestId }
      : {}),
    ...(snapshot?.roleListingId ? { roleListingId: snapshot.roleListingId } : {}),
    ...(snapshot?.entitlementId ? { entitlementId: snapshot.entitlementId } : {}),
  };
}

function buildExecutionPlan(params: {
  executionId: string;
  taskPackage: TaskPackage;
  rolePackage: LoadedRolePackage;
}): RoleExecutionPlan {
  const { executionId, taskPackage, rolePackage } = params;
  const workPatternResolution = resolveWorkPatterns(taskPackage, rolePackage.manifest);
  const outputContractResolution = resolveOutputContracts(taskPackage, rolePackage.manifest);
  const businessCategory =
    rolePackage.manifest.businessCategory ??
    rolePackage.manifest.businessContext?.businessCategory ??
    taskPackage.category;
  const validationRules = deriveValidationRules(
    rolePackage.validationRules,
    outputContractResolution.outputContracts,
    rolePackage.manifest.businessContext,
  );
  return {
    executionId,
    workPatterns: workPatternResolution.workPatterns,
    outputContracts: outputContractResolution.outputContracts,
    ...(businessCategory ? { businessCategory } : {}),
    ...(rolePackage.manifest.businessContext
      ? { businessContext: rolePackage.manifest.businessContext }
      : {}),
    currentState: `收到已派发任务 "${taskPackage.title}"，尚未生成业务产物。`,
    targetState: `交付 ${outputContractResolution.outputContracts.join(", ")} 类型的可验收业务产物。`,
    gap: "当前只有任务说明、岗位包和授权上下文，需要按执行方式调用已授权 Skill/Tool 并完成产物验收。",
    executionChoice: `按 ${workPatternResolution.workPatterns.join(" + ")} 执行，不按品类分支执行。`,
    steps: buildPlanSteps(
      workPatternResolution.workPatterns,
      outputContractResolution.outputContracts,
      rolePackage.manifest,
      validationRules,
    ),
    validationRules,
    riskCheckpoints: buildRiskCheckpoints(
      workPatternResolution.workPatterns,
      rolePackage.manifest.businessContext,
    ),
    ...(workPatternResolution.inferred ? { inferredWorkPattern: true } : {}),
    ...(outputContractResolution.inferred ? { inferredOutputContract: true } : {}),
  };
}

function resolveWorkPatterns(
  taskPackage: TaskPackage,
  manifest: RolePackageManifest,
): { workPatterns: WorkPattern[]; inferred: boolean } {
  const declared = normalizeWorkPatterns(manifest.workPatterns);
  if (declared.length) return { workPatterns: declared, inferred: false };

  const text = searchableTaskText(taskPackage, manifest);
  const inferred: WorkPattern[] = [];
  if (/分析|诊断|复盘|总结|洞察|指标|数据|报告/iu.test(text)) inferred.push("analyze");
  if (/转换|转成|导出|格式|迁移|改写/iu.test(text)) inferred.push("transform");
  if (/发布|上传|创建工单|修改|删除|付款|投流|外部系统/iu.test(text)) inferred.push("operate");
  if (/生成|写|图片|海报|页面|详情页|文案|文档|PPT|合同|产物/iu.test(text)) {
    inferred.push("generate");
  }
  const unique = uniqueItems(inferred);
  if (unique.length > 1) unique.push("composite");
  return {
    workPatterns: unique.length ? uniqueItems(unique) : ["generate"],
    inferred: true,
  };
}

function resolveOutputContracts(
  taskPackage: TaskPackage,
  manifest: RolePackageManifest,
): { outputContracts: OutputContract[]; inferred: boolean } {
  const declared = normalizeOutputContracts(manifest.outputContracts);
  if (declared.length) return { outputContracts: declared, inferred: false };

  const text = searchableTaskText(taskPackage, manifest);
  const inferred: OutputContract[] = [];
  if (/图片|海报|视觉|image|png|jpg|jpeg/iu.test(text)) inferred.push("image");
  if (/页面|详情页|落地页|html|网站|网页/iu.test(text)) inferred.push("html");
  if (/报告|文档|合同|说明书|PDF|README|document/iu.test(text)) inferred.push("document");
  if (/表格|Excel|spreadsheet|csv|xlsx/iu.test(text)) inferred.push("spreadsheet");
  if (/json|schema|结构化|接口/iu.test(text)) inferred.push("json");
  if (/外部记录|回读|record|工单|发布记录/iu.test(text)) inferred.push("external_record");
  if (/打包|包|zip|下载|交付/iu.test(text)) inferred.push("package");
  const unique = uniqueItems(inferred);
  return {
    outputContracts: unique.length ? unique : ["document"],
    inferred: true,
  };
}

function buildPlanSteps(
  workPatterns: WorkPattern[],
  outputContracts: OutputContract[],
  manifest: RolePackageManifest,
  validationRules: string[],
): RoleExecutionPlan["steps"] {
  const steps: RoleExecutionPlan["steps"] = [
    {
      stepIndex: 1,
      stepName: "preflight_gate",
      workPattern: "composite",
      expectedOutput: "确认任务派发、授权、费用、Skill/Tool 和人工确认状态满足执行前置条件。",
      requiredSkills: manifest.requiredSkills,
      requiredTools: manifest.requiredTools,
      validationRules: ["缺授权、费用、API、工具或人工确认时必须阻塞"],
    },
  ];
  const concretePatterns = workPatterns.filter((pattern) => pattern !== "composite");
  const patterns = concretePatterns.length ? concretePatterns : workPatterns;
  for (const pattern of patterns) {
    steps.push({
      stepIndex: steps.length + 1,
      stepName: `${pattern}_workflow`,
      workPattern: pattern,
      expectedOutput: expectedOutputForPattern(pattern, outputContracts),
      requiredSkills: manifest.requiredSkills,
      requiredTools: manifest.requiredTools,
      validationRules,
      requiresHumanConfirm: pattern === "operate",
    });
  }
  steps.push({
    stepIndex: steps.length + 1,
    stepName: "output_validation",
    workPattern: "composite",
    expectedOutput: `按 ${outputContracts.join(", ")} 输出契约检查业务产物。`,
    validationRules,
  });
  if (outputContracts.includes("package")) {
    steps.push({
      stepIndex: steps.length + 1,
      stepName: "artifact_packaging",
      workPattern: "composite",
      expectedOutput: "生成可读回的产物清单和打包文件。",
      validationRules: ["清单、业务产物和打包文件必须同时存在且非空"],
    });
  }
  return steps;
}

function expectedOutputForPattern(
  workPattern: WorkPattern,
  outputContracts: OutputContract[],
): string {
  switch (workPattern) {
    case "analyze":
      return `从输入资料中提取结论，并输出 ${outputContracts.join(", ")}。`;
    case "transform":
      return `读取源材料并转换为 ${outputContracts.join(", ")}。`;
    case "operate":
      return "在人工确认后执行外部动作，并回读外部记录。";
    case "composite":
      return "串联多个执行方式并分别记录步骤与工具调用。";
    case "generate":
    default:
      return `从任务输入生成新的 ${outputContracts.join(", ")} 业务产物。`;
  }
}

function deriveValidationRules(
  validationRulesText: string,
  outputContracts: OutputContract[],
  businessContext?: BusinessContext,
): string[] {
  const packageRules = validationRulesText
    .split(/\r?\n/u)
    .map((line) => line.replace(/^[-*#\s\[\]x.]+/iu, "").trim())
    .filter(Boolean)
    .slice(0, 10);
  const contractRules = outputContracts.map((contract) => validationRuleForContract(contract));
  const businessRules = businessValidationRules(businessContext);
  return uniqueItems([...packageRules, ...contractRules, ...businessRules]);
}

function businessValidationRules(businessContext?: BusinessContext): string[] {
  if (!businessContext) return [];
  return [
    ...(businessContext.qualityStandards ?? []).map((rule) => `业务质量: ${rule}`),
    ...(businessContext.styleRules ?? []).map((rule) => `业务风格: ${rule}`),
    ...(businessContext.metricRules ?? []).map((rule) => `业务指标: ${rule}`),
  ]
    .map((rule) => rule.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function validationRuleForContract(outputContract: OutputContract): string {
  switch (outputContract) {
    case "image":
      return "image: 文件存在、非空、格式正确";
    case "html":
      return "html: 可打开、引用资源存在";
    case "document":
      return "document: 可读取、内容非空";
    case "spreadsheet":
      return "spreadsheet: 表结构和关键字段存在";
    case "json":
      return "json: schema valid";
    case "external_record":
      return "external_record: 有外部系统回读 id";
    case "package":
      return "package: manifest 和压缩包完整";
  }
}

function buildRiskCheckpoints(
  workPatterns: WorkPattern[],
  businessContext?: BusinessContext,
): string[] {
  const checkpoints = [
    "调度层是唯一任务来源",
    "执行层不能创建任务或修改正式记忆",
    "所有真实能力调用必须通过 Tool/Skill 执行引擎",
  ];
  if (workPatterns.includes("operate")) {
    checkpoints.push("外部写入、发布、删除、付款、投流必须人工确认");
  }
  for (const action of businessContext?.forbiddenActions ?? []) {
    const value = action.trim();
    if (value) checkpoints.push(`禁止动作: ${value}`);
  }
  return checkpoints;
}

function searchableTaskText(taskPackage: TaskPackage, manifest: RolePackageManifest): string {
  return [
    taskPackage.title,
    taskPackage.taskText,
    taskPackage.category,
    manifest.title,
    manifest.description,
    ...(taskPackage.requiredCapabilityRefs ?? []),
    ...(manifest.requiredCapabilities ?? []),
    ...(manifest.workflows ?? []),
  ]
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .join("\n");
}

function normalizeWorkPatterns(value: unknown): WorkPattern[] {
  return Array.isArray(value)
    ? uniqueItems(value.filter((item): item is WorkPattern => isWorkPattern(item)))
    : [];
}

function normalizeOutputContracts(value: unknown): OutputContract[] {
  return Array.isArray(value)
    ? uniqueItems(value.filter((item): item is OutputContract => isOutputContract(item)))
    : [];
}

function normalizeStringRefs(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueItems(
        value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())),
      )
    : [];
}

function isWorkPattern(value: unknown): value is WorkPattern {
  return (
    value === "generate" ||
    value === "analyze" ||
    value === "transform" ||
    value === "operate" ||
    value === "composite"
  );
}

function isOutputContract(value: unknown): value is OutputContract {
  return (
    value === "image" ||
    value === "html" ||
    value === "document" ||
    value === "spreadsheet" ||
    value === "json" ||
    value === "external_record" ||
    value === "package"
  );
}

function uniqueItems<T extends string>(items: T[]): T[] {
  return [...new Set(items)];
}

function formatMemoryContext(memoryContext: RoleExecutionContext["memoryContext"]): string {
  if (memoryContext.recallError) {
    return `（正式记忆召回失败：${memoryContext.recallError}）`;
  }
  if (memoryContext.formal.length === 0) {
    return "（无匹配正式记忆）";
  }
  return memoryContext.formal
    .map((memory, index) =>
      [
        `${index + 1}. ${memory.title}`,
        `   类型: ${memory.type}`,
        `   置信度: ${memory.confidence}`,
        `   标签: ${memory.tags.join(", ") || "无"}`,
        `   内容: ${memory.content}`,
      ].join("\n"),
    )
    .join("\n");
}

// ======================================================================
// Helpers
// ======================================================================

function safeRead(filePath: string): string {
  try {
    return existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  } catch {
    return "";
  }
}

function tryParseJson(text: string): RolePackageManifest {
  try {
    return JSON.parse(text) as RolePackageManifest;
  } catch {
    return {
      roleId: "",
      title: "",
      description: "",
      version: "0",
      requiredCapabilities: [],
      workflows: [],
      skills: [],
      knowledgeFiles: [],
      templateFiles: [],
      sopFiles: [],
    };
  }
}

function collectArtifacts(workspaceDir: string): string[] {
  const artifacts: string[] = [];
  if (!existsSync(workspaceDir)) return artifacts;

  try {
    for (const entry of readdirSync(workspaceDir, { recursive: true })) {
      const relativePath = entry.toString();
      if (isInternalWorkspaceArtifact(relativePath)) continue;
      const fullPath = path.join(workspaceDir, relativePath);
      if (
        relativePath.endsWith(".png") ||
        relativePath.endsWith(".jpg") ||
        relativePath.endsWith(".jpeg") ||
        relativePath.endsWith(".html") ||
        relativePath.endsWith(".htm") ||
        relativePath.endsWith(".md") ||
        relativePath.endsWith(".txt") ||
        relativePath.endsWith(".pdf") ||
        relativePath.endsWith(".docx") ||
        relativePath.endsWith(".csv") ||
        relativePath.endsWith(".tsv") ||
        relativePath.endsWith(".xlsx") ||
        relativePath.endsWith(".mp4") ||
        relativePath.endsWith(".json") ||
        relativePath.endsWith(".zip")
      ) {
        artifacts.push(fullPath);
      }
    }
  } catch {
    // workspace may not have artifacts
  }

  return artifacts;
}

function isInternalWorkspaceArtifact(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/gu, "/");
  const fileName = normalized.split("/").pop() ?? normalized;
  return (
    fileName === "ROLE_TASK.md" ||
    normalized.startsWith(".") ||
    normalized.includes("/.") ||
    normalized.startsWith("logs/") ||
    normalized.startsWith("tmp/")
  );
}

type OutputValidationEvidence = NonNullable<RoleResult["executionEvidence"]["validation"]>;

async function validateOutputContracts(
  outputContracts: OutputContract[],
  artifactRefs: string[],
): Promise<OutputValidationEvidence> {
  const failures = (
    await Promise.all(
      outputContracts.map((contract) => validateOutputContract(contract, artifactRefs)),
    )
  ).flat();
  return {
    passed: failures.length === 0,
    checkedContracts: outputContracts,
    failures,
  };
}

async function validateOutputContract(
  outputContract: OutputContract,
  artifactRefs: string[],
): Promise<string[]> {
  switch (outputContract) {
    case "image":
      return validateImageArtifacts(artifactRefs);
    case "html":
      return validateHtmlArtifacts(artifactRefs);
    case "document":
      return validateDocumentArtifacts(artifactRefs);
    case "spreadsheet":
      return await validateSpreadsheetArtifacts(artifactRefs);
    case "json":
      return validateJsonArtifacts(artifactRefs);
    case "external_record":
      return artifactRefs.some((ref) => /^(external_record|external|record):/iu.test(ref))
        ? []
        : ["缺少 external_record 产物：需要外部系统回读记录 id"];
    case "package":
      return await validatePackageArtifacts(artifactRefs);
  }
}

function mergeValidationEvidence(
  existing: RoleResult["executionEvidence"]["validation"] | undefined,
  outputValidation: OutputValidationEvidence,
): OutputValidationEvidence {
  return {
    passed: Boolean(existing?.passed !== false && outputValidation.passed),
    checkedContracts: uniqueItems([
      ...(existing?.checkedContracts ?? []),
      ...outputValidation.checkedContracts,
    ]),
    failures: uniqueItems([...(existing?.failures ?? []), ...outputValidation.failures]),
    ...(existing?.warnings?.length ? { warnings: existing.warnings } : {}),
  };
}

function validateDocumentArtifacts(artifactRefs: string[]): string[] {
  const documentRefs = artifactRefs.filter((ref) => /\.(md|txt|pdf|docx)$/iu.test(ref));
  if (!documentRefs.some(isNonEmptyFile)) {
    return ["缺少 document 产物：需要非空文档文件"];
  }

  const failures: string[] = [];
  let hasValidDocument = false;
  for (const ref of documentRefs.filter(isNonEmptyFile)) {
    if (/\.(md|txt)$/iu.test(ref)) {
      const failure = validateReadableTextDocument(ref);
      if (failure) {
        failures.push(failure);
      } else {
        hasValidDocument = true;
      }
      continue;
    }
    hasValidDocument = true;
  }

  return hasValidDocument
    ? uniqueItems(failures)
    : uniqueItems([...failures, "缺少 document 产物：需要包含可读正文的文档文件"]);
}

function validateReadableTextDocument(ref: string): string {
  try {
    const content = readFileSync(ref, "utf-8");
    const meaningfulText = content
      .replace(/```[\s\S]*?```/gu, " ")
      .replace(/[#>*_`~\-[\]()|!:]+/gu, " ")
      .replace(/\s+/gu, "");
    const readableChars = meaningfulText.match(/[\p{L}\p{N}]/gu) ?? [];
    return readableChars.length >= 8
      ? ""
      : `document 正文为空或不可验收：${path.basename(ref)} 需要可读正文`;
  } catch (error) {
    return `document 文档不可读取：${path.basename(ref)}（${
      error instanceof Error ? error.message : String(error)
    }）`;
  }
}

function validateImageArtifacts(artifactRefs: string[]): string[] {
  const imageRefs = artifactRefs.filter((ref) => /\.(png|jpe?g|webp|gif)$/iu.test(ref));
  if (!imageRefs.some(isNonEmptyFile)) return ["缺少 image 产物：需要非空图片文件"];

  const invalidRefs = imageRefs.filter(
    (ref) => isNonEmptyFile(ref) && !hasKnownImageSignature(ref),
  );
  return invalidRefs.length
    ? [
        `image 产物格式无效：${uniqueItems(invalidRefs.map((ref) => path.basename(ref))).join(", ")}`,
      ]
    : [];
}

function hasKnownImageSignature(ref: string): boolean {
  try {
    const bytes = readFileSync(ref);
    if (bytes.length < 4) return false;
    const isPng =
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const gifHeader = bytes.length >= 6 ? bytes.slice(0, 6).toString("ascii") : "";
    const isGif = gifHeader === "GIF87a" || gifHeader === "GIF89a";
    const isWebp =
      bytes.length >= 12 &&
      bytes.slice(0, 4).toString("ascii") === "RIFF" &&
      bytes.slice(8, 12).toString("ascii") === "WEBP";
    return Boolean(isPng || isJpeg || isGif || isWebp);
  } catch {
    return false;
  }
}

async function validateSpreadsheetArtifacts(artifactRefs: string[]): Promise<string[]> {
  const spreadsheetRefs = artifactRefs.filter((ref) => /\.(csv|tsv|xlsx)$/iu.test(ref));
  if (!spreadsheetRefs.some(isNonEmptyFile)) {
    return ["缺少 spreadsheet 产物：需要非空表格文件"];
  }

  const failures: string[] = [];
  for (const ref of spreadsheetRefs.filter(isNonEmptyFile)) {
    if (/\.(csv|tsv)$/iu.test(ref)) {
      const delimiter = /\.tsv$/iu.test(ref) ? "\t" : ",";
      const validation = validateDelimitedTable(ref, delimiter);
      if (validation) failures.push(validation);
      continue;
    }
    if (/\.xlsx$/iu.test(ref)) {
      const validation = await validateXlsxWorkbook(ref);
      if (validation) failures.push(validation);
    }
  }
  return uniqueItems(failures);
}

function validateDelimitedTable(ref: string, delimiter: string): string {
  try {
    const rows = readFileSync(ref, "utf-8")
      .split(/\r?\n/u)
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => row.split(delimiter).map((cell) => cell.trim()));
    const header = rows[0] ?? [];
    const dataRows = rows.slice(1);
    const hasHeader = header.length >= 2 && header.every(Boolean);
    const hasDataRow = dataRows.some((row) => row.length >= header.length && row.some(Boolean));
    return hasHeader && hasDataRow
      ? ""
      : `spreadsheet 表结构无效：${path.basename(ref)} 需要至少 2 个表头字段和 1 行数据`;
  } catch (error) {
    return `spreadsheet 表格不可读取：${path.basename(ref)}（${
      error instanceof Error ? error.message : String(error)
    }）`;
  }
}

async function validateXlsxWorkbook(ref: string): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(readFileSync(ref));
    const names = Object.keys(zip.files);
    const hasWorkbook = names.includes("xl/workbook.xml");
    const hasWorksheet = names.some((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name));
    return hasWorkbook && hasWorksheet
      ? ""
      : `spreadsheet xlsx 结构无效：${path.basename(ref)} 缺少 workbook 或 worksheet`;
  } catch (error) {
    return `spreadsheet xlsx 不可读取：${path.basename(ref)}（${
      error instanceof Error ? error.message : String(error)
    }）`;
  }
}

async function validatePackageArtifacts(artifactRefs: string[]): Promise<string[]> {
  const zipRefs = artifactRefs.filter((ref) => /\.zip$/iu.test(ref) && isNonEmptyFile(ref));
  const manifestRefs = artifactRefs.filter(
    (ref) => /(^|[/\\])artifact-manifest\.json$/iu.test(ref) && isNonEmptyFile(ref),
  );
  const failures: string[] = [];

  if (!zipRefs.length) failures.push("缺少 package 产物：需要非空 ZIP 文件");
  if (!manifestRefs.length) failures.push("缺少 package 产物：需要 artifact-manifest.json");
  if (failures.length) return failures;

  const manifestRef = manifestRefs[0]!;
  const manifest = parseArtifactManifest(manifestRef);
  if ("error" in manifest) return [manifest.error];

  if (!manifest.artifactNames.length) {
    failures.push("package 产物清单为空：artifact-manifest.json 必须列出业务产物");
  }

  for (const zipRef of zipRefs) {
    try {
      const zip = await JSZip.loadAsync(readFileSync(zipRef));
      const zipFileNames = new Set(
        Object.keys(zip.files)
          .filter((name) => !zip.files[name]?.dir)
          .map((name) => path.basename(name)),
      );
      const missingFromZip = [path.basename(manifestRef), ...manifest.artifactNames].filter(
        (name) => !zipFileNames.has(name),
      );
      if (missingFromZip.length) {
        failures.push(
          `package 压缩包不完整：${path.basename(zipRef)} 缺少 ${uniqueItems(missingFromZip).join(", ")}`,
        );
      }
    } catch (error) {
      failures.push(
        `package 压缩包不可读取：${path.basename(zipRef)}（${
          error instanceof Error ? error.message : String(error)
        }）`,
      );
    }
  }

  return uniqueItems(failures);
}

function parseArtifactManifest(
  manifestRef: string,
): { artifactNames: string[] } | { error: string } {
  try {
    const parsed = JSON.parse(readFileSync(manifestRef, "utf-8")) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.artifacts)) {
      return {
        error: "package 产物清单无效：artifact-manifest.json 必须包含 artifacts 数组",
      };
    }
    const artifactNames = parsed.artifacts
      .map((artifact) => {
        if (!isRecord(artifact)) return "";
        const name = typeof artifact.name === "string" ? artifact.name.trim() : "";
        const ref = typeof artifact.ref === "string" ? artifact.ref.trim() : "";
        return name || (ref ? path.basename(ref) : "");
      })
      .filter((name): name is string => Boolean(name));
    return { artifactNames: uniqueItems(artifactNames) };
  } catch (error) {
    return {
      error: `package 产物清单不可解析：artifact-manifest.json（${
        error instanceof Error ? error.message : String(error)
      }）`,
    };
  }
}

function validateHtmlArtifacts(artifactRefs: string[]): string[] {
  const htmlRefs = artifactRefs.filter((ref) => /\.(html|htm)$/iu.test(ref) && isNonEmptyFile(ref));
  if (!htmlRefs.length) return ["缺少 html 产物：需要可读取且非空的 HTML 文件"];

  const unreadableRefs: string[] = [];
  const missingLocalRefs: string[] = [];

  for (const ref of htmlRefs) {
    try {
      const html = readFileSync(ref, "utf-8");
      if (!/<html\b|<!doctype html|<body\b/iu.test(html) || !html.trim()) {
        unreadableRefs.push(path.basename(ref));
        continue;
      }
      for (const localRef of localHtmlResourceRefs(html)) {
        const resolved = path.resolve(path.dirname(ref), localRef);
        if (!existsSync(resolved)) missingLocalRefs.push(`${path.basename(ref)} -> ${localRef}`);
      }
    } catch {
      unreadableRefs.push(path.basename(ref));
    }
  }

  return [
    unreadableRefs.length
      ? `html 产物不可读取或主体为空：${uniqueItems(unreadableRefs).join(", ")}`
      : "",
    missingLocalRefs.length
      ? `html 产物引用资源缺失：${uniqueItems(missingLocalRefs).join("；")}`
      : "",
  ].filter(Boolean);
}

function localHtmlResourceRefs(html: string): string[] {
  const refs: string[] = [];
  const attrRegex = /\b(?:src|href)\s*=\s*["']([^"']+)["']/giu;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(html))) {
    const rawRef = match[1]?.trim();
    const localRef = normalizeLocalHtmlRef(rawRef);
    if (localRef) refs.push(localRef);
  }
  return uniqueItems(refs);
}

function normalizeLocalHtmlRef(rawRef: string | undefined): string {
  if (!rawRef) return "";
  if (
    rawRef.startsWith("#") ||
    /^(?:https?:|data:|mailto:|tel:|javascript:|blob:)/iu.test(rawRef)
  ) {
    return "";
  }
  const withoutFragment = rawRef.split("#")[0] ?? "";
  const withoutQuery = withoutFragment.split("?")[0] ?? "";
  const trimmed = withoutQuery.trim();
  if (!trimmed || path.isAbsolute(trimmed)) return "";
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function validateJsonArtifacts(artifactRefs: string[]): string[] {
  const jsonRefs = artifactRefs.filter(
    (ref) =>
      /\.json$/iu.test(ref) &&
      !/(^|[/\\])artifact-manifest\.json$/iu.test(ref) &&
      isNonEmptyFile(ref),
  );
  if (!jsonRefs.length) return ["缺少 json 产物：需要可解析的 JSON 文件"];

  const failures: string[] = [];
  let hasValidJson = false;
  for (const ref of jsonRefs) {
    try {
      const parsed = JSON.parse(readFileSync(ref, "utf-8")) as unknown;
      if (isNonEmptyJsonPayload(parsed)) {
        hasValidJson = true;
      } else {
        failures.push(`json 产物结构无效：${path.basename(ref)} 需要非空对象或数组`);
      }
    } catch (error) {
      failures.push(
        `json 产物不可解析：${path.basename(ref)}（${
          error instanceof Error ? error.message : String(error)
        }）`,
      );
    }
  }

  return hasValidJson
    ? uniqueItems(failures)
    : uniqueItems([...failures, "缺少 json 产物：需要非空对象或数组"]);
}

function isNonEmptyJsonPayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return isRecord(value) && Object.keys(value).length > 0;
}

function isNonEmptyFile(ref: string): boolean {
  try {
    return existsSync(ref) && statSync(ref).isFile() && statSync(ref).size > 0;
  } catch {
    return false;
  }
}

function resolveOutcome(
  executorOutcome: RoleExecutionOutcome,
  durationMs: number,
  timeoutMs: number,
): RoleExecutionOutcome {
  if (durationMs >= timeoutMs) {
    return "timed_out";
  }
  return executorOutcome;
}

function recoverySuggestionFor(outcome: RoleExecutionOutcome, error?: string): string {
  if (outcome === "timed_out") {
    return "本次执行超时。建议缩小任务范围、减少工具调用，或重新运行一次。";
  }
  if (outcome === "blocked") {
    if (error && /执行前检查未通过/iu.test(error)) {
      return `${error}。请先补齐岗位授权、人工确认、费用凭证、API 绑定和工具/Skill 配置后再执行。`;
    }
    if (error && /未在本次调度允许列表|没有匹配本次调度允许的工具|Skill|capability/iu.test(error)) {
      return `缺授权或能力未就绪：${error}。请到工具与 Skill 检查允许的能力，或重新生成派发单。`;
    }
    return error ? `本次执行被阻塞：${error}` : "本次执行被阻塞。请先补齐授权、工具或人工确认。";
  }
  return error ? `本次执行失败：${error}` : "本次执行失败。请查看步骤与工具调用后重试。";
}
