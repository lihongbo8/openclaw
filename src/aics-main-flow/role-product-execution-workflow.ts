import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import type { AuthProfileStore } from "../agents/auth-profiles/types.js";
import type { ApiModelRuntimeBinding } from "../api-connections/runtime.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { createCategoryCapabilityExecutionEngine } from "./category-capability-execution-engine.js";
import type {
  RoleExecutionContext,
  RoleExecutionPlan,
  RoleExecutionStep,
  RoleExecutor,
  RoleResult,
  RoleToolCallRecord,
} from "./role-execution-types.js";
import { ToolRegistry, type ToolRegistration } from "./tool-registry.js";
import type { ToolSkillExecutionResult } from "./tool-skill-execution-engine.js";

const CORE_TOOL_IDS = {
  imageGenerate: "core.openai.image.generate",
  workspaceWrite: "core.workspace.detail.write",
  qualityCheck: "core.artifact.quality.check",
  packageBundle: "core.artifact.package.bundle",
} as const;

export type RoleProductWorkflowOptions = {
  imageRuntime: ApiModelRuntimeBinding;
  config?: OpenClawConfig;
  agentDir?: string;
  authStore?: AuthProfileStore;
  roleTitle: string;
  roleListingId?: string;
  allowedSkillIds?: string[];
  allowedToolRefs?: string[];
  categoryCapabilityId?: string;
};

export function createRoleProductExecutionExecutor(
  options: RoleProductWorkflowOptions,
): RoleExecutor {
  registerCoreProductTools(options);

  return {
    async execute(context) {
      const steps: RoleExecutionStep[] = [];
      const startedArtifacts: string[] = [];
      const toolResults: Array<{ ok: boolean }> = [];
      const executionPlan = buildProductExecutionPlan(context, options);

      const analysisStarted = Date.now();
      const analysis = buildExecutionAnalysis(context, options);
      steps.push({
        stepIndex: 1,
        stepName: "role_execution_analysis",
        status: "completed",
        startedAt: analysisStarted,
        completedAt: Date.now(),
        inputSummary: context.taskPackage.taskText.slice(0, 300),
        outputSummary: analysis.slice(0, 500),
        toolCalls: [],
      });

      const allowedSkillIds = normalizeAllowedSkillIds(
        options.allowedSkillIds ?? context.allowedSkills,
      );
      const allowedToolRefs = normalizeAllowedToolRefs(
        options.allowedToolRefs ?? context.availableTools,
      );
      const categoryCapabilityId =
        options.categoryCapabilityId ?? context.taskPackage.requiredCapabilityRefs?.[0];
      const workflowRunRef = context.executionId;
      const imagePrompt = buildImagePrompt(context, options);
      const businessDeliverables = buildBusinessDeliverables(context, options);

      const imageResult = await runSkillStep({
        stepIndex: 2,
        stepName: "image_generation",
        roleRunRef: workflowRunRef,
        categoryCapabilityId,
        skillId: "img:gen",
        allowedSkillIds,
        allowedToolRefs,
        input: {
          workspaceDir: context.workspaceDir,
          prompt: imagePrompt,
          outputName: "hero.png",
          size: "1024x1024",
        },
        expectedOutput: "生成一张可用于详情页首屏的 PNG 图片",
      });
      steps.push(imageResult.step);
      toolResults.push({ ok: imageResult.ok });
      startedArtifacts.push(...imageResult.artifactRefs);
      if (!imageResult.ok) {
        return blockedExecutorResult(
          steps,
          toolResults,
          imageResult.reason,
          buildProductExecutionEvidence(executionPlan, businessDeliverables, false, [
            imageResult.reason ?? "图片生成失败",
          ]),
        );
      }

      const imageRef = imageResult.artifactRefs[0] ?? "";
      const detailResult = await runSkillStep({
        stepIndex: 3,
        stepName: "detail_page_write",
        roleRunRef: workflowRunRef,
        categoryCapabilityId,
        skillId: "ws:write",
        allowedSkillIds,
        allowedToolRefs,
        input: {
          workspaceDir: context.workspaceDir,
          outputName: "detail.html",
          title: context.taskPackage.title,
          roleTitle: options.roleTitle,
          taskText: context.taskPackage.taskText,
          category: context.taskPackage.category,
          imageRef,
          businessDeliverables,
        },
        expectedOutput: "写入可直接打开的详情页 HTML 文件",
      });
      steps.push(detailResult.step);
      toolResults.push({ ok: detailResult.ok });
      startedArtifacts.push(...detailResult.artifactRefs);
      if (!detailResult.ok) {
        return blockedExecutorResult(
          steps,
          toolResults,
          detailResult.reason,
          buildProductExecutionEvidence(executionPlan, businessDeliverables, false, [
            detailResult.reason ?? "详情页写入失败",
          ]),
        );
      }

      const qualityResult = await runSkillStep({
        stepIndex: 4,
        stepName: "artifact_quality_check",
        roleRunRef: workflowRunRef,
        categoryCapabilityId,
        skillId: "quality:check",
        allowedSkillIds,
        allowedToolRefs,
        input: {
          artifactRefs: startedArtifacts,
          requirements: [
            "至少包含一张图片",
            "至少包含一个 HTML 详情页",
            "所有产物必须是本地非空文件",
          ],
        },
        expectedOutput: "检查图片和详情页产物是否存在且可交付",
      });
      steps.push(qualityResult.step);
      toolResults.push({ ok: qualityResult.ok });
      if (!qualityResult.ok) {
        return blockedExecutorResult(
          steps,
          toolResults,
          qualityResult.reason,
          buildProductExecutionEvidence(executionPlan, businessDeliverables, false, [
            qualityResult.reason ?? "产物质量检查未通过",
          ]),
        );
      }

      const packageResult = await runSkillStep({
        stepIndex: 5,
        stepName: "artifact_package_manifest",
        roleRunRef: workflowRunRef,
        categoryCapabilityId,
        skillId: "file:pack",
        allowedSkillIds,
        allowedToolRefs,
        input: {
          workspaceDir: context.workspaceDir,
          artifactRefs: startedArtifacts,
          manifestName: "artifact-manifest.json",
          outputName: "artifacts.zip",
        },
        expectedOutput: "写入可下载 ZIP 包和产物清单",
      });
      steps.push(packageResult.step);
      toolResults.push({ ok: packageResult.ok });
      startedArtifacts.push(...packageResult.artifactRefs);
      if (!packageResult.ok) {
        return blockedExecutorResult(
          steps,
          toolResults,
          packageResult.reason,
          buildProductExecutionEvidence(executionPlan, businessDeliverables, false, [
            packageResult.reason ?? "产物打包失败",
          ]),
        );
      }

      const output = [
        "岗位执行完成，已生成可交付业务产物。",
        `图片: ${path.basename(imageRef)}`,
        `详情页: detail.html`,
        `打包文件: artifacts.zip`,
      ].join("\n");

      return {
        output,
        steps,
        modelUsage: numericModelUsage(options.imageRuntime),
        toolUsage: summarizeToolUsage(toolResults),
        executionEvidence: {
          ...buildProductExecutionEvidence(executionPlan, businessDeliverables, true),
          ...(isLocalRehearsalImageRuntime(options.imageRuntime)
            ? {
                modelUsageNotApplicable: true,
                modelUsageNotApplicableReason:
                  "本地演练使用内置图片占位工具完成岗位产物生成，未调用外部模型 API。",
              }
            : {}),
        },
        outcome: "succeeded",
      };
    },
  };
}

