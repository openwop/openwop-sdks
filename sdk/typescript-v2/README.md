# `@openwop/openwop` 2.x — TypeScript SDK for OpenWOP v2 hosts

**openwop is an open, wire-level protocol for multi-agent workflow orchestration.** This package is the reference TypeScript client for the **v2 major** (`spec/v2/`, RFC 0168 §D): one typed method per operation in `spec/v2/path-manifest.json` (51 operations), an async-iterable SSE consumer for the run and host event channels, and zero runtime dependencies.

```bash
npm install @openwop/openwop@next   # 2.0.0-rc.1 — the corpus release-candidate line; `@2` once 2.0.0 is final
```

> **Spec:** [github.com/openwop/openwop](https://github.com/openwop/openwop) · **Corpus tag:** see [`CORPUS_TAG`](../../CORPUS_TAG) · **Mirrors:** [`api/v2/openapi.yaml`](../../api/v2/openapi.yaml), [`api/v2/asyncapi.yaml`](../../api/v2/asyncapi.yaml), [`schemas/v2/`](../../schemas/v2/), [`spec/v2/errors.json`](../../spec/v2/errors.json)
>
> The 1.x package (`sdk/typescript/`) is untouched and keeps publishing for v1 hosts. This is a v2-ONLY client: it never sends a `/v1/…` path.

## What is different from 1.x (RFC 0172 / 0171 / 0173)

| 1.x | 2.x |
| --- | --- |
| `/v1/runs`, `/v1/agents`, … | Bare origin, unversioned path keys: `/runs`, `/agents`, … There is no `/v2/` path space. |
| Negotiation by `protocolVersion` | `OpenWOP-Version: <major>.0` on **every** request (ctor option `major`, default `2`); the host answers `406 protocol_version_unsupported` with `details.protocolVersions[]` when it does not list the major. |
| `X-Dedup` | `OpenWOP-Dedup` (`MutationOptions.dedup`). Every non-standard header is `OpenWOP-<Name>` (headers.md). |
| `pollEvents({ lastSequence })` | `pollEvents({ afterSequence })`; the response is the closed `{ runId, events, lastSequence, status, isTerminal }`. |
| Open discovery root, `supported: boolean` | The closed v2 root: `protocolVersions[]` + `preferredVersion` REQUIRED, every family a `CapabilityRecord` `{ status, since, until?, witness, …facets }` (presence is the claim). Family and metadata keys are generated from `schemas/v2/capabilities.schema.json`. |
| `ErrorEnvelope.error: string` | `ErrorCode \| VendorErrorCode` — the 94-member union is generated from `spec/v2/errors.json` (`ERROR_CODES`, `ERROR_CODE_HTTP_STATUS`, `RETRIABLE_ERROR_CODES`). |
| `workspace.*` (4), `runs.debugBundle`, `userAgents.*` (host-sample seams), `RegistryClient` | Removed — not v2 operations. The pack registry is a separate wire surface a client resolves through `.well-known/openwop-registry.json` `endpoints` (packs.md). |
| — | `runs.compensation`, `runs.effects`, `host.effectSeams` (RFC 0173), `host.events` (the `hostEvents` SSE channel). |
| Webhook `openwop-Webhook-*` legacy names, `v1=<hex>` | `OpenWOP-*` only (`X-openwop-*` accepted through the overlap); `sha256=<hex>`; an unrecognized `OpenWOP-Signature-Algorithm` is rejected. Import from `@openwop/openwop/webhooks` — the barrel no longer carries `node:crypto`. |

## Quickstart

```typescript
import { OpenwopClient, WopError, isTerminalRunStatus } from '@openwop/openwop';

const client = new OpenwopClient({
  baseUrl: 'https://api.example.com',
  apiKey: 'hk_test_abc123',
  // major: 2 — the default; every request carries `OpenWOP-Version: 2.0`.
});

// Discovery — the closed v2 root; `webhooks` is a record or absent, never `supported: false`.
const caps = await client.discovery.capabilities();
console.log(caps.preferredVersion, caps.protocolVersions, caps.webhooks?.status);

// Runs
const { runId } = await client.runs.create(
  { workflowId: 'my-workflow', inputs: { q: 'hello' }, configurable: { version: 1, run: { runTimeoutMs: 60_000 } } },
  { idempotencyKey: crypto.randomUUID(), dedup: 'enforce' },
);

for await (const event of client.runs.events(runId, { streamMode: ['updates', 'messages'] })) {
  console.log(event.sequence, event.type);
}

// Long-poll fallback: feed `lastSequence` back as `afterSequence`.
let cursor: number | undefined;
for (;;) {
  const page = await client.runs.pollEvents(runId, cursor === undefined ? {} : { afterSequence: cursor });
  cursor = page.lastSequence;
  if (page.isTerminal) break;
}

// RFC 0173 read projections
const compensation = await client.runs.compensation(runId); // null when `compensation` is unadvertised
const effects = await client.runs.effects(runId);

// Errors route on the registered code, never on `message`.
try {
  await client.runs.get('tenant/does-not-exist');
} catch (err) {
  if (err instanceof WopError && err.envelope?.error === 'not_found') { /* … */ }
}

void isTerminalRunStatus;
```

Webhook receivers (server-only):

```typescript
import { readWebhookHeaders, verifyWebhookSignature } from '@openwop/openwop/webhooks';

const read = readWebhookHeaders(req.headers);
const outcome = read
  ? verifyWebhookSignature(secret, read.signatureHeader, read.timestampHeader, rawBody, {
      ...(read.algorithmHeader === undefined ? {} : { algorithmHeader: read.algorithmHeader }),
    })
  : { valid: false as const, reason: 'malformed_signature_header' as const };
```

## Generated surface

`src/generated.ts` is produced by `scripts/generate.mjs` from the vendored `spec/v2/errors.json` and `schemas/v2/capabilities.schema.json`. `npm run generate` rewrites it; `npm run generate:check` (run by `scripts/sdks-check.sh`) fails when it drifts from the corpus at `CORPUS_TAG`.

## Method ↔ operation map

Every one of the 51 `spec/v2/path-manifest.json` operations has exactly one method; `scripts/check-sdk-parity.mjs --manifest spec/v2/path-manifest.json --expectations sdk/parity-expectations-v2.json` enforces it. See [`sdk/PARITY.md`](../PARITY.md) §v2.

## Development

```bash
npm install
npm run typecheck   # strict + exactOptionalPropertyTypes
npm test
npm run generate:check
```
