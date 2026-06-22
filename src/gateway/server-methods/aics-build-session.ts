import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { resolveApiKeyForProvider } from "../../agents/model-auth.js";
import { BuildSession } from "../../aics-main-flow/role-build-session.js";
import type { BuildSessionBrief } from "../../aics-main-flow/role-build-session.js";
import { createRoleDevelopmentEngine } from "../../aics-main-flow/role-development-engine.js";
import {
  assertDeveloperRoleDraftLimit,
  bindRolePreListingReviewCategory,
  createRoleCapabilityAnalysis,
  startRolePreListingReview,
  submitRolePreListingForListing,
} from "../../aics-main-flow/role-pre-listing-review.js";
import { listCategoryTemplates, getCategoryTemplate } from "../../aics-main-flow/skill-catalog.js";
import { resolveApiModelRefCandidatesForConsumer } from "../../api-connections/metering.js";
import {
  resolveApiModelRuntimeForConsumer,
  toOpenAICompatibleChatCompletionsUrl,
  type ApiModelRuntimeBinding,
} from "../../api-connections/runtime.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { recordModelUsageToApiMetering } from "./aics-api-metering.js";
import { aicsCloudConfig } from "./aics-role-pre-listing-review.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

const OPENAI_CODEX_RESPONSES_BASE_URL = "https://chatgpt.com/backend-api/codex";
const DEFAULT_OPENAI_CODEX_TEXT_MODEL = "gpt-5.5";

type BuildSessionModelRuntime = ApiModelRuntimeBinding & {
  transport: "chat_completions" | "codex_responses";
};

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

async function resolveBuildSessionModelRuntime(
  config: OpenClawConfig,
): Promise<BuildSessionModelRuntime | null> {
  try {
    const runtime = await resolveApiModelRuntimeForConsumer(config, {
      consumer: "build_session",
    });
    return runtime ? { ...runtime, transport: "chat_completions" } : null;
  } catch (error) {
    const oauthRuntime = resolveOpenAICodexBuildSessionRuntime(config);
    if (oauthRuntime) return oauthRuntime;
    throw error;
  }
}

function resolveOpenAICodexBuildSessionRuntime(
  config: OpenClawConfig,
): BuildSessionModelRuntime | null {
  const attempts = [
    { consumer: "build_session" as const, provider: "openai" as const },
    { consumer: "model" as const, provider: "openai" as const },
  ];
  for (const attempt of attempts) {
    for (const selected of resolveApiModelRefCandidatesForConsumer(config, attempt)) {
      const entry = config.apiConnections?.entries?.[selected.entryId];
      if (
        !entry ||
        entry.enabled === false ||
        entry.kind !== "model" ||
        entry.provider.toLowerCase() !== "openai" ||
        entry.authMode !== "oauth"
      ) {
        continue;
      }
      const configuredBaseUrl = entry.baseUrl?.trim() || entry.endpoint?.trim();
      return {
        ...selected,
        model: resolveOpenAICodexTextModel(selected.model),
        modelRef: `openai/${resolveOpenAICodexTextModel(selected.model)}`,
        baseUrl: codexResponsesBaseUrl(configuredBaseUrl),
        apiKey: "",
        authMode: "oauth",
        secretSource: "oauth",
        transport: "codex_responses",
      };
    }
  }
  return null;
}

function resolveOpenAICodexTextModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed || trimmed === "auto") return DEFAULT_OPENAI_CODEX_TEXT_MODEL;
  return trimmed;
}

function codexResponsesBaseUrl(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim().replace(/\/+$/u, "") ?? "";
  if (!trimmed || /^https:\/\/api\.openai\.com(?:\/v1)?$/iu.test(trimmed)) {
    return OPENAI_CODEX_RESPONSES_BASE_URL;
  }
  if (/^https:\/\/chatgpt\.com\/backend-api(?:\/codex)?(?:\/v1)?$/iu.test(trimmed)) {
    return OPENAI_CODEX_RESPONSES_BASE_URL;
  }
  return trimmed;
}

async function generateBuildSessionContent(params: {
  config: OpenClawConfig;
  runtime: BuildSessionModelRuntime;
  prompt: string;
}): Promise<{
  content: string;
  usage: unknown;
}> {
  if (params.runtime.transport === "codex_responses") {
    return generateBuildSessionContentWithCodexResponses(params);
  }
  return generateBuildSessionContentWithChatCompletions(params.runtime, params.prompt);
}

