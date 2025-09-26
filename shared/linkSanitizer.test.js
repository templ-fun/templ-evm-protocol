import assert from 'node:assert/strict';
import { sanitizeLink } from './linkSanitizer.js';

function run(describeFn, itFn) {
  describeFn('sanitizeLink', () => {
    itFn('allows configured safe schemes', () => {
      const https = sanitizeLink('https://templ.fun');
      assert.equal(https.href, 'https://templ.fun');
      assert.equal(https.text, 'https://templ.fun');
      assert.equal(https.isSafe, true);

      const tg = sanitizeLink('tg://resolve?domain=templfun');
      assert.equal(tg.href, 'tg://resolve?domain=templfun');
      assert.equal(tg.isSafe, true);
    });

    itFn('treats inputs without a scheme as plain text', () => {
      const result = sanitizeLink('templ.fun');
      assert.equal(result.href, null);
      assert.equal(result.text, 'templ.fun');
      assert.equal(result.isSafe, false);
    });

    itFn('strips surrounding whitespace before validating', () => {
      const result = sanitizeLink('  https://templ.fun  ');
      assert.equal(result.href, 'https://templ.fun');
      assert.equal(result.text, 'https://templ.fun');
      assert.equal(result.isSafe, true);
    });

    itFn('rejects dangerous schemes and preserves the text', () => {
      const javascriptLink = sanitizeLink('javascript:alert(1)');
      assert.equal(javascriptLink.href, null);
      assert.equal(javascriptLink.text, 'javascript:alert(1)');
      assert.equal(javascriptLink.isSafe, false);

      const dataLink = sanitizeLink('data:text/html;base64,PGgxPk1hbGljaW91czwvaDE+');
      assert.equal(dataLink.href, null);
      assert.equal(dataLink.text, 'data:text/html;base64,PGgxPk1hbGljaW91czwvaDE+');
      assert.equal(dataLink.isSafe, false);
    });

    itFn('rejects attempts to smuggle newlines or control characters', () => {
      const result = sanitizeLink('https://templ.fun\njavascript:alert(1)');
      assert.equal(result.href, null);
      assert.equal(result.text, 'https://templ.fun\njavascript:alert(1)');
      assert.equal(result.isSafe, false);
    });

    itFn('permits custom scheme overrides', () => {
      const custom = sanitizeLink('ftp://example.com', { allowedSchemes: ['ftp'] });
      assert.equal(custom.href, 'ftp://example.com');
      assert.equal(custom.isSafe, true);
    });
  });
}

try {
  const { describe, it } = await import('vitest');
  run(describe, it);
} catch {
  const { describe, it } = await import('node:test');
  run(describe, it);
}
