// ======================================================================
// RoleBuilderService — AI 岗位生成服务（独立于 Extension 和 Session）
// ======================================================================
//
// 职责：接受 brief + 配置 → 调用执行器生成岗位包 → 返回结果
// 通过 RoleBuilderExecutor 接口解耦核心和扩展。
//
// 同时被两个入口使用：
//   1. aics.buildSession.generate  (BuildSession 状态机)
//   2. dijie_role_builder 工具     (Extension plugin)

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// ═══ Types ═══

export type RoleBuilderBrief = {
  roleTitle: string;
  roleDescription: string;
  targetCategory: string;
  coreResponsibilities: string[];
  taskExamples: string[];
  dailySop: string[];
  weeklySop: string[];
  requiredCapabilities: string[];
  inputTypes: string[];
  outputTypes: string[];
  forbiddenActions: string[];
  qualityStandards: string[];
};

export type RoleBuilderConfig = {
  outputRoot: string;
  timeoutMs: number;
  maxOutputChars?: number;
};

export type RoleBuilderProgress = {
  step: string; // "prompt", "running", "normalizing", "validating", "done"
  output?: string; // 当前输出片段
  pct: number; // 0-100
  message: string; // 用户可读的进度信息
};

export type RoleBuilderResult = {
  ok: boolean;
  packageDir: string;
  files: string[];
  validationErrors: string[];
  summary: string;
  output: string; // AI 原始输出
  durationMs: number;
  error?: string;
};

// ═══ Executor Interface（依赖注入） ═══

export type RoleBuilderExecutorParams = {
  prompt: string;
  workspaceRoot: string;
  timeoutMs: number;
  maxOutputChars: number;
};

export type RoleBuilderExecutorResult = {
  ok: boolean;
  output: string;
  error?: string;
};

/** AI 执行器接口：native embedded agent 或 subprocess command */
export type RoleBuilderExecutor = (
  params: RoleBuilderExecutorParams,
) => Promise<RoleBuilderExecutorResult>;

// ═══ Service ═══

export type RoleBuilderServiceParams = {
  brief: RoleBuilderBrief;
  config: RoleBuilderConfig;
  executor: RoleBuilderExecutor;
  onProgress?: (progress: RoleBuilderProgress) => void;
};

