import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { ToolCallRequest, ToolExecutionResponse } from "./role-execution-types.js";

function resolveKey(explicitKey: string | undefined, envName: string): string {
  const key = explicitKey?.trim() || process.env[envName]?.trim();
  if (!key)
    throw new Error(`缺少 API key。请在 OpenClaw 配置中设置 ${envName} 或传入 apiKey 参数。`);
  return key;
}

export type RealToolExecutor = {
  capabilities: string[];
  execute(request: ToolCallRequest): Promise<ToolExecutionResponse>;
};

// ═══ Deprecated model executor ═══

export function createDeepSeekExecutor(apiKey?: string): RealToolExecutor {
  void apiKey;
  return {
    capabilities: ["model.reasoning", "model.planning", "model.prompt_gen"],
    async execute(request: ToolCallRequest): Promise<ToolExecutionResponse> {
      const s = Date.now();
      return {
        callId: request.callId,
        ok: false,
        toolName: "deepseek",
        output: null,
        artifacts: [],
        durationMs: Date.now() - s,
        error:
          "DeepSeek 直连执行器已停用；模型调用必须通过 API 管理的 SecretRef、Provider 和 consumer resolver。",
      };
    },
  };
}

// ═══ 图片生成（阿里百炼） ═══

async function pollDashScope(apiKey: string, taskId: string, timeoutMs: number): Promise<string[]> {
  const d = Date.now() + timeoutMs;
  while (Date.now() < d) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = (await res.json()) as Record<string, unknown>;
    const status = (data.output as Record<string, unknown>)?.task_status as string;
    if (status === "SUCCEEDED")
      return (
        ((data.output as Record<string, unknown>)?.results as Array<{ url: string }>)?.map(
          (r) => r.url,
        ) || []
      );
    if (status === "FAILED")
      throw new Error(
        `任务失败: ${(data.output as Record<string, unknown>)?.message || "unknown"}`,
      );
  }
  throw new Error("任务超时");
}

