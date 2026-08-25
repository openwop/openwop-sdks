/**
 * Pins the barrel's browser-safety (openwop-sdks#30).
 *
 * The reported failure was a BUILD error with a message that names a
 * bundler-internal shim — `"createHmac" is not exported by
 * "__vite-browser-external"` — rather than the real cause, so it pointed
 * nowhere useful and sat open for fifteen months.
 *
 * These are manifest + source assertions rather than a bundler run: they fail
 * the moment the condition returns, without a 30-second Vite build in the unit
 * suite. The end-to-end proof (a real Vite build against the packed tarball)
 * is recorded in the PR, red-before-green against published 1.7.0.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
  browser?: Record<string, string>;
};

describe('browser safety of the package barrel', () => {
  it('maps the node:crypto-bearing module to a browser substitute', () => {
    // Without this, importing ANYTHING from the barrel drags in node:crypto
    // and the bundler fails the build.
    expect(pkg.browser?.['./dist/webhook-helpers.js']).toBe('./dist/webhook-helpers.browser.js');
  });

  it('offers a server subpath so webhook helpers stay reachable', () => {
    // The barrel re-export is deprecated, not removed — a consumer needs
    // somewhere to move TO before it goes.
    expect(pkg.exports['./webhooks']).toMatchObject({ import: './dist/webhook-helpers.js' });
  });

  it('the browser substitute does NOT import node:crypto', () => {
    // The substitute existing is not the property; the property is that it
    // carries no Node builtin. A stub that re-exported the real module would
    // satisfy the manifest check above and still break the build.
    const src = readFileSync(join(ROOT, 'src/webhook-helpers.browser.ts'), 'utf8');
    expect(src).not.toMatch(/from 'node:/);
  });

  it('the browser substitute throws rather than reporting a failed verification', async () => {
    // Returning `{ valid: false }` in a browser would be a silent security
    // downgrade: a caller treating "not valid" as "reject" cannot distinguish
    // a forged signature from a platform that could not check one.
    const stub = await import('../webhook-helpers.browser.js');
    expect(() => stub.verifyWebhookSignature()).toThrow(/not available in a browser/i);
    expect(() => stub.signWebhookDelivery()).toThrow(/@openwop\/openwop\/webhooks/);
  });

  it('only webhook-helpers imports a Node builtin — a new one would silently re-break the barrel', () => {
    // The guard that matters over time: this catches the NEXT module that
    // reaches for node:*, which is how the barrel broke in the first place.
    const files = readFileSync(join(ROOT, 'src/index.ts'), 'utf8')
      .split('\n')
      .flatMap((l) => l.match(/from '\.\/([a-z-]+)\.js'/)?.[1] ?? []);
    const offenders = [...new Set(files)].filter((f) => {
      try {
        return /from 'node:/.test(readFileSync(join(ROOT, `src/${f}.ts`), 'utf8'));
      } catch {
        return false;
      }
    });
    expect(offenders).toEqual(['webhook-helpers']);
  });
});
