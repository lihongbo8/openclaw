export type {
  ObservationAdapter,
  AdapterFetchResult,
  SourceConfidence,
  SourceFreshness,
  EvidenceRef,
} from "./types.js";

export { createMarketplaceAdapter, type MarketplaceAdapterConfig } from "./marketplace-adapter.js";

export { createHistoricalAdapter, type HistoricalAdapterConfig } from "./historical-adapter.js";

export { createGatewayAdapter, type GatewayAdapterConfig } from "./gateway-adapter.js";

export {
  collectObservations,
  toObservationPackageInput,
  type CollectorResult,
} from "./collector.js";
