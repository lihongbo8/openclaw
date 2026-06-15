import type { ToolCapabilityGroup } from "./tool-registry.js";

// ======================================================================
// 共享技能目录（Skill Catalog）
// ======================================================================
//
// 按品类组织的通用技能。岗位包只声明 requiredCapabilities，
// 具体工具从共享目录匹配，不重复定义"图片生成怎么调"。
//
// 新品类岗位基于模板继承通用能力，只补充品类特有的 SOP 和 knowledge。

export type SkillEntry = {
  skillId: string;
  label: string;
  description: string;
  /** 对应的工具能力 */
  capability: ToolCapabilityGroup;
  /** 标准输入说明 */
  inputContract: string;
  /** 标准输出说明 */
  outputContract: string;
  /** 质量检查提示 */
  qualityHints: string[];
};

export type CategoryTemplate = {
  categoryId: string;
  label: string;
  description: string;
  /** 该品类默认需要的能力 */
  defaultCapabilities: ToolCapabilityGroup[];
  /** 该品类的通用技能 */
  skills: SkillEntry[];
  /** 通用 SOP 片段（被岗位包继承） */
  commonSop: string;
};

// ======================================================================
// 技能目录
// ======================================================================

export const SKILL_CATALOG: Record<string, SkillEntry> = {
  // ---- image.* ----
  "img:gen": {
    skillId: "img:gen",
    label: "图片生成",
    description: "根据文本描述生成图片，支持风格、尺寸、格式控制",
    capability: "image.generation",
    inputContract: "prompt（文本描述），style（风格），size（尺寸），format（png/jpg/webp）",
    outputContract: "图片文件路径（本地）或 URL（远程）",
    qualityHints: ["检查图片分辨率是否符合要求", "检查格式是否正确", "检查内容是否与描述一致"],
  },
  "img:edit": {
    skillId: "img:edit",
    label: "图片编辑",
    description: "裁剪、调色、合成、换背景、抠图",
    capability: "image.editing",
    inputContract:
      "sourceFile（源文件路径），operations（操作列表：crop/resize/recolor/composite），params",
    outputContract: "编辑后的图片文件路径",
    qualityHints: ["检查编辑前后尺寸是否正确", "检查颜色是否失真", "检查合成边缘是否自然"],
  },
  "img:inspect": {
    skillId: "img:inspect",
    label: "图片分析",
    description: "分析图片内容、质量、格式，提取元数据",
    capability: "image.inspect",
    inputContract: "filePath（图片路径）",
    outputContract: "{ width, height, format, colorSpace, hasAlpha, qualityScore }",
    qualityHints: ["检查图片是否能正常打开", "检查元数据完整性"],
  },

  // ---- video.* ----
  "vid:gen": {
    skillId: "vid:gen",
    label: "视频生成",
    description: "根据脚本/描述生成短视频",
    capability: "video.generation",
    inputContract: "script/description，duration，style，resolution",
    outputContract: "视频文件路径",
    qualityHints: ["检查视频时长", "检查分辨率", "检查音视频同步"],
  },
  "vid:edit": {
    skillId: "vid:edit",
    label: "视频剪辑",
    description: "剪辑、拼接、转场、调速",
    capability: "video.editing",
    inputContract: "sourceFiles，timeline，transitions",
    outputContract: "剪辑后的视频文件路径",
    qualityHints: ["检查剪辑点是否精确", "检查转场是否流畅"],
  },
  "vid:caption": {
    skillId: "vid:caption",
    label: "字幕生成",
    description: "自动生成/嵌入字幕",
    capability: "video.caption",
    inputContract: "videoFile，language，style",
    outputContract: "字幕文件（srt/ass）或嵌入字幕的视频",
    qualityHints: ["检查字幕时间轴", "检查文字准确度", "检查字幕位置"],
  },
  "vid:audio": {
    skillId: "vid:audio",
    label: "音频处理",
    description: "背景音乐、配音、混音",
    capability: "video.audio",
    inputContract: "audioFiles，operations（mix/replace/volume），params",
    outputContract: "处理后的音频或视频文件",
    qualityHints: ["检查音量平衡", "检查音画同步"],
  },

  // ---- workspace.* ----
  "ws:read": {
    skillId: "ws:read",
    label: "读取工作区文件",
    description: "读取工作区内的文件内容",
    capability: "workspace.read",
    inputContract: "filePath（相对于工作区根目录）",
    outputContract: "文件内容（文本或 base64）",
    qualityHints: ["检查文件是否存在", "检查编码是否正确"],
  },
  "ws:write": {
    skillId: "ws:write",
    label: "写入工作区文件",
    description: "在工作区内写入文件",
    capability: "workspace.write",
    inputContract: "filePath, content, encoding",
    outputContract: "写入确认",
    qualityHints: ["检查路径在工作区范围内", "检查文件大小合理"],
  },
  "ws:shell": {
    skillId: "ws:shell",
    label: "执行命令",
    description: "在工作区内执行系统命令",
    capability: "workspace.shell",
    inputContract: "command, cwd, env",
    outputContract: "{ exitCode, stdout, stderr }",
    qualityHints: ["检查命令在工作区范围内", "检查超时", "审计命令内容"],
  },

  // ---- file.* ----
  "file:pack": {
    skillId: "file:pack",
    label: "产物打包",
    description: "将工作区产物打包为 zip/tar",
    capability: "file.packaging",
    inputContract: "files（文件列表），format（zip/tar），outputName",
    outputContract: "打包文件路径",
    qualityHints: ["检查所有文件都在工作区内", "检查包大小", "检查包完整性"],
  },

  // ---- web.* ----
  "web:search": {
    skillId: "web:search",
    label: "网页搜索",
    description: "搜索互联网获取信息",
    capability: "web.search",
    inputContract: "query, maxResults, language",
    outputContract: "搜索结果列表 { title, url, snippet }",
    qualityHints: ["检查结果相关性", "检查来源可信度"],
  },
  "web:fetch": {
    skillId: "web:fetch",
    label: "网页抓取",
    description: "抓取网页内容并转换为文本",
    capability: "web.fetch",
    inputContract: "url, format（text/markdown/html）",
    outputContract: "网页内容文本",
    qualityHints: ["检查 URL 合法性", "检查内容完整性"],
  },

  // ---- human.* ----
  "human:confirm": {
    skillId: "human:confirm",
    label: "人工确认",
    description: "请求人工确认关键操作",
    capability: "human.confirm",
    inputContract: "question, context, options",
    outputContract: "{ confirmed: boolean, choice: string, note: string }",
    qualityHints: ["确保问题清晰", "提供充分上下文"],
  },
};

