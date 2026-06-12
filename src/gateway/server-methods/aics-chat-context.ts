const AICS_DEVELOPER_STAGE_LABELS: Record<string, { label: string; detail: string }> = {
  ready: { label: "使用就绪", detail: "处理岗位使用、任务安排和执行结果。" },
  idle: { label: "等待业务逻辑", detail: "只讲业务问题、使用对象和判断流程。" },
  intake: { label: "收集业务逻辑", detail: "收集岗位业务逻辑，尚不触发生成包或上传流程。" },
  clarifying: { label: "追问业务事实", detail: "只针对业务逻辑不清楚处追问。" },
  briefGenerated: { label: "岗位规格已整理", detail: "已形成业务可读的岗位规格草案。" },
  awaitingBusinessConfirmation: { label: "等待业务确认", detail: "只确认业务理解是否正确。" },
  buildingPackage: { label: "整理岗位资料", detail: "正在整理可上架的岗位资料。" },
  validatingPackage: { label: "安全检查", detail: "正在检查岗位资料是否适合上架。" },
  readyToUpload: { label: "可上传开发者中心", detail: "岗位资料已准备好，可提交审核。" },
  submittedForReview: { label: "等待审核", detail: "岗位资料已提交，等待审核。" },
};

const AICS_MAIN_WORKFLOW_STAGE_LABELS: Record<string, { label: string; detail: string }> = {
  ready: { label: "可处理", detail: "可以理解用户目标、选择已授权岗位并进入任务确认。" },
  idle: { label: "等待任务", detail: "等待用户说明业务目标或岗位使用意图。" },
  goalIntake: { label: "理解目标", detail: "把用户的自然语言目标整理成可确认任务建议。" },
  planning: { label: "任务准备", detail: "匹配已安装岗位、确认工作区和人工确认点。" },
  awaitingConfirmation: { label: "等待确认", detail: "需要用户确认任务、岗位和费用归属后再执行。" },
  dispatching: { label: "进入任务中心", detail: "通过 gateway 交给本地任务工具处理。" },
  running: { label: "执行中", detail: "岗位任务正在本地 OpenClaw 工具池中运行。" },
  completed: { label: "已完成", detail: "执行完成后回读结果、费用和 audit 摘要。" },
  failed: { label: "执行失败", detail: "解释失败原因并给出可恢复步骤。" },
};

type AicsExecutionChannel = "local_openclaw" | "cloud_user_center";

export type ChatSendAicsContext =
  | {
      mode: "developer";
      stage?: string;
    }
  | {
      mode: "user" | "openclaw_main";
      stage?: string;
      executionChannel?: AicsExecutionChannel;
      roleListingId?: string;
      roleTitle?: string;
      roleQuery?: string;
      workspaceDir?: string;
    };

function trimmedStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeExecutionChannel(value: unknown): AicsExecutionChannel | undefined {
  return value === "local_openclaw" || value === "cloud_user_center" ? value : undefined;
}

export function normalizeChatSendAicsContext(value: unknown): ChatSendAicsContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.mode === "developer") {
    return {
      mode: "developer",
      ...(trimmedStringField(record, "stage")
        ? { stage: trimmedStringField(record, "stage") }
        : {}),
    };
  }
  if (record.mode === "user" || record.mode === "openclaw_main") {
    return {
      mode: record.mode,
      ...(trimmedStringField(record, "stage")
        ? { stage: trimmedStringField(record, "stage") }
        : {}),
      ...(normalizeExecutionChannel(record.executionChannel)
        ? { executionChannel: normalizeExecutionChannel(record.executionChannel) }
        : {}),
      ...(trimmedStringField(record, "roleListingId")
        ? { roleListingId: trimmedStringField(record, "roleListingId") }
        : {}),
      ...(trimmedStringField(record, "roleTitle")
        ? { roleTitle: trimmedStringField(record, "roleTitle") }
        : {}),
      ...(trimmedStringField(record, "roleQuery")
        ? { roleQuery: trimmedStringField(record, "roleQuery") }
        : {}),
      ...(trimmedStringField(record, "workspaceDir")
        ? { workspaceDir: trimmedStringField(record, "workspaceDir") }
        : {}),
    };
  }
  return null;
}

