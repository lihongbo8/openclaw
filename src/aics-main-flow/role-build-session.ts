import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { getCategoryTemplate, type CategoryTemplate } from "./skill-catalog.js";
import { resolveCapabilities } from "./tool-registry.js";

// ======================================================================
// BuildSession: 岗位包生成会话状态机
// ======================================================================
//
// 替代 one-shot CLI 模式。多轮交互：
//   created → briefing → confirming → generating → validating → completed/failed
//
// 每轮保存状态到 JSON 文件，支持中断后继续。

export const BUILD_SESSION_STATES = [
  "created",
  "briefing",
  "confirming",
  "generating",
  "validating",
  "completed",
  "failed",
  "cancelled",
] as const;

export type BuildSessionState = (typeof BUILD_SESSION_STATES)[number];

export type BuildSessionBrief = {
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

export type BuildSessionRecord = {
  sessionId: string;
  state: BuildSessionState;
  createdAt: number;
  updatedAt: number;
  userRequirements: string;
  brief?: BuildSessionBrief;
  userConfirmations: string[];
  matchedTemplate?: string;
  capabilityReport?: ReturnType<typeof resolveCapabilities>;
  outputPackageDir?: string;
  validationErrors: string[];
  blockedReason?: string;
  /** 生成进度 */
  progress?: { step: string; pct: number; message: string };
  /** 修复重试 */
  repairCount: number;
  maxRepairs: number;
};

function emptySession(sessionId: string, requirements: string): BuildSessionRecord {
  return {
    sessionId,
    state: "created",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userRequirements: requirements,
    userConfirmations: [],
    validationErrors: [],
    repairCount: 0,
    maxRepairs: 3,
  };
}

function resolveSessionPath(sessionId: string): string {
  const dir = path.join(resolveStateDir(), "build-sessions");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${sessionId}.json`);
}

function loadSession(sessionId: string): BuildSessionRecord | null {
  const p = resolveSessionPath(sessionId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as BuildSessionRecord;
  } catch {
    return null;
  }
}

function saveSession(session: BuildSessionRecord): void {
  session.updatedAt = Date.now();
  const dir = path.dirname(resolveSessionPath(session.sessionId));
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolveSessionPath(session.sessionId), JSON.stringify(session, null, 2), "utf-8");
}

// ======================================================================
// Public API
// ======================================================================

export const BuildSession = {
  /** 创建新会话 */
  create(requirements: string): BuildSessionRecord {
    const session = emptySession(randomUUID(), requirements);
    saveSession(session);
    return session;
  },

  /** 加载已有会话 */
  load(sessionId: string): BuildSessionRecord | null {
    return loadSession(sessionId);
  },

  /** 列出所有会话 */
  listAll(): BuildSessionRecord[] {
    const dir = path.join(resolveStateDir(), "build-sessions");
    if (!existsSync(dir)) return [];
    try {
      const fs = require("node:fs");
      return fs
        .readdirSync(dir)
        .filter((f: string) => f.endsWith(".json"))
        .map((f: string) => {
          try {
            return JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as BuildSessionRecord;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a: BuildSessionRecord, b: BuildSessionRecord) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  },

  // ---- 状态转换 ----

  /** created → briefing: 开始处理需求，匹配品类和能力 */
  startBriefing(sessionId: string): BuildSessionRecord {
    const session = loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.state !== "created") {
      throw new Error(`Cannot start briefing from state "${session.state}"`);
    }

    // 自动匹配品类模板
    const lowerReqs = session.userRequirements.toLowerCase();
    let matched: CategoryTemplate | undefined;
    if (
      lowerReqs.includes("美工") ||
      lowerReqs.includes("图片") ||
      lowerReqs.includes("设计") ||
      lowerReqs.includes("电商") ||
      lowerReqs.includes("视觉") ||
      lowerReqs.includes("产品图")
    ) {
      matched = getCategoryTemplate("ecommerce-visual");
    } else if (
      lowerReqs.includes("视频") ||
      lowerReqs.includes("剪辑") ||
      lowerReqs.includes("字幕") ||
      lowerReqs.includes("分镜")
    ) {
      matched = getCategoryTemplate("video-production");
    } else if (
      lowerReqs.includes("数据") ||
      lowerReqs.includes("分析") ||
      lowerReqs.includes("报表")
    ) {
      matched = getCategoryTemplate("data-analysis");
    }

    session.matchedTemplate = matched?.categoryId;

    // 自动匹配能力
    if (matched) {
      session.capabilityReport = resolveCapabilities(matched.defaultCapabilities);
    }

    session.state = "briefing";
    saveSession(session);
    return session;
  },

  /** briefing → confirming: 提交 brief */
  submitBrief(sessionId: string, brief: BuildSessionBrief): BuildSessionRecord {
    const session = loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.state !== "briefing") {
      throw new Error(`Cannot submit brief from state "${session.state}"`);
    }

    // 补充能力匹配（如果 brief 中包含 requiredCapabilities）
    if (brief.requiredCapabilities.length > 0) {
      session.capabilityReport = resolveCapabilities(brief.requiredCapabilities);
    }

    session.brief = brief;
    session.state = "confirming";
    saveSession(session);
    return session;
  },

  /** confirming → confirming: 用户确认（可多次确认/修改） */
  confirm(sessionId: string, note?: string): BuildSessionRecord {
    const session = loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.state !== "confirming") {
      throw new Error(`Cannot confirm from state "${session.state}"`);
    }

    if (note) {
      session.userConfirmations.push(note);
    }
    saveSession(session);
    return session;
  },

  /** confirming → generating: 用户最终确认，开始生成 */
  startGenerating(sessionId: string): BuildSessionRecord {
    const session = loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.state !== "confirming") {
      throw new Error(`Cannot start generating from state "${session.state}"`);
    }
    if (!session.brief) {
      throw new Error("Brief is required before generating");
    }

    session.state = "generating";
    saveSession(session);
    return session;
  },

  /** generating → validating: 生成完成，开始校验 */
  startValidating(sessionId: string, outputPackageDir: string): BuildSessionRecord {
    const session = loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.state !== "generating") {
      throw new Error(`Cannot start validating from state "${session.state}"`);
    }

    session.outputPackageDir = outputPackageDir;
    session.state = "validating";
    session.validationErrors = validatePackage(outputPackageDir, session);
    saveSession(session);
    return session;
  },

  /** validating → completed: 校验通过 */
  complete(sessionId: string): BuildSessionRecord {
    const session = loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.state !== "validating") {
      throw new Error(`Cannot complete from state "${session.state}"`);
    }

    session.state = "completed";
    saveSession(session);
    return session;
  },

  /** 写入进度 */
  reportProgress(
    sessionId: string,
    progress: { step: string; pct: number; message: string },
  ): void {
    const session = loadSession(sessionId);
    if (!session) return;
    session.progress = progress;
    saveSession(session);
  },

  /** validating/failed → generating: 修复重试 */
  repair(sessionId: string): BuildSessionRecord {
    const session = loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.state !== "validating" && session.state !== "failed") {
      throw new Error(`Cannot repair from state "${session.state}"`);
    }
    if (session.repairCount >= session.maxRepairs) {
      throw new Error(`已达最大修复次数 (${session.maxRepairs})`);
    }
    session.state = "generating";
    session.repairCount++;
    session.validationErrors = [];
    saveSession(session);
    return session;
  },

  /** any → cancelled */
  cancel(sessionId: string, reason?: string): BuildSessionRecord {
    const session = loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.state = "cancelled";
    session.blockedReason = reason || "用户取消";
    saveSession(session);
    return session;
  },

  /** any → failed: 失败 */
  fail(sessionId: string, reason: string): BuildSessionRecord {
    const session = loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.state = "failed";
    session.blockedReason = reason;
    saveSession(session);
    return session;
  },
};

// ======================================================================
// 岗位包结构生成
// ======================================================================

export function generateRolePackageStructure(
  session: BuildSessionRecord,
  outputRoot: string,
): {
  packageDir: string;
  files: Record<string, string>;
} {
  if (!session.brief) {
    throw new Error("Cannot generate without a confirmed brief");
  }

  const brief = session.brief;
  const template = session.matchedTemplate
    ? getCategoryTemplate(session.matchedTemplate)
    : undefined;

  const packageDir = path.join(outputRoot, sanitizeDirName(brief.roleTitle));
  const files: Record<string, string> = {};

  // manifest.json
  files["manifest.json"] = JSON.stringify(
    {
      roleId: session.sessionId,
      title: brief.roleTitle,
      description: brief.roleDescription,
      version: "1.0.0",
      requiredCapabilities: brief.requiredCapabilities,
      workflows: ["main-workflow.md"],
      skills: template?.skills.map((s) => s.skillId) ?? [],
      knowledgeFiles: ["knowledge.md"],
      templateFiles: ["templates.md"],
      sopFiles: ["SOP.md"],
    },
    null,
    2,
  );

  // listing.md
  files["listing.md"] = [
    `# ${brief.roleTitle}`,
    "",
    brief.roleDescription,
    "",
    "## 核心职责",
    ...brief.coreResponsibilities.map((r) => `- ${r}`),
    "",
    "## 任务示例",
    ...brief.taskExamples.map((t) => `- ${t}`),
    "",
    "## 输入",
    ...brief.inputTypes.map((i) => `- ${i}`),
    "",
    "## 输出",
    ...brief.outputTypes.map((o) => `- ${o}`),
    "",
    "## 禁止事项",
    ...brief.forbiddenActions.map((f) => `- ${f}`),
    "",
    "## 质量标准",
    ...brief.qualityStandards.map((q) => `- ${q}`),
  ].join("\n");

  // SOP.md
  files["SOP.md"] = [
    "# 标准操作流程",
    "",
    template?.commonSop ?? "",
    "",
    "## 每日",
    ...brief.dailySop.map((s) => `- ${s}`),
    "",
    "## 每周",
    ...brief.weeklySop.map((s) => `- ${s}`),
  ].join("\n");

  // skills.md
  files["skills.md"] = template
    ? [
        "# 技能列表",
        "",
        ...template.skills.map(
          (s) =>
            `## ${s.label}\n${s.description}\n\n输入: ${s.inputContract}\n输出: ${s.outputContract}\n质量检查: ${s.qualityHints.join("；")}\n`,
        ),
      ].join("\n")
    : "# 技能列表\n\n（无品类模板匹配，请手动补充）\n";

  // knowledge.md
  files["knowledge.md"] = [
    "# 岗位知识库",
    "",
    `- 品类: ${session.matchedTemplate ?? "通用"}`,
    `- 能力需求: ${brief.requiredCapabilities.join(", ")}`,
    session.capabilityReport
      ? `- 能力匹配: ready=${session.capabilityReport.summary.ready}, missing=${session.capabilityReport.summary.missing}`
      : "",
  ].join("\n");

  // templates.md
  files["templates.md"] = ["# 模板", "", "（岗位生成时请根据品类补充具体模板内容）"].join("\n");

  // validation.md
  files["validation.md"] = [
    "# 验证规则",
    "",
    ...brief.qualityStandards.map((q) => `- [ ] ${q}`),
    "",
    "## 必检项",
    `- [ ] manifest.json 包含所有 requiredCapabilities: ${brief.requiredCapabilities.join(", ")}`,
    "- [ ] listing.md 描述完整（职责+示例+输入+输出+禁止+质量）",
    "- [ ] SOP.md 包含每日和每周流程",
    "- [ ] skills.md 包含所有声明技能",
  ].join("\n");

  return { packageDir, files };
}

// ======================================================================
// 校验
// ======================================================================

function validatePackage(pkgDir: string, session: BuildSessionRecord): string[] {
  const errors: string[] = [];

  if (!existsSync(path.join(pkgDir, "manifest.json"))) {
    errors.push("缺少 manifest.json");
  }
  if (!existsSync(path.join(pkgDir, "listing.md"))) {
    errors.push("缺少 listing.md");
  }
  if (!existsSync(path.join(pkgDir, "SOP.md"))) {
    errors.push("缺少 SOP.md");
  }

  if (session.brief && errors.length === 0) {
    // 检查 manifest 内容
    try {
      const manifest = JSON.parse(readFileSync(path.join(pkgDir, "manifest.json"), "utf-8"));
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

  return errors;
}

// ======================================================================
// Helpers
// ======================================================================

function sanitizeDirName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9一-鿿_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
}
