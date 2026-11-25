# OpenWOP SDKs

OpenWOP is the open-source protocol for multi-agent workflow orchestration: run AI agents as workflows you can watch, pause for human approval and replay, on any host that implements it.

This repo holds the official TypeScript, Python, and Go client SDKs, in lockstep with the
[spec](https://github.com/openwop/openwop).

[openwop.dev](https://openwop.dev) · [Quickstart](https://openwop.dev/quickstart/)

```bash
npm install @openwop/openwop@2                   # TypeScript
pip install "openwop-client>=2,<3"                # Python
go get github.com/openwop/openwop-sdks/go/v2      # Go
```

Carved out of the `openwop/openwop` spec corpus (full history preserved) so the protocol repo
stays a lean spec + conformance contract.

**v2 is the current protocol major, and 2.x is the only maintained SDK line.** The 2.x packages
are v2-ONLY (`spec/v2/`: bare-origin unversioned paths, `OpenWOP-Version` negotiation, the closed
discovery root, the generated error registry — RFC 0172 / 0171 / 0173, RFC 0168 §D), cover all
68 operations of `spec/v2/path-manifest.json` at corpus **`v2.46.38`**
([`CORPUS_TAG`](./CORPUS_TAG)). The latest published release is **2.10.0**, on corpus `v2.46.41`.

**The 1.x line is deprecated (2026-11-24).** The 1.x packages target v1 hosts (`/v1/…`), and v1
reached end of support on **2026-10-04** (RFC 0234). 1.x is no longer maintained, built, tested or
published from this repo. It is deprecated, not yanked: the published 1.x versions stay installable
until about **2027-09-05** (the 12-month floor after the 2.0.0 publish), so existing pins keep
building. Unpinned installs resolve to 2.x. The 1.x sources are kept frozen in place as history
(do not edit), and [`docs/RETIRE-1X.md`](./docs/RETIRE-1X.md) records the retirement.

| SDK | Maintained (2.x) | 2.x path | 2.x tag form | 1.x line: **deprecated**, installable to ~2027-09-05 |
|---|---|---|---|---|
| TypeScript [`@openwop/openwop`](https://www.npmjs.com/package/@openwop/openwop) | `npm install @openwop/openwop@2` | `sdk/typescript-v2/` | `openwop/v2.Y.Z` | last `1.10.0` · frozen at `sdk/typescript/` |
| Python [`openwop-client`](https://pypi.org/project/openwop-client/) | `pip install "openwop-client>=2,<3"` | `sdk/python-v2/` | `openwop-client/v2.Y.Z` | last `1.8.0` · frozen at `sdk/python/` |
| Go | `go get github.com/openwop/openwop-sdks/go/v2` | `go/v2/` | `go/v2.Y.Z` | module `…/go`, last `v1.7.0` · frozen at `go/` (minus `go/v2/`) |

```go
import openwop "github.com/openwop/openwop-sdks/go/v2"
```

Same npm / PyPI names across the two generations; Go's v2 is the major-subdirectory module `…/go/v2`.
A coordinated corpus tag (`v2.Y.Z`, rc's `v2.0.0-rc.N`) publishes the three 2.x packages; a
pre-release tag publishes to npm under dist-tag `next` and requires a PEP 440 pre-release version on
PyPI. 1.x tags no longer trigger the publish workflow.

## Go import path (from the monorepo era)

Before the SDKs left the spec corpus, the Go module lived at `github.com/openwop/openwop/sdk/go`.
That path is frozen at its last in-corpus tag. The v1 line moved to
`github.com/openwop/openwop-sdks/go` (tags `go/v1.Y.Z`, now deprecated, last `go/v1.7.0`); v2 is
`…/go/v2` (tags `go/v2.Y.Z`).

## Versioning

Per [`PUBLISHING.md`](https://github.com/openwop/openwop/blob/main/PUBLISHING.md), the three SDKs
track the **spec major** — a spec at v1.x always has SDKs at v1.x; patch versions float
independently within the major. A spec minor/major release triggers a coordinated tag here.

## Checks

```bash
npm run check           # 2.x: TS build/typecheck + Python + Go + generated-registry --check + parity + release-surface
npm run check:parity:v2 # 2.x: spec/v2/path-manifest.json operations <-> one method per SDK (mandatory symbols)
npm run check:vendored  # vendored schemas/api/spec registries match the corpus at CORPUS_TAG
```

`api/openapi.yaml`, `api/v2/*.yaml`, `schemas/**` and `spec/v2/{path-manifest,errors}.json` are
vendored copies of the canonical spec-corpus files at `CORPUS_TAG` (source of truth in
`openwop/openwop`); re-vendor from a published tag, never `main`. The v1 files among them
(`api/openapi.yaml`, `api/asyncapi.yaml`, the flat `schemas/*.json`, `schemas/envelopes/`) are the frozen v1 tree (RFC 0234
§A.3): nothing 2.x builds from them, and `check:vendored` keeps them byte-equal to the corpus.
`sdk/PARITY.md` tracks cross-SDK feature parity.

> Note: the SDK ↔ canonical-REST-error-vocabulary consistency test (formerly the
> `describe.skipIf` block in the spec corpus's `spec-corpus-validity.test.ts`, which now
> auto-skips there since the SDK sources left) should be ported here as a follow-up; the
> machine-enforced `check-sdk-parity.mjs` gate above already covers the operation-level surface.

## License

Apache-2.0.