export function createImageGenExecutor(apiKey?: string): RealToolExecutor {
  return {
    capabilities: ["image.generation"],
    async execute(request: ToolCallRequest): Promise<ToolExecutionResponse> {
      const s = Date.now();
      try {
        const key = resolveKey(apiKey, "DASHSCOPE_API_KEY");
        const prompt = request.params.prompt as string;
        const size = (request.params.size as string) || "1024*1024";
        const res = await fetch(
          "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
              "X-DashScope-Async": "enable",
            },
            body: JSON.stringify({
              model: "wan2.1-t2i-turbo",
              input: { prompt },
              parameters: { size, n: 1 },
            }),
            signal: AbortSignal.timeout(request.timeoutMs || 120000),
          },
        );
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          return {
            callId: request.callId,
            ok: false,
            toolName: "image_gen",
            output: null,
            artifacts: [],
            durationMs: Date.now() - s,
            error: `图片API ${res.status}: ${err.slice(0, 200)}`,
          };
        }
        const data = (await res.json()) as Record<string, unknown>;
        const taskId = (data.output as Record<string, unknown>)?.task_id as string;
        if (!taskId) throw new Error("未获取到 task_id");
        const urls = await pollDashScope(key, taskId, request.timeoutMs || 120000);
        return {
          callId: request.callId,
          ok: true,
          toolName: "image_gen",
          output: { taskId, urls, count: urls.length },
          artifacts: urls.map((_url, i) => ({
            artifactId: randomUUID(),
            kind: "image" as const,
            relPath: `img_${i}.png`,
            mimeType: "image/png",
            sizeBytes: 0,
          })),
          durationMs: Date.now() - s,
        };
      } catch (err) {
        return {
          callId: request.callId,
          ok: false,
          toolName: "image_gen",
          output: null,
          artifacts: [],
          durationMs: Date.now() - s,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

// ═══ 视频生成 ═══

export function createVideoGenExecutor(apiKey?: string): RealToolExecutor {
  return {
    capabilities: ["video.generation"],
    async execute(request: ToolCallRequest): Promise<ToolExecutionResponse> {
      const s = Date.now();
      try {
        const key = resolveKey(apiKey, "DASHSCOPE_API_KEY");
        const res = await fetch(
          "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
              "X-DashScope-Async": "enable",
            },
            body: JSON.stringify({
              model: "wan2.1-t2v-turbo",
              input: { prompt: request.params.prompt as string },
            }),
            signal: AbortSignal.timeout(request.timeoutMs || 300000),
          },
        );
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          return {
            callId: request.callId,
            ok: false,
            toolName: "video_gen",
            output: null,
            artifacts: [],
            durationMs: Date.now() - s,
            error: `视频API ${res.status}: ${err.slice(0, 200)}`,
          };
        }
        const data = (await res.json()) as Record<string, unknown>;
        const taskId = (data.output as Record<string, unknown>)?.task_id as string;
        if (!taskId) throw new Error("未获取到 task_id");
        const urls = await pollDashScope(key, taskId, request.timeoutMs || 300000);
        return {
          callId: request.callId,
          ok: true,
          toolName: "video_gen",
          output: { taskId, urls },
          artifacts: urls.map((_url, i) => ({
            artifactId: randomUUID(),
            kind: "video",
            relPath: `vid_${i}.mp4`,
            mimeType: "video/mp4",
            sizeBytes: 0,
          })),
          durationMs: Date.now() - s,
        };
      } catch (err) {
        return {
          callId: request.callId,
          ok: false,
          toolName: "video_gen",
          output: null,
          artifacts: [],
          durationMs: Date.now() - s,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

// ═══ 文件打包 ═══

export function createFilePackExecutor(): RealToolExecutor {
  return {
    capabilities: ["file.packaging"],
    async execute(request: ToolCallRequest): Promise<ToolExecutionResponse> {
      const s = Date.now();
      try {
        const files = request.params.files as string[];
        const outputName = (request.params.outputName as string) || "package";
        const root = request.params.workspaceRoot as string;

        const { execSync } = await import("node:child_process");
        const outPath = path.join(root, `${outputName}.zip`);
        execSync(`zip -j "${outPath}" ${files.map((f) => `"${f}"`).join(" ")}`, { cwd: root });

        const sz = statSync(outPath).size;
        return {
          callId: request.callId,
          ok: true,
          toolName: "file_pack",
          output: { path: outPath, files, size: sz },
          artifacts: [
            {
              artifactId: randomUUID(),
              kind: "archive",
              relPath: `${outputName}.zip`,
              mimeType: "application/zip",
              sizeBytes: sz,
            },
          ],
          durationMs: Date.now() - s,
        };
      } catch (err) {
        return {
          callId: request.callId,
          ok: false,
          toolName: "file_pack",
          output: null,
          artifacts: [],
          durationMs: Date.now() - s,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

// ═══ 质量检查 ═══

export function createQualityCheckExecutor(): RealToolExecutor {
  return {
    capabilities: ["quality.check"],
    async execute(request: ToolCallRequest): Promise<ToolExecutionResponse> {
      const s = Date.now();
      try {
        const fp = request.params.filePath as string;
        const kind = (request.params.kind as string) || "image";
        const issues: string[] = [];
        if (!existsSync(fp)) issues.push("文件不存在");
        else {
          const st = statSync(fp);
          if (st.size === 0) issues.push("文件为空");
          if (kind === "image" && st.size < 1024) issues.push("图片过小(<1KB)");
          if (kind === "image" && st.size > 50 * 1024 * 1024) issues.push("图片过大(>50MB)");
          if (kind === "video" && st.size < 10240) issues.push("视频过小(<10KB)");
        }
        return {
          callId: request.callId,
          ok: true,
          toolName: "quality_check",
          output: { pass: issues.length === 0, issues },
          artifacts: [],
          durationMs: Date.now() - s,
        };
      } catch (err) {
        return {
          callId: request.callId,
          ok: false,
          toolName: "quality_check",
          output: null,
          artifacts: [],
          durationMs: Date.now() - s,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

// ═══ Factory ═══

export function createAllRealToolExecutors(): RealToolExecutor[] {
  return [
    createImageGenExecutor(),
    createVideoGenExecutor(),
    createFilePackExecutor(),
    createQualityCheckExecutor(),
  ];
}

// ═══ Backward compat ═══

export async function executeWithRealTools(
  _c: unknown,
  _t: unknown,
  _k?: string,
): Promise<{
  outcome: string;
  output: string;
  steps: unknown[];
  modelUsage: unknown;
  toolUsage: unknown;
  error?: string;
}> {
  return {
    outcome: "failed",
    output: "",
    steps: [],
    modelUsage: {},
    toolUsage: {},
    error: "deprecated — use RealToolExecutor.execute()",
  };
}
export const createHttpImageExecutor = createImageGenExecutor;
