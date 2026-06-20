import type { ApiConnectionConsumer, ApiConnectionEntry } from "../config/types.api-connections.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  coerceSecretRef,
  normalizeSecretInputString,
  type SecretInput,
} from "../config/types.secrets.js";
import { resolveSecretRefString } from "../secrets/resolve.js";
import { resolveApiModelRefCandidatesForConsumer, type ApiModelRefSelection } from "./metering.js";

export type ApiModelRuntimeBinding = ApiModelRefSelection & {
  baseUrl: string;
  apiKey: string;
  authMode: ApiConnectionEntry["authMode"];
  secretSource: "secret_ref" | "plaintext" | "oauth";
};

const DEFAULT_OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com",
};

function resolveProviderBaseUrl(entry: ApiConnectionEntry): string {
  const configured = entry.baseUrl?.trim();
  if (configured) return configured;
  return DEFAULT_OPENAI_COMPATIBLE_BASE_URLS[entry.provider.toLowerCase()] ?? "";
}

async function resolveApiKey(params: {
  config: OpenClawConfig;
  secret: SecretInput | undefined;
  authMode: ApiConnectionEntry["authMode"];
  env?: NodeJS.ProcessEnv;
  path: string;
}): Promise<{ apiKey: string; secretSource: "secret_ref" | "plaintext" }> {
  const ref = coerceSecretRef(params.secret, params.config.secrets?.defaults);
  if (ref) {
    return {
      apiKey: await resolveSecretRefString(ref, {
        config: params.config,
        env: params.env,
      }),
      secretSource: "secret_ref",
    };
  }

  const plaintext = normalizeSecretInputString(params.secret);
  if (plaintext) {
    return { apiKey: plaintext, secretSource: "plaintext" };
  }

  if (params.authMode === "oauth") {
    throw new Error(
      `${params.path}: OAuth/云端授权不能直接用于本地服务端模型调用，请改用 API Key 或 SecretRef。`,
    );
  }

  throw new Error(`${params.path}: 缺少 API Key 或 SecretRef。`);
}

export async function resolveApiModelRuntimeForConsumer(
  config: OpenClawConfig,
  params: {
    consumer: ApiConnectionConsumer;
    provider?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<ApiModelRuntimeBinding | null> {
  const candidates = resolveApiModelRefCandidatesForConsumer(config, {
    consumer: params.consumer,
    provider: params.provider,
  });
  if (!candidates.length) return null;

  const errors: string[] = [];
  for (const selected of candidates) {
    const entry = config.apiConnections?.entries?.[selected.entryId];
    if (!entry || entry.enabled === false || entry.kind !== "model") continue;

    const baseUrl = resolveProviderBaseUrl(entry);
    if (!baseUrl) {
      errors.push(`apiConnections.entries.${entry.id}.baseUrl: 缺少模型 Provider Base URL。`);
      continue;
    }

    try {
      const auth = await resolveApiKey({
        config,
        secret: entry.secret,
        authMode: entry.authMode,
        env: params.env,
        path: `apiConnections.entries.${entry.id}.secret`,
      });

      return {
        ...selected,
        baseUrl,
        apiKey: auth.apiKey,
        authMode: entry.authMode,
        secretSource: auth.secretSource,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors.length ? errors.join("；") : "API 管理未给模型调用配置可用 Provider。");
}

export function toOpenAICompatibleChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}
