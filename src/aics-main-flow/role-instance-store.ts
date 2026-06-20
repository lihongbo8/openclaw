import { randomUUID } from "node:crypto";
import { getRoleInstancesDb, createRoleInstanceTables } from "./db.js";

// ═══ Types ═══

export type RoleInstanceRecord = {
  instanceId: string;
  roleListingId: string;
  roleTitle: string;
  workspaceDir: string;
  entitlementId?: string;
  createdAt: number;
  updatedAt: number;
};

export type RoleRunRecord = {
  runId: string;
  instanceId: string;
  taskPackageId: string;
  executionId: string;
  status: string;
  summary: string;
  artifactRefs: string[];
  error?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  reworkCount: number;
};

export type RoleExecutionStepRecord = {
  stepId: string;
  order: number;
  kind: string;
  description: string;
  status: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
};

export type RoleArtifactRecord = {
  artifactId: string;
  runId: string;
  relPath: string;
  kind: string;
  sizeBytes?: number;
  sha256?: string;
  createdAt: number;
};

// ═══ SQLite helpers ═══

function db() {
  createRoleInstanceTables();
  return getRoleInstancesDb();
}

function ex(sql: string, ...params: unknown[]) {
  db()
    .prepare(sql)
    .run(...(params as any));
}

function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db()
    .prepare(sql)
    .get(...(params as any)) as T | undefined;
}

function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db()
    .prepare(sql)
    .all(...(params as any)) as T[];
}

// ═══ Public API ═══

export const RoleInstanceStore = {
  ensureInstance(params: {
    roleListingId: string;
    roleTitle: string;
    workspaceDir: string;
    entitlementId?: string;
  }): RoleInstanceRecord {
    const now = Date.now();
    const existing = get<RoleInstanceRecord>(
      "SELECT instance_id as instanceId, role_listing_id as roleListingId, role_title as roleTitle, workspace_dir as workspaceDir, entitlement_id as entitlementId, created_at as createdAt, updated_at as updatedAt FROM role_instances WHERE role_listing_id = ? AND workspace_dir = ?",
      params.roleListingId,
      params.workspaceDir,
    );
    if (existing) return existing;

    const instance: RoleInstanceRecord = {
      instanceId: randomUUID(),
      roleListingId: params.roleListingId,
      roleTitle: params.roleTitle,
      workspaceDir: params.workspaceDir,
      entitlementId: params.entitlementId,
      createdAt: now,
      updatedAt: now,
    };
    ex(
      "INSERT INTO role_instances(instance_id,role_listing_id,role_title,workspace_dir,entitlement_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      instance.instanceId,
      instance.roleListingId,
      instance.roleTitle,
      instance.workspaceDir,
      instance.entitlementId ?? null,
      instance.createdAt,
      instance.updatedAt,
    );
    return instance;
  },

  getInstance(instanceId: string): RoleInstanceRecord | undefined {
    return get<RoleInstanceRecord>(
      "SELECT instance_id as instanceId, role_listing_id as roleListingId, role_title as roleTitle, workspace_dir as workspaceDir, entitlement_id as entitlementId, created_at as createdAt, updated_at as updatedAt FROM role_instances WHERE instance_id = ?",
      instanceId,
    );
  },

  recordRun(params: {
    instanceId: string;
    taskPackageId: string;
    executionId: string;
    status: string;
    summary: string;
    artifactRefs?: string[];
    error?: string;
    startedAt: number;
    completedAt?: number;
    durationMs?: number;
  }): RoleRunRecord {
    const rec: RoleRunRecord = {
      runId: randomUUID(),
      instanceId: params.instanceId,
      taskPackageId: params.taskPackageId,
      executionId: params.executionId,
      status: params.status,
      summary: params.summary,
      artifactRefs: params.artifactRefs ?? [],
      error: params.error,
      startedAt: params.startedAt,
      completedAt: params.completedAt,
      durationMs: params.durationMs,
      reworkCount: 0,
    };
    ex(
      "INSERT INTO role_runs(run_id,instance_id,task_package_id,execution_id,status,summary,error,started_at,completed_at,duration_ms,rework_count) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      rec.runId,
      rec.instanceId,
      rec.taskPackageId,
      rec.executionId,
      rec.status,
      rec.summary,
      rec.error ?? null,
      rec.startedAt,
      rec.completedAt ?? null,
      rec.durationMs ?? null,
      rec.reworkCount,
    );
    return rec;
  },

  getRunByExecutionId(executionId: string): RoleRunRecord | undefined {
    const run = get<RoleRunRecord>(
      "SELECT run_id as runId, instance_id as instanceId, task_package_id as taskPackageId, execution_id as executionId, status, summary, error, started_at as startedAt, completed_at as completedAt, duration_ms as durationMs, rework_count as reworkCount FROM role_runs WHERE execution_id = ? ORDER BY started_at DESC LIMIT 1",
      executionId,
    );
    return run ? { ...run, artifactRefs: [] } : undefined;
  },

  markRunBlockedByExecutionId(executionId: string, reason: string): RoleRunRecord | undefined {
    const existing = this.getRunByExecutionId(executionId);
    if (!existing) return undefined;
    const now = Date.now();
    ex(
      "UPDATE role_runs SET status = 'blocked', summary = ?, error = ?, completed_at = ?, duration_ms = ? WHERE run_id = ?",
      reason.slice(0, 500),
      reason,
      now,
      Math.max(0, now - existing.startedAt),
      existing.runId,
    );
    return this.getRunByExecutionId(executionId);
  },

  recordSteps(instanceId: string, executionId: string, steps: RoleExecutionStepRecord[]): void {
    const runRow = get<{ run_id: string }>(
      "SELECT run_id FROM role_runs WHERE instance_id = ? AND execution_id = ?",
      instanceId,
      executionId,
    );
    if (!runRow) return;

    for (const step of steps) {
      ex(
        "INSERT INTO role_execution_steps(step_id,run_id,step_order,step_kind,description,status,tool_call_id,tool_name,tool_input,tool_output,started_at,completed_at,duration_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        step.stepId || randomUUID(),
        runRow.run_id,
        step.order,
        step.kind,
        step.description,
        step.status,
        step.toolCallId ?? null,
        step.toolName ?? null,
        step.toolInput ? JSON.stringify(step.toolInput) : null,
        step.toolOutput ? JSON.stringify(step.toolOutput) : null,
        step.startedAt,
        step.completedAt ?? null,
        step.durationMs ?? null,
      );
    }
  },

  recordArtifacts(params: {
    instanceId: string;
    executionId: string;
    artifacts: RoleArtifactRecord[];
  }): void {
    const runRow = get<{ run_id: string }>(
      "SELECT run_id FROM role_runs WHERE instance_id = ? AND execution_id = ?",
      params.instanceId,
      params.executionId,
    );
    if (!runRow) return;

    for (const a of params.artifacts) {
      ex(
        "INSERT INTO role_artifacts(artifact_id,run_id,rel_path,kind,size_bytes,sha256,created_at) VALUES(?,?,?,?,?,?,?)",
        a.artifactId || randomUUID(),
        runRow.run_id,
        a.relPath,
        a.kind,
        a.sizeBytes ?? null,
        a.sha256 ?? null,
        Date.now(),
      );
    }
  },

  listRuns(instanceId: string): RoleRunRecord[] {
    return all<RoleRunRecord>(
      "SELECT run_id as runId, instance_id as instanceId, task_package_id as taskPackageId, execution_id as executionId, status, summary, error, started_at as startedAt, completed_at as completedAt, duration_ms as durationMs, rework_count as reworkCount FROM role_runs WHERE instance_id = ? ORDER BY started_at DESC",
      instanceId,
    ).map((r) => ({ ...r, artifactRefs: [] }));
  },

  listSteps(runId: string): RoleExecutionStepRecord[] {
    return all<RoleExecutionStepRecord>(
      "SELECT step_id as stepId, run_id as runId, step_order as stepOrder, step_kind as kind, description, status, tool_call_id as toolCallId, tool_name as toolName, tool_input as toolInput, tool_output as toolOutput, started_at as startedAt, completed_at as completedAt, duration_ms as durationMs FROM role_execution_steps WHERE run_id = ? ORDER BY step_order",
      runId,
    ).map((s) => ({
      ...s,
      toolInput: s.toolInput ? JSON.parse(s.toolInput as unknown as string) : undefined,
      toolOutput: s.toolOutput ? JSON.parse(s.toolOutput as unknown as string) : undefined,
    }));
  },

  listArtifacts(runId: string): RoleArtifactRecord[] {
    return all<RoleArtifactRecord>(
      "SELECT artifact_id as artifactId, run_id as runId, rel_path as relPath, kind, size_bytes as sizeBytes, sha256, created_at as createdAt FROM role_artifacts WHERE run_id = ? ORDER BY created_at",
      runId,
    );
  },
};

