import { createHash } from "node:crypto";
import { createPipelineTables, getPipelineDb } from "./db.js";

export type LocalRoleListing = {
  roleListingId: string;
  reviewId: string;
  rolePackageId: string;
  title: string;
  categoryRef: string;
  requiredCapabilities: string[];
  authorizationFeeCents: number;
  status: "published" | "archived";
  source: "local_review_center";
  createdAt: number;
  updatedAt: number;
};

export type LocalRoleEntitlement = {
  entitlementId: string;
  roleListingId: string;
  accountId: string;
  status: "authorized" | "revoked";
  source: "zero_price";
  createdAt: number;
  updatedAt: number;
};

export type LocalMarketplaceRole = {
  id: string;
  roleListingId: string;
  title: string;
  category: string;
  categoryRef: string;
  capabilities: string[];
  authorizationFeeCents: number;
  priceLabel: string;
  entitlementId?: string;
  entitlementStatus: "authorized" | "missing";
  source: "local";
};

export type LocalRoleExecutionAudit = {
  auditRecordId: string;
  executionId: string;
  roleListingId: string;
  entitlementId: string;
  status: "completed" | "failed" | "blocked";
  summary: string;
  ledgerRef: string;
  billingSummary: Record<string, unknown>;
  createdAt: number;
};

export type LocalRoleLedgerEntry = {
  ledgerRef: string;
  executionId: string;
  roleListingId: string;
  entitlementId: string;
  authorizationFeeCents: number;
  executionFeeCents: number;
  source: "local_zero_price";
  status: "posted";
  createdAt: number;
};

type ListingRow = {
  role_listing_id: string;
  review_id: string;
  role_package_id: string;
  title: string;
  category_ref: string;
  required_capabilities: string;
  authorization_fee_cents: number;
  status: string;
  source: string;
  created_at: number;
  updated_at: number;
};

type EntitlementRow = {
  entitlement_id: string;
  role_listing_id: string;
  account_id: string;
  status: string;
  source: string;
  created_at: number;
  updated_at: number;
};

type ExecutionAuditRow = {
  audit_record_id: string;
  execution_id: string;
  role_listing_id: string;
  entitlement_id: string;
  status: string;
  summary: string;
  ledger_ref: string;
  billing_summary: string;
  created_at: number;
};

type LedgerEntryRow = {
  ledger_ref: string;
  execution_id: string;
  role_listing_id: string;
  entitlement_id: string;
  authorization_fee_cents: number;
  execution_fee_cents: number;
  source: string;
  status: string;
  created_at: number;
};

function db(options: { ensureSchema?: boolean } = {}) {
  const database = getPipelineDb();
  if (options.ensureSchema !== false) createPipelineTables(database);
  return database;
}

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no such table");
}

function now() {
  return Date.now();
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function readStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : [];
  } catch {
    return [];
  }
}

