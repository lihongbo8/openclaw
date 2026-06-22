import type { SecretInput } from "./types.secrets.js";

export type ApiConnectionKind = "model" | "tool_skill" | "marketplace" | "dialog" | "custom";

export type ApiConnectionAuthMode = "secret_ref" | "plaintext" | "none" | "oauth";

export type ApiConnectionConsumer =
  | "marketplace"
  | "marketplace_dialog"
  | "local_dialog"
  | "dispatch"
  | "main_chat"
  | "operations_backend"
  | "build_session"
  | "buyer_storefront"
  | "user_center"
  | "developer_center"
  | "ai_review"
  | "role_execution"
  | "tool"
  | "skill"
  | "voice"
  | "image"
  | "media_model"
  | "model";

export type ApiConnectionConfigBinding = {
  path: string;
  owner?: "apiConnections";
  materializedAt?: string;
};

export type ApiConnectionEntry = {
  id: string;
  name: string;
  kind: ApiConnectionKind;
  provider: string;
  baseUrl?: string;
  endpoint?: string;
  authMode?: ApiConnectionAuthMode;
  secret?: SecretInput;
  consumers?: ApiConnectionConsumer[];
  configBindings?: ApiConnectionConfigBinding[];
  requestedScope?: string[];
  metadata?: Record<string, unknown>;
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ApiConnectionsConfig = {
  entries?: Record<string, ApiConnectionEntry>;
};