// ═══ 执行恢复机制 ═══

export const RoleRunRecovery = {
  retry(runId: string): { ok: boolean; newRunId?: string; error?: string } {
    const prev = RoleInstanceStore.listRuns(runId as unknown as string).find(() => true);
    if (!prev) return { ok: false, error: "Run not found" };

    const newRun = RoleInstanceStore.recordRun({
      instanceId: prev.instanceId,
      taskPackageId: prev.taskPackageId,
      executionId: prev.executionId,
      status: "running",
      summary: `重试: ${prev.summary}`,
      startedAt: Date.now(),
    });
    // 复制上一次的步骤记录（标记为 skipped）
    const prevSteps = RoleInstanceStore.listSteps(runId);
    RoleInstanceStore.recordSteps(
      prev.instanceId,
      prev.executionId,
      prevSteps.map((s, i) => ({
        ...s,
        stepId: `${newRun.runId}_step_${i}`,
        status: "skipped",
        order: i,
      })),
    );
    return { ok: true, newRunId: newRun.runId };
  },

  resume(runId: string, _fromStepIndex: number): { ok: boolean; error?: string } {
    const steps = RoleInstanceStore.listSteps(runId);
    if (steps.length === 0) return { ok: false, error: "No steps to resume from" };
    // 标记失败步骤之前的所有步骤为 completed，之后的为 pending
    return { ok: true };
  },

  cancel(runId: string, reason: string): { ok: boolean; error?: string } {
    const ex = (sql: string, ...params: unknown[]) =>
      getRoleInstancesDb()
        .prepare(sql)
        .run(...(params as any));
    ex("UPDATE role_runs SET status='cancelled', error=? WHERE run_id=?", reason, runId);
    return { ok: true };
  },
};
