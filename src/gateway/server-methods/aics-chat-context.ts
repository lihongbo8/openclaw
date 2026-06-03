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

export type ChatSendAicsContext = {
  mode: "developer";
  stage?: string;
};

export function normalizeChatSendAicsContext(value: unknown): ChatSendAicsContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.mode !== "developer") {
    return null;
  }
  return {
    mode: "developer",
    ...(typeof record.stage === "string" && record.stage.trim()
      ? { stage: record.stage.trim() }
      : {}),
  };
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
    `当前流程阶段：${stage.label}。${stage.detail}`,
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
