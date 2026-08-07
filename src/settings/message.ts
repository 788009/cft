import MarkdownIt from 'markdown-it';
import { defaultConfig } from '@/config';

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
});

const ALLOWED_ELEMENTS = new Set([
  'a',
  'abbr',
  'blockquote',
  'br',
  'code',
  'del',
  'details',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);

const BLOCKED_ELEMENTS = new Set([
  'audio',
  'button',
  'canvas',
  'embed',
  'form',
  'iframe',
  'input',
  'link',
  'math',
  'meta',
  'object',
  'script',
  'select',
  'source',
  'style',
  'svg',
  'textarea',
  'video',
]);

export function createSafeMarkdownContent(markdownSource: string): DocumentFragment {
  const html = markdown.render(markdownSource);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const fragment = document.createDocumentFragment();
  const contentBaseUrl = new URL(
    `${defaultConfig.dataBasePath.replace(/\/$/, '')}/`,
    window.location.href,
  );
  for (const child of parsed.body.childNodes) {
    appendSanitizedNode(child, fragment, contentBaseUrl);
  }
  return fragment;
}

function appendSanitizedNode(source: Node, target: Node, baseUrl: URL): void {
  if (source.nodeType === Node.TEXT_NODE) {
    target.appendChild(document.createTextNode(source.textContent ?? ''));
    return;
  }
  if (!(source instanceof Element)) return;

  const tagName = source.tagName.toLowerCase();
  if (BLOCKED_ELEMENTS.has(tagName)) return;
  const nextTarget = ALLOWED_ELEMENTS.has(tagName)
    ? document.createElement(tagName)
    : target;
  if (nextTarget !== target) {
    copySafeAttributes(source, nextTarget as HTMLElement, tagName, baseUrl);
    target.appendChild(nextTarget);
  }
  for (const child of source.childNodes) appendSanitizedNode(child, nextTarget, baseUrl);
}

function copySafeAttributes(
  source: Element,
  target: HTMLElement,
  tagName: string,
  baseUrl: URL,
): void {
  const title = source.getAttribute('title');
  if (title) target.title = title;

  if (tagName === 'a') {
    const href = getSafeLink(source.getAttribute('href') ?? '', baseUrl);
    if (href) {
      const anchor = target as HTMLAnchorElement;
      anchor.href = href;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
    return;
  }

  if (tagName === 'img') {
    const image = target as HTMLImageElement;
    image.alt = source.getAttribute('alt') ?? '';
    const src = getSafeLocalImage(source.getAttribute('src') ?? '', baseUrl);
    if (src) image.src = src;
    copyPositiveIntegerAttribute(source, image, 'width');
    copyPositiveIntegerAttribute(source, image, 'height');
    image.loading = 'lazy';
    image.decoding = 'async';
    return;
  }

  if (tagName === 'details' && source.hasAttribute('open')) {
    target.setAttribute('open', '');
  }
  if (tagName === 'td' || tagName === 'th') {
    copyPositiveIntegerAttribute(source, target, 'colspan');
    copyPositiveIntegerAttribute(source, target, 'rowspan');
  }
}

function getSafeLink(href: string, baseUrl: URL): string | null {
  try {
    const url = new URL(href, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function getSafeLocalImage(src: string, baseUrl: URL): string | null {
  try {
    const url = new URL(src, baseUrl);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === window.location.origin
    ) ? url.href : null;
  } catch {
    return null;
  }
}

function copyPositiveIntegerAttribute(
  source: Element,
  target: HTMLElement,
  name: string,
): void {
  const raw = source.getAttribute(name);
  if (!raw || !/^\d+$/.test(raw)) return;
  const value = Number(raw);
  if (value > 0 && value <= 10000) target.setAttribute(name, String(value));
}