function listingRowToRecord(row: ListingRow): LocalRoleListing {
  return {
    roleListingId: row.role_listing_id,
    reviewId: row.review_id,
    rolePackageId: row.role_package_id,
    title: row.title,
    categoryRef: row.category_ref,
    requiredCapabilities: readStringArray(row.required_capabilities),
    authorizationFeeCents: row.authorization_fee_cents,
    status: row.status === "archived" ? "archived" : "published",
    source: "local_review_center",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function entitlementRowToRecord(row: EntitlementRow): LocalRoleEntitlement {
  return {
    entitlementId: row.entitlement_id,
    roleListingId: row.role_listing_id,
    accountId: row.account_id,
    status: row.status === "revoked" ? "revoked" : "authorized",
    source: "zero_price",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function auditRowToRecord(row: ExecutionAuditRow): LocalRoleExecutionAudit {
  return {
    auditRecordId: row.audit_record_id,
    executionId: row.execution_id,
    roleListingId: row.role_listing_id,
    entitlementId: row.entitlement_id,
    status: row.status === "failed" || row.status === "blocked" ? row.status : "completed",
    summary: row.summary,
    ledgerRef: row.ledger_ref,
    billingSummary: readRecord(row.billing_summary),
    createdAt: row.created_at,
  };
}

function ledgerRowToRecord(row: LedgerEntryRow): LocalRoleLedgerEntry {
  return {
    ledgerRef: row.ledger_ref,
    executionId: row.execution_id,
    roleListingId: row.role_listing_id,
    entitlementId: row.entitlement_id,
    authorizationFeeCents: row.authorization_fee_cents,
    executionFeeCents: row.execution_fee_cents,
    source: "local_zero_price",
    status: "posted",
    createdAt: row.created_at,
  };
}

export function publishLocalRoleListing(input: {
  reviewId: string;
  rolePackageId: string;
  title?: string;
  categoryRef: string;
  requiredCapabilities: string[];
  authorizationFeeCents?: number;
}): LocalRoleListing {
  if (!input.reviewId.trim()) throw new Error("缺少本地审核记录。");
  if (!input.rolePackageId.trim()) throw new Error("缺少岗位包编号。");
  if (!input.categoryRef.trim()) throw new Error("岗位必须先绑定正式品类。");
  const fee = input.authorizationFeeCents ?? 0;
  if (fee !== 0) throw new Error("本地首个正式岗位只允许 0 元授权。");
  const timestamp = now();
  const roleListingId = stableId("local_rolelisting", input.reviewId);
  const existing = db()
    .prepare("SELECT created_at FROM local_role_listings WHERE role_listing_id = ?")
    .get(roleListingId) as { created_at: number } | undefined;
  db()
    .prepare(
      "INSERT OR REPLACE INTO local_role_listings(role_listing_id,review_id,role_package_id,title,category_ref,required_capabilities,authorization_fee_cents,status,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      roleListingId,
      input.reviewId,
      input.rolePackageId,
      input.title?.trim() || input.rolePackageId,
      input.categoryRef,
      JSON.stringify(input.requiredCapabilities),
      fee,
      "published",
      "local_review_center",
      existing?.created_at ?? timestamp,
      timestamp,
    );
  return getLocalRoleListing(roleListingId)!;
}

export function getLocalRoleListing(roleListingId: string): LocalRoleListing | null {
  const row = db()
    .prepare("SELECT * FROM local_role_listings WHERE role_listing_id = ?")
    .get(roleListingId) as ListingRow | undefined;
  return row ? listingRowToRecord(row) : null;
}

export function createZeroPriceLocalRoleEntitlement(input: {
  roleListingId: string;
  accountId?: string;
}): LocalRoleEntitlement {
  const listing = getLocalRoleListing(input.roleListingId);
  if (!listing || listing.status !== "published") {
    throw new Error("本地岗位商品不存在或尚未上架，不能授权。");
  }
  if (listing.authorizationFeeCents !== 0) {
    throw new Error("该岗位不是 0 元授权岗位，不能走本地 0 元授权。");
  }
  const accountId = input.accountId?.trim() || "local-admin";
  const entitlementId = stableId("local_entitlement", `${listing.roleListingId}:${accountId}`);
  const timestamp = now();
  const existing = db()
    .prepare("SELECT created_at FROM local_role_entitlements WHERE entitlement_id = ?")
    .get(entitlementId) as { created_at: number } | undefined;
  db()
    .prepare(
      "INSERT OR REPLACE INTO local_role_entitlements(entitlement_id,role_listing_id,account_id,status,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      entitlementId,
      listing.roleListingId,
      accountId,
      "authorized",
      "zero_price",
      existing?.created_at ?? timestamp,
      timestamp,
    );
  return getLocalRoleEntitlement(entitlementId)!;
}

export function getLocalRoleEntitlement(entitlementId: string): LocalRoleEntitlement | null {
  const row = db()
    .prepare("SELECT * FROM local_role_entitlements WHERE entitlement_id = ?")
    .get(entitlementId) as EntitlementRow | undefined;
  return row ? entitlementRowToRecord(row) : null;
}

export function listLocalMarketplaceRoles(
  input: {
    accountId?: string;
    includeUnauthorized?: boolean;
  } = {},
): LocalMarketplaceRole[] {
  const accountId = input.accountId?.trim() || "local-admin";
  let rows: Array<
    ListingRow & { entitlement_id: string | null; entitlement_status: string | null }
  >;
  try {
    rows = db({ ensureSchema: false })
      .prepare(
        "SELECT l.*, e.entitlement_id, e.status AS entitlement_status FROM local_role_listings l LEFT JOIN local_role_entitlements e ON e.role_listing_id = l.role_listing_id AND e.account_id = ? WHERE l.status = 'published' ORDER BY l.updated_at DESC",
      )
      .all(accountId) as Array<
      ListingRow & { entitlement_id: string | null; entitlement_status: string | null }
    >;
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return rows
    .filter((row) => input.includeUnauthorized !== false || row.entitlement_id)
    .map((row) => ({
      id: row.role_listing_id,
      roleListingId: row.role_listing_id,
      title: row.title,
      category: row.category_ref,
      categoryRef: row.category_ref,
      capabilities: readStringArray(row.required_capabilities),
      authorizationFeeCents: row.authorization_fee_cents,
      priceLabel:
        row.authorization_fee_cents === 0 ? "0 元" : `${row.authorization_fee_cents / 100} 元`,
      ...(row.entitlement_id ? { entitlementId: row.entitlement_id } : {}),
      entitlementStatus:
        row.entitlement_id && row.entitlement_status === "authorized" ? "authorized" : "missing",
      source: "local",
    }));
}

export function recordLocalRoleExecutionReadback(input: {
  auditRecordId: string;
  executionId: string;
  roleListingId: string;
  entitlementId: string;
  status?: "completed" | "failed" | "blocked";
  summary: string;
  ledgerRef: string;
  billingSummary: Record<string, unknown>;
}): {
  audit: LocalRoleExecutionAudit;
  ledger: LocalRoleLedgerEntry;
} {
  if (!input.auditRecordId.trim()) throw new Error("缺少本地审计记录编号。");
  if (!input.executionId.trim()) throw new Error("缺少本地执行编号。");
  const listing = getLocalRoleListing(input.roleListingId);
  if (!listing || listing.status !== "published") {
    throw new Error("本地岗位商品不存在或尚未上架，不能写入审计账本。");
  }
  const entitlement = getLocalRoleEntitlement(input.entitlementId);
  if (!entitlement || entitlement.status !== "authorized") {
    throw new Error("本地岗位授权不存在或未授权，不能写入审计账本。");
  }
  if (entitlement.roleListingId !== listing.roleListingId) {
    throw new Error("本地授权与岗位商品不匹配，不能写入审计账本。");
  }
  if (!input.ledgerRef.trim()) throw new Error("缺少本地账本引用。");
  const timestamp = now();
  const billingSummary = {
    authorizationFeeCents: 0,
    executionFeeCents: 0,
    source: "local_zero_price",
    ...input.billingSummary,
    ledgerRef: input.ledgerRef,
  };
  db()
    .prepare(
      "INSERT OR REPLACE INTO local_role_ledger_entries(ledger_ref,execution_id,role_listing_id,entitlement_id,authorization_fee_cents,execution_fee_cents,source,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      input.ledgerRef,
      input.executionId,
      listing.roleListingId,
      entitlement.entitlementId,
      Number(billingSummary.authorizationFeeCents) || 0,
      Number(billingSummary.executionFeeCents) || 0,
      "local_zero_price",
      "posted",
      timestamp,
    );
  db()
    .prepare(
      "INSERT OR REPLACE INTO local_role_execution_audits(audit_record_id,execution_id,role_listing_id,entitlement_id,status,summary,ledger_ref,billing_summary,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      input.auditRecordId,
      input.executionId,
      listing.roleListingId,
      entitlement.entitlementId,
      input.status ?? "completed",
      input.summary.slice(0, 2000),
      input.ledgerRef,
      JSON.stringify(billingSummary),
      timestamp,
    );
  return {
    audit: getLocalRoleExecutionAudit(input.auditRecordId)!,
    ledger: getLocalRoleLedgerEntry(input.ledgerRef)!,
  };
}

export function getLocalRoleExecutionAudit(auditRecordId: string): LocalRoleExecutionAudit | null {
  let row: ExecutionAuditRow | undefined;
  try {
    row = db({ ensureSchema: false })
      .prepare("SELECT * FROM local_role_execution_audits WHERE audit_record_id = ?")
      .get(auditRecordId) as ExecutionAuditRow | undefined;
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return row ? auditRowToRecord(row) : null;
}

export function getLocalRoleExecutionAuditByExecutionId(
  executionId: string,
): LocalRoleExecutionAudit | null {
  let row: ExecutionAuditRow | undefined;
  try {
    row = db({ ensureSchema: false })
      .prepare("SELECT * FROM local_role_execution_audits WHERE execution_id = ?")
      .get(executionId) as ExecutionAuditRow | undefined;
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return row ? auditRowToRecord(row) : null;
}

export function getLocalRoleLedgerEntry(ledgerRef: string): LocalRoleLedgerEntry | null {
  let row: LedgerEntryRow | undefined;
  try {
    row = db({ ensureSchema: false })
      .prepare("SELECT * FROM local_role_ledger_entries WHERE ledger_ref = ?")
      .get(ledgerRef) as LedgerEntryRow | undefined;
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return row ? ledgerRowToRecord(row) : null;
}

export function getLocalRoleLedgerEntryByExecutionId(
  executionId: string,
): LocalRoleLedgerEntry | null {
  let row: LedgerEntryRow | undefined;
  try {
    row = db({ ensureSchema: false })
      .prepare("SELECT * FROM local_role_ledger_entries WHERE execution_id = ?")
      .get(executionId) as LedgerEntryRow | undefined;
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return row ? ledgerRowToRecord(row) : null;
}