export function buildAicsDeveloperModeModelPrompt(params: {
  message: string;
  stage?: string;
}): string {
  const stageKey = params.stage && params.stage !== "ready" ? params.stage : "idle";
  const stage = AICS_DEVELOPER_STAGE_LABELS[stageKey] ?? AICS_DEVELOPER_STAGE_LABELS.idle;
  return [
    "[迭界AI开发者模式]",
    "当前角色：岗位开发专属助手",
    "工作身份：同一个聊天框下的岗位开发工作身份",
    `内部工作状态（只用于判断，不要向用户展示或复述）：${stage.label}。${stage.detail}`,
    "你是岗位开发专属助手。开发者只需要用自然语言讲业务逻辑，不需要填写输入、输出、规则、验收标准、平台接口、协议字段、授权字段、审计字段、计费字段或上传字段。",
    "输入、输出、规则、验收标准、岗位包结构、协议映射、验证材料和上传标准都是平台职责，已经内置在你的资料包里；不要让开发者定义、填写或逐项确认这些平台标准。",
    "当业务逻辑足够清楚时，先生成业务可读的规格草案并请开发者确认；开发者确认后调用 `dijie_role_builder`，使用 `confirm_brief=true`、`package_only=true` 和已确认的 RoleBuildBrief JSON 生成公开 `role_package/`。",
    "开发者包生成发生在创建岗位商品和购买执行之前；不要为 package_only 路径索要或传入 execution token、entitlement、订单、钱包、workspace、device、Gateway、审计或结算字段。",
    "如果业务逻辑不清楚，只用业务语言追问。不要暴露后端实现、执行 token、云端 bearer、授权编号、岗位 listing id、订单编号或结算归属字段。",
    "",
    "开发者消息:",
    params.message,
  ].join("\n");
}

export function buildAicsMainWorkflowModelPrompt(params: {
  message: string;
  context: Extract<ChatSendAicsContext, { mode: "user" | "openclaw_main" }>;
}): string {
  const stageKey =
    params.context.stage && params.context.stage !== "ready" ? params.context.stage : "idle";
  const stage = AICS_MAIN_WORKFLOW_STAGE_LABELS[stageKey] ?? AICS_MAIN_WORKFLOW_STAGE_LABELS.idle;
  const executionChannel = params.context.executionChannel ?? "local_openclaw";
  const roleHints = [
    params.context.roleListingId
      ? `- 已选择岗位 listing id: ${params.context.roleListingId}`
      : undefined,
    params.context.roleTitle ? `- 已选择岗位名称: ${params.context.roleTitle}` : undefined,
    params.context.roleQuery ? `- 岗位匹配提示: ${params.context.roleQuery}` : undefined,
    params.context.workspaceDir
      ? `- 系统已知 workspace_dir: ${params.context.workspaceDir}`
      : undefined,
  ].filter(Boolean);
  const channelInstructions =
    executionChannel === "cloud_user_center"
      ? [
          "执行渠道：使用者中心云端执行。独立个人用户的岗位执行由使用者中心后端 action router 承接。",
          "在这个 OpenClaw 主对话中不要调用本地 `dijie_role_task_run`；说明需要回到使用者中心确认并执行。",
        ]
      : [
          "执行渠道：公司客户本地 OpenClaw。",
          "主对话不能直接调用岗位执行工具，也不能绕过本地主流程调度岗位。",
          "你只能解释当前业务状态、导航确认点，并通过 `aics.mainFlow.*` 准备观察、归因、目标、规划和调度候选项。",
          "只有本地主流程已经形成 `TaskPackage` 和 `DispatchToRoleRequest` 后，调度层才允许进入已批准任务运行。",
        ];

  return [
    "[迭界AI业务对话]",
    `当前角色：${params.context.mode === "openclaw_main" ? "本地业务对话助手" : "使用者中心任务助手"}`,
    `内部状态（只用于判断，不要向用户展示或复述）：${stage.label}。${stage.detail}`,
    ...channelInstructions,
    "对用户保持正常业务对话：不要暴露内部状态机、技术对象、分层名称或流程阶段。",
    "需要说明状态时，只用业务语言，例如：目标缺数据、项目待确认、任务等待处理、岗位未授权、交付已完成。",
    "用户只需要说业务目标和岗位选择；cloudBaseUrl、cloud access token、execution token、entitlement、device、workspace_ref、local_gateway_id、audit upload 和费用归属都由 gateway 内部解析、校验和记录。",
    "不要要求用户粘贴 bearer token、execution token、授权编号、订单编号、结算编号、云端地址或本地 gateway id。",
    "必须按观察、归因、目标、规划、调度、岗位的顺序推进；没有用户确认的 CompanyGoal 不能规划，没有确认后的 PlanningPackage / RolePlanItem 不能调度，没有 TaskPackage / DispatchToRoleRequest 不能执行岗位。",
    "执行结果只能来自调度层回读的 RoleResult、AuditSummary、费用归属和失败原因；不要伪造执行结果。",
    "如果没有系统已知 workspace_dir，先请用户选择当前本地工作区，不要自己编造路径。",
    ...(roleHints.length > 0 ? ["", "系统传入的岗位/工作区上下文:", ...roleHints] : []),
    "",
    "用户消息:",
    params.message,
  ].join("\n");
}

export function buildAicsModelPrompt(params: {
  message: string;
  context: ChatSendAicsContext;
}): string {
  return params.context.mode === "developer"
    ? buildAicsDeveloperModeModelPrompt({
        message: params.message,
        stage: params.context.stage,
      })
    : buildAicsMainWorkflowModelPrompt({
        message: params.message,
        context: params.context,
      });
}
