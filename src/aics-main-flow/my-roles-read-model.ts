// ═══ MyRolesReadModel — 本地岗位资产中心 ═══
//
// 聚合 marketplace roles + role-instances.db + tool registry
// 输出前端直接可渲染的"我的岗位"read model

import { existsSync } from "node:fs";
import { createRoleInstanceTables, getRoleInstancesDb } from "./db.js";
import { RoleInstanceStore } from "./role-instance-store.js";
import type {
  RoleInstanceRecord,
  RoleRunRecord,
  RoleArtifactRecord,
} from "./role-instance-store.js";
import { resolveCapabilities } from "./tool-registry.js";

// ═══ Types ═══

export type MyRolesReadModel = {
  updatedAt: number;
  summary: MyRolesSummary;
  roles: MyRoleCard[];
};

export type MyRolesSummary = {
  totalRoles: number;
  availableRoles: number;
  blockedRoles: number;
  missingCapabilityRoles: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  totalArtifacts: number;
  openQualityIssues: number;
  instanceStoreError?: string;
};

export type MyRoleCard = {
  roleKey: string;
  roleListingId?: string;
  entitlementId?: string;
  authorizationFeeCents?: number;
  priceLabel?: string;
  instanceId?: string;
  title: string;
  source: "marketplace" | "local_instance" | "merged";
  status: "available" | "not_run" | "missing_config" | "blocked" | "archived";
  statusReason?: string;
  entitlementStatus: "authorized" | "missing" | "expired" | "unknown";
  capabilities: MyRoleCapability[];
  runSummary: MyRoleRunSummary;
  recentRuns: MyRoleRunPreview[];
  artifactSummary: MyRoleArtifactSummary;
  recentArtifacts: MyRoleArtifactPreview[];
  qualitySummary: MyRoleQualitySummary;
};

export type MyRoleCapability = {
  capability: string;
  label: string;
  group: string;
  status: "ready" | "missing_tool" | "missing_secret" | "needs_confirm" | "unsupported";
  requiredTools: string[];
  missingReason?: string;
};

export type MyRoleRunSummary = {
  total: number;
  succeeded: number;
  failed: number;
  blocked: number;
  cancelled: number;
  lastRunAt?: number;
  lastOutcome?: string;
};

export type MyRoleRunPreview = {
  runId: string;
  executionId: string;
  taskPackageId: string;
  title: string;
  status: string;
  outcome?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  summary: string;
  artifactCount: number;
  error?: string;
};

export type MyRoleArtifactSummary = {
  total: number;
  images: number;
  videos: number;
  archives: number;
  reports: number;
  missingFiles: number;
};

export type MyRoleArtifactPreview = {
  artifactId: string;
  runId?: string;
  executionId: string;
  filePath: string;
  fileName: string;
  assetType: string;
  fileSizeBytes: number;
  exists: boolean;
  createdAt: number;
};

export type MyRoleQualitySummary = {
  openIssues: number;
  criticalIssues: number;
  highIssues: number;
  lastIssueAt?: number;
};

// ═══ Input ═══

export type MyRolesReadModelParams = {
  marketplaceRoles?: Array<{
    roleListingId?: string;
    title?: string;
    capabilities?: string[];
    entitlementId?: string;
    entitlementStatus?: string;
    authorizationFeeCents?: number;
    priceLabel?: string;
  }>;
  includeArchived?: boolean;
  includeRecentRuns?: boolean;
  includeArtifacts?: boolean;
  maxRecentRuns?: number;
  maxRecentArtifacts?: number;
};

// ═══ Builder ═══

