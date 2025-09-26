import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sanitizeLink } from '../../../shared/linkSanitizer.js';

function HomeLinkPreview({ value }) {
  const { href, text } = sanitizeLink(value);
  if (!text) return '—';
  if (!href) return text;
  return createElement('a', { href, target: '_blank', rel: 'noreferrer' }, text);
}

describe('home link sanitization', () => {
  it('renders plain text for javascript links', () => {
    const html = renderToStaticMarkup(createElement(HomeLinkPreview, { value: "javascript:alert('xss')" }));
    expect(html).toBe('javascript:alert(&#x27;xss&#x27;)');
  });

  it('renders anchor tags for safe links', () => {
    const html = renderToStaticMarkup(createElement(HomeLinkPreview, { value: 'https://example.com' }));
    expect(html).toBe('<a href="https://example.com" target="_blank" rel="noreferrer">https://example.com</a>');
  });
});
