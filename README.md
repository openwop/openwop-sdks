# openwop-sdks

Client SDKs for the [OpenWOP protocol](https://github.com/openwop/openwop), in lockstep with the spec.

Carved out of the `openwop/openwop` spec corpus (full history preserved) so the protocol repo
stays a lean spec + conformance contract.

| SDK | Package | Path |
|---|---|---|
| TypeScript | [`@openwop/openwop`](https://www.npmjs.com/package/@openwop/openwop) | `sdk/typescript/` |
| Python | [`openwop-client`](https://pypi.org/project/openwop-client/) | `sdk/python/` |
| Go | `github.com/openwop/openwop-sdks/go` | `go/` |

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
npm run check        # TS build + Python smoke + Go vet/test + SDK parity + release-surface
npm run check:parity # OpenAPI operations <-> typed helpers across all three SDKs
```

`api/openapi.yaml` is a vendored copy of the canonical spec-corpus file (source of truth in
`openwop/openwop`); refresh it on an OpenAPI change. `sdk/PARITY.md` tracks cross-SDK feature parity.

> Note: the SDK ↔ canonical-REST-error-vocabulary consistency test (formerly the
> `describe.skipIf` block in the spec corpus's `spec-corpus-validity.test.ts`, which now
> auto-skips there since the SDK sources left) should be ported here as a follow-up; the
> machine-enforced `check-sdk-parity.mjs` gate above already covers the operation-level surface.

## License

Apache-2.0.