export function buildMyRolesReadModel(params: MyRolesReadModelParams = {}): MyRolesReadModel {
  const now = Date.now();
  const maxRuns = params.maxRecentRuns ?? 20;
  const maxArtifacts = params.maxRecentArtifacts ?? 12;

  // 从 role-instances.db 收集本地实例
  const allInstances: RoleInstanceRecord[] = [];
  const runsByInstance = new Map<string, RoleRunRecord[]>();
  const artifactsByInstance = new Map<string, RoleArtifactRecord[]>();
  let instanceStoreError: string | undefined;

  // 扫描所有已知实例（简单全表扫描，数据量小）
  try {
    createRoleInstanceTables();
    const db = getRoleInstancesDb();
    const rows = db
      .prepare("SELECT instance_id FROM role_instances ORDER BY created_at DESC")
      .all() as Array<{ instance_id: string }>;
    for (const { instance_id } of rows) {
      const inst = RoleInstanceStore.getInstance(instance_id);
      if (inst) {
        if (!params.includeArchived && (inst as Record<string, unknown>).status === "archived")
          continue;
        allInstances.push(inst);
        runsByInstance.set(instance_id, RoleInstanceStore.listRuns(instance_id).slice(0, maxRuns));
        const allArtifacts: RoleArtifactRecord[] = [];
        for (const run of runsByInstance.get(instance_id) ?? []) {
          allArtifacts.push(...RoleInstanceStore.listArtifacts(run.runId));
        }
        artifactsByInstance.set(instance_id, allArtifacts.slice(0, maxArtifacts));
      }
    }
  } catch (error) {
    instanceStoreError =
      error instanceof Error ? error.message : "岗位实例库暂时不可读，已仅展示授权岗位资产。";
  }

  // 从 marketplace roles 收集
  type MktRole = NonNullable<typeof params.marketplaceRoles>[number];
  const marketplaceMap = new Map<string, MktRole>();
  for (const r of params.marketplaceRoles ?? []) {
    const key = r.roleListingId || r.title || "";
    if (key) marketplaceMap.set(key, r);
  }

  // 合并构建 MyRoleCard
  const roleKeys = new Set<string>();
  const roles: MyRoleCard[] = [];

  // 处理本地实例
  for (const inst of allInstances) {
    const key = inst.roleListingId || inst.roleTitle || inst.instanceId;
    if (roleKeys.has(key)) continue;
    roleKeys.add(key);

    const mktRole = marketplaceMap.get(inst.roleListingId) || marketplaceMap.get(inst.roleTitle);
    if (mktRole) marketplaceMap.delete(mktRole.roleListingId || mktRole.title || "");

    const runs = runsByInstance.get(inst.instanceId) ?? [];
    const artifacts = artifactsByInstance.get(inst.instanceId) ?? [];

    roles.push(
      buildRoleCard({
        key,
        inst,
        mktRole,
        runs,
        artifacts,
        includeRuns: params.includeRecentRuns !== false,
        includeArtifacts: params.includeArtifacts !== false,
        maxRuns,
        maxArtifacts,
      }),
    );
  }

  // 处理纯 marketplace（无本地实例）
  for (const [, mktRole] of marketplaceMap) {
    const key = mktRole.roleListingId || mktRole.title || "";
    if (!key || roleKeys.has(key)) continue;
    roleKeys.add(key);
    roles.push(
      buildRoleCard({
        key,
        mktRole,
        runs: [],
        artifacts: [],
        includeRuns: true,
        includeArtifacts: true,
        maxRuns,
        maxArtifacts,
      }),
    );
  }

  // 计算 summary
  const summary: MyRolesSummary = {
    totalRoles: roles.length,
    availableRoles: roles.filter((r) => r.status === "available").length,
    blockedRoles: roles.filter((r) => r.status === "blocked").length,
    missingCapabilityRoles: roles.filter((r) => r.status === "missing_config").length,
    totalRuns: roles.reduce((s, r) => s + r.runSummary.total, 0),
    successfulRuns: roles.reduce((s, r) => s + r.runSummary.succeeded, 0),
    failedRuns: roles.reduce((s, r) => s + r.runSummary.failed, 0),
    totalArtifacts: roles.reduce((s, r) => s + r.artifactSummary.total, 0),
    openQualityIssues: roles.reduce((s, r) => s + r.qualitySummary.openIssues, 0),
    ...(instanceStoreError ? { instanceStoreError } : {}),
  };

  return { updatedAt: now, summary, roles };
}

