import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { BuildSession } from "../../aics-main-flow/role-build-session.js";
import type { BuildSessionBrief } from "../../aics-main-flow/role-build-session.js";
import { listCategoryTemplates, getCategoryTemplate } from "../../aics-main-flow/skill-catalog.js";
import { resolveCapabilities } from "../../aics-main-flow/tool-registry.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayParam(params: Record<string, unknown>, key: string): string[] {
  const value = params[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = stringParam(params, key);
  if (!value) throw new Error(`missing required string param: ${key}`);
  return value;
}

function respondError(respond: RespondFn, error: unknown): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)),
  );
}

export const aicsBuildSessionHandlers: GatewayRequestHandlers = {
  // ---- 会话生命周期 ----

  "aics.buildSession.create": ({ params, respond }) => {
    try {
      const requirements = requireString(params, "requirements");
      const session = BuildSession.create(requirements);
      respond(true, {
        ...session,
        availableTemplates: listCategoryTemplates().map((t) => ({
          id: t.categoryId,
          label: t.label,
          defaultCapabilities: t.defaultCapabilities,
        })),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.buildSession.load": ({ params, respond }) => {
    try {
      const sessionId = requireString(params, "sessionId");
      const session = BuildSession.load(sessionId);
      if (!session) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.NOT_FOUND, `Build session not found: ${sessionId}`),
        );
        return;
      }
      respond(true, session);
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.buildSession.list": ({ respond }) => {
    try {
      respond(true, BuildSession.listAll());
    } catch (error) {
      respondError(respond, error);
    }
  },

  // ---- 状态推进 ----

  /** created → briefing: 匹配品类和能力 */
  "aics.buildSession.startBriefing": ({ params, respond }) => {
    try {
      const sessionId = requireString(params, "sessionId");
      const session = BuildSession.startBriefing(sessionId);
      respond(true, {
        ...session,
        matchedTemplate: session.matchedTemplate
          ? getCategoryTemplate(session.matchedTemplate)
          : null,
        capabilityReport: session.capabilityReport,
      });
    } catch (error) {
      respondError(respond, error);
    }
  },

  /** briefing → confirming: 提交 brief */
  "aics.buildSession.submitBrief": ({ params, respond }) => {
    try {
      const sessionId = requireString(params, "sessionId");
      const briefParams = params.brief as Record<string, unknown>;
      if (!briefParams) throw new Error("brief is required");

      const brief: BuildSessionBrief = {
        roleTitle: stringParam(briefParams, "roleTitle") ?? "未命名岗位",
        roleDescription: stringParam(briefParams, "roleDescription") ?? "",
        targetCategory: stringParam(briefParams, "targetCategory") ?? "",
        coreResponsibilities: stringArrayParam(briefParams, "coreResponsibilities"),
        taskExamples: stringArrayParam(briefParams, "taskExamples"),
        dailySop: stringArrayParam(briefParams, "dailySop"),
        weeklySop: stringArrayParam(briefParams, "weeklySop"),
        requiredCapabilities: stringArrayParam(briefParams, "requiredCapabilities"),
        inputTypes: stringArrayParam(briefParams, "inputTypes"),
        outputTypes: stringArrayParam(briefParams, "outputTypes"),
        forbiddenActions: stringArrayParam(briefParams, "forbiddenActions"),
        qualityStandards: stringArrayParam(briefParams, "qualityStandards"),
      };

      const session = BuildSession.submitBrief(sessionId, brief);
      respond(true, session);
    } catch (error) {
      respondError(respond, error);
    }
  },

  /** confirming → confirming: 确认/修改 */
  "aics.buildSession.confirm": ({ params, respond }) => {
    try {
      const sessionId = requireString(params, "sessionId");
      const note = stringParam(params, "note");
      const session = BuildSession.confirm(sessionId, note);
      respond(true, session);
    } catch (error) {
      respondError(respond, error);
    }
  },

  /** confirming → generating: 开始生成 */
  "aics.buildSession.generate": async ({ params, respond }) => {
    try {
      const sessionId = requireString(params, "sessionId");
      const outputRoot =
        stringParam(params, "outputRoot") ??
        pathJoin(process.env.HOME ?? "/tmp", ".dijie-runtime/role-packages");

      let session = BuildSession.load(sessionId);
      if (!session) throw new Error("Session not found");
      if (session.state !== "confirming") {
        throw new Error(`Cannot generate from state "${session.state}"`);
      }
      const brief = session.brief;
      if (!brief) throw new Error("Brief is required before generating");
      session = BuildSession.startGenerating(sessionId);

      const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
      if (!apiKey) {
        session = BuildSession.fail(
          sessionId,
          "缺少 DEEPSEEK_API_KEY。请在环境变量或 OpenClaw 配置中设置。",
        );
        respond(true, { session, error: "missing DEEPSEEK_API_KEY" });
        return;
      }

      BuildSession.reportProgress(sessionId, {
        step: "prompt",
        pct: 10,
        message: "构建 AI prompt...",
      });
      const prompt = buildRoleGenPrompt(brief);

      BuildSession.reportProgress(sessionId, {
        step: "running",
        pct: 20,
        message: "调用 DeepSeek 生成岗位包...",
      });
      const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 8192,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        session = BuildSession.fail(
          sessionId,
          `DeepSeek API ${res.status}: ${errText.slice(0, 300)}`,
        );
        respond(true, { session, error: "DeepSeek API failed" });
        return;
      }

      BuildSession.reportProgress(sessionId, {
        step: "normalizing",
        pct: 60,
        message: "解析 AI 输出...",
      });
      const data = (await res.json()) as Record<string, unknown>;
      const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
      const content = ((choice?.message as Record<string, unknown>)?.content as string) || "";

      // 解析输出：按 "### FILE: filename" 分割
      const { mkdirSync, writeFileSync } = require("node:fs");
      const packageDir = pathJoin(outputRoot, sanitizeDirName(brief.roleTitle));
      mkdirSync(packageDir, { recursive: true });

      const fileNames: string[] = [];
      const parts = content.split(/###\s*FILE:\s*/i);
      for (const part of parts) {
        const lines = part.trim().split("\n");
        const fileName = lines[0]?.trim();
        if (!fileName || fileName.length > 100) continue;
        const fileContent = lines.slice(1).join("\n").trim();
        if (!fileContent) continue;
        writeFileSync(pathJoin(packageDir, fileName), fileContent, "utf-8");
        fileNames.push(fileName);
      }

      BuildSession.reportProgress(sessionId, {
        step: "validating",
        pct: 85,
        message: `校验 ${fileNames.length} 个文件...`,
      });
      session = BuildSession.startValidating(sessionId, packageDir);

      if (session.validationErrors.length === 0) {
        session = BuildSession.complete(sessionId);
      }

      respond(true, {
        session,
        packageDir,
        files: fileNames,
        validationErrors: session.validationErrors,
      });
    } catch (error) {
      respondError(respond, error);
    }
  },

  /** 获取进度 */
  "aics.buildSession.progress": ({ params, respond }) => {
    try {
      const sessionId = requireString(params, "sessionId");
      const session = BuildSession.load(sessionId);
      if (!session) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Session not found: ${sessionId}`),
        );
        return;
      }
      respond(true, {
        state: session.state,
        progress: session.progress,
        validationErrors: session.validationErrors,
        repairCount: session.repairCount,
        maxRepairs: session.maxRepairs,
      });
    } catch (error) {
      respondError(respond, error);
    }
  },

  /** 修复重试 */
  "aics.buildSession.repair": ({ params, respond }) => {
    try {
      const sessionId = requireString(params, "sessionId");
      const session = BuildSession.repair(sessionId);
      respond(true, session);
    } catch (error) {
      respondError(respond, error);
    }
  },

  /** 取消 */
  "aics.buildSession.cancel": ({ params, respond }) => {
    try {
      const sessionId = requireString(params, "sessionId");
      const reason = stringParam(params, "reason");
      const session = BuildSession.cancel(sessionId, reason);
      respond(true, session);
    } catch (error) {
      respondError(respond, error);
    }
  },
};

function pathJoin(...segments: string[]): string {
  const nodePath = require("node:path");
  return nodePath.join(...segments);
}

function buildRoleGenPrompt(brief: BuildSessionBrief): string {
  return [
    "你是迭界AI的岗位包生成器。根据以下 brief 生成完整的岗位包文件。",
    '每个文件用 "### FILE: <filename>" 标记开始，紧接着是该文件的完整内容。',
    "",
    "## 岗位 Brief",
    `- 岗位名称: ${brief.roleTitle}`,
    `- 描述: ${brief.roleDescription}`,
    `- 品类: ${brief.targetCategory}`,
    `- 核心职责: ${brief.coreResponsibilities.join("、")}`,
    `- 任务示例: ${brief.taskExamples.join("、")}`,
    `- 能力需求: ${brief.requiredCapabilities.join(", ")}`,
    `- 输入类型: ${brief.inputTypes.join(", ")}`,
    `- 输出类型: ${brief.outputTypes.join(", ")}`,
    `- 禁止事项: ${brief.forbiddenActions.join("、")}`,
    `- 质量标准: ${brief.qualityStandards.join("、")}`,
    `- 每日SOP: ${brief.dailySop.join("、")}`,
    `- 每周SOP: ${brief.weeklySop.join("、")}`,
    "",
    "## 必须生成的文件",
    "1. manifest.json — 岗位清单（含 roleId/requiredCapabilities/workflows/skills）",
    "2. listing.md — 岗位商品详情页（面向商城买家）",
    "3. SOP.md — 标准操作流程（每日+每周）",
    "4. skills.md — 技能列表与说明",
    "5. knowledge.md — 岗位知识库",
    "6. templates.md — 输出模板",
    "7. validation.md — 验证规则",
    "",
    "请开始生成:",
  ].join("\n");
}

function sanitizeDirName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9一-鿿_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
}