async function generateBuildSessionContentWithChatCompletions(
  runtime: BuildSessionModelRuntime,
  prompt: string,
): Promise<{ content: string; usage: unknown }> {
  const res = await fetch(toOpenAICompatibleChatCompletionsUrl(runtime.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.apiKey}`,
    },
    body: JSON.stringify({
      model: runtime.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8192,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`${runtime.provider} API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
  const content = ((choice?.message as Record<string, unknown>)?.content as string) || "";
  return { content, usage: data.usage };
}

async function generateBuildSessionContentWithCodexResponses(params: {
  config: OpenClawConfig;
  runtime: BuildSessionModelRuntime;
  prompt: string;
}): Promise<{ content: string; usage: unknown }> {
  const auth = await resolveApiKeyForProvider({
    provider: "openai",
    cfg: ensureOpenAICodexProviderConfig(params.config),
    modelApi: "openai-chatgpt-responses",
    credentialPrecedence: "env-first",
  });
  const res = await fetch(`${params.runtime.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.apiKey}`,
    },
    body: JSON.stringify({
      model: params.runtime.model,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: params.prompt }],
        },
      ],
      instructions:
        "You generate OpenClaw role package files. Return only the requested file blocks.",
      max_output_tokens: 8192,
      temperature: 0.3,
      store: false,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `${params.runtime.provider} OAuth Responses API ${res.status}: ${errText.slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as Record<string, unknown>;
  return {
    content: extractResponsesText(data),
    usage: data.usage,
  };
}

function ensureOpenAICodexProviderConfig(config: OpenClawConfig): OpenClawConfig {
  const cloned = structuredClone(config) as OpenClawConfig;
  const providers = (cloned.models ??= {}).providers ?? {};
  cloned.models.providers = providers;
  providers.openai = {
    ...(providers.openai ?? {}),
    auth: "oauth",
    api: "openai-chatgpt-responses",
    baseUrl: OPENAI_CODEX_RESPONSES_BASE_URL,
  };
  delete providers.openai.apiKey;
  return cloned;
}

function extractResponsesText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") chunks.push(text);
    }
  }
  return chunks.join("\n").trim();
}

export const aicsBuildSessionHandlers: GatewayRequestHandlers = {
  // ---- 会话生命周期 ----

  "aics.buildSession.create": ({ params, respond }) => {
    try {
      assertDeveloperRoleDraftLimit();
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
          errorShape(ErrorCodes.INVALID_REQUEST, `Build session not found: ${sessionId}`),
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
        targetUser: stringParam(briefParams, "targetUser") ?? "",
        targetCategory: stringParam(briefParams, "targetCategory") ?? "",
        coreResponsibilities: stringArrayParam(briefParams, "coreResponsibilities"),
        taskExamples: stringArrayParam(briefParams, "taskExamples"),
        dailySop: stringArrayParam(briefParams, "dailySop"),
        weeklySop: stringArrayParam(briefParams, "weeklySop"),
        monthlySop: stringArrayParam(briefParams, "monthlySop"),
        requiredCapabilities: stringArrayParam(briefParams, "requiredCapabilities"),
        inputTypes: stringArrayParam(briefParams, "inputTypes"),
        outputTypes: stringArrayParam(briefParams, "outputTypes"),
        forbiddenActions: stringArrayParam(briefParams, "forbiddenActions"),
        qualityStandards: stringArrayParam(briefParams, "qualityStandards"),
      };

      assertDeveloperRoleDraftLimit({
        rolePackageId: brief.roleTitle,
        listingDraftId: sessionId,
      });
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
  "aics.buildSession.generate": async ({ params, respond, context: gatewayContext }) => {
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
      const development = createRoleDevelopmentEngine().getStatus(session);
      if (!development.canGenerateRolePackage) {
        throw new Error(
          `岗位能力尚未就绪，不能生成岗位包。当前状态：${development.userStatusLabel}`,
        );
      }
      assertDeveloperRoleDraftLimit({
        rolePackageId: brief.roleTitle,
        listingDraftId: sessionId,
      });
      session = BuildSession.startGenerating(sessionId);

      const runtimeConfig = gatewayContext.getRuntimeConfig();
      const modelRuntime = await resolveBuildSessionModelRuntime(runtimeConfig);
      if (!modelRuntime) {
        session = BuildSession.fail(
          sessionId,
          "API 管理未给 BuildSession 绑定可用模型 Provider。请在 API 管理里选择模型供应商，并勾选 BuildSession。",
        );
        respond(true, { session, error: "missing BuildSession model provider" });
        return;
      }

      BuildSession.reportProgress(sessionId, {
        step: "prompt",
        pct: 10,
        message: "构建 AI prompt...",
      });
      const generatedCapabilityAnalysis = createRoleCapabilityAnalysis({
        rolePackageId: brief.roleTitle,
        listingDraftId: session.sessionId,
        developerId: "local-developer",
        roleTitle: brief.roleTitle,
        roleDescription: brief.roleDescription,
        targetUser: brief.targetUser,
        requiredCapabilities: brief.requiredCapabilities,
        sopFlow: brief.coreResponsibilities.join("\n"),
        dailyPlan: brief.dailySop.join("\n"),
        weeklyPlan: brief.weeklySop.join("\n"),
        monthlyPlan: (brief.monthlySop ?? []).join("\n"),
        inputOutput: [
          brief.inputTypes.length ? `输入：${brief.inputTypes.join("、")}` : "",
          brief.outputTypes.length ? `输出：${brief.outputTypes.join("、")}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        riskBoundaries: [...brief.forbiddenActions, ...brief.qualityStandards],
      });
      const effectiveBrief: BuildSessionBrief = {
        ...brief,
        requiredCapabilities: brief.requiredCapabilities.length
          ? brief.requiredCapabilities
          : generatedCapabilityAnalysis.requiredCapabilities,
      };
      const prompt = buildRoleGenPrompt(effectiveBrief);

      BuildSession.reportProgress(sessionId, {
        step: "running",
        pct: 20,
        message: `调用 ${modelRuntime.provider}/${modelRuntime.model} 生成岗位包...`,
      });
      let generated: { content: string; usage: unknown };
      try {
        generated = await generateBuildSessionContent({
          config: runtimeConfig,
          runtime: modelRuntime,
          prompt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        session = BuildSession.fail(sessionId, message);
        respond(true, {
          session,
          error: `${modelRuntime.provider} API failed`,
          modelRef: modelRuntime.modelRef,
          apiConnectionEntryId: modelRuntime.entryId,
          transport: modelRuntime.transport,
        });
        return;
      }

      BuildSession.reportProgress(sessionId, {
        step: "normalizing",
        pct: 60,
        message: "解析 AI 输出...",
      });
      const content = generated.content;
      const modelUsage = normalizeOpenAICompatibleUsage(generated.usage, {
        provider: modelRuntime.provider,
        model: modelRuntime.model,
      });

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
      if (!fileNames.includes("README.md")) {
        writeFileSync(
          pathJoin(packageDir, "README.md"),
          [
            `# ${brief.roleTitle}`,
            "",
            brief.roleDescription || "岗位包说明。",
            "",
            "## 本地上架检查",
            "- 需要通过本地一键综合检查后，由岗位开发者确认生成本地正式岗位商品。",
          ].join("\n"),
          "utf-8",
        );
        fileNames.push("README.md");
      }
      if (
        !fileNames.some((fileName) =>
          /(validation|validate|smoke|tests?|spec)([-_.]|\.)/i.test(fileName),
        )
      ) {
        writeFileSync(
          pathJoin(packageDir, "validation.md"),
          [
            "# 验证材料",
            "",
            "- [ ] smoke test 可运行",
            "- [ ] 输出符合 listing.md 描述",
            "- [ ] 不包含 secret、token、API Key 或用户私有数据",
          ].join("\n"),
          "utf-8",
        );
        fileNames.push("validation.md");
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
      const review =
        session.state === "completed"
          ? startRolePreListingReview({
              rolePackageId: brief.roleTitle,
              listingDraftId: session.sessionId,
              developerId: "local-developer",
              category: brief.targetCategory,
              packageDir,
              requiredCapabilities: effectiveBrief.requiredCapabilities,
            })
          : null;
      const capabilityAnalysis = session.state === "completed" ? generatedCapabilityAnalysis : null;
      const boundReview =
        review && generatedCapabilityAnalysis.categoryCapabilityReview?.id
          ? bindRolePreListingReviewCategory(
              review.id,
              generatedCapabilityAnalysis.categoryCapabilityReview.id,
            ).review
          : review;

      let apiMetering: { entryId: string; costCny: number } | null = null;
      let apiMeteringError: string | undefined;
      try {
        apiMetering = await recordModelUsageToApiMetering({
          context: gatewayContext,
          consumer: "build_session",
          executionId: `build_session:${sessionId}`,
          modelUsage,
        });
      } catch (meteringError) {
        apiMeteringError =
          meteringError instanceof Error ? meteringError.message : String(meteringError);
      }

      respond(true, {
        session,
        packageDir,
        files: fileNames,
        validationErrors: session.validationErrors,
        review: boundReview,
        capabilityAnalysis,
        modelRef: modelRuntime.modelRef,
        apiConnectionEntryId: modelRuntime.entryId,
        transport: modelRuntime.transport,
        modelUsage,
        ...(apiMetering ? { apiMetering } : {}),
        ...(apiMeteringError ? { apiMeteringError } : {}),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.roleDeveloper.submitForListing": async ({ params, respond, context }) => {
    try {
      const reviewId = requireString(params, "reviewId");
      const cloud = await aicsCloudConfig(context.getRuntimeConfig());
      const result = await submitRolePreListingForListing(reviewId, cloud);
      respond(true, result);
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

  "aics.roleDevelopment.status.get": ({ params, respond }) => {
    try {
      const sessionId = requireString(params, "sessionId");
      const session = BuildSession.load(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      respond(true, {
        session,
        development: createRoleDevelopmentEngine().getStatus(session),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.roleDevelopment.prepareMissingCapability": ({ params, respond }) => {
    try {
      const sessionId = requireString(params, "sessionId");
      const session = BuildSession.load(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      respond(true, {
        session,
        development: createRoleDevelopmentEngine().prepareMissingCapability(session),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.roleDevelopment.reduceScopeToBasic": ({ params, respond }) => {
    try {
      const sessionId = requireString(params, "sessionId");
      const session = BuildSession.load(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      const development = createRoleDevelopmentEngine().reduceScopeToBasicVersion(session);
      respond(true, {
        session: BuildSession.load(sessionId),
        development,
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
};

function pathJoin(...segments: string[]): string {
  const nodePath = require("node:path");
  return nodePath.join(...segments);
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeOpenAICompatibleUsage(
  usage: unknown,
  params: { provider: string; model: string },
): Record<string, unknown> {
  const record =
    usage && typeof usage === "object" && !Array.isArray(usage)
      ? (usage as Record<string, unknown>)
      : {};
  const inputTokens = finiteNumber(record.prompt_tokens ?? record.input_tokens);
  const outputTokens = finiteNumber(record.completion_tokens ?? record.output_tokens);
  const totalTokens = finiteNumber(record.total_tokens) || inputTokens + outputTokens;
  return {
    provider: params.provider,
    model: params.model,
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function buildRoleGenPrompt(brief: BuildSessionBrief): string {
  return [
    "你是迭界AI的岗位包生成器。根据以下 brief 生成完整的岗位包文件。",
    '每个文件用 "### FILE: <filename>" 标记开始，紧接着是该文件的完整内容。',
    "",
    "## 岗位 Brief",
    `- 岗位名称: ${brief.roleTitle}`,
    `- 描述: ${brief.roleDescription}`,
    `- 目标用户: ${brief.targetUser}`,
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
    `- 每月SOP: ${(brief.monthlySop ?? []).join("、")}`,
    "",
    "## 必须生成的文件",
    "1. manifest.json — 岗位清单（必须含 roleId/requiredCapabilities/workPatterns/outputContracts/workflows/skills）",
    "   - workPatterns 只能使用 generate/analyze/transform/operate/composite",
    "   - outputContracts 只能使用 image/html/document/spreadsheet/json/external_record/package",
    "2. listing.md — 岗位商品详情页（面向商城买家）",
    "3. README.md — 开发者与审核员阅读的岗位包说明",
    "4. SOP.md — 标准操作流程（每日+每周）",
    "5. skills.md — 技能列表与说明",
    "6. knowledge.md — 岗位知识库",
    "7. templates.md — 输出模板",
    "8. validation.md — smoke test / 验证材料",
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
