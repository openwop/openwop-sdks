/**
 * OpenwopClient — typed HTTP client for the OpenWOP v2 REST surface.
 *
 * Hand-authored. Each method maps 1:1 to an operation in
 * `spec/v2/path-manifest.json` (generated from `api/v2/openapi.yaml`):
 * bare origin, unversioned path keys, negotiation by the `OpenWOP-Version`
 * request header (RFC 0172 §A). Request/response types live in ./types.ts;
 * the error-code union in ./generated.ts.
 *
 * Auth: a single bearer-style API key, supplied at construction.
 */

import { streamEvents, streamHostEvents, type EventsStreamOptions, type HostEventsStreamOptions } from './sse.js';
import {
  WopError,
  type AuditVerifyResult,
  type CreateTriggerSubscriptionResponse,
  type LocalizedContentLanguageSettings,
  type LocalizedContentPage,
  type LocalizedContentPageResponse,
  type LocalizedContentSection,
  type PutContentSectionRequest,
  type TriggerSubscriptionRegistration,
  type BulkCancelRunsRequest,
  type BulkCancelRunsResponse,
  type Capabilities,
  type CancelRunRequest,
  type CancelRunResponse,
  type CompensationProjection,
  type CreateRunRequest,
  type CreateRunResponse,
  type EffectLedgerProjection,
  type EffectSeamManifest,
  type ErrorEnvelope,
  type ForkRunRequest,
  type ForkRunResponse,
  type Annotation,
  type CreateAnnotationRequest,
  type GetPromptRequest,
  type HostEventDoc,
  type InterruptByTokenInspection,
  type ListPromptsRequest,
  type ListPromptsResponse,
  type PromptTemplate,
  type RegisterWebhookRequest,
  type RegisterWebhookResponse,
  type PauseRunRequest,
  type PauseRunResponse,
  type PollEventsResponse,
  type RenderPromptRequest,
  type RenderPromptResponse,
  type ResolveInterruptByTokenResponse,
  type ResolveInterruptRequest,
  type ResolveInterruptResponse,
  type ResumeRunRequest,
  type ResumeRunResponse,
  type RunAncestryResponse,
  type RunDiffResponse,
  type RunEventDoc,
  type RunSnapshot,
  type AgentInventoryEntry,
  type AgentInventoryResponse,
  type AgentRosterEntry,
  type AgentRosterResponse,
  type AgentOrgChart,
  type OrgChartResponsibilityView,
  type EvalSummary,
  type ToolDescriptor,
  type CompactToolDescriptor,
  type AgentDeployment,
  type AgentDeploymentTransition,
} from './types.js';

/** The protocol major this SDK implements; the default for {@link OpenwopClientOptions.major}. */
export const SDK_PROTOCOL_MAJOR = 2;

/** Renders the `OpenWOP-Version` request value for a major: `<major>.0` (the OpenAPI grammar is `<major>.<minor>`). */
export function protocolVersionHeader(major: number): string {
  if (!Number.isInteger(major) || major < 0) {
    throw new TypeError(`OpenwopClient: major must be a non-negative integer (got ${String(major)})`);
  }
  return `${major}.0`;
}

export interface OpenwopClientOptions {
  /** Base URL of the openwop server, e.g., `https://api.example.com`. Trailing slash optional. */
  readonly baseUrl: string;
  /** API key (bearer-style). */
  readonly apiKey: string;
  /**
   * The protocol major to negotiate (RFC 0172 §A.3). Every request carries
   * `OpenWOP-Version: <major>.0`; a host that does not list the major answers
   * `406 protocol_version_unsupported` with `details.protocolVersions[]`.
   * Default {@link SDK_PROTOCOL_MAJOR} (2).
   */
  readonly major?: number;
  /** Optional fetch implementation override (test injection). Defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Default `Accept-Language` to send. Optional. */
  readonly acceptLanguage?: string;
}

export interface MutationOptions {
  /** `Idempotency-Key` for at-most-once mutation semantics (idempotency.md Layer 1). */
  readonly idempotencyKey?: string;
  /** `OpenWOP-Dedup: enforce` — the host rejects a duplicate `(tenantId, scopeId)` with `409 run_already_active` (runs.md §Create). */
  readonly dedup?: 'enforce';
}

interface RawRequestOptions {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

export class OpenwopClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #acceptLanguage: string | undefined;
  readonly #versionHeader: string;

