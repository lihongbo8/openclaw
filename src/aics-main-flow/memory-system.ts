import { randomUUID } from "node:crypto";
import { getMemoryDb, createMemoryTables } from "./db.js";

// ═══ Types ═══

export type MemoryType = "role_experience" | "tool_experience" | "quality_feedback";

export type MemorySource = {
  layer: "role" | "tool" | "planning" | "dispatch";
  entityId: string;
  entityType: string;
};

export type MemoryCandidate = {
  candidateId: string;
  type: MemoryType;
  title: string;
  content: string;
  source: MemorySource;
  confidence: "low" | "medium" | "high";
  tags: string[];
  requiresHumanConfirm: boolean;
  proposedBy: string;
  proposedAt: number;
};

export type MemoryCandidateStatus = "pending" | "confirmed" | "rejected";

export type MemoryCandidateRecord = MemoryCandidate & {
  status: MemoryCandidateStatus;
  confirmedBy?: string;
  confirmedAt?: number;
  rejectReason?: string;
};

export type FormalMemory = {
  memoryId: string;
  candidateId?: string;
  type: MemoryType;
  title: string;
  content: string;
  source: MemorySource;
  confidence: "low" | "medium" | "high";
  tags: string[];
  createdAt: number;
  updatedAt: number;
  scope: string;
  scopeRef?: string;
  version: number;
};

// ═══ SQLite helpers ═══

function db() {
  createMemoryTables();
  return getMemoryDb();
}

function ex(sql: string, ...params: unknown[]) {
  db()
    .prepare(sql)
    .run(...(params as any));
}

function one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db()
    .prepare(sql)
    .get(...(params as any)) as T | undefined;
}

function many<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db()
    .prepare(sql)
    .all(...(params as any)) as T[];
}

// ═══ MemoryCandidateStore ═══