// ======================================================================
// 品类能力模板
// ======================================================================

export const CATEGORY_TEMPLATES: CategoryTemplate[] = [
  {
    categoryId: "ecommerce-visual",
    label: "电商美工",
    description: "电商产品图片和视觉素材制作",
    defaultCapabilities: [
      "image.generation",
      "image.editing",
      "image.inspect",
      "workspace.read",
      "workspace.write",
      "file.packaging",
      "human.confirm",
    ],
    skills: [
      SKILL_CATALOG["img:gen"],
      SKILL_CATALOG["img:edit"],
      SKILL_CATALOG["img:inspect"],
      SKILL_CATALOG["ws:read"],
      SKILL_CATALOG["ws:write"],
      SKILL_CATALOG["file:pack"],
      SKILL_CATALOG["human:confirm"],
    ],
    commonSop: [
      "# 电商美工通用 SOP",
      "",
      "## 每日",
      "- 检查素材库新入库图片质量和格式",
      "- 处理待办产品图任务（抠图 → 调色 → 套版 → 输出）",
      "- 更新素材索引",
      "",
      "## 每周",
      "- 检查品牌视觉标准一致性",
      "- 清理过期临时文件",
      "- 生成周度产出统计",
      "",
      "## 图片标准",
      "- 产品主图: 800x800px, 白色背景, PNG",
      "- 详情图: 宽度790px, JPG/PNG, 单张≤2MB",
      "- Banner: 1920x600px, JPG",
      "",
      "## 禁止操作",
      "- 不自动上传平台",
      "- 不编造产品卖点",
      "- 不使用未授权素材",
      "- 不生成与产品不一致的效果图",
    ].join("\n"),
  },
  {
    categoryId: "video-production",
    label: "视频制作",
    description: "短视频脚本、剪辑、字幕、成片输出",
    defaultCapabilities: [
      "video.generation",
      "video.editing",
      "video.caption",
      "video.audio",
      "workspace.read",
      "workspace.write",
      "file.packaging",
      "human.confirm",
    ],
    skills: [
      SKILL_CATALOG["vid:gen"],
      SKILL_CATALOG["vid:edit"],
      SKILL_CATALOG["vid:caption"],
      SKILL_CATALOG["vid:audio"],
      SKILL_CATALOG["ws:read"],
      SKILL_CATALOG["ws:write"],
      SKILL_CATALOG["file:pack"],
      SKILL_CATALOG["human:confirm"],
    ],
    commonSop: [
      "# 视频制作通用 SOP",
      "",
      "## 流程",
      "1. 接收需求 → 撰写脚本 → 确认脚本",
      "2. 生成分镜 → 确认分镜",
      "3. 生成素材 → 剪辑 → 加字幕 → 加BGM",
      "4. 输出成片 → 质量检查 → 交付",
      "",
      "## 禁止操作",
      "- 不自动发布视频",
      "- 不投流",
      "- 不夸大产品效果",
      "- 不使用未授权素材",
    ].join("\n"),
  },
  {
    categoryId: "data-analysis",
    label: "数据分析",
    description: "数据采集、分析、可视化、报告生成",
    defaultCapabilities: [
      "web.search",
      "web.fetch",
      "workspace.read",
      "workspace.write",
      "workspace.shell",
      "file.packaging",
      "human.confirm",
    ],
    skills: [
      SKILL_CATALOG["web:search"],
      SKILL_CATALOG["web:fetch"],
      SKILL_CATALOG["ws:read"],
      SKILL_CATALOG["ws:write"],
      SKILL_CATALOG["ws:shell"],
      SKILL_CATALOG["file:pack"],
      SKILL_CATALOG["human:confirm"],
    ],
    commonSop: [
      "# 数据分析通用 SOP",
      "",
      "## 流程",
      "1. 明确分析需求 → 确定数据源",
      "2. 采集数据 → 清洗 → 分析",
      "3. 生成可视化 → 撰写报告",
      "4. 交付 → 评审",
    ].join("\n"),
  },
];

