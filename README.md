# openwop-sdks

Client SDKs for the [OpenWOP protocol](https://github.com/openwop/openwop), in lockstep with the spec.

Carved out of the `openwop/openwop` spec corpus (full history preserved) so the protocol repo
stays a lean spec + conformance contract.

Two generations of packages live side by side. The 1.x packages target v1 hosts (`/v1/…`); the
2.0.0 packages are **v2-ONLY** siblings for the v2 major (`spec/v2/`: bare-origin unversioned
paths, `OpenWOP-Version` negotiation, the closed discovery root, the generated error registry —
RFC 0172 / 0171 / 0173, RFC 0168 §D). Same npm / PyPI names, a new Go major-subdirectory module.

| SDK | Package | 1.x path | 2.x path | 2.x tag form |
|---|---|---|---|---|
| TypeScript | [`@openwop/openwop`](https://www.npmjs.com/package/@openwop/openwop) | `sdk/typescript/` | `sdk/typescript-v2/` | `openwop/v2.Y.Z` |
| Python | [`openwop-client`](https://pypi.org/project/openwop-client/) | `sdk/python/` | `sdk/python-v2/` | `openwop-client/v2.Y.Z` |
| Go | `github.com/openwop/openwop-sdks/go` · `…/go/v2` | `go/` | `go/v2/` | `go/v2/v2.Y.Z` |

A coordinated corpus tag (`v1.Y.Z` / `v2.Y.Z`, rc's `v2.0.0-rc.N`) publishes the three packages of
that major; a pre-release tag publishes to npm under dist-tag `next` and requires a PEP 440
pre-release version on PyPI. The vendored corpus the packages mirror is pinned by [`CORPUS_TAG`](./CORPUS_TAG).

## ⚠️ Go import path change

The Go module moved from `github.com/openwop/openwop/sdk/go` to
**`github.com/openwop/openwop-sdks/go`**. Update imports and re-pin:

```go
import openwop "github.com/openwop/openwop-sdks/go"
```

```bash
go get github.com/openwop/openwop-sdks/go@latest
```

The old path is frozen at its last in-corpus tag; all future releases tag from this repo
(`go/vX.Y.Z`).

## Versioning

Per [`PUBLISHING.md`](https://github.com/openwop/openwop/blob/main/PUBLISHING.md), the three SDKs
track the **spec major** — a spec at v1.x always has SDKs at v1.x; patch versions float
independently within the major. A spec minor/major release triggers a coordinated tag here.

## Checks

```bash
npm run check           # 1.x + 2.x legs: TS build/typecheck + Python + Go + generated-registry --check + parity + release-surface
npm run check:parity    # 1.x: OpenAPI operations <-> typed helpers across the three SDKs
npm run check:parity:v2 # 2.x: spec/v2/path-manifest.json operations <-> one method per SDK (mandatory symbols)
npm run check:vendored  # vendored schemas/api/spec registries match the corpus at CORPUS_TAG
```

`api/openapi.yaml`, `api/v2/*.yaml`, `schemas/**` and `spec/v2/{path-manifest,errors}.json` are
vendored copies of the canonical spec-corpus files at `CORPUS_TAG` (source of truth in
`openwop/openwop`); re-vendor from a published tag, never `main`. `sdk/PARITY.md` tracks cross-SDK
feature parity for both generations.

> Note: the SDK ↔ canonical-REST-error-vocabulary consistency test (formerly the
> `describe.skipIf` block in the spec corpus's `spec-corpus-validity.test.ts`, which now
> auto-skips there since the SDK sources left) should be ported here as a follow-up; the
> machine-enforced `check-sdk-parity.mjs` gate above already covers the operation-level surface.

## License

Apache-2.0.
