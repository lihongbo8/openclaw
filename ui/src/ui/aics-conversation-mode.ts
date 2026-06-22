export type AicsConversationMode = "user" | "developer";

export type AicsConversationRole = "userExecutionAssistant" | "developerAssistant";

export type AicsConversationStage =
  | "ready"
  | "idle"
  | "intake"
  | "clarifying"
  | "briefGenerated"
  | "awaitingBusinessConfirmation"
  | "buildingPackage"
  | "validatingPackage"
  | "readyToUpload"
  | "submittedForReview";

export type AicsConversationProtocol = {
  mode: AicsConversationMode;
  role: AicsConversationRole;
  stage: AicsConversationStage;
  roleLabel: string;
  workIdentityLabel: string;
  stageLabel: string;
  stageDetail: string;
};

export const AICS_USER_ROLE_LABEL = "岗位授权与执行助手";
export const AICS_DEVELOPER_ROLE_LABEL = "岗位开发专属助手";

export const AICS_STAGE_LABELS: Record<AicsConversationStage, { label: string; detail: string }> = {
  ready: {
    label: "授权就绪",
    detail: "处理岗位授权、任务安排和执行结果。",
  },
  idle: {
    label: "等待业务逻辑",
    detail: "只讲业务问题、使用对象和判断流程。",
  },
  intake: {
    label: "收集业务逻辑",
    detail: "收集岗位业务逻辑，尚不触发生成包或上传流程。",
  },
  clarifying: {
    label: "追问业务事实",
    detail: "只针对业务逻辑不清楚处追问。",
  },
  briefGenerated: {
    label: "岗位规格已整理",
    detail: "已形成业务可读的岗位规格草案。",
  },
  awaitingBusinessConfirmation: {
    label: "等待业务确认",
    detail: "只确认业务理解是否正确。",
  },
  buildingPackage: {
    label: "整理岗位资料",
    detail: "正在整理可上架的岗位资料。",
  },
  validatingPackage: {
    label: "安全检查",
    detail: "正在检查岗位资料是否适合上架。",
  },
  readyToUpload: {
    label: "可上传开发者中心",
    detail: "岗位资料已准备好，可提交审核。",
  },
  submittedForReview: {
    label: "等待审核",
    detail: "岗位资料已提交，等待审核。",
  },
};

export function getDefaultAicsConversationStage(mode: AicsConversationMode): AicsConversationStage {
  return mode === "developer" ? "idle" : "ready";
}

export function resolveAicsConversationProtocol(
  mode: AicsConversationMode,
  stage: AicsConversationStage = getDefaultAicsConversationStage(mode),
): AicsConversationProtocol {
  if (mode === "user") {
    const readyStage = AICS_STAGE_LABELS.ready;
    return {
      mode,
      role: "userExecutionAssistant",
      stage: "ready",
      roleLabel: AICS_USER_ROLE_LABEL,
      workIdentityLabel: "同一个聊天框下的岗位授权与任务执行身份",
      stageLabel: readyStage.label,
      stageDetail: readyStage.detail,
    };
  }

  const developerStage = stage === "ready" ? "idle" : stage;
  const stageCopy = AICS_STAGE_LABELS[developerStage] ?? AICS_STAGE_LABELS.idle;
  return {
    mode,
    role: "developerAssistant",
    stage: developerStage,
    roleLabel: AICS_DEVELOPER_ROLE_LABEL,
    workIdentityLabel: "同一个聊天框下的岗位开发工作身份",
    stageLabel: stageCopy.label,
    stageDetail: stageCopy.detail,
  };
}

export function advanceAicsDeveloperStageForBusinessLogic(
  stage: AicsConversationStage = "idle",
): AicsConversationStage {
  return stage === "idle" || stage === "ready" ? "intake" : stage;
}