// ═══ Helpers ═══

function buildRoleCard(params: {
  key: string;
  inst?: RoleInstanceRecord;
  mktRole?: {
    roleListingId?: string;
    title?: string;
    capabilities?: string[];
    entitlementId?: string;
    entitlementStatus?: string;
    authorizationFeeCents?: number;
    priceLabel?: string;
  };
  runs: RoleRunRecord[];
  artifacts: RoleArtifactRecord[];
  includeRuns: boolean;
  includeArtifacts: boolean;
  maxRuns: number;
  maxArtifacts: number;
}): MyRoleCard {
  const {
    key,
    inst,
    mktRole,
    runs,
    artifacts,
    includeRuns,
    includeArtifacts,
    maxRuns,
    maxArtifacts,
  } = params;

  const title = mktRole?.title || inst?.roleTitle || key;
  const capabilities = buildCapabilities(mktRole?.capabilities ?? []);
  const runSummary = buildRunSummary(runs);
  const artifactSummary = buildArtifactSummary(artifacts);
  const qualitySummary = buildQualitySummary(runs, artifacts);

  // 状态判断
  let status: MyRoleCard["status"] = "available";
  let statusReason: string | undefined;
  if (inst && (inst as Record<string, unknown>).status === "archived") {
    status = "archived";
  } else if (qualitySummary.openIssues > 0 || runSummary.lastOutcome === "blocked") {
    status = "blocked";
    statusReason = qualitySummary.openIssues > 0 ? "有未解决的质量问题" : "最近运行被阻塞";
  } else if (capabilities.some((c) => c.status !== "ready" && c.status !== "unsupported")) {
    status = "missing_config";
    statusReason =
      capabilities.find((c) => c.status === "missing_secret")?.missingReason ||
      capabilities.find((c) => c.status === "missing_tool")?.missingReason ||
      "缺少工具或配置";
  } else if (runSummary.total === 0) {
    status = "not_run";
  }

  return {
    roleKey: key,
    roleListingId: mktRole?.roleListingId || inst?.roleListingId,
    ...(mktRole?.entitlementId ? { entitlementId: mktRole.entitlementId } : {}),
    ...(typeof mktRole?.authorizationFeeCents === "number"
      ? { authorizationFeeCents: mktRole.authorizationFeeCents }
      : {}),
    ...(mktRole?.priceLabel ? { priceLabel: mktRole.priceLabel } : {}),
    instanceId: inst?.instanceId,
    title,
    source: mktRole && inst ? "merged" : mktRole ? "marketplace" : "local_instance",
    status,
    statusReason,
    entitlementStatus: mktRole?.entitlementId
      ? "authorized"
      : mktRole
        ? mktRole.entitlementStatus === "authorized"
          ? "authorized"
          : "missing"
        : "unknown",
    capabilities,
    runSummary,
    recentRuns: includeRuns
      ? runs.slice(0, maxRuns).map((r) => ({
          runId: r.runId,
          executionId: r.executionId,
          taskPackageId: r.taskPackageId,
          title: r.summary.slice(0, 60),
          status: r.status as MyRoleRunPreview["status"],
          outcome:
            r.status === "completed" ? "succeeded" : r.status === "failed" ? "failed" : undefined,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          durationMs: r.durationMs,
          summary: r.summary,
          artifactCount: artifacts.filter((a) => a.runId === r.runId).length,
          error: r.error,
        }))
      : [],
    artifactSummary,
    recentArtifacts: includeArtifacts
      ? artifacts.slice(0, maxArtifacts).map((a) => ({
          artifactId: a.artifactId,
          runId: a.runId,
          executionId: "",
          filePath: a.relPath,
          fileName: a.relPath.split("/").pop() || a.relPath,
          assetType: a.kind,
          fileSizeBytes: a.sizeBytes ?? 0,
          exists: existsSync(a.relPath),
          createdAt: a.createdAt,
        }))
      : [],
    qualitySummary,
  };
}

