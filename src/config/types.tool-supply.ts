export type ToolSupplyGrantStatus = "approved" | "blocked" | "pending_review";

export type ToolSupplyGrant = {
  id: string;
  capabilityRef: string;
  targetKind?: "tool" | "skill" | "api" | "cloud_capability";
  targetId?: string;
  status: ToolSupplyGrantStatus;
  reason?: string;
  updatedAt?: string;
};

export type ToolSupplyUniqueCapabilityRequest = {
  id: string;
  title: string;
  capabilityRef: string;
  category?: string;
  reason?: string;
  status: "draft" | "pending_review";
  createdAt?: string;
  updatedAt?: string;
};

export type ToolSupplyCategory = {
  id: string;
  name: string;
  source: "cloud";
  status: "active" | "disabled" | "pending";
  listingCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type ToolSupplyBindingTargetKind = "category_capability" | "role_dispatch";

export type ToolSupplyBinding = {
  id: string;
  sourceItemId: string;
  sourceKind: "tool" | "skill";
  targetKind: ToolSupplyBindingTargetKind;
  targetId: string;
  targetTitle?: string;
  status: "active" | "paused";
  syncStatus?: "local" | "syncing" | "synced" | "sync_failed";
  note?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ToolSupplyConfig = {
  categories?: Record<string, ToolSupplyCategory>;
  grants?: Record<string, ToolSupplyGrant>;
  uniqueCapabilityRequests?: Record<string, ToolSupplyUniqueCapabilityRequest>;
  bindings?: Record<string, ToolSupplyBinding>;
};
