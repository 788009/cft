const ALLOWED_ELEMENTS = new Set([
  'a',
  'br',
  'code',
  'em',
  'h3',
  'h4',
  'li',
  'ol',
  'p',
  'strong',
  'ul',
]);

const BLOCKED_ELEMENTS = new Set([
  'button',
  'embed',
  'form',
  'iframe',
  'input',
  'math',
  'object',
  'script',
  'style',
  'svg',
]);

function getSafeLink(href: string): string | null {
  try {
    const url = new URL(href, window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function appendSanitizedNode(source: Node, target: Node): void {
  if (source.nodeType === Node.TEXT_NODE) {
    target.append(document.createTextNode(source.textContent ?? ''));
    return;
  }
  if (!(source instanceof Element)) return;

  const tagName = source.tagName.toLowerCase();
  if (BLOCKED_ELEMENTS.has(tagName)) return;
  const nextTarget = ALLOWED_ELEMENTS.has(tagName)
    ? document.createElement(tagName)
    : target;
  if (nextTarget !== target) {
    if (tagName === 'a') {
      const href = getSafeLink(source.getAttribute('href') ?? '');
      if (href) {
        (nextTarget as HTMLAnchorElement).href = href;
        (nextTarget as HTMLAnchorElement).target = '_blank';
        (nextTarget as HTMLAnchorElement).rel = 'noopener noreferrer';
      }
    }
    target.append(nextTarget);
  }
  for (const child of source.childNodes) appendSanitizedNode(child, nextTarget);
}

export function createSafeMessageContent(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const fragment = document.createDocumentFragment();
  for (const child of parsed.body.childNodes) appendSanitizedNode(child, fragment);
  return fragment;
}