function buildCapabilities(declared: string[]): MyRoleCapability[] {
  const known: MyRoleCapability[] = [];

  const groups: Record<string, { label: string; group: string }> = {
    "image.generation": { label: "图片生成", group: "image" },
    "image.editing": { label: "图片编辑", group: "image" },
    "video.generation": { label: "视频生成", group: "video" },
    "video.caption": { label: "字幕生成", group: "video" },
    "file.packaging": { label: "文件打包", group: "file" },
    "quality.check": { label: "质量检查", group: "quality" },
    "web.search": { label: "网页搜索", group: "network" },
    "web.fetch": { label: "网页抓取", group: "network" },
    "workspace.read": { label: "工作区读取", group: "workspace" },
    "workspace.write": { label: "工作区写入", group: "workspace" },
    "human.confirm": { label: "人工确认", group: "human" },
    "marketplace.read": { label: "岗位商城读取", group: "marketplace" },
    "gateway.role_read_model": { label: "岗位网关读模型", group: "marketplace" },
    "ledger.summary.read": { label: "账本摘要读取", group: "ledger" },
    "audit.record": { label: "审计记录", group: "audit" },
    "document.write": { label: "文档输出", group: "document" },
    "model.chat.analysis": { label: "模型分析", group: "model" },
  };
  const platformProvided = new Set([
    "marketplace.read",
    "gateway.role_read_model",
    "ledger.summary.read",
    "audit.record",
    "document.write",
    "human.confirm",
    "model.chat.analysis",
  ]);

  for (const cap of declared) {
    const info = groups[cap] || { label: cap, group: "other" };
    const resolved = resolveCapabilities([cap]);
    let status: MyRoleCapability["status"] = "ready";
    let missingReason: string | undefined;

    if (!platformProvided.has(cap) && resolved.summary.missing > 0) {
      status = "missing_tool";
      missingReason = `缺少工具: ${cap}`;
    } else if (!process.env.DEEPSEEK_API_KEY && !process.env.DASHSCOPE_API_KEY) {
      // 简化判断：如果环境变量没配，标记 missing_secret
      // 生产环境应从 OpenClaw config/provider 检查
    }

    known.push({
      capability: cap,
      label: info.label,
      group: info.group,
      status,
      requiredTools: [cap],
      missingReason,
    });
  }

  // 如果没有声明的能力，返回空
  if (declared.length === 0) {
    known.push({
      capability: "general",
      label: "通用执行",
      group: "other",
      status: "ready",
      requiredTools: [],
    });
  }

  return known;
}

function buildRunSummary(runs: RoleRunRecord[]): MyRoleRunSummary {
  return {
    total: runs.length,
    succeeded: runs.filter((r) => r.status === "completed").length,
    failed: runs.filter((r) => r.status === "failed").length,
    blocked: runs.filter((r) => r.status === "blocked").length,
    cancelled: runs.filter((r) => r.status === "cancelled").length,
    lastRunAt: runs[0]?.startedAt,
    lastOutcome: runs[0]?.status,
  };
}

function buildArtifactSummary(artifacts: RoleArtifactRecord[]): MyRoleArtifactSummary {
  const existing = artifacts.filter((a) => existsSync(a.relPath));
  const missing = artifacts.length - existing.length;
  return {
    total: artifacts.length,
    images: artifacts.filter((a) => a.kind === "image").length,
    videos: artifacts.filter((a) => a.kind === "video").length,
    archives: artifacts.filter((a) => a.kind === "archive").length,
    reports: artifacts.filter((a) => a.kind === "document").length,
    missingFiles: missing,
  };
}

function buildQualitySummary(
  runs: RoleRunRecord[],
  _artifacts: RoleArtifactRecord[],
): MyRoleQualitySummary {
  const failedRuns = runs.filter((r) => r.status === "failed");
  const critical = runs.filter((r) => r.status === "blocked").length;
  const high = failedRuns.length;
  return {
    openIssues: critical + high,
    criticalIssues: critical,
    highIssues: high,
    lastIssueAt: failedRuns[0]?.startedAt,
  };
}
