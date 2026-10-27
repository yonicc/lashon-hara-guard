export * from './types.js';
export * from './evalExpr.js';
export * from './factStore.js';
export * from './validatePack.js';
export * from './questionPlanner.js';
export * from './evaluate.js';
export * from './liveFacts.js';
export * from './lessonScenario.js';
export * from './meaning.js';
export * from './chafetzChaim/toeletPack.js';
export * from './chafetzChaim/allPacks.js';
export * from './extractor/index.js';
export * from './connectors/index.js';
export { sanitizeContextPacket, computeContextVersion, CONTEXT_PACKET_VERSION } from './contextPacket.js';
export type { ContextPacket, ContextSnapshot } from './contextPacket.js';

// FACT_CATALOG is defined once in lessonScenario.ts (imported via MEANING_FACT_IDS refs).
