import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type {
  RoleExecutionContext,
  RoleExecutionOutcome,
  RoleResult,
  RoleExecutor,
  LoadedRolePackage,
  RolePackageManifest,
} from "./role-execution-types.js";
import type { TaskPackage } from "./types.js";

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
        timeoutMs = 300_000,
        maxOutputChars = 256_000,
      } = options;

      const executionId = randomUUID();
      const workspaceDir = path.join(workspaceRoot, executionId);
      mkdirSync(workspaceDir, { recursive: true });

      // 尝试从默认位置加载岗位包
      const rolePackage = tryLoadRolePackage(taskPackage);

      return {
        executionId,
        taskPackage,
        rolePackage,
        workspaceDir,
        modelRef,
        availableTools,
        timeoutMs,
        maxOutputChars,
      };
    },

    async execute(context, executor) {
      const startedAt = Date.now();

      // 注入执行上下文到工作区
      await prepareWorkspace(context);

      // 执行
      const executorResult = await executor.execute(context);

      const completedAt = Date.now();
      const durationMs = completedAt - startedAt;

      // 生成结果
      const outcome = resolveOutcome(executorResult.outcome, durationMs, context.timeoutMs);

      const result: RoleResult = {
        executionId: context.executionId,
        taskPackageId: context.taskPackage.id,
        roleListingId:
          context.taskPackage.requiredCapabilityRefs?.[0] ?? context.taskPackage.rolePlanItemId,
        roleTitle: context.rolePackage.manifest.title,
        outcome,
        summary: executorResult.output.slice(0, context.maxOutputChars),
        artifactRefs: collectArtifacts(context.workspaceDir),
        steps: executorResult.steps,
        modelUsage: executorResult.modelUsage,
        toolUsage: executorResult.toolUsage,
        blockedReason: executorResult.error,
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
      ``,
      `## 任务`,
      context.taskPackage.taskText,
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
      const fullPath = path.join(workspaceDir, entry.toString());
      if (
        entry.toString().endsWith(".png") ||
        entry.toString().endsWith(".jpg") ||
        entry.toString().endsWith(".mp4") ||
        entry.toString().endsWith(".json") ||
        entry.toString().endsWith(".zip")
      ) {
        artifacts.push(fullPath);
      }
    }
  } catch {
    // workspace may not have artifacts
  }

  return artifacts;
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