// ======================================================================
// API
// ======================================================================

/** 根据品类ID获取模板 */
export function getCategoryTemplate(categoryId: string): CategoryTemplate | undefined {
  return CATEGORY_TEMPLATES.find((t) => t.categoryId === categoryId);
}

/** 列出所有品类模板 */
export function listCategoryTemplates(): CategoryTemplate[] {
  return CATEGORY_TEMPLATES;
}

/** 根据 requiredCapabilities 获取匹配的品类模板 */
export function findMatchingTemplates(requiredCapabilities: string[]): CategoryTemplate[] {
  return CATEGORY_TEMPLATES.filter((tpl) =>
    requiredCapabilities.every(
      (cap) =>
        tpl.defaultCapabilities.includes(cap as ToolCapabilityGroup) ||
        tpl.defaultCapabilities.some(
          (dc) => dc === cap || dc.startsWith(cap) || cap.startsWith(dc),
        ),
    ),
  );
}

/** 根据能力获取对应技能 */
export function findSkillsForCapability(capability: ToolCapabilityGroup): SkillEntry[] {
  return Object.values(SKILL_CATALOG).filter((skill) => skill.capability === capability);
}

/** 根据多个能力获取对应技能列表 */
export function findSkillsForCapabilities(capabilities: ToolCapabilityGroup[]): SkillEntry[] {
  return Object.values(SKILL_CATALOG).filter((skill) => capabilities.includes(skill.capability));
}