  /** The `OpenWOP-Version` value this client sends on every request. */
  get protocolVersion(): string {
    return this.#versionHeader;
  }

  constructor(opts: OpenwopClientOptions) {
    if (!opts.baseUrl) throw new TypeError('OpenwopClient: baseUrl is required');
    if (!opts.apiKey) throw new TypeError('OpenwopClient: apiKey is required');
    this.#baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetch ?? fetch;
    this.#acceptLanguage = opts.acceptLanguage;
    this.#versionHeader = protocolVersionHeader(opts.major ?? SDK_PROTOCOL_MAJOR);
  }

  // ── Discovery ────────────────────────────────────────────────────────
  readonly discovery = {
    /**
     * `GET /.well-known/openwop` — one resource whose representation the
     * `OpenWOP-Version` header selects (capabilities.md §1): with this
     * client's major the host returns the closed v2 root.
     */
    capabilities: (): Promise<Capabilities> =>
      this.#request<Capabilities>({ method: 'GET', path: '/.well-known/openwop' }, false),

    /** `GET /openapi.json` — the self-describing OpenAPI 3.1 document. */
    openapi: (): Promise<unknown> =>
      this.#request<unknown>({ method: 'GET', path: '/openapi.json' }, false),
  };

  // ── Workflows ────────────────────────────────────────────────────────
  readonly workflows = {
    /** `GET /workflows/{workflowId}` */
    get: (workflowId: string): Promise<unknown> =>
      this.#request<unknown>({
        method: 'GET',
        path: `/workflows/${encodeURIComponent(workflowId)}`,
      }),
  };

  // ── Runs ─────────────────────────────────────────────────────────────
  readonly runs = {
    /** `POST /runs` — the body is closed at the composition (runs.md §Create). */
    create: (body: CreateRunRequest, opts: MutationOptions = {}): Promise<CreateRunResponse> =>
      this.#request<CreateRunResponse>({
        method: 'POST',
        path: '/runs',
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /** `GET /runs/{runId}` — the snapshot (runs.md §Snapshot). */
    get: (runId: string): Promise<RunSnapshot> =>
      this.#request<RunSnapshot>({
        method: 'GET',
        path: `/runs/${encodeURIComponent(runId)}`,
      }),

    /** `POST /runs/{runId}/cancel` — `status` is `cancelling` or `cancelled`. */
    cancel: (
      runId: string,
      body: CancelRunRequest = {},
      opts: MutationOptions = {},
    ): Promise<CancelRunResponse> =>
      this.#request<CancelRunResponse>({
        method: 'POST',
        path: `/runs/${encodeURIComponent(runId)}/cancel`,
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /** `POST /runs/{runId}:pause` — `409` when the run is not pausable. */
    pause: (
      runId: string,
      body: PauseRunRequest = {},
      opts: MutationOptions = {},
    ): Promise<PauseRunResponse> =>
      this.#request<PauseRunResponse>({
        method: 'POST',
        path: `/runs/${encodeURIComponent(runId)}:pause`,
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /** `POST /runs/{runId}:resume` — `409` when the run is not paused. */
    resume: (
      runId: string,
      body: ResumeRunRequest = {},
      opts: MutationOptions = {},
    ): Promise<ResumeRunResponse> =>
      this.#request<ResumeRunResponse>({
        method: 'POST',
        path: `/runs/${encodeURIComponent(runId)}:resume`,
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /**
     * `POST /runs:bulk-cancel` — `200 { results[] }` in request order even
     * when every id failed; per-id authorization yields `ok: false` with
     * `run_forbidden` in that entry, never a top-level `403` (runs.md §Cancel).
     */
    bulkCancel: (
      body: BulkCancelRunsRequest,
      opts: MutationOptions = {},
    ): Promise<BulkCancelRunsResponse> =>
      this.#request<BulkCancelRunsResponse>({
        method: 'POST',
        path: '/runs:bulk-cancel',
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /** `POST /runs/{runId}:fork` — `mode: replay | branch` (runs.md §Fork; replay.md). */
    fork: (
      runId: string,
      body: ForkRunRequest,
      opts: MutationOptions = {},
    ): Promise<ForkRunResponse> =>
      this.#request<ForkRunResponse>({
        method: 'POST',
        path: `/runs/${encodeURIComponent(runId)}:fork`,
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /**
     * `POST /runs/{runId}/annotations` — a live notification, never a run
     * event. Throws on non-2xx (`501` when the host doesn't advertise
     * `feedback`).
     */
    createAnnotation: (
      runId: string,
      body: CreateAnnotationRequest,
      opts: MutationOptions = {},
    ): Promise<Annotation> =>
      this.#request<Annotation>({
        method: 'POST',
        path: `/runs/${encodeURIComponent(runId)}/annotations`,
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /**
     * `GET /runs/{runId}/annotations` — returns `null` when the host doesn't
     * advertise `feedback` (404/501), so callers can branch on capability
     * discovery without try/catch.
     */
    listAnnotations: async (runId: string): Promise<readonly Annotation[] | null> => {
      try {
        const res = await this.#request<{ annotations: Annotation[] }>({
          method: 'GET',
          path: `/runs/${encodeURIComponent(runId)}/annotations`,
        });
        return res.annotations;
      } catch (err) {
        if (err instanceof WopError && (err.status === 404 || err.status === 501)) return null;
        throw err;
      }
    },

    /**
     * `GET /runs/{runId}/ancestry` — the run's immediate parent in the
     * cross-host composition chain; `parent: null` for top-level runs.
     * Returns `null` when the host doesn't advertise
     * `multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported`
     * (the endpoint 404s).
     */
    ancestry: async (runId: string): Promise<RunAncestryResponse | null> => {
      try {
        return await this.#request<RunAncestryResponse>({
          method: 'GET',
          path: `/runs/${encodeURIComponent(runId)}/ancestry`,
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /**
     * `GET /runs/{runId}:diff?against=` — deterministic, replay-aware diff of
     * two runs; requires `runs:read` on both. OPTIONAL surface: `null` on
     * `404`. Identical logs yield `divergedAtSeq: null` + empty `eventDiffs`.
     */
    diff: async (runId: string, against: string): Promise<RunDiffResponse | null> => {
      try {
        return await this.#request<RunDiffResponse>({
          method: 'GET',
          path: `/runs/${encodeURIComponent(runId)}:diff?against=${encodeURIComponent(against)}`,
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /**
     * `GET /runs/{runId}/eval-summary` — the `EvalSummary` for a terminal eval
     * run. `null` on `404` (not an eval run, or `agents.evalSuite`
     * unadvertised); throws `409` while the run is still in progress.
     */
    evalSummary: async (runId: string): Promise<EvalSummary | null> => {
      try {
        return await this.#request<EvalSummary>({
          method: 'GET',
          path: `/runs/${encodeURIComponent(runId)}/eval-summary`,
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /**
     * `GET /runs/{runId}/artifacts/{artifactId}` — an implementation-defined
     * JSON object. `null` on `404`.
     */
    getArtifact: async (runId: string, artifactId: string): Promise<Record<string, unknown> | null> => {
      try {
        return await this.#request<Record<string, unknown>>({
          method: 'GET',
          path: `/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /**
     * `GET /runs/{runId}/compensation` (RFC 0173 §C.1) — the compensation
     * plan and attempts. Gated on `compensation`; `null` on `404`.
     */
    compensation: async (runId: string): Promise<CompensationProjection | null> => {
      try {
        return await this.#request<CompensationProjection>({
          method: 'GET',
          path: `/runs/${encodeURIComponent(runId)}/compensation`,
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /**
     * `GET /runs/{runId}/effects` (RFC 0173 §C.2) — the Layer-2 effect ledger,
     * business-identity keyed. Gated on `idempotency`; `null` on `404`.
     */
    effects: async (runId: string): Promise<EffectLedgerProjection | null> => {
      try {
        return await this.#request<EffectLedgerProjection>({
          method: 'GET',
          path: `/runs/${encodeURIComponent(runId)}/effects`,
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /**
     * `GET /runs/{runId}/events/poll` — the long-poll fallback (events.md
     * §Poll). `afterSequence` returns events with `sequence > afterSequence`;
     * omission means from the first event. The response's `lastSequence` is
     * the highest sequence in the log (`-1` when empty) — feed it back as the
     * next `afterSequence`.
     */
    pollEvents: (
      runId: string,
      params: { afterSequence?: number; timeoutSeconds?: number } = {},
    ): Promise<PollEventsResponse> => {
      const search = new URLSearchParams();
      if (params.afterSequence !== undefined) {
        search.set('afterSequence', String(params.afterSequence));
      }
      if (params.timeoutSeconds !== undefined) {
        search.set('timeout', String(params.timeoutSeconds));
      }
      const qs = search.toString();
      return this.#request<PollEventsResponse>({
        method: 'GET',
        path: `/runs/${encodeURIComponent(runId)}/events/poll${qs ? `?${qs}` : ''}`,
      });
    },

    /**
     * `GET /runs/{runId}/events` — async-iterable SSE consumer. The
     * connection auto-closes after the run's terminal event; break out of
     * the loop or call `signal.abort()` to terminate early.
     */
    events: (runId: string, opts: EventsStreamOptions = {}): AsyncGenerator<RunEventDoc, void, void> =>
      streamEvents(this.#streamContext(), runId, opts),
  };

  // ── Host ─────────────────────────────────────────────────────────────
  readonly host = {
    /**
     * `GET /host/effect-seams` (RFC 0173 §C) — every outbound effect seam
     * replay suppression covers. Throws `401` when unauthenticated.
     */
    effectSeams: (): Promise<EffectSeamManifest> =>
      this.#request<EffectSeamManifest>({ method: 'GET', path: '/host/effect-seams' }),

    /**
     * `GET /host/events` — the `hostEvents` channel (heartbeat messages) as
     * SSE; content-free of run data. A host MAY declare another address
     * under `heartbeat.deliveryChannel` — pass it as `opts.path`.
     */
    events: (opts: HostEventsStreamOptions = {}): AsyncGenerator<HostEventDoc, void, void> =>
      streamHostEvents(this.#streamContext(), opts),
  };

  // ── Manifest-agent inventory (RFC 0072 §A) ───────────────────────────
  // Read-only. Gated on `agents`; the methods return `null` when the host
  // doesn't advertise it (the endpoints 404).
  readonly agents = {
    /** `GET /agents` */
    list: async (): Promise<AgentInventoryResponse | null> => {
      try {
        return await this.#request<AgentInventoryResponse>({ method: 'GET', path: '/agents' });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /** `GET /agents/{agentId}` */
    get: async (agentId: string): Promise<AgentInventoryEntry | null> => {
      try {
        return await this.#request<AgentInventoryEntry>({
          method: 'GET',
          path: `/agents/${encodeURIComponent(agentId)}`,
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /** `GET /agents/{agentId}/deployments` (RFC 0082 §C/§E) — `null` when unadvertised. */
    listDeployments: async (agentId: string): Promise<readonly AgentDeployment[] | null> => {
      try {
        return await this.#request<AgentDeployment[]>({
          method: 'GET',
          path: `/agents/${encodeURIComponent(agentId)}/deployments`,
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /** `POST /agents/{agentId}/deployments` (RFC 0082 §E) — a deployment state transition. */
    transitionDeployment: (
      agentId: string,
      body: AgentDeploymentTransition,
      opts: MutationOptions = {},
    ): Promise<AgentDeployment> =>
      this.#request<AgentDeployment>({
        method: 'POST',
        path: `/agents/${encodeURIComponent(agentId)}/deployments`,
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /** `GET /agents/roster` (RFC 0086 §B) — `null` when unadvertised. */
    listRoster: async (): Promise<AgentRosterResponse | null> => {
      try {
        return await this.#request<AgentRosterResponse>({ method: 'GET', path: '/agents/roster' });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /** `GET /agents/roster/{rosterId}` (RFC 0086 §B) — `null` on `404`. */
    getRosterEntry: async (rosterId: string): Promise<AgentRosterEntry | null> => {
      try {
        return await this.#request<AgentRosterEntry>({
          method: 'GET',
          path: `/agents/roster/${encodeURIComponent(rosterId)}`,
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /** `GET /agents/org-chart` (RFC 0087 §C) — `null` when unadvertised. */
    getOrgChart: async (): Promise<AgentOrgChart | null> => {
      try {
        return await this.#request<AgentOrgChart>({ method: 'GET', path: '/agents/org-chart' });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /** `GET /agents/org-chart/{departmentId}` (RFC 0087 §D) — `null` on `404`. */
    getOrgChartDepartment: async (
      departmentId: string,
      opts: { recursive?: boolean } = {},
    ): Promise<OrgChartResponsibilityView | null> => {
      const qs = opts.recursive === false ? '?recursive=false' : '';
      try {
        return await this.#request<OrgChartResponsibilityView>({
          method: 'GET',
          path: `/agents/org-chart/${encodeURIComponent(departmentId)}${qs}`,
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },
  };

  // ── RFC 0078 — portable tool catalog (gated on `toolCatalog`) ─────────
  readonly tools = {
    /** `GET /tools` — `null` when the host doesn't advertise `toolCatalog`. */
    list: async (): Promise<readonly ToolDescriptor[] | null> => {
      try {
        return await this.#request<ToolDescriptor[]>({ method: 'GET', path: '/tools' });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /** `GET /tools?view=compact` (RFC 0112) — unwraps `{ tools }`; `null` when unadvertised. */
    listCompact: async (): Promise<readonly CompactToolDescriptor[] | null> => {
      try {
        const res = await this.#request<{ tools?: readonly CompactToolDescriptor[] }>({
          method: 'GET',
          path: '/tools?view=compact',
        });
        return res.tools ?? [];
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /** `GET /tools/{toolId}` — `null` on `404`; `{ view: 'compact' }` for the compact projection. */
    get: async (
      toolId: string,
      opts: { readonly view?: 'standard' | 'compact' } = {},
    ): Promise<ToolDescriptor | CompactToolDescriptor | null> => {
      const query = opts.view === 'compact' ? '?view=compact' : '';
      try {
        return await this.#request<ToolDescriptor | CompactToolDescriptor>({
          method: 'GET',
          path: `/tools/${encodeURIComponent(toolId)}${query}`,
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },
  };

  // ── HITL interrupts (run-scoped + signed-token) ──────────────────────
  readonly interrupts = {
    /** `POST /runs/{runId}/interrupts/{nodeId}` */
    resolveByRun: (
      runId: string,
      nodeId: string,
      body: ResolveInterruptRequest,
      opts: MutationOptions = {},
    ): Promise<ResolveInterruptResponse> =>
      this.#request<ResolveInterruptResponse>({
        method: 'POST',
        path: `/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(nodeId)}`,
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /**
     * `GET /interrupts/{token}` — inspect via signed token. The token is the
     * auth; no API key is sent (signed-token endpoints bypass bearer auth so
     * external systems can resolve without openwop credentials).
     */
    inspectByToken: (token: string): Promise<InterruptByTokenInspection> =>
      this.#request<InterruptByTokenInspection>(
        {
          method: 'GET',
          path: `/interrupts/${encodeURIComponent(token)}`,
        },
        false, // unauthenticated (token IS the auth)
      ),

    /** `POST /interrupts/{token}` — resolve via signed token. */
    resolveByToken: (
      token: string,
      body: ResolveInterruptRequest,
      opts: MutationOptions = {},
    ): Promise<ResolveInterruptByTokenResponse> =>
      this.#request<ResolveInterruptByTokenResponse>(
        {
          method: 'POST',
          path: `/interrupts/${encodeURIComponent(token)}`,
          body,
          headers: this.#mutationHeaders(opts),
        },
        false, // unauthenticated (token IS the auth)
      ),
  };

  // ── Webhook subscriptions (webhooks.md; gated on `webhooks`) ─────────
  readonly webhooks = {
    /**
     * `POST /webhooks` — `{ url, events[], secret?, tags? }`; `url` MUST be
     * `https://`. Deliveries are signed HMAC-SHA256 over
     * `${timestamp}.${rawBody}` under the `OpenWOP-*` header family (verify
     * with `@openwop/openwop/webhooks`).
     */
    register: (
      body: RegisterWebhookRequest,
      opts: MutationOptions = {},
    ): Promise<RegisterWebhookResponse> =>
      this.#request<RegisterWebhookResponse>({
        method: 'POST',
        path: '/webhooks',
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /** `DELETE /webhooks/{webhookId}` — `204`; throws `404` when unknown, `403` outside the tenant. */
    unregister: async (webhookId: string): Promise<void> => {
      await this.#request<unknown>({
        method: 'DELETE',
        path: `/webhooks/${encodeURIComponent(webhookId)}`,
      });
    },
  };

  // ── Prompt library (RFC 0028; gated on `prompts`) ────────────────────
  readonly prompts = {
    /** `GET /prompts` — kind / tag / modelClass / source filters + cursor pagination. */
    list: (req: ListPromptsRequest = {}): Promise<ListPromptsResponse> => {
      const search = new URLSearchParams();
      if (req.kind) search.set('kind', req.kind);
      if (req.tag) search.set('tag', req.tag);
      if (req.modelClass) search.set('modelClass', req.modelClass);
      if (req.source) search.set('source', req.source);
      if (req.cursor) search.set('cursor', req.cursor);
      if (req.limit !== undefined) search.set('limit', String(req.limit));
      const query = search.toString();
      return this.#request<ListPromptsResponse>({
        method: 'GET',
        path: `/prompts${query ? `?${query}` : ''}`,
      });
    },

    /** `GET /prompts/{templateId}` — `null` on `404`; a `400 prompt_ref_ambiguous` still throws. */
    get: async (req: GetPromptRequest): Promise<PromptTemplate | null> => {
      const search = new URLSearchParams();
      if (req.version) search.set('version', req.version);
      if (req.libraryId) search.set('libraryId', req.libraryId);
      const query = search.toString();
      try {
        return await this.#request<PromptTemplate>({
          method: 'GET',
          path: `/prompts/${encodeURIComponent(req.templateId)}${query ? `?${query}` : ''}`,
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 404) return null;
        throw err;
      }
    },

    /** `POST /prompts:render` — composed body + sha256 hash; does NOT dispatch an LLM call. */
    render: (req: RenderPromptRequest): Promise<RenderPromptResponse> => {
      return this.#request<RenderPromptResponse>({
        method: 'POST',
        path: '/prompts:render',
        body: req,
      });
    },

    /** `POST /prompts` — requires `prompts.mutableLibrary`. */
    create: (template: PromptTemplate, opts: MutationOptions = {}): Promise<void> => {
      return this.#request<void>({
        method: 'POST',
        path: '/prompts',
        body: template,
        headers: this.#mutationHeaders(opts),
      });
    },

    /** `PUT /prompts/{templateId}` — the submitted SemVer MUST be strictly greater than stored. */
    update: (
      templateId: string,
      template: PromptTemplate,
      opts: MutationOptions = {},
    ): Promise<PromptTemplate> => {
      return this.#request<PromptTemplate>({
        method: 'PUT',
        path: `/prompts/${encodeURIComponent(templateId)}`,
        body: template,
        headers: this.#mutationHeaders(opts),
      });
    },

    /** `DELETE /prompts/{templateId}` */
    delete: (templateId: string): Promise<void> => {
      return this.#request<void>({
        method: 'DELETE',
        path: `/prompts/${encodeURIComponent(templateId)}`,
      });
    },
  };

  // ── Audit-log integrity ──────────────────────────────────────────────
  readonly audit = {
    /**
     * `GET /audit/verify?fromSeq&toSeq` — chain-validity verdict + signed
     * checkpoints + anomalies. Requires the `audit:read` scope; a host that
     * does not serve the profile answers `404`.
     */
    verify: (fromSeq: number, toSeq: number): Promise<AuditVerifyResult> => {
      const search = new URLSearchParams();
      search.set('fromSeq', String(fromSeq));
      search.set('toSeq', String(toSeq));
      return this.#request<AuditVerifyResult>({
        method: 'GET',
        path: `/audit/verify?${search.toString()}`,
      });
    },
  };

  // ── RFC 0103 Localized content surface (gated on `content`) ──────────
  readonly content = {
    /** `GET /content/pages` — `null` when the host doesn't advertise `content` (501). */
    listPages: async (): Promise<readonly LocalizedContentPage[] | null> => {
      try {
        return await this.#request<readonly LocalizedContentPage[]>({
          method: 'GET',
          path: '/content/pages',
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 501) return null;
        throw err;
      }
    },

    /** `GET /content/pages/{slug}` — `acceptLanguage` rides `Accept-Language`; `null` on `404`/`501`. */
    getPage: async (
      slug: string,
      acceptLanguage?: string,
    ): Promise<LocalizedContentPageResponse | null> => {
      try {
        return await this.#request<LocalizedContentPageResponse>({
          method: 'GET',
          path: `/content/pages/${encodeURIComponent(slug)}`,
          ...(acceptLanguage
            ? { headers: { 'Accept-Language': acceptLanguage } }
            : {}),
        });
      } catch (err) {
        if (err instanceof WopError && (err.status === 404 || err.status === 501))
          return null;
        throw err;
      }
    },

    /** `POST /content/pages` (admin). */
    createPage: (body: LocalizedContentPage): Promise<LocalizedContentPage> =>
      this.#request<LocalizedContentPage>({
        method: 'POST',
        path: '/content/pages',
        body,
      }),

    /** `PUT /content/pages/{pageId}/sections/{sectionId}` (admin). */
    putSection: (
      pageId: string,
      sectionId: string,
      body: PutContentSectionRequest,
    ): Promise<LocalizedContentSection> =>
      this.#request<LocalizedContentSection>({
        method: 'PUT',
        path: `/content/pages/${encodeURIComponent(pageId)}/sections/${encodeURIComponent(sectionId)}`,
        body,
      }),

    /** `GET /content/settings` — `null` when the host doesn't advertise `content` (501). */
    getSettings: async (): Promise<LocalizedContentLanguageSettings | null> => {
      try {
        return await this.#request<LocalizedContentLanguageSettings>({
          method: 'GET',
          path: '/content/settings',
        });
      } catch (err) {
        if (err instanceof WopError && err.status === 501) return null;
        throw err;
      }
    },

    /** `PUT /content/settings` (admin). */
    putSettings: (
      body: LocalizedContentLanguageSettings,
    ): Promise<LocalizedContentLanguageSettings> =>
      this.#request<LocalizedContentLanguageSettings>({
        method: 'PUT',
        path: '/content/settings',
        body,
      }),
  };

  // ── RFC 0099 Trigger subscriptions (gated on `triggerBridge`) ─────────
  readonly triggerSubscriptions = {
    /** `POST /trigger-subscriptions` — the `binding.secret*` is returned ONCE; persist it. */
    create: (
      body: TriggerSubscriptionRegistration,
    ): Promise<CreateTriggerSubscriptionResponse> =>
      this.#request<CreateTriggerSubscriptionResponse>({
        method: 'POST',
        path: '/trigger-subscriptions',
        body,
      }),
  };

  // ── Internals ────────────────────────────────────────────────────────
  #streamContext(): { baseUrl: string; apiKey: string; protocolVersion: string; fetch: typeof fetch } {
    return {
      baseUrl: this.#baseUrl,
      apiKey: this.#apiKey,
      protocolVersion: this.#versionHeader,
      fetch: this.#fetch,
    };
  }

  #mutationHeaders(opts: MutationOptions): Record<string, string> {
    const h: Record<string, string> = {};
    if (opts.idempotencyKey) h['Idempotency-Key'] = opts.idempotencyKey;
    if (opts.dedup) h['OpenWOP-Dedup'] = opts.dedup;
    return h;
  }

  async #request<T>(opts: RawRequestOptions, authenticated = true): Promise<T> {
    const url = `${this.#baseUrl}${opts.path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      // RFC 0172 §A.3 — on every request, authenticated or not.
      'OpenWOP-Version': this.#versionHeader,
      ...(opts.headers ?? {}),
    };
    if (opts.body !== undefined && headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (authenticated) {
      headers.Authorization = `Bearer ${this.#apiKey}`;
    }
    if (this.#acceptLanguage && headers['Accept-Language'] === undefined) {
      headers['Accept-Language'] = this.#acceptLanguage;
    }

    const init: RequestInit = { method: opts.method, headers };
    if (opts.body !== undefined) {
      init.body = JSON.stringify(opts.body);
    }
    if (opts.signal) {
      init.signal = opts.signal;
    }

    const res = await this.#fetch(url, init);
    const text = await res.text();
    // Capture traceparent for error reporting (observability.md §Trace
    // context propagation). Header names are case-insensitive per RFC 9110.
    const traceparent =
      res.headers.get('traceparent') ?? res.headers.get('Traceparent') ?? undefined;

    if (!res.ok) {
      let env: ErrorEnvelope | undefined;
      try {
        const parsed: unknown = text.length > 0 ? JSON.parse(text) : undefined;
        if (isErrorEnvelope(parsed)) env = parsed;
      } catch {
        // not JSON; leave envelope undefined
      }
      throw new WopError(res.status, text, env, traceparent);
    }

    if (text.length === 0) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new WopError(
        res.status,
        text,
        {
          error: 'internal_error',
          message: 'Server returned non-JSON body for a 2xx response',
          details: { sdk: 'invalid_json' },
        },
        traceparent,
      );
    }
  }
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return typeof rec['error'] === 'string' && typeof rec['message'] === 'string';
}
