/**
 * @openwop/openwop 2.x — TypeScript reference SDK for OpenWOP v2 hosts.
 *
 * Public surface:
 *   - OpenwopClient (auth + one method per `spec/v2/path-manifest.json` operation)
 *   - WopError (typed error wrapping the v2 ErrorEnvelope)
 *   - Generated ERROR_CODES / ErrorCode + capability-key unions (`generated.ts`)
 *   - All request/response types mirroring `api/v2/openapi.yaml` + `schemas/v2/`
 *   - streamEvents / streamHostEvents SSE helpers
 *
 * See README.md for usage examples.
 */

export { OpenwopClient, SDK_PROTOCOL_MAJOR, protocolVersionHeader } from './client.js';
export type { OpenwopClientOptions, MutationOptions } from './client.js';
export { WopError } from './types.js';
export type {
  AuditVerifyAnomaly,
  AuditVerifyCheckpoint,
  AuditVerifyResult,
  BulkCancelRunResult,
  BulkCancelRunsRequest,
  BulkCancelRunsResponse,
  // The closed v2 discovery root (capabilities.md)
  Capabilities,
  CapabilityRecord,
  CapabilityStatus,
  WitnessClass,
  ProtocolVersion,
  CancelRunRequest,
  CancelRunResponse,
  CreateRunRequest,
  CreateRunResponse,
  ErrorEnvelope,
  VendorErrorCode,
  ForkRunRequest,
  ForkRunResponse,
  RegisterWebhookRequest,
  RegisterWebhookResponse,
  InterruptByTokenInspection,
  PauseRunRequest,
  PauseRunResponse,
  PollEventsResponse,
  ResolveInterruptByTokenResponse,
  ResolveInterruptRequest,
  ResolveInterruptResponse,
  ResumeRunRequest,
  ResumeRunResponse,
  RunConfigurable,
  RunDiffEventDiff,
  RunDiffResponse,
  RunEventDoc,
  RunOwner,
  RunSnapshot,
  RunStatus,
  CompensationStatus,
  StreamMode,
  TypedRunEvent,
  // RFC 0173 — compensation / effect ledger / effect seams
  CompensationProjection,
  EffectLedgerProjection,
  EffectSeamManifest,
  // `/host/events` channel
  HostEventDoc,
  HeartbeatEvaluatedPayload,
  HeartbeatStateChangedPayload,
  AgentReasonedPayload,
  AgentReasoningDeltaPayload,
  AgentToolCalledPayload,
  AgentToolReturnedPayload,
  AgentHandoffPayload,
  AgentDecidedPayload,
  MemoryWrittenPayload,
  OutputChunkPayload,
  VoiceSpeechStartPayload,
  VoiceTranscriptPayload,
  VoiceEndpointCandidatePayload,
  VoiceTurnCommitPayload,
  VoiceSynthesisChunkPayload,
  VoiceBargeInPayload,
  VoiceCancelledPayload,
  ChannelPresencePayload,
  DispatchFanOutPayload,
  DispatchJoinPayload,
  ContextSummarizedPayload,
  // RFC 0027 + RFC 0028 — Prompt library
  GetPromptRequest,
  ListPromptsRequest,
  ListPromptsResponse,
  PromptKind,
  PromptRef,
  PromptTemplate,
  PromptVariable,
  RenderPromptRequest,
  RenderPromptResponse,
  // RFC 0072 §A — Manifest-agent inventory
  AgentInventoryEntry,
  AgentInventoryResponse,
  AgentRef,
  // RFC 0081 — Agent evaluation
  AgentModelClass,
  EvalSafetyFinding,
  EvalTaskResult,
  EvalRegression,
  EvalSummary,
  // RFC 0078 — Portable tool catalog
  ToolDescriptor,
  CompactToolDescriptor,
  // RFC 0082 — Agent deployment lifecycle
  DeploymentState,
  AgentDeployment,
  AgentDeploymentTransition,
  // RFC 0086 / 0087 — roster + org chart
  AgentRosterEntry,
  AgentRosterResponse,
  AgentOrgChart,
  OrgChartDepartment,
  OrgChartMember,
  OrgChartResponsibilityView,
  // RFC 0056 — annotations
  Annotation,
  AnnotationSignal,
  CreateAnnotationRequest,
  RunAncestryResponse,
} from './types.js';
export { streamEvents, streamHostEvents } from './sse.js';
export type { EventsStreamContext, EventsStreamOptions, HostEventsStreamOptions } from './sse.js';