export const MemoryCandidateStore = {
  propose(input: Omit<MemoryCandidate, "candidateId" | "proposedAt">): MemoryCandidateRecord {
    const record: MemoryCandidateRecord = {
      ...input,
      candidateId: randomUUID(),
      proposedAt: Date.now(),
      status: "pending",
    };
    ex(
      `INSERT INTO memory_candidates(candidate_id,type,title,content,source_layer,source_entity_id,source_entity_type,confidence,tags,requires_human_confirm,proposed_by,proposed_at,status,audit_refs)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      record.candidateId,
      record.type,
      record.title,
      record.content,
      record.source.layer,
      record.source.entityId,
      record.source.entityType,
      record.confidence,
      JSON.stringify(record.tags),
      record.requiresHumanConfirm ? 1 : 0,
      record.proposedBy,
      record.proposedAt,
      record.status,
      "[]",
    );
    return record;
  },

  listPending(limit = 50): MemoryCandidateRecord[] {
    return many<any>(
      "SELECT * FROM memory_candidates WHERE status='pending' ORDER BY proposed_at DESC LIMIT ?",
      limit,
    ).map(rowToCandidate);
  },

  getById(candidateId: string): MemoryCandidateRecord | undefined {
    const row = one("SELECT * FROM memory_candidates WHERE candidate_id = ?", candidateId);
    return row ? rowToCandidate(row) : undefined;
  },

  confirm(candidateId: string, confirmedBy: string): MemoryCandidateRecord {
    ex(
      "UPDATE memory_candidates SET status='confirmed', confirmed_by=?, confirmed_at=? WHERE candidate_id=?",
      confirmedBy,
      Date.now(),
      candidateId,
    );
    return this.getById(candidateId)!;
  },

  reject(candidateId: string, reason: string): MemoryCandidateRecord {
    ex(
      "UPDATE memory_candidates SET status='rejected', reject_reason=? WHERE candidate_id=?",
      reason,
      candidateId,
    );
    return this.getById(candidateId)!;
  },

  listBySource(layer: string, entityId: string): MemoryCandidateRecord[] {
    return many<any>(
      "SELECT * FROM memory_candidates WHERE source_layer=? AND source_entity_id=? ORDER BY proposed_at DESC",
      layer,
      entityId,
    ).map(rowToCandidate);
  },
};

function rowToCandidate(row: Record<string, unknown>): MemoryCandidateRecord {
  return {
    candidateId: row.candidate_id as string,
    type: row.type as MemoryType,
    title: row.title as string,
    content: row.content as string,
    source: {
      layer: row.source_layer as MemorySource["layer"],
      entityId: row.source_entity_id as string,
      entityType: row.source_entity_type as string,
    },
    confidence: row.confidence as "low" | "medium" | "high",
    tags: JSON.parse((row.tags as string) || "[]"),
    requiresHumanConfirm: Boolean(row.requires_human_confirm),
    proposedBy: row.proposed_by as string,
    proposedAt: row.proposed_at as number,
    status: row.status as MemoryCandidateStatus,
    confirmedBy: row.confirmed_by as string | undefined,
    confirmedAt: row.confirmed_at as number | undefined,
    rejectReason: row.reject_reason as string | undefined,
  };
}

// ═══ FormalMemoryStore ═══

export const FormalMemoryStore = {
  create(input: {
    candidateId?: string;
    type: MemoryType;
    title: string;
    content: string;
    source: MemorySource;
    confidence?: "low" | "medium" | "high";
    tags?: string[];
    scope?: string;
    scopeRef?: string;
  }): FormalMemory {
    const memory: FormalMemory = {
      memoryId: randomUUID(),
      candidateId: input.candidateId,
      type: input.type,
      title: input.title,
      content: input.content,
      source: input.source,
      confidence: input.confidence ?? "medium",
      tags: input.tags ?? [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scope: input.scope ?? "company",
      scopeRef: input.scopeRef,
      version: 1,
    };
    ex(
      `INSERT INTO formal_memories(memory_id,candidate_id,type,title,content,source_layer,source_entity_id,confidence,tags,created_at,updated_at,scope,scope_ref,version)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      memory.memoryId,
      memory.candidateId ?? null,
      memory.type,
      memory.title,
      memory.content,
      memory.source.layer,
      memory.source.entityId,
      memory.confidence,
      JSON.stringify(memory.tags),
      memory.createdAt,
      memory.updatedAt,
      memory.scope,
      memory.scopeRef ?? null,
      memory.version,
    );
    return memory;
  },

  getById(memoryId: string): FormalMemory | undefined {
    const row = one("SELECT * FROM formal_memories WHERE memory_id = ?", memoryId);
    return row ? rowToMemory(row) : undefined;
  },

  search(query: string, limit = 20): FormalMemory[] {
    // 优先用 FTS，回退 LIKE
    try {
      const fts = many<{ memory_id: string }>(
        "SELECT memory_id FROM formal_memories_fts WHERE formal_memories_fts MATCH ? LIMIT ?",
        query,
        limit,
      );
      if (fts.length) {
        return fts.map((r) => this.getById(r.memory_id)).filter(Boolean) as FormalMemory[];
      }
    } catch {
      /* FTS not available, fall through */
    }

    return many<any>(
      "SELECT * FROM formal_memories WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT ?",
      `%${query}%`,
      `%${query}%`,
      limit,
    ).map(rowToMemory);
  },

  listByScope(scope: string, scopeRef?: string, limit = 50): FormalMemory[] {
    const rows = scopeRef
      ? many<any>(
          "SELECT * FROM formal_memories WHERE scope=? AND scope_ref=? ORDER BY updated_at DESC LIMIT ?",
          scope,
          scopeRef,
          limit,
        )
      : many<any>(
          "SELECT * FROM formal_memories WHERE scope=? ORDER BY updated_at DESC LIMIT ?",
          scope,
          limit,
        );
    return rows.map(rowToMemory);
  },

  listByTags(tags: string[], limit = 50): FormalMemory[] {
    // SQLite JSON 查询：检查 tags JSON 数组是否包含任意 tag
    const conditions = tags.map(() => "tags LIKE ?").join(" OR ");
    const params = tags.map((t) => `%${t}%`);
    return many<any>(
      `SELECT * FROM formal_memories WHERE ${conditions} ORDER BY updated_at DESC LIMIT ?`,
      ...params,
      limit,
    ).map(rowToMemory);
  },
};

function rowToMemory(row: Record<string, unknown>): FormalMemory {
  return {
    memoryId: row.memory_id as string,
    candidateId: row.candidate_id as string | undefined,
    type: row.type as MemoryType,
    title: row.title as string,
    content: row.content as string,
    source: {
      layer: row.source_layer as MemorySource["layer"],
      entityId: row.source_entity_id as string,
      entityType: "",
    },
    confidence: row.confidence as "low" | "medium" | "high",
    tags: JSON.parse((row.tags as string) || "[]"),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    scope: row.scope as string,
    scopeRef: row.scope_ref as string | undefined,
    version: row.version as number,
  };
}