export function resolveOpenAIImageModel(model: string): string {
  const value = model.trim();
  if (!value || value === "auto") return "gpt-image-1";
  if (/^gpt-image-/iu.test(value)) return value;
  return "gpt-image-1";
}

export function toOpenAIImagesGenerationsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  if (/\/images\/generations$/iu.test(trimmed)) return trimmed;
  if (/\/v1$/iu.test(trimmed)) return `${trimmed}/images/generations`;
  return `${trimmed}/v1/images/generations`;
}

function registerCoreProductTools(options: RoleProductWorkflowOptions): void {
  ToolRegistry.register(openAIImageTool(options));
  ToolRegistry.register(workspaceDetailWriterTool());
  ToolRegistry.register(qualityCheckTool());
  ToolRegistry.register(packageBundleTool());
}

function openAIImageTool(options: RoleProductWorkflowOptions): ToolRegistration {
  const imageRuntime = options.imageRuntime;
  return {
    toolId: CORE_TOOL_IDS.imageGenerate,
    name: "openai_image_generation",
    label: "OpenAI 图片生成",
    description: "使用 API 管理中的 OpenAI 连接生成本地图片产物",
    capabilities: ["image.generation"],
    inputSchema: {},
    outputSchema: {},
    riskLevel: "low",
    requiresHumanConfirm: false,
    qualityCheckRules: ["必须写入本地图片文件", "不得把 API Key 写入产物或执行记录"],
    enabled: true,
    source: "core",
    handler: async (input) => {
      const startedAt = Date.now();
      try {
        if (isLocalRehearsalImageRuntime(imageRuntime)) {
          const workspaceDir = stringField(input, "workspaceDir");
          const prompt = stringField(input, "prompt");
          const outputName = stringField(input, "outputName") || "hero.png";
          if (!workspaceDir || !prompt) {
            return toolFailure(startedAt, "本地演练图片生成缺少 workspaceDir 或 prompt。");
          }
          const outputPath = safeWorkspacePath(workspaceDir, outputName);
          mkdirSync(path.dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, localRehearsalPng());
          return {
            ok: true,
            output: {
              provider: imageRuntime.provider,
              model: imageRuntime.model,
              filePath: outputPath,
              sha256: sha256(outputPath),
              rehearsal: true,
            },
            artifactRefs: [outputPath],
            durationMs: Date.now() - startedAt,
            qualityCheckPassed: existsSync(outputPath) && statSync(outputPath).size > 0,
          };
        }
        if (imageRuntime.provider.toLowerCase() !== "openai") {
          return toolFailure(startedAt, "图片生成需要 API 管理中的 OpenAI Provider。");
        }
        const workspaceDir = stringField(input, "workspaceDir");
        const prompt = stringField(input, "prompt");
        const size = stringField(input, "size") || "1024x1024";
        const outputName = stringField(input, "outputName") || "hero.png";
        if (!workspaceDir || !prompt) {
          return toolFailure(startedAt, "图片生成缺少 workspaceDir 或 prompt。");
        }
        const outputPath = safeWorkspacePath(workspaceDir, outputName);
        if (imageRuntime.authMode === "oauth") {
          const generated = await generateOpenAIImageWithOAuth({
            config: options.config,
            agentDir: options.agentDir,
            authStore: options.authStore,
            imageRuntime,
            prompt,
            size,
          });
          mkdirSync(path.dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, generated.buffer);
          return {
            ok: true,
            output: {
              provider: imageRuntime.provider,
              model: generated.model,
              filePath: outputPath,
              sha256: sha256(outputPath),
              authMode: "oauth",
            },
            artifactRefs: [outputPath],
            durationMs: Date.now() - startedAt,
            qualityCheckPassed: existsSync(outputPath) && statSync(outputPath).size > 0,
          };
        }
        const response = await fetch(toOpenAIImagesGenerationsUrl(imageRuntime.baseUrl), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${imageRuntime.apiKey}`,
          },
          body: JSON.stringify({
            model: resolveOpenAIImageModel(imageRuntime.model),
            prompt,
            size,
            n: 1,
          }),
          signal: AbortSignal.timeout(180_000),
        });
        const payload = await responseJson(response);
        if (!response.ok) {
          return toolFailure(
            startedAt,
            `OpenAI 图片 API ${response.status}: ${summarizePayload(payload)}`,
          );
        }
        const image = firstImagePayload(payload);
        if (!image.b64Json) {
          return toolFailure(startedAt, "OpenAI 图片 API 未返回可写入本地文件的 b64_json。");
        }
        mkdirSync(path.dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, Buffer.from(image.b64Json, "base64"));
        return {
          ok: true,
          output: {
            provider: imageRuntime.provider,
            model: resolveOpenAIImageModel(imageRuntime.model),
            filePath: outputPath,
            sha256: sha256(outputPath),
            remoteUrl: image.url,
          },
          artifactRefs: [outputPath],
          durationMs: Date.now() - startedAt,
          qualityCheckPassed: existsSync(outputPath) && statSync(outputPath).size > 0,
        };
      } catch (error) {
        return toolFailure(startedAt, error instanceof Error ? error.message : String(error));
      }
    },
  };
}

function isLocalRehearsalImageRuntime(imageRuntime: ApiModelRuntimeBinding): boolean {
  return imageRuntime.provider.toLowerCase() === "local-rehearsal";
}

function localRehearsalPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  );
}

async function generateOpenAIImageWithOAuth(params: {
  config?: OpenClawConfig;
  agentDir?: string;
  authStore?: AuthProfileStore;
  imageRuntime: ApiModelRuntimeBinding;
  prompt: string;
  size: string;
}): Promise<{ buffer: Buffer; model: string }> {
  if (!params.config) {
    throw new Error("OpenAI OAuth 图片生成需要已加载的 API 管理配置。");
  }
  const { buildOpenAIImageGenerationProvider } =
    await import("../../extensions/openai/image-generation-provider.js");
  const provider = buildOpenAIImageGenerationProvider();
  const result = await provider.generateImage({
    provider: "openai",
    model: resolveOpenAIImageModel(params.imageRuntime.model),
    prompt: params.prompt,
    cfg: ensureOpenAIProviderConfig(params.config, params.imageRuntime),
    agentDir: params.agentDir,
    authStore: params.authStore,
    size: params.size,
    count: 1,
  });
  const first = result.images[0];
  if (!first?.buffer?.length) {
    throw new Error("OpenAI OAuth 图片生成未返回可写入本地文件的图片。");
  }
  return {
    buffer: Buffer.from(first.buffer),
    model: result.model ?? resolveOpenAIImageModel(params.imageRuntime.model),
  };
}

function ensureOpenAIProviderConfig(
  config: OpenClawConfig,
  imageRuntime: ApiModelRuntimeBinding,
): OpenClawConfig {
  const cloned = structuredClone(config) as OpenClawConfig;
  const providers = (cloned.models ??= {}).providers ?? {};
  cloned.models.providers = providers;
  const existing = providers.openai ?? {};
  providers.openai = {
    ...existing,
    auth: "oauth",
    baseUrl: imageRuntime.baseUrl || existing.baseUrl || "https://api.openai.com/v1",
    models: existing.models ?? [],
  };
  delete providers.openai.apiKey;
  return cloned;
}

function workspaceDetailWriterTool(): ToolRegistration {
  return {
    toolId: CORE_TOOL_IDS.workspaceWrite,
    name: "workspace_detail_writer",
    label: "详情页写入",
    description: "写入可直接打开的本地 HTML 详情页和执行摘要 JSON",
    capabilities: ["workspace.write"],
    inputSchema: {},
    outputSchema: {},
    riskLevel: "low",
    requiresHumanConfirm: false,
    qualityCheckRules: ["路径必须在执行工作区内", "HTML 必须引用生成图片", "执行摘要必须写入 JSON"],
    enabled: true,
    source: "core",
    handler: async (input) => {
      const startedAt = Date.now();
      try {
        const workspaceDir = stringField(input, "workspaceDir");
        const outputName = stringField(input, "outputName") || "detail.html";
        const summaryName = stringField(input, "summaryName") || "execution-summary.json";
        if (!workspaceDir) return toolFailure(startedAt, "详情页写入缺少 workspaceDir。");
        const outputPath = safeWorkspacePath(workspaceDir, outputName);
        const summaryPath = safeWorkspacePath(workspaceDir, summaryName);
        mkdirSync(path.dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, buildDetailHtml(input), "utf-8");
        writeFileSync(
          summaryPath,
          JSON.stringify(buildExecutionSummary(input, outputPath), null, 2),
          "utf-8",
        );
        return {
          ok: true,
          output: {
            filePath: outputPath,
            summaryPath,
            sha256: sha256(outputPath),
            summarySha256: sha256(summaryPath),
          },
          artifactRefs: [outputPath, summaryPath],
          durationMs: Date.now() - startedAt,
          qualityCheckPassed: statSync(outputPath).size > 0 && statSync(summaryPath).size > 0,
        };
      } catch (error) {
        return toolFailure(startedAt, error instanceof Error ? error.message : String(error));
      }
    },
  };
}

function qualityCheckTool(): ToolRegistration {
  return {
    toolId: CORE_TOOL_IDS.qualityCheck,
    name: "artifact_quality_check",
    label: "产物质量检查",
    description: "检查图片、详情页等业务产物是否存在且非空",
    capabilities: ["quality.check"],
    inputSchema: {},
    outputSchema: {},
    riskLevel: "low",
    requiresHumanConfirm: false,
    qualityCheckRules: ["业务产物必须存在", "业务产物不能为空", "执行摘要 JSON 必须存在且可解析"],
    enabled: true,
    source: "core",
    handler: async (input) => {
      const startedAt = Date.now();
      const refs = stringArrayField(input, "artifactRefs");
      const checked = refs.map((ref) => ({
        ref,
        exists: existsSync(ref),
        sizeBytes: existsSync(ref) ? statSync(ref).size : 0,
      }));
      const missing = checked.filter((item) => !item.exists || item.sizeBytes <= 0);
      const imageRefs = checked.filter((item) => /\.(png|jpe?g|webp)$/iu.test(item.ref));
      const htmlRefs = checked.filter((item) => /\.html$/iu.test(item.ref));
      const summaryRefs = checked.filter((item) =>
        /(^|[/\\])execution-summary\.json$/iu.test(item.ref),
      );
      const invalidJsonArtifacts = summaryRefs.filter((item) => !isReadableJsonFile(item.ref));
      const htmlImageLinks = htmlRefs.flatMap((item) => inspectHtmlImageLinks(item.ref));
      const brokenHtmlImageLinks = htmlImageLinks.filter((item) => !item.exists);
      const hasImage = imageRefs.length > 0;
      const hasHtml = htmlRefs.length > 0;
      const hasExecutionSummary = summaryRefs.length > 0;
      const passed =
        missing.length === 0 &&
        hasImage &&
        hasHtml &&
        hasExecutionSummary &&
        invalidJsonArtifacts.length === 0 &&
        brokenHtmlImageLinks.length === 0;
      return {
        ok: passed,
        output: {
          passed,
          checkedArtifacts: checked,
          missingArtifacts: missing,
          hasImage,
          hasHtml,
          hasExecutionSummary,
          invalidJsonArtifacts,
          htmlImageLinks,
          brokenHtmlImageLinks,
        },
        artifactRefs: [],
        error: passed
          ? undefined
          : "产物质量检查未通过：缺少图片、HTML、执行摘要 JSON、存在空文件、执行摘要 JSON 无法解析，或详情页图片引用不可打开。",
        durationMs: Date.now() - startedAt,
        qualityCheckPassed: passed,
      };
    },
  };
}

function packageBundleTool(): ToolRegistration {
  return {
    toolId: CORE_TOOL_IDS.packageBundle,
    name: "artifact_package_bundle",
    label: "产物打包",
    description: "写入可下载 ZIP 包和产物清单，供结果页读取所有业务文件",
    capabilities: ["file.packaging"],
    inputSchema: {},
    outputSchema: {},
    riskLevel: "low",
    requiresHumanConfirm: false,
    qualityCheckRules: [
      "ZIP 必须包含图片和详情页",
      "清单必须列出所有业务产物",
      "输出必须写入执行工作区",
    ],
    enabled: true,
    source: "core",
    handler: async (input) => {
      const startedAt = Date.now();
      try {
        const workspaceDir = stringField(input, "workspaceDir");
        const outputName = stringField(input, "outputName") || "artifacts.zip";
        const manifestName = stringField(input, "manifestName") || "artifact-manifest.json";
        if (!workspaceDir) return toolFailure(startedAt, "产物打包缺少 workspaceDir。");
        const refs = stringArrayField(input, "artifactRefs");
        const zipPath = safeWorkspacePath(workspaceDir, outputName);
        const manifestPath = safeWorkspacePath(workspaceDir, manifestName);
        const artifacts = refs.map((ref) => ({
          ref,
          name: path.basename(ref),
          sizeBytes: existsSync(ref) ? statSync(ref).size : 0,
          sha256: existsSync(ref) ? sha256(ref) : "",
        }));
        writeFileSync(
          manifestPath,
          JSON.stringify({ generatedAt: new Date().toISOString(), artifacts }, null, 2),
          "utf-8",
        );
        const zip = new JSZip();
        for (const artifact of artifacts) {
          if (!artifact.ref || !existsSync(artifact.ref) || statSync(artifact.ref).size <= 0) {
            return toolFailure(startedAt, `产物打包失败，文件不存在或为空：${artifact.name}`);
          }
          zip.file(artifact.name, readFileSync(artifact.ref));
        }
        zip.file(path.basename(manifestPath), readFileSync(manifestPath));
        writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
        return {
          ok: true,
          output: { filePath: zipPath, manifestPath, artifacts },
          artifactRefs: [manifestPath, zipPath],
          durationMs: Date.now() - startedAt,
          qualityCheckPassed: statSync(zipPath).size > 0 && statSync(manifestPath).size > 0,
        };
      } catch (error) {
        return toolFailure(startedAt, error instanceof Error ? error.message : String(error));
      }
    },
  };
}

async function runSkillStep(params: {
  stepIndex: number;
  stepName: string;
  roleRunRef: string;
  categoryCapabilityId?: string;
  skillId: string;
  input: Record<string, unknown>;
  expectedOutput: string;
  allowedSkillIds?: string[];
  allowedToolRefs?: string[];
}): Promise<{ ok: boolean; reason?: string; artifactRefs: string[]; step: RoleExecutionStep }> {
  const startedAt = Date.now();
  const engine = createCategoryCapabilityExecutionEngine();
  const categoryStep = await engine.executeSkill({
    categoryId: params.categoryCapabilityId,
    roleRunRef: params.roleRunRef,
    workflowStepRef: `${params.stepIndex}:${params.stepName}`,
    skillId: params.skillId,
    input: params.input,
    expectedOutput: params.expectedOutput,
    allowedSkillIds: params.allowedSkillIds,
    allowedToolRefs: params.allowedToolRefs,
    requireAllowedSkillMatch: true,
    requireAllowedToolMatch: true,
    riskLevel: "low",
    humanConfirmPolicy: "auto",
  });
  const result = categoryStep.result;
  const completedAt = Date.now();
  const ok = result.ok && !result.response.blockedReason;
  return {
    ok,
    reason: result.response.blockedReason ?? result.response.executionSummary,
    artifactRefs: result.response.artifactRefs,
    step: {
      stepIndex: params.stepIndex,
      stepName: params.stepName,
      status: ok ? "completed" : "failed",
      startedAt,
      completedAt,
      inputSummary: params.expectedOutput,
      outputSummary: result.response.executionSummary,
      toolCalls: [toolCallRecord(result, completedAt - startedAt)],
      ...(ok ? {} : { error: result.response.blockedReason ?? result.response.executionSummary }),
    },
  };
}

function toolCallRecord(result: ToolSkillExecutionResult, durationMs: number): RoleToolCallRecord {
  return {
    toolName: result.response.selectedToolRef,
    toolCallId: result.requestId,
    inputSummary: result.skill?.label ?? "岗位能力",
    outputSummary: result.response.executionSummary,
    durationMs,
    status: result.ok ? "ok" : "error",
    ...(result.response.blockedReason ? { error: result.response.blockedReason } : {}),
  };
}

function blockedExecutorResult(
  steps: RoleExecutionStep[],
  toolResults: Array<{ ok: boolean }>,
  reason = "岗位执行被工具结果阻塞。",
  executionEvidence: Partial<RoleResult["executionEvidence"]> = {},
): Awaited<ReturnType<RoleExecutor["execute"]>> {
  return {
    output: reason,
    steps,
    modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
    toolUsage: summarizeToolUsage(toolResults),
    executionEvidence,
    outcome: "blocked",
    error: reason,
  };
}

function summarizeToolUsage(toolResults: Array<{ ok: boolean }>): RoleResult["toolUsage"] {
  return {
    totalToolCalls: toolResults.length,
    successfulCalls: toolResults.filter((item) => item.ok).length,
    failedCalls: toolResults.filter((item) => !item.ok).length,
  };
}

function normalizeAllowedSkillIds(value?: string[]): string[] | undefined {
  return normalizeAllowedRefs(value);
}

function normalizeAllowedToolRefs(value?: string[]): string[] | undefined {
  return normalizeAllowedRefs(value);
}

function normalizeAllowedRefs(value?: string[]): string[] | undefined {
  const refs = [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))];
  return refs.length ? refs : undefined;
}

function buildExecutionAnalysis(
  context: RoleExecutionContext,
  options: RoleProductWorkflowOptions,
): string {
  return [
    `当前状态: 收到任务 "${context.taskPackage.title}"，岗位为 "${options.roleTitle}"。`,
    "目标状态: 交付一张本地图片、一个可打开详情页和一份产物清单。",
    "差距: 当前任务只有文字需求，没有业务产物。",
    "执行选择: 使用岗位绑定的品类能力完成图片生成、详情页写入、质量检查和产物打包。",
  ].join("\n");
}

function buildProductExecutionPlan(
  context: RoleExecutionContext,
  options: RoleProductWorkflowOptions,
): RoleExecutionPlan {
  return {
    executionId: context.executionId,
    workPatterns: ["generate", "composite"],
    outputContracts: ["image", "html", "package"],
    ...(options.categoryCapabilityId ? { categoryCapabilityId: options.categoryCapabilityId } : {}),
    businessCategory: context.taskPackage.category,
    currentState: `收到已派发任务 "${context.taskPackage.title}"，尚未生成图片、详情页或打包产物。`,
    targetState: "交付一张本地图片、一个可打开 HTML 详情页、一份产物清单和 ZIP 包。",
    gap: "当前只有任务说明和岗位上下文，需要通过已授权岗位能力生成、写入、质检并打包业务产物。",
    executionChoice: `使用 ${options.roleTitle} 的通用生成型组合执行链，不按品类创建专用执行器。`,
    steps: [
      {
        stepIndex: 1,
        stepName: "role_execution_analysis",
        workPattern: "composite",
        expectedOutput: "明确当前状态、目标状态、差距和执行选择。",
        validationRules: ["执行前必须先说明当前状态、目标状态、差距和执行选择"],
      },
      {
        stepIndex: 2,
        stepName: "image_generation",
        workPattern: "generate",
        expectedOutput: "生成一张本地 PNG 图片。",
        requiredSkills: ["img:gen"],
        requiredTools: [CORE_TOOL_IDS.imageGenerate],
        validationRules: ["image: 文件存在、非空、格式正确"],
      },
      {
        stepIndex: 3,
        stepName: "detail_page_write",
        workPattern: "generate",
        expectedOutput: "写入可直接打开的 HTML 详情页和执行摘要 JSON。",
        requiredSkills: ["ws:write"],
        requiredTools: [CORE_TOOL_IDS.workspaceWrite],
        validationRules: ["html: 可打开、引用资源存在", "json: schema valid"],
      },
      {
        stepIndex: 4,
        stepName: "artifact_quality_check",
        workPattern: "composite",
        expectedOutput: "检查图片、HTML 和执行摘要 JSON 是否可交付。",
        requiredSkills: ["quality:check"],
        requiredTools: [CORE_TOOL_IDS.qualityCheck],
        validationRules: [
          "image: 文件存在、非空、格式正确",
          "html: 可打开、引用资源存在",
          "json: schema valid",
        ],
      },
      {
        stepIndex: 5,
        stepName: "artifact_package_manifest",
        workPattern: "composite",
        expectedOutput: "写入可下载 ZIP 包和 artifact-manifest.json。",
        requiredSkills: ["file:pack"],
        requiredTools: [CORE_TOOL_IDS.packageBundle],
        validationRules: ["package: manifest 和压缩包完整"],
      },
    ],
    validationRules: [
      "image: 文件存在、非空、格式正确",
      "html: 可打开、引用资源存在",
      "json: schema valid",
      "package: manifest 和压缩包完整",
    ],
    riskCheckpoints: [
      "调度层是唯一任务来源",
      "所有真实能力调用必须通过品类能力和能力执行门禁",
      "成功必须有业务 artifact",
    ],
  };
}

function buildProductExecutionEvidence(
  executionPlan: RoleExecutionPlan,
  businessDeliverables: NonNullable<RoleResult["executionEvidence"]["businessDeliverables"]>,
  passed: boolean,
  failures: string[] = [],
): Partial<RoleResult["executionEvidence"]> {
  return {
    workPatterns: executionPlan.workPatterns,
    outputContracts: executionPlan.outputContracts,
    ...(executionPlan.categoryCapabilityId
      ? { categoryCapabilityId: executionPlan.categoryCapabilityId }
      : {}),
    businessCategory: executionPlan.businessCategory,
    executionPlan,
    validation: {
      passed,
      checkedContracts: executionPlan.outputContracts,
      failures,
    },
    ...(businessDeliverables.length ? { businessDeliverables } : {}),
  };
}

function buildImagePrompt(
  context: RoleExecutionContext,
  options: RoleProductWorkflowOptions,
): string {
  return [
    `为 ${options.roleTitle} 生成一张可用于详情页首屏的高质量电商视觉图。`,
    `任务标题: ${context.taskPackage.title}`,
    `任务内容: ${context.taskPackage.taskText}`,
    `品类: ${context.taskPackage.category}`,
    "画面要求: 清晰、商业可用、构图稳定、无水印、无多余文字。",
  ].join("\n");
}

function buildBusinessDeliverables(
  context: RoleExecutionContext,
  options: RoleProductWorkflowOptions,
): NonNullable<RoleResult["executionEvidence"]["businessDeliverables"]> {
  if (!isMarketplaceOpsDiagnosis(context, options)) return [];
  return [
    {
      label: "商城运营诊断报告",
      summary: "汇总岗位商城本地闭环状态，覆盖岗位商品、授权、执行、审计和账本。",
      ref: "execution-summary.json#marketplace-ops-diagnosis-report",
      status: "available",
    },
    {
      label: "岗位供给分析",
      summary: "检查正式岗位商品、品类覆盖和可授权岗位供给是否已形成。",
      ref: "execution-summary.json#role-supply-analysis",
      status: "available",
    },
    {
      label: "授权转化分析",
      summary: "核对 0 元岗位商品是否生成正式授权，并可同步到我的岗位。",
      ref: "execution-summary.json#authorization-conversion-analysis",
      status: "available",
    },
    {
      label: "执行成功率分析",
      summary: "核对已授权派发单、执行结果、业务产物和执行成功状态。",
      ref: "execution-summary.json#execution-success-analysis",
      status: "available",
    },
    {
      label: "阻塞原因分析",
      summary: "列出 API、授权、费用确认、能力包、审计和账本的阻塞检查项。",
      ref: "execution-summary.json#blocked-reason-analysis",
      status: "available",
    },
    {
      label: "日/周/月运营建议",
      summary: "给出每日检查、每周复盘、每月优化的岗位商城运营动作。",
      ref: "execution-summary.json#daily-weekly-monthly-plan",
      status: "available",
    },
    {
      label: "下一步调度建议",
      summary: "建议优先调度已授权、已确认费用、能力包已就绪的岗位任务。",
      ref: "execution-summary.json#next-dispatch-suggestion",
      status: "available",
    },
    {
      label: "审计摘要",
      summary: "执行完成后应能读回 auditRef 和本地审计记录。",
      ref: "execution-summary.json#audit-summary",
      status: "available",
    },
    {
      label: "账本摘要",
      summary: "执行完成后应能读回 ledgerRef、0 元授权费用和本地账本记录。",
      ref: "execution-summary.json#ledger-summary",
      status: "available",
    },
  ];
}

function isMarketplaceOpsDiagnosis(
  context: RoleExecutionContext,
  options: RoleProductWorkflowOptions,
): boolean {
  const text = [
    options.roleTitle,
    context.rolePackage.manifest.title,
    context.taskPackage.title,
    context.taskPackage.taskText,
    context.taskPackage.category,
    ...(context.taskPackage.requiredCapabilityRefs ?? []),
  ].join(" ");
  return /商城运营诊断官|商城运营诊断|marketplace-ops|marketplace_ops|marketplace ops/iu.test(text);
}

function numericModelUsage(imageRuntime: ApiModelRuntimeBinding): RoleResult["modelUsage"] {
  void imageRuntime;
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 };
}

function buildDetailHtml(input: Record<string, unknown>): string {
  const title = stringField(input, "title") || "岗位执行详情页";
  const roleTitle = stringField(input, "roleTitle") || "执行岗位";
  const taskText = stringField(input, "taskText") || "";
  const category = stringField(input, "category") || "通用品类";
  const imageRef = stringField(input, "imageRef");
  const imageName = imageRef ? path.basename(imageRef) : "";
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width,initial-scale=1" />',
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    "body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;background:#f8fafc;}",
    ".wrap{max-width:920px;margin:0 auto;padding:32px 20px 48px;}",
    ".hero{display:grid;grid-template-columns:1fr;gap:20px;}",
    ".hero img{width:100%;border-radius:8px;border:1px solid #e5e7eb;background:#fff;}",
    "h1{font-size:32px;line-height:1.2;margin:0 0 10px;}h2{font-size:18px;margin:28px 0 10px;}",
    ".meta{color:#64748b;font-size:14px;margin-bottom:18px;}.box{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:18px;}",
    "</style>",
    "</head>",
    "<body>",
    '<main class="wrap">',
    '<section class="hero">',
    imageName
      ? `<img src="./${escapeAttribute(imageName)}" alt="${escapeAttribute(title)}" />`
      : "",
    "<div>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<div class="meta">${escapeHtml(roleTitle)} · ${escapeHtml(category)}</div>`,
    '<div class="box">',
    "<h2>任务目标</h2>",
    `<p>${escapeHtml(taskText)}</p>`,
    "<h2>交付内容</h2>",
    "<p>本次执行已生成首屏图片、详情页 HTML 和产物清单，可直接用于人工复核、下载或二次编辑。</p>",
    "<h2>人工复核点</h2>",
    "<p>请确认图片是否符合真实商品、品牌调性和平台规范；确认后再用于线上发布。</p>",
    "</div>",
    "</div>",
    "</section>",
    "</main>",
    "</body>",
    "</html>",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildExecutionSummary(
  input: Record<string, unknown>,
  detailPath: string,
): Record<string, unknown> {
  const imageRef = stringField(input, "imageRef");
  const businessDeliverables = recordArrayField(input, "businessDeliverables")
    .map((item) => ({
      label: stringField(item, "label"),
      summary: stringField(item, "summary"),
      ref: stringField(item, "ref"),
      status: stringField(item, "status") || "available",
    }))
    .filter((item) => item.label && item.summary);
  return {
    title: stringField(input, "title") || "岗位执行详情页",
    roleTitle: stringField(input, "roleTitle") || "执行岗位",
    taskText: stringField(input, "taskText") || "",
    category: stringField(input, "category") || "通用品类",
    imageRef,
    detailPage: detailPath,
    deliverables: [
      ...(imageRef ? [{ type: "image", name: path.basename(imageRef), ref: imageRef }] : []),
      { type: "detail_page", name: path.basename(detailPath), ref: detailPath },
    ],
    businessDeliverables,
    generatedAt: new Date().toISOString(),
  };
}

function recordArrayField(
  value: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> {
  const items = value[key];
  return Array.isArray(items)
    ? items.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function inspectHtmlImageLinks(
  filePath: string,
): Array<{ src: string; resolvedPath: string; exists: boolean }> {
  if (!existsSync(filePath)) return [];
  const html = readFileSync(filePath, "utf-8");
  const links: Array<{ src: string; resolvedPath: string; exists: boolean }> = [];
  for (const match of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)) {
    const src = match[1]?.trim() ?? "";
    if (!src || /^(https?:|data:)/iu.test(src)) continue;
    const resolvedPath = path.resolve(path.dirname(filePath), src);
    links.push({
      src,
      resolvedPath,
      exists: existsSync(resolvedPath) && statSync(resolvedPath).size > 0,
    });
  }
  return links;
}

function isReadableJsonFile(filePath: string): boolean {
  if (!existsSync(filePath) || statSync(filePath).size <= 0) return false;
  try {
    JSON.parse(readFileSync(filePath, "utf-8"));
    return true;
  } catch {
    return false;
  }
}

function safeWorkspacePath(workspaceDir: string, outputName: string): string {
  const root = path.resolve(workspaceDir);
  const target = path.resolve(root, outputName);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("工具输出路径必须在执行工作区内。");
  }
  return target;
}

function stringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
}

function stringArrayField(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response
    .json()
    .catch(async () => ({ text: await response.text().catch(() => "") }))) as Record<
    string,
    unknown
  >;
}

function firstImagePayload(payload: Record<string, unknown>): { b64Json?: string; url?: string } {
  const first = Array.isArray(payload.data) ? payload.data[0] : undefined;
  const record = first && typeof first === "object" ? (first as Record<string, unknown>) : {};
  return {
    b64Json: typeof record.b64_json === "string" ? record.b64_json : undefined,
    url: typeof record.url === "string" ? record.url : undefined,
  };
}

function summarizePayload(payload: Record<string, unknown>): string {
  const error = payload.error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message.slice(0, 300);
  }
  return JSON.stringify(payload).slice(0, 300);
}

function toolFailure(startedAt: number, error: string) {
  return {
    ok: false,
    error,
    artifactRefs: [],
    durationMs: Date.now() - startedAt,
    qualityCheckPassed: false,
  };
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/gu, "&#39;");
}