export async function executeRoleBuilder(
  params: RoleBuilderServiceParams,
): Promise<RoleBuilderResult> {
  const { brief, config, executor, onProgress } = params;
  const startedAt = Date.now();
  const outputRoot = config.outputRoot;

  const report = (step: string, pct: number, message: string, output?: string) => {
    onProgress?.({ step, pct, message, output });
  };

  try {
    // ---- Step 1: 准备 workspace ----
    report("prompt", 5, "准备生成环境和 prompt...");
    mkdirSync(outputRoot, { recursive: true });

    const briefJson = JSON.stringify(brief, null, 2);
    const prompt = buildRoleBuilderPrompt(brief, briefJson);

    const lastMessagePath = path.join(outputRoot, ".dijie_local_executor_last_message.md");
    writeFileSync(path.join(outputRoot, "role-build-brief.json"), briefJson, "utf-8");

    // ---- Step 2: 调用 AI 执行器 ----
    report("running", 15, "调用 AI 执行器生成岗位包...");

    const execResult = await withTimeout(
      executor({
        prompt,
        workspaceRoot: outputRoot,
        timeoutMs: config.timeoutMs,
        maxOutputChars: config.maxOutputChars ?? 200_000,
      }),
      config.timeoutMs,
    );

    if (!execResult.ok) {
      return {
        ok: false,
        packageDir: outputRoot,
        files: [],
        validationErrors: [execResult.error ?? "AI 执行器返回失败"],
        summary: "生成失败",
        output: execResult.output,
        durationMs: Date.now() - startedAt,
        error: execResult.error,
      };
    }

    // 保存 AI 原始输出
    writeFileSync(
      lastMessagePath,
      execResult.output.slice(0, config.maxOutputChars ?? 200_000),
      "utf-8",
    );
    report("running", 50, `AI 生成完成，输出 ${execResult.output.length} 字符`);

    // ---- Step 3: 归一化 ----
    report("normalizing", 60, "归一化 manifest 和产物文件...");
    const preNormalizationFiles = listWorkspaceFiles(outputRoot);
    const normalizeErrors = normalizePackageManifest(outputRoot, preNormalizationFiles);
    report("normalizing", 75, `归一化完成，文件: ${preNormalizationFiles.length}`);

    // ---- Step 4: 校验 ----
    report("validating", 85, "校验岗位包...");
    const files = listWorkspaceFiles(outputRoot);
    const validationErrors = validatePackageFiles(files, brief);
    validationErrors.push(...normalizeErrors);
    report(
      "validating",
      95,
      validationErrors.length === 0 ? "校验通过" : `校验发现 ${validationErrors.length} 个问题`,
    );

    // ---- Step 5: 完成 ----
    report("done", 100, "岗位包生成完成");

    return {
      ok: true,
      packageDir: outputRoot,
      files: files.map((f) => f.relPath),
      validationErrors,
      summary: `岗位「${brief.roleTitle}」生成完成，共 ${files.length} 个文件`,
      output: execResult.output,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report("done", 100, `生成异常: ${message}`);
    return {
      ok: false,
      packageDir: outputRoot,
      files: listWorkspaceFiles(outputRoot).map((f) => f.relPath),
      validationErrors: [message],
      summary: "生成异常中断",
      output: "",
      durationMs: Date.now() - startedAt,
      error: message,
    };
  }
}

// ═══ Prompt 生成 ═══

function buildRoleBuilderPrompt(brief: RoleBuilderBrief, briefJson: string): string {
  return [
    `你是迭界AI的岗位生成器。请根据以下岗位 brief 生成完整的岗位包文件。`,
    ``,
    `## 岗位 Brief (JSON)`,
    "```json",
    briefJson,
    "```",
    ``,
    `## 输出要求`,
    `在 workspace 目录中生成以下文件：`,
    ``,
    `1. **manifest.json** — 岗位清单`,
    `   - roleId: 自动生成`,
    `   - title, description: 来自 brief`,
    `   - version: "1.0.0"`,
    `   - requiredCapabilities: 来自 brief.requiredCapabilities`,
    `   - workflows: ["main-workflow.md"]`,
    `   - skills: brief 中提到的技能`,
    `   - knowledgeFiles: ["knowledge.md"]`,
    `   - templateFiles: ["templates.md"]`,
    `   - sopFiles: ["SOP.md"]`,
    ``,
    `2. **listing.md** — 岗位商品详情，面向商城买家`,
    ``,
    `3. **SOP.md** — 标准操作流程（包含每日和每周 SOP）`,
    ``,
    `4. **skills.md** — 技能列表与说明`,
    ``,
    `5. **knowledge.md** — 岗位知识库`,
    ``,
    `6. **templates.md** — 模板（至少包含一个可用的输出模板）`,
    ``,
    `7. **validation.md** — 验证规则与质量标准`,
    ``,
    `## 质量标准`,
    ...brief.qualityStandards.map((q) => `- ${q}`),
    ``,
    `## 禁止事项`,
    ...brief.forbiddenActions.map((f) => `- ${f}`),
    ``,
    `请仅输出生成的文件内容，每个文件用 "### FILE: <filename>" 标记开始。`,
  ].join("\n");
}

// ═══ Workspace 文件管理 ═══

type WorkspaceFile = {
  relPath: string;
  absPath: string;
  size: number;
};

function listWorkspaceFiles(root: string): WorkspaceFile[] {
  const files: WorkspaceFile[] = [];
  if (!existsSync(root)) return files;

  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(abs);
      } else if (st.isFile()) {
        files.push({ relPath: rel, absPath: abs, size: st.size });
      }
    }
  };
  walk(root);
  return files.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function normalizePackageManifest(root: string, files: WorkspaceFile[]): string[] {
  const errors: string[] = [];
  const manifestFile = files.find(
    (f) => f.relPath === "manifest.json" || f.relPath.endsWith("/manifest.json"),
  );
  if (!manifestFile) {
    // 如果没有独立的 manifest.json，创建一个
    const briefPath = path.join(root, "role-build-brief.json");
    if (existsSync(briefPath)) {
      try {
        const brief = JSON.parse(readFileSync(briefPath, "utf-8"));
        const manifest = {
          roleId: `role_${Date.now()}`,
          title: brief.roleTitle ?? "",
          description: brief.roleDescription ?? "",
          version: "1.0.0",
          requiredCapabilities: brief.requiredCapabilities ?? [],
          workflows: ["main-workflow.md"],
          skills: [],
          knowledgeFiles: ["knowledge.md"],
          templateFiles: ["templates.md"],
          sopFiles: ["SOP.md"],
        };
        writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
      } catch {
        errors.push("无法创建 manifest.json");
      }
    } else {
      errors.push("缺少 manifest.json");
    }
  }
  return errors;
}

function validatePackageFiles(files: WorkspaceFile[], brief: RoleBuilderBrief): string[] {
  const errors: string[] = [];
  const fileNames = new Set(files.map((f) => f.relPath.split("/").pop() ?? ""));

  const required = ["manifest.json", "listing.md", "SOP.md"];
  for (const name of required) {
    if (!fileNames.has(name) && !files.some((f) => f.relPath.endsWith(`/${name}`))) {
      errors.push(`缺少 ${name}`);
    }
  }

  // 检查 manifest 内容
  const manifestFile = files.find(
    (f) => f.relPath === "manifest.json" || f.relPath.endsWith("/manifest.json"),
  );
  if (manifestFile) {
    try {
      const manifest = JSON.parse(readFileSync(manifestFile.absPath, "utf-8"));
      if (!manifest.requiredCapabilities?.length) {
        errors.push("manifest.json 缺少 requiredCapabilities");
      }
      if (!manifest.workflows?.length) {
        errors.push("manifest.json 缺少 workflows");
      }
    } catch {
      errors.push("manifest.json 解析失败");
    }
  }

  // 检查 brief 声明的能力是否都在 manifest 中
  if (brief.requiredCapabilities.length > 0 && manifestFile) {
    try {
      const manifest = JSON.parse(readFileSync(manifestFile.absPath, "utf-8"));
      const missing = brief.requiredCapabilities.filter(
        (cap) => !manifest.requiredCapabilities?.includes(cap),
      );
      if (missing.length > 0) {
        errors.push(`manifest 缺少声明的能力: ${missing.join(", ")}`);
      }
    } catch {
      // already reported
    }
  }

  return errors;
}

// ═══ Utils ═══

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return promise;

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`操作超时 (${timeoutMs}ms)`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
