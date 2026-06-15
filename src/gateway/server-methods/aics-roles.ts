import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { buildMyRolesReadModel } from "../../aics-main-flow/my-roles-read-model.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function respondError(respond: RespondFn, error: unknown): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)),
  );
}

export const aicsRolesHandlers: GatewayRequestHandlers = {
  "aics.roles.mine.readModel.get": ({ params, respond }) => {
    try {
      const includeArchived = params.includeArchived === true;
      const includeRecentRuns = params.includeRecentRuns !== false;
      const includeArtifacts = params.includeArtifacts !== false;
      const maxRecentRuns = typeof params.maxRecentRuns === "number" ? params.maxRecentRuns : 20;
      const maxRecentArtifacts =
        typeof params.maxRecentArtifacts === "number" ? params.maxRecentArtifacts : 12;

      // marketplace roles 从 session context 获取，这里暂时传空
      const readModel = buildMyRolesReadModel({
        includeArchived,
        includeRecentRuns,
        includeArtifacts,
        maxRecentRuns,
        maxRecentArtifacts,
      });

      respond(true, readModel);
    } catch (error) {
      respondError(respond, error);
    }
  },
};