// ═══ MemoryConfirmService ═══

export const MemoryConfirmService = {
  confirmAndPromote(
    candidateId: string,
    confirmedBy: string,
  ): { candidate: MemoryCandidateRecord; memory: FormalMemory } | { error: string } {
    const candidate = MemoryCandidateStore.getById(candidateId);
    if (!candidate) return { error: "Candidate not found" };
    if (candidate.status !== "pending") return { error: `Candidate already ${candidate.status}` };

    const updated = MemoryCandidateStore.confirm(candidateId, confirmedBy);
    const memory = FormalMemoryStore.create({
      candidateId: updated.candidateId,
      type: updated.type,
      title: updated.title,
      content: updated.content,
      source: updated.source,
      confidence: updated.confidence,
      tags: updated.tags,
    });
    return { candidate: updated, memory };
  },

  batchConfirm(
    candidateIds: string[],
    confirmedBy: string,
  ): { confirmed: FormalMemory[]; errors: string[] } {
    const confirmed: FormalMemory[] = [];
    const errors: string[] = [];
    for (const id of candidateIds) {
      const result = this.confirmAndPromote(id, confirmedBy);
      if ("error" in result) errors.push(`${id}: ${result.error}`);
      else confirmed.push(result.memory);
    }
    return { confirmed, errors };
  },
};

// ═══ MemoryRetrievalService ═══

export const MemoryRetrievalService = {
  recall(options: {
    query?: string;
    source?: MemorySource;
    scope?: string;
    scopeRef?: string;
    tags?: string[];
    limit?: number;
  }): { formal: FormalMemory[]; candidates: MemoryCandidateRecord[] } {
    const formal = options.query
      ? FormalMemoryStore.search(options.query, options.limit ?? 20)
      : options.tags?.length
        ? FormalMemoryStore.listByTags(options.tags, options.limit ?? 50)
        : FormalMemoryStore.listByScope(
            options.scope ?? "company",
            options.scopeRef,
            options.limit ?? 50,
          );

    const candidates = options.source
      ? MemoryCandidateStore.listBySource(options.source.layer, options.source.entityId)
      : MemoryCandidateStore.listPending(10);

    return { formal, candidates };
  },
};

// ═══ proposeMemoryFromRoleResult ═══

export function proposeMemoryFromRoleResult(params: {
  roleTitle: string;
  roleListingId: string;
  outcome: string;
  summary: string;
  steps?: Array<{ kind: string; description: string; status: string }>;
}): MemoryCandidateRecord[] {
  const results: MemoryCandidateRecord[] = [];

  // 岗位经验记忆
  results.push(
    MemoryCandidateStore.propose({
      type: "role_experience",
      title: `${params.roleTitle} 执行${params.outcome === "succeeded" ? "成功" : "失败"}经验`,
      content: params.summary,
      source: { layer: "role", entityId: params.roleListingId, entityType: "role_listing" },
      confidence: params.outcome === "succeeded" ? "high" : "medium",
      tags: ["role_execution", params.outcome === "succeeded" ? "success" : "failure"],
      requiresHumanConfirm: false,
      proposedBy: "role-execution-engine",
    }),
  );

  // 工具经验（从步骤中提取）
  if (params.steps) {
    for (const step of params.steps.filter((s) => s.kind === "tool_call")) {
      results.push(
        MemoryCandidateStore.propose({
          type: "tool_experience",
          title: `工具调用: ${step.description}`,
          content: `步骤状态: ${step.status}`,
          source: { layer: "tool", entityId: params.roleListingId, entityType: "tool_call" },
          confidence: "high",
          tags: ["tool_call", step.status],
          requiresHumanConfirm: false,
          proposedBy: "role-execution-engine",
        }),
      );
    }
  }

  // 失败时生成质量反馈
  if (params.outcome !== "succeeded") {
    results.push(
      MemoryCandidateStore.propose({
        type: "quality_feedback",
        title: `${params.roleTitle} 执行质量问题`,
        content: params.summary,
        source: { layer: "role", entityId: params.roleListingId, entityType: "role_listing" },
        confidence: "medium",
        tags: ["quality_issue", "needs_review"],
        requiresHumanConfirm: true,
        proposedBy: "role-execution-engine",
      }),
    );
  }

  return results;
}
