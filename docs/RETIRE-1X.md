# Retiring the 1.x SDK line

**Decision (maintainer, 2026-11-24):** the 1.x packages are **deprecated, not yanked**. Stop
publishing them, mark them deprecated in each registry, and keep every published version
installable until about **2027-09-05**, the 12-month old-major retention floor after the 2.0.0
publish (`spec/v2/core/overview.md` §Old-major retention floors in the corpus). v1 reached end of
support on **2026-10-04** (RFC 0234). 2.x is the only maintained line.

| Package | Last published 1.x (checked 2026-11-25) | Replacement |
|---|---|---|
| npm `@openwop/openwop` | `1.10.0` (dist-tag `latest-1`; `latest` is `2.10.0`) | `@openwop/openwop@2` (`sdk/typescript-v2/`) |
| PyPI `openwop-client` | `1.8.0` (latest release `2.10.0`) | `openwop-client>=2,<3` (`sdk/python-v2/`) |
| Go `github.com/openwop/openwop-sdks/go` | `v1.7.0` (tag `go/v1.7.0`) | `github.com/openwop/openwop-sdks/go/v2` (`go/v2/`) |

## What the repo already does

These changes are on `main` and need nothing from the maintainer:

- **Publishing is closed for 1.x.** `.github/workflows/publish.yml` triggers only on major-2 tags
  (`v2.*`, `openwop/v2.*`, `openwop-client/v2.*`, `go/v2.*`). If a 1.x tag ever reached it,
  `validate-tag` and `resolve` would refuse it. The 1.x build, test, parity and release-surface
  legs are gone from `scripts/sdks-check.sh` and `scripts/check-python-go-release-surface.sh`.
- **The 1.x sources are frozen in place.** That means `sdk/typescript/`, `sdk/python/`, the v1
  module in `go/` (everything except `go/v2/`), `sdk/smoke/` (it smokes the 1.x SDKs), and the
  vendored v1 tree they mirror (`api/openapi.yaml`, `api/asyncapi.yaml`, the flat `schemas/*.json`
  and `schemas/envelopes/`).
  Do not edit them. Nothing 2.x builds from them: the 2.x generators, the parity gate and the
  narrow-union gate read only `schemas/v2/`, `api/v2/` and `spec/v2/`. `go/v2` is its own module and
  does not require the v1 module. The 2.x gate (`npm run check`) passes on a copy of the repo with all
  of those paths removed. The sources were frozen rather than moved or deleted for three
  reasons:
  1. The corpus freezes its own old-major tree in place as history (RFC 0234 §A.3,
     `spec/v1/end-of-support.json`).
  2. Go ties the `go/` tag prefix to the `go/` directory, and `go/v2/` sits inside it.
  3. `check:vendored` compares the v1 files at the corpus layout, so it keeps catching any edit to
     them.
- **Deprecation notices are in the sources.** Each 1.x README starts with a deprecation banner.
  `go/go.mod` has the module-level comment
  `// Deprecated: … use github.com/openwop/openwop-sdks/go/v2 …`, and the `openwopclient` package
  doc has a `Deprecated:` paragraph.

Published versions do not depend on any of this. npm and PyPI serve the uploaded artifacts.
proxy.golang.org serves `go/v1.*` tags from the commits they name and caches them, so a later
change on `main` cannot break `go get github.com/openwop/openwop-sdks/go@v1.7.0`.

## What the maintainer runs (by hand, with their own credentials)

Do **not** use `npm unpublish`, PyPI *yank*, or Go `retract`. Each of them removes a version or
hides it from resolution, and doing that inside the window fails the retention floor.

### 1. npm: deprecate every 1.x version (required)

```bash
npm deprecate @openwop/openwop@"<2.0.0" "The 1.x line is retired: OpenWOP v1 reached end of support on 2026-10-04 (RFC 0234). Use @openwop/openwop@2. 1.x stays installable until about 2027-09-05."
```

This marks the versions and does not remove them: `npm install @openwop/openwop@1` still works and
prints the message. To verify:

```bash
npm view @openwop/openwop@1.10.0 deprecated
npm view @openwop/openwop@2.10.0 deprecated   # must print nothing
```

Leave the `latest-1` dist-tag in place, because consumers may install by it. To undo the
deprecation: `npm deprecate @openwop/openwop@"<2.0.0" ""`.

### 2. PyPI: no deprecate command (choose; the default is to do nothing)

PyPI has no deprecation flag. Yanking (PEP 592) is **not** wanted: it hides 1.x from range installs
such as `openwop-client<2`. The options are:

- **Default, no action.** The PyPI project page already renders the 2.10.0 description, and the 1.x
  READMEs in this repo carry the banner. A pinned `openwop-client<2` keeps installing 1.8.0.
- **Optional, a note on the project page.** In the next 2.x release, add one line to
  `sdk/python-v2/README.md`: "The 1.x line is deprecated (v1 end of support 2026-10-04, RFC 0234);
  1.x stays installable until about 2027-09-05." It ships through the normal 2.x flow.
- **Optional, only if the maintainer wants it: a final metadata-only 1.x release (`1.8.1`).** Set
  `Development Status :: 7 - Inactive` and put the banner in the description. Change no code. The
  publish workflow no longer builds 1.x, and the PyPI trusted publisher is bound to that workflow,
  so this needs a manual upload with a PyPI API token:

  ```bash
  git switch -c release/1.x-final openwop-client/v1.8.0
  # sdk/python: version = "1.8.1" in pyproject.toml and __version__; classifier
  #   "Development Status :: 7 - Inactive"; prepend the README banner from main
  cd sdk/python && python -m build && twine upload dist/openwop_client-1.8.1*
  ```

  This creates a new 1.x version, so `lastOldMajor` in the corpus's
  `spec/v2/retention-floors.json` has to be bumped to match.

### 3. Go: the go.mod `Deprecated` comment needs one more tag (optional)

The Go toolchain and pkg.go.dev read `// Deprecated:` from the go.mod of the module's **latest**
version. The latest version is `v1.7.0`, and it has no comment, so the comment on `main` does
nothing until a new `go/v1.*` tag carries it. Do not tag `main`: `go/` on `main` carries unreleased
1.x changes (`ListTriggerDeadLetters` and others since `go/v1.7.0`). Cut a metadata-only patch from
the last tag instead:

```bash
git fetch origin --tags
git switch -c release/1.x-go-deprecated go/v1.7.0
git checkout origin/main -- go/go.mod            # only change: the // Deprecated: module comment
git commit -s -m "chore(go): deprecate the v1 module (use …/go/v2)"
git tag -a go/v1.7.1 -m "go v1.7.1: deprecation notice only"
git push origin go/v1.7.1                        # the tag is the Go release; publish.yml ignores go/v1.*
GOPROXY=https://proxy.golang.org go list -m -json github.com/openwop/openwop-sdks/go@v1.7.1
```

Then `go list -m -u github.com/openwop/openwop-sdks/go` reports `(deprecated)`. The new version means
`lastOldMajor` for the Go row in the corpus's `spec/v2/retention-floors.json` has to be bumped to
`v1.7.1`. Skipping this step is fine: the module stays installable either way, and the only cost is
that `go` tooling never shows the notice.

## Message text

Use the same text everywhere:

> The 1.x line is retired: OpenWOP v1 reached end of support on 2026-10-04 (RFC 0234). Use
> `<v2 package>`. 1.x stays installable until about 2027-09-05.

## After 2027-09-05

The retention floor then ends, and the frozen 1.x sources may be deleted from this repo. Deleting
them does not affect anything already published. Deleting the published versions themselves is a
separate decision and is not required.
