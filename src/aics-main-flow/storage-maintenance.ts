import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import path from "node:path";

// ======================================================================
// 本地自管存储维护
// ======================================================================
//
// 只治理迭界AI/OpenClaw本地端自己产生、导入、复制、转换和缓存的文件。
// 外部用户文件只保存授权引用，不默认移动、删除或改名。
//
// 设计依据: docs/AICS-293-local-storage-maintenance-plan.md

export const STORAGE_ROOT = path.join(process.env.HOME ?? "/tmp", ".dijie-runtime/storage");

export type StoragePartition =
  | "imports"
  | "executions"
  | "artifacts"
  | "cache"
  | "tmp"
  | "logs"
  | "trash";

export type FileManifestEntry = {
  path: string;
  partition: StoragePartition;
  sizeBytes: number;
  createdAt: number;
  lastAccessedAt: number;
  ttlMs: number | null;
  refCount: number;
  source: "system" | "execution" | "import" | "cache";
};

type ManifestState = {
  version: 1;
  updatedAt: number;
  entries: FileManifestEntry[];
};

// ======================================================================
// 默认 TTL（毫秒）
// ======================================================================

const DEFAULT_TTL: Record<StoragePartition, number | null> = {
  imports: null, // 用户导入文件，永久保留（除非手动删除）
  executions: 30 * 24 * 3600_000, // 执行工作区，30天
  artifacts: 90 * 24 * 3600_000, // 产物，90天
  cache: 7 * 24 * 3600_000, // 缓存，7天
  tmp: 24 * 3600_000, // 临时文件，1天
  logs: 14 * 24 * 3600_000, // 日志，14天
  trash: 30 * 24 * 3600_000, // 回收站，30天后物理删除
};

const SPACE_BUDGET_MB = 2048; // 2GB 空间预算

function ensureStorageRoot(): void {
  for (const partition of Object.keys(DEFAULT_TTL) as StoragePartition[]) {
    mkdirSync(path.join(STORAGE_ROOT, partition), { recursive: true });
  }
}

function manifestPath(): string {
  return path.join(STORAGE_ROOT, "manifests", "files.jsonl");
}

function loadManifest(): ManifestState {
  const mp = manifestPath();
  if (!existsSync(mp)) {
    return { version: 1, updatedAt: Date.now(), entries: [] };
  }
  try {
    const entries = readFileSync(mp, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FileManifestEntry);
    return { version: 1, updatedAt: Date.now(), entries };
  } catch {
    return { version: 1, updatedAt: Date.now(), entries: [] };
  }
}

function saveManifest(state: ManifestState): void {
  state.updatedAt = Date.now();
  mkdirSync(path.dirname(manifestPath()), { recursive: true });
  writeFileSync(
    manifestPath(),
    state.entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf-8",
  );
}

// ======================================================================
// Public API
// ======================================================================

