import { defaultConfig } from '@/config';

const RESOURCE_CACHE_NAME = 'cft-static-v1';
const MANIFEST_RECORD_KEY = 'resource-manifest';

export interface ResourceManifest {
  schemaVersion: number;
  buildId: string;
  resources: Record<string, string>;
}

interface ResourceCacheStorage {
  getMeta: (key: string) => Promise<unknown>;
  putMeta: (key: string, value: unknown) => Promise<void>;
  deleteMeta: (key: string) => Promise<void>;
}

let activeManifest: ResourceManifest | null = null;
let resourceCachingEnabled = false;

export async function initializeResourceCache(
  enabled: boolean,
  storage: ResourceCacheStorage,
): Promise<void> {
  resourceCachingEnabled = enabled && supportsCacheStorage();
  if (!resourceCachingEnabled) return;

  let previous: ResourceManifest | null = null;
  try {
    previous = parseResourceManifest(await storage.getMeta(MANIFEST_RECORD_KEY));
    const response = await fetch(resolveAppUrl('resource-manifest.json'), { cache: 'no-store' });
    if (!response.ok) throw new Error(`资源清单加载失败 (${response.status})`);
    const current = parseResourceManifest(await response.json());
    if (!current) throw new Error('资源清单格式无效');
    await removeChangedResources(previous, current);
    await storage.putMeta(MANIFEST_RECORD_KEY, current);
    activeManifest = current;
  } catch (error) {
    activeManifest = previous;
    if (!previous) console.warn('资源缓存清单不可用，将直接请求资源:', error);
  }
}

export async function fetchAppResource(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!resourceCachingEnabled || !activeManifest || !supportsCacheStorage()) {
    return fetch(input, init);
  }

  const request = new Request(input, init);
  if (request.method !== 'GET' || !manifestContains(activeManifest, request.url)) {
    return fetch(request);
  }

  let cache: Cache;
  try {
    cache = await caches.open(RESOURCE_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch (error) {
    console.warn('资源缓存读取失败，将直接请求资源:', error);
    return fetch(request);
  }
  const response = await fetch(request);
  if (response.ok) {
    try {
      await cache.put(request, response.clone());
    } catch (error) {
      console.warn('资源缓存写入失败，将继续使用网络响应:', error);
    }
  }
  return response;
}

export async function clearResourceCache(storage: ResourceCacheStorage): Promise<void> {
  activeManifest = null;
  await Promise.all([
    supportsCacheStorage()
      ? caches.delete(RESOURCE_CACHE_NAME).catch((error: unknown) => {
        console.warn('资源缓存删除失败:', error);
        return false;
      })
      : Promise.resolve(false),
    storage.deleteMeta(MANIFEST_RECORD_KEY),
  ]);
}

export async function registerResourceServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(resolveAppUrl('service-worker.js'), {
      scope: import.meta.env.BASE_URL,
    });
    await navigator.serviceWorker.ready;
  } catch (error) {
    console.warn('静态资源 Service Worker 注册失败:', error);
  }
}

export async function unregisterResourceServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.controller?.postMessage({ type: 'disable-cache' });
  const registrations = await navigator.serviceWorker.getRegistrations();
  const scopeUrl = new URL(import.meta.env.BASE_URL, window.location.href).href;
  await Promise.all(
    registrations
      .filter((registration) => registration.scope === scopeUrl)
      .map(async (registration) => {
        registration.active?.postMessage({ type: 'disable-cache' });
        await registration.unregister();
      }),
  );
}

function parseResourceManifest(value: unknown): ResourceManifest | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<ResourceManifest>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.buildId !== 'string' ||
    typeof candidate.resources !== 'object' ||
    candidate.resources === null
  ) return null;
  const resources = Object.entries(candidate.resources).every(([path, hash]) => (
    path.length > 0 && typeof hash === 'string' && hash.length > 0
  ));
  return resources ? candidate as ResourceManifest : null;
}

async function removeChangedResources(
  previous: ResourceManifest | null,
  current: ResourceManifest,
): Promise<void> {
  if (!previous || previous.buildId === current.buildId) return;
  const cache = await caches.open(RESOURCE_CACHE_NAME);
  const stalePaths = Object.entries(previous.resources)
    .filter(([path, hash]) => current.resources[path] !== hash)
    .map(([path]) => resolveAppUrl(path));
  await Promise.all(stalePaths.map((url) => cache.delete(url)));
}

function manifestContains(manifest: ResourceManifest, url: string): boolean {
  const parsed = new URL(url, window.location.href);
  if (parsed.origin !== window.location.origin) return false;
  return Object.keys(manifest.resources).some((path) => resolveAppUrl(path) === parsed.href);
}

function resolveAppUrl(path: string): string {
  const base = defaultConfig.dataBasePath.replace(/\/data$/, '/');
  return new URL(path.replace(/^\//, ''), new URL(base, window.location.href)).href;
}

function supportsCacheStorage(): boolean {
  return typeof caches !== 'undefined';
}
