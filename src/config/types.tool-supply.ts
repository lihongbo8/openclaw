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

export type ToolSupplyConfig = {
  grants?: Record<string, ToolSupplyGrant>;
  uniqueCapabilityRequests?: Record<string, ToolSupplyUniqueCapabilityRequest>;
};
