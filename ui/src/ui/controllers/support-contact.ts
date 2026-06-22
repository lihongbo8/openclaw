import type { AppViewState } from "../app-view-state.ts";

export type SupportContact = {
  displayName: string;
  wechatId: string;
  audience: "developer" | "user" | "system_developer" | "all";
  purpose: string;
  serviceHours?: string;
  note?: string;
};

export type SupportContactState = {
  loading: boolean;
  error: string | null;
  contact: SupportContact | null;
};

export function createDefaultSupportContactState(): SupportContactState {
  return {
    loading: false,
    error: null,
    contact: null,
  };
}

function requestHostUpdate(state: AppViewState): void {
  (
    state as unknown as { requestUpdate?: () => void; requestHostUpdate?: () => void }
  ).requestHostUpdate?.();
  (
    state as unknown as { requestUpdate?: () => void; requestHostUpdate?: () => void }
  ).requestUpdate?.();
}

export async function refreshSupportContact(state: AppViewState): Promise<void> {
  const pageState = state.supportContact;
  if (!state.client || pageState.loading) return;
  pageState.loading = true;
  pageState.error = null;
  requestHostUpdate(state);
  try {
    const result = await state.client.request<{ supportContact?: SupportContact | null }>(
      "aics.supportContact.get",
      {},
    );
    pageState.contact = result.supportContact ?? null;
  } catch (error) {
    pageState.error = error instanceof Error ? error.message : String(error);
  } finally {
    pageState.loading = false;
    requestHostUpdate(state);
  }
}