export const StorageMaintenance = {
  /** 初始化存储目录结构 */
  init(): void {
    ensureStorageRoot();
  },

  /** 扫描存储目录并更新 manifest */
  scan(): ManifestState {
    ensureStorageRoot();
    const entries: FileManifestEntry[] = [];
    const now = Date.now();

    for (const partition of Object.keys(DEFAULT_TTL) as StoragePartition[]) {
      const dir = path.join(STORAGE_ROOT, partition);
      if (!existsSync(dir)) continue;

      try {
        const files = readdirSync(dir, { recursive: true });
        for (const file of files) {
          const fullPath = path.join(dir, file.toString());
          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) continue;

            entries.push({
              path: fullPath,
              partition,
              sizeBytes: stat.size,
              createdAt: stat.birthtimeMs,
              lastAccessedAt: stat.atimeMs,
              ttlMs: DEFAULT_TTL[partition],
              refCount: 0,
              source:
                partition === "imports"
                  ? "import"
                  : partition === "executions"
                    ? "execution"
                    : partition === "cache"
                      ? "cache"
                      : "system",
            });
          } catch {
            // file may have been deleted between readdir and stat
          }
        }
      } catch {
        // partition may not exist yet
      }
    }

    const state: ManifestState = { version: 1, updatedAt: now, entries };
    saveManifest(state);
    return state;
  },

  /** 执行清理：删除过期文件和超过空间预算的最老文件 */
  cleanup(options?: { dryRun?: boolean; minFreeMb?: number }): {
    deleted: string[];
    freedBytes: number;
    errors: string[];
  } {
    const dryRun = options?.dryRun ?? false;
    const minFreeMb = options?.minFreeMb ?? 512;
    const state = loadManifest();
    const now = Date.now();
    const deleted: string[] = [];
    const errors: string[] = [];
    let freedBytes = 0;

    // 1. TTL 过期清理
    for (const entry of state.entries) {
      if (entry.ttlMs === null) continue; // 永久保留
      const age = now - entry.createdAt;
      if (age > entry.ttlMs) {
        if (!dryRun) {
          try {
            if (existsSync(entry.path)) {
              unlinkSync(entry.path);
              freedBytes += entry.sizeBytes;
              deleted.push(entry.path);
            }
          } catch (err) {
            errors.push(
              `Cannot delete ${entry.path}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        } else {
          deleted.push(entry.path);
          freedBytes += entry.sizeBytes;
        }
      }
    }

    // 2. 空间预算检查
    if (!dryRun) {
      const remainingEntries = loadManifest().entries;
      const totalSize = remainingEntries.reduce((sum, e) => sum + e.sizeBytes, 0);
      const totalMb = totalSize / (1024 * 1024);
      const overBudget = totalMb - SPACE_BUDGET_MB;

      if (overBudget > 0 && totalMb > minFreeMb) {
        // 按最老优先删除（排除永久保留的）
        const deletable = remainingEntries
          .filter((e) => e.ttlMs !== null && existsSync(e.path))
          .sort((a, b) => a.createdAt - b.createdAt);

        let toFree = overBudget * 1024 * 1024;
        for (const entry of deletable) {
          if (toFree <= 0) break;
          try {
            unlinkSync(entry.path);
            freedBytes += entry.sizeBytes;
            toFree -= entry.sizeBytes;
            deleted.push(entry.path);
          } catch (err) {
            errors.push(
              `Cannot delete ${entry.path}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }

    // 3. 清理空目录
    if (!dryRun) {
      for (const partition of Object.keys(DEFAULT_TTL) as StoragePartition[]) {
        const dir = path.join(STORAGE_ROOT, partition);
        if (!existsSync(dir) || partition === "trash") continue;
        try {
          const remaining = readdirSync(dir);
          if (remaining.length === 0) {
            // Don't remove partition dirs, just note them
          }
        } catch {
          /* ignore */
        }
      }
    }

    return { deleted, freedBytes, errors };
  },

  /** 报告当前存储状态 */
  report(): {
    partitions: Record<StoragePartition, { fileCount: number; sizeMb: number }>;
    totalSizeMb: number;
    budgetMb: number;
    percentUsed: number;
  } {
    const state = loadManifest();
    const partitions: Record<string, { fileCount: number; sizeMb: number }> = {};

    for (const partition of Object.keys(DEFAULT_TTL) as StoragePartition[]) {
      const entries = state.entries.filter((e) => e.partition === partition);
      partitions[partition] = {
        fileCount: entries.length,
        sizeMb: entries.reduce((sum, e) => sum + e.sizeBytes, 0) / (1024 * 1024),
      };
    }

    const totalSizeMb = state.entries.reduce((sum, e) => sum + e.sizeBytes, 0) / (1024 * 1024);

    return {
      partitions: partitions as Record<StoragePartition, { fileCount: number; sizeMb: number }>,
      totalSizeMb,
      budgetMb: SPACE_BUDGET_MB,
      percentUsed: (totalSizeMb / SPACE_BUDGET_MB) * 100,
    };
  },

  /** 安全删除：移到 trash 而非直接删除（用户导入文件保护） */
  safeDelete(filePath: string): { ok: boolean; error?: string } {
    if (!filePath.startsWith(STORAGE_ROOT)) {
      return { ok: false, error: `拒绝删除 storage root 外的路径: ${filePath}` };
    }

    try {
      const trashDir = path.join(STORAGE_ROOT, "trash");
      mkdirSync(trashDir, { recursive: true });
      const destName = `${Date.now()}_${path.basename(filePath)}`;
      const dest = path.join(trashDir, destName);
      renameSync(filePath, dest);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