// Generated from spec/v2/errors.json + schemas/v2/capabilities.schema.json.
export {
  ERROR_CODES,
  ERROR_CODE_HTTP_STATUS,
  RETRIABLE_ERROR_CODES,
  VENDOR_ERROR_CODE_PATTERN,
  CAPABILITY_FAMILY_KEYS,
  CAPABILITY_METADATA_KEYS,
} from './generated.js';
export type { ErrorCode, CapabilityFamilyKey, CapabilityMetadataKey } from './generated.js';

// Typed event helpers — type guards over `RunEventDoc` plus a high-level
// streaming-reasoning subscription helper.
export {
  isAgentReasoned,
  isAgentReasoningDelta,
  isAgentToolCalled,
  isAgentToolReturned,
  isAgentHandoff,
  isAgentDecided,
  isMemoryWritten,
  isOutputChunk,
  isVoiceSpeechStart,
  isVoiceTranscript,
  isVoiceEndpointCandidate,
  isVoiceTurnCommit,
  isVoiceSynthesisChunk,
  isVoiceBargeIn,
  isVoiceCancelled,
  isChannelPresence,
  isDispatchFanOut,
  isDispatchJoin,
  isContextSummarized,
  subscribeToAgentReasoning,
} from './event-helpers.js';
export type {
  AgentReasoningCallbacks,
  Unsubscribe,
} from './event-helpers.js';

// Run-status + error-code helpers. `HTTP_ERROR_CODES` is the generated
// registry; `isErrorCode` narrows to it, `isRetriableErrorCode` to the
// `retriable: true` rows.
export {
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  isTerminalRunStatus,
  HTTP_ERROR_CODES,
  isHttpErrorCode,
  isErrorCode,
  isRetriableErrorCode,
  isVendorErrorCode,
  RUN_ERROR_CODES,
  isRunErrorCode,
} from './run-helpers.js';
export type {
  ActiveRunStatus,
  TerminalRunStatus,
  HttpErrorCode,
  RunErrorCode,
  RunError,
} from './run-helpers.js';

// Cost-attribution allowlist + sanitizer helpers.
export {
  OPENWOP_COST_ATTRIBUTE_NAMES,
  sanitizeCostAttributes,
} from './cost-attribution.js';
export type { OpenwopCostAttributeName } from './cost-attribution.js';

// Webhook verification is server-only (`node:crypto`) and lives on the
// `@openwop/openwop/webhooks` subpath — it is no longer re-exported from the
// barrel (the 1.x deprecation, removed in this major). The browser-safe
// header-family readers stay here.
export {
  WEBHOOK_HEADER_FAMILIES,
  WEBHOOK_SIGNATURE_ALGORITHMS,
  parseSignatureValue,
  readWebhookHeaders,
} from './webhook-header-families.js';
export type { WebhookHeaderRead, WebhookSignatureAlgorithm } from './webhook-header-families.js';

// AI Envelope types (events.md §AI envelopes). Inbound LLM-emission
// envelope, distinct from RunEventDoc (outbound) and ErrorEnvelope (host HTTP).
export type {
  A2UISurfacePayload,
  A2uiSurfaceDeltaFrame,
  A2uiSurfacePatchOp,
  AIEnvelope,
  AIEnvelopeErrorPayload,
  ClarificationRequestPayload,
  EnvelopeContract,
  EnvelopeContractRefusal,
  EnvelopeMeta,
  EnvelopeOutcome,
  EnvelopeStrictness,
  PartialInfo,
  SchemaRequestPayload,
  SchemaResponsePayload,
  ValidationDetail,
  // RFC 0103 — localized content surface
  LocalizedContentStatus,
  LocalizedContentPage,
  LocalizedContentSection,
  LocalizedContentPageResponse,
  LocalizedContentLanguageSettings,
  PutContentSectionRequest,
  // RFC 0099 — trigger subscription registration
  TriggerSubscriptionRegistration,
  TriggerSubscription,
  CreateTriggerSubscriptionResponse,
} from './types.js';

// RFC 0030 §A `reasoning` field prompt-directive helper.
export { buildReasoningDirective } from './envelope-directive.js';
export type { ReasoningDirectiveStrength } from './envelope-directive.js';

// RFC 0032 §B.3 + RFC 0033 §D refusal detection helper. **SECURITY:** pass
// `refusalText` through the BYOK redaction harness BEFORE persistence — this
// helper does NOT redact.
export { parseRefusal } from './parse-refusal.js';
export type { RefusalProvider, RefusalSignal } from './parse-refusal.js';
