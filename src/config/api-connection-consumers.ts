import type { ApiConnectionConsumer } from "./types.api-connections.js";

export const API_CONNECTION_CONSUMERS = [
  "marketplace",
  "marketplace_dialog",
  "local_dialog",
  "dispatch",
  "main_chat",
  "operations_backend",
  "build_session",
  "buyer_storefront",
  "user_center",
  "developer_center",
  "ai_review",
  "role_execution",
  "tool",
  "skill",
  "voice",
  "image",
  "media_model",
  "model",
] as const satisfies readonly ApiConnectionConsumer[];

export const API_CONNECTION_CONSUMER_SET = new Set<ApiConnectionConsumer>(API_CONNECTION_CONSUMERS);
