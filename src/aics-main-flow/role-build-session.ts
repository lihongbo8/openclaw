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
export const MAX_DEVELOPER_BUILD_SESSIONS = 3;

export type BuildSessionBrief = {
  roleTitle: string;
  roleDescription: string;
  targetUser?: string;
  targetCategory: string;
  coreResponsibilities: string[];
  taskExamples: string[];
  dailySop: string[];
  weeklySop: string[];
  monthlySop?: string[];
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

export type BuildSessionScopeReduction = {
  keptCapabilities: string[];
  disabledCapabilities: string[];
  reason: string;
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function listSessionsFromDisk(): BuildSessionRecord[] {
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
}

function countsTowardDeveloperLimit(session: BuildSessionRecord): boolean {
  return session.state !== "failed" && session.state !== "cancelled";
}

export function countDeveloperBuildSessions(): number {
  return listSessionsFromDisk().filter(countsTowardDeveloperLimit).length;
}

export function assertDeveloperBuildSessionLimit(): void {
  const current = countDeveloperBuildSessions();
  if (current >= MAX_DEVELOPER_BUILD_SESSIONS) {
    throw new Error(
      `开发者中心暂定最多开发 ${MAX_DEVELOPER_BUILD_SESSIONS} 个岗位。请先取消或清理已有岗位后再创建新岗位。`,
    );
  }
}

// ======================================================================
// Public API
// ======================================================================

export const BuildSession = {
  /** 创建新会话 */
  create(requirements: string): BuildSessionRecord {
    assertDeveloperBuildSessionLimit();
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
    return listSessionsFromDisk();
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
    if (isMarketplaceOpsRequirement(lowerReqs)) {
      matched = undefined;
    } else if (
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

  /** confirming → confirming: 关闭缺失能力，继续生成基础版岗位 */
  reduceScopeToBasicVersion(
    sessionId: string,
    reduction: BuildSessionScopeReduction,
  ): BuildSessionRecord {
    const session = loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.state !== "confirming") {
      throw new Error(`Cannot reduce scope from state "${session.state}"`);
    }
    if (!session.brief) {
      throw new Error("Brief is required before reducing scope");
    }
    const keptCapabilities = uniqueStrings(reduction.keptCapabilities);
    const disabledCapabilities = uniqueStrings(reduction.disabledCapabilities);
    if (keptCapabilities.length === 0) {
      throw new Error("当前没有可保留的已具备能力，不能生成基础版岗位。");
    }
    if (disabledCapabilities.length === 0) {
      throw new Error("没有需要关闭的缺失能力。");
    }
    const disabledMessage = `基础版已关闭暂不可用能力：${disabledCapabilities.join("、")}。`;
    const reason = reduction.reason.trim() || "缺失能力暂不可用，先生成基础版岗位。";
    session.brief = {
      ...session.brief,
      requiredCapabilities: keptCapabilities,
      forbiddenActions: uniqueStrings([...session.brief.forbiddenActions, disabledMessage]),
      qualityStandards: uniqueStrings([
        ...session.brief.qualityStandards,
        `基础版范围说明：${reason}`,
      ]),
    };
    session.capabilityReport = resolveCapabilities(keptCapabilities);
    session.userConfirmations.push(`${disabledMessage} ${reason}`);
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

function isMarketplaceOpsRequirement(value: string): boolean {
  return (
    (value.includes("商城") && value.includes("运营")) ||
    value.includes("岗位商城") ||
    value.includes("授权转化") ||
    value.includes("执行成功率") ||
    value.includes("ledger") ||
    value.includes("audit") ||
    value.includes("审计") ||
    value.includes("账本")
  );
}

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
      workPatterns: inferWorkPatterns(brief),
      outputContracts: inferOutputContracts(brief),
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

  // README.md
  files["README.md"] = [
    `# ${brief.roleTitle}`,
    "",
    brief.roleDescription,
    "",
    "## 本地上架检查",
    "- 岗位包生成完成后进入本地上架检查。",
    "- 必须通过一键综合检查和人工确认后，由岗位开发者确认生成本地正式岗位商品。",
  ].join("\n");

  // SOP.md
  files["SOP.md"] = [
    "# 标准操作流程",
    "",
    template?.commonSop ?? "",
    "",
    "## 目标用户",
    brief.targetUser || "未填写",
    "",
    "## 每日",
    ...brief.dailySop.map((s) => `- ${s}`),
    "",
    "## 每周",
    ...brief.weeklySop.map((s) => `- ${s}`),
    "",
    "## 每月",
    ...(brief.monthlySop ?? []).map((s) => `- ${s}`),
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

function inferWorkPatterns(brief: BuildSessionBrief): string[] {
  const text = [
    brief.roleDescription,
    ...brief.coreResponsibilities,
    ...brief.taskExamples,
    ...brief.outputTypes,
  ].join(" ");
  const patterns = new Set<string>();
  if (/分析|诊断|复盘|报告|总结|数据|指标/u.test(text)) patterns.add("analyze");
  if (/生成|撰写|创作|设计|图片|文案|详情页|报告/u.test(text)) patterns.add("generate");
  if (/转换|整理|改写|格式/u.test(text)) patterns.add("transform");
  if (/发布|上传|创建工单|修改库存|外部系统/u.test(text)) patterns.add("operate");
  if (patterns.size > 1) patterns.add("composite");
  if (patterns.size === 0) patterns.add("generate");
  return [...patterns];
}

function inferOutputContracts(brief: BuildSessionBrief): string[] {
  const text = [...brief.outputTypes, brief.roleDescription, ...brief.taskExamples].join(" ");
  const contracts = new Set<string>();
  if (/图片|图像|海报|视觉|png|jpg|jpeg|webp/u.test(text)) contracts.add("image");
  if (/详情页|页面|html|网页|landing/u.test(text)) contracts.add("html");
  if (/表格|xlsx|csv|数据表/u.test(text)) contracts.add("spreadsheet");
  if (/json|结构化/u.test(text)) contracts.add("json");
  if (/发布|上传|工单|外部记录|record/u.test(text)) contracts.add("external_record");
  if (/打包|zip|压缩包|交付包/u.test(text)) contracts.add("package");
  if (/报告|文档|复盘|总结|方案|草稿|计划/u.test(text)) contracts.add("document");
  if (contracts.size === 0) contracts.add("document");
  return [...contracts];
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
  if (!existsSync(path.join(pkgDir, "README.md"))) {
    errors.push("缺少 README.md");
  }
  if (!existsSync(path.join(pkgDir, "SOP.md"))) {
    errors.push("缺少 SOP.md");
  }
  if (!existsSync(path.join(pkgDir, "validation.md"))) {
    errors.push("缺少 validation.md");
  }

  if (session.brief && errors.length === 0) {
    // 检查 manifest 内容
    try {
      const manifest = JSON.parse(readFileSync(path.join(pkgDir, "manifest.json"), "utf-8"));
      if (!manifest.requiredCapabilities?.length) {
        errors.push("manifest.json 缺少 requiredCapabilities");
      }
      if (!manifest.workPatterns?.length) {
        errors.push("manifest.json 缺少 workPatterns");
      }
      if (!manifest.outputContracts?.length) {
        errors.push("manifest.json 缺少 outputContracts");
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
