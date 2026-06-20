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

export type AicsChatAccountDataSummary = {
  statusLabel?: string;
  currentGoal?: string;
  goalSummary?: string[];
  goalRecommendation?: string;
  currentBlocker?: string;
  nextStep?: string;
  nextTab?: string;
  stageCards?: Array<{ label: string; statusLabel: string; nextAction: string }>;
  systemUsageSummary?: string[];
  cloudMarketplaceSummary?: string[];
  localOpenClawSummary?: string[];
  roleUsageSummary?: string[];
  apiToolSkillSummary?: string[];
  auditLedgerSummary?: string[];
  planningSummary?: string[];
  dispatchSummary?: string[];
  nextObservationSummary?: string[];
  blockedSummary?: string[];
  observationSummary?: string;
  attributionSummary?: string;
  executionSummary?: string;
  evidenceSummary?: string[];
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
  accountData?: AicsChatAccountDataSummary;
}): string {
  const stageKey =
    params.context.stage && params.context.stage !== "ready" ? params.context.stage : "idle";
  const stage = AICS_MAIN_WORKFLOW_STAGE_LABELS[stageKey] ?? AICS_MAIN_WORKFLOW_STAGE_LABELS.idle;
  const executionChannel = params.context.executionChannel ?? "local_openclaw";
  const roleHints = [
    params.context.roleListingId
      ? `- 已选择岗位编号（不要向用户复述原始编号）: ${params.context.roleListingId}`
      : undefined,
    params.context.roleTitle ? `- 已选择岗位名称: ${params.context.roleTitle}` : undefined,
    params.context.roleQuery ? `- 岗位匹配提示: ${params.context.roleQuery}` : undefined,
    params.context.workspaceDir
      ? `- 系统已知本地工作区路径（不要主动复述完整路径）: ${params.context.workspaceDir}`
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
          "只有本地主流程已经形成正式派发单和执行队列后，岗位执行页才允许进入已批准任务运行。",
        ];
  const accountDataLines = params.accountData
    ? [
        "",
        "当前账号真实经营数据摘要（只用于回答用户，不要编造未出现的数据）:",
        params.accountData.statusLabel ? `- 系统状态：${params.accountData.statusLabel}` : "",
        params.accountData.currentGoal ? `- 当前经营目标：${params.accountData.currentGoal}` : "",
        ...(params.accountData.goalSummary?.length
          ? [`- 目标详情：${params.accountData.goalSummary.join("；")}`]
          : []),
        params.accountData.goalRecommendation
          ? `- 当前最应该推进的目标：${params.accountData.goalRecommendation}`
          : "",
        params.accountData.currentBlocker ? `- 当前卡点：${params.accountData.currentBlocker}` : "",
        params.accountData.nextStep
          ? `- 建议下一步：${params.accountData.nextStep}${params.accountData.nextTab ? `（去 ${params.accountData.nextTab}）` : ""}`
          : "",
        params.accountData.observationSummary
          ? `- 观察数据：${params.accountData.observationSummary}`
          : "",
        params.accountData.attributionSummary
          ? `- 归因结果：${params.accountData.attributionSummary}`
          : "",
        ...(params.accountData.systemUsageSummary?.length
          ? [`- 系统使用：${params.accountData.systemUsageSummary.join("；")}`]
          : []),
        ...(params.accountData.cloudMarketplaceSummary?.length
          ? [`- 云端商城：${params.accountData.cloudMarketplaceSummary.join("；")}`]
          : []),
        ...(params.accountData.localOpenClawSummary?.length
          ? [`- 本地 OpenClaw：${params.accountData.localOpenClawSummary.join("；")}`]
          : []),
        ...(params.accountData.apiToolSkillSummary?.length
          ? [`- API/模型/工具/Skill：${params.accountData.apiToolSkillSummary.join("；")}`]
          : []),
        ...(params.accountData.roleUsageSummary?.length
          ? [`- 岗位使用：${params.accountData.roleUsageSummary.join("；")}`]
          : []),
        ...(params.accountData.planningSummary?.length
          ? [`- 规划方案：${params.accountData.planningSummary.join("；")}`]
          : []),
        ...(params.accountData.dispatchSummary?.length
          ? [`- 任务调度：${params.accountData.dispatchSummary.join("；")}`]
          : []),
        ...(params.accountData.nextObservationSummary?.length
          ? [`- 下一轮观察：${params.accountData.nextObservationSummary.join("；")}`]
          : []),
        ...(params.accountData.auditLedgerSummary?.length
          ? [`- 审计账本：${params.accountData.auditLedgerSummary.join("；")}`]
          : []),
        ...(params.accountData.blockedSummary?.length
          ? [`- 当前阻塞：${params.accountData.blockedSummary.join("；")}`]
          : []),
        params.accountData.executionSummary
          ? `- 执行结果：${params.accountData.executionSummary}`
          : "",
        ...(params.accountData.evidenceSummary?.length
          ? [`- 证据读回：${params.accountData.evidenceSummary.join("；")}`]
          : []),
        ...(params.accountData.stageCards?.length
          ? [
              "- 六层进度：" +
                params.accountData.stageCards
                  .map((item) => `${item.label}${item.statusLabel ? ` ${item.statusLabel}` : ""}`)
                  .join(" / "),
            ]
          : []),
        "- 回答边界：可以解释状态、指出卡点、建议去哪个页面确认；不能替用户确认目标、确认规划、派发任务或执行岗位。",
      ].filter(Boolean)
    : [];

  return [
    "[迭界AI业务对话]",
    `当前角色：${params.context.mode === "openclaw_main" ? "本地业务对话助手" : "使用者中心任务助手"}`,
    `内部状态（只用于判断，不要向用户展示或复述）：${stage.label}。${stage.detail}`,
    ...channelInstructions,
    "对用户保持正常业务对话：不要暴露内部状态机、技术对象、分层名称或流程阶段。",
    "需要说明状态时，只用业务语言，例如：目标缺数据、项目待确认、任务等待处理、岗位未授权、交付已完成。",
    "当用户问“系统哪里有问题”“下一步做什么”“现在能不能用”时，必须优先按四件事回答：当前状态、主要卡点、下一步去哪个页面、做完会得到什么结果；如果账号摘要里没有对应数据，就明确说还缺哪类数据，不要编造。",
    "用户只需要说业务目标和岗位选择；cloudBaseUrl、cloud access token、execution token、entitlement、device、workspace_ref、local_gateway_id、audit upload 和费用归属都由 gateway 内部解析、校验和记录。",
    "不要要求用户粘贴 bearer token、execution token、授权编号、订单编号、结算编号、云端地址或本地 gateway id。",
    "公司目标来自数据分析、归因分析和用户确认的共同结果：数据分析提供事实和证据，归因分析解释差距和原因，两者齐全后才能生成目标候选，经用户确认后才成为正式公司目标。不要跳过观察或归因直接创建目标。",
    "必须按观察、归因、目标、规划、调度、岗位的顺序推进；没有用户确认的公司目标不能规划，没有确认后的规划方案和岗位工作块不能调度，没有正式派发单和执行队列不能执行岗位。",
    "当用户讨论“公司管理”“公司管理看板”“目标拆解后的状态”“详情页转化完成程度”时，把它理解为经营拆解状态看板，而不是公司目标总览页。",
    "公司管理看板只围绕已确认公司目标之后的拆解工作展示：工作块/项目主题、承接岗位、岗位任务、完成度、阻塞点、是否可进入调度；不要在这里重复展示公司目标页的总目标摘要，例如“岗位商城授权转化：整体 58%”。",
    "如果用户给出岗位商城运营目标，例如提升首批岗位授权转化与执行成功率，应先把目标拆成岗位供给、详情页转化、执行质量、授权费用、审核治理等工作块，再为每个工作块匹配岗位和任务状态候选。",
    "工作块拆解输出要使用业务语言：工作块名称、目的、进度口径、承接岗位、岗位要做的任务、目标产物、当前状态、阻塞原因、下一步确认点。",
    "公司管理页可以形成待调度任务候选，但不能直接调用岗位、不能调用 provider、不能生成正式派发单；用户点击或确认进入调度后，才通过规划/调度层创建正式规划、岗位工作块或派发预检。",
    "执行结果只能来自调度层读回的业务结果、审计记录、费用账本和失败原因；不要伪造执行结果，也不要向用户展示内部对象名。",
    "如果没有系统已知本地工作区路径，先请用户选择当前本地工作区，不要自己编造路径。",
    ...(roleHints.length > 0 ? ["", "系统传入的岗位/工作区上下文:", ...roleHints] : []),
    ...accountDataLines,
    "",
    "用户消息:",
    params.message,
  ].join("\n");
}

export function buildAicsModelPrompt(params: {
  message: string;
  context: ChatSendAicsContext;
  accountData?: AicsChatAccountDataSummary;
}): string {
  return params.context.mode === "developer"
    ? buildAicsDeveloperModeModelPrompt({
        message: params.message,
        stage: params.context.stage,
      })
    : buildAicsMainWorkflowModelPrompt({
        message: params.message,
        context: params.context,
        accountData: params.accountData,
      });
}
