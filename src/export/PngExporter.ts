import { defaultConfig } from '@/config';
import type { ProcessedData } from '@/types';
import {
  MapRenderer,
  type MapRendererSnapshot,
} from '@/map/Renderer';
import type { InfoRectanglePlacement } from '@/map/InfoRectangle';
import {
  RegionDetailRenderer,
  type RegionDetailRendererSnapshot,
} from '@/map/RegionDetailRenderer';
import type { RegionSelection } from '@/details/types';
import type { SaveImageSceneSettings } from './SaveImageScene';
import { fetchAppResource } from '@/cache/ResourceCache';
import { validateExportDimensions } from './validation';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SVG_STYLE_PROPERTIES = [
  'color',
  'display',
  'fill',
  'fill-opacity',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'opacity',
  'paint-order',
  'stroke',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'text-decoration',
  'visibility',
] as const;

export interface PngExportBackground {
  color: string;
  imageUrl: string | null;
  fit: 'cover' | 'contain';
}

export interface PngExportSettings extends SaveImageSceneSettings {
  infoRectanglePlacement: InfoRectanglePlacement;
}

interface BasePngExportRequest {
  width: number;
  height: number;
  fontScale: number;
  visualScale: number;
  data: ProcessedData;
  settings: PngExportSettings;
  background: PngExportBackground;
  filename: string;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface PngExportRequest extends BasePngExportRequest {
  mapSnapshot: MapRendererSnapshot;
}

export interface RegionPngExportRequest extends BasePngExportRequest {
  selection: RegionSelection;
  regionSnapshot: RegionDetailRendererSnapshot;
}

interface PngSceneRenderer {
  getSvgElement: () => SVGSVGElement;
  destroy: () => void;
}

export async function exportMapToPng(request: PngExportRequest): Promise<void> {
  return exportSceneToPng(request, async (host, reportProgress) => {
    const renderer = new MapRenderer(host, {
      cardGroupingMode: request.settings.cardGroupingMode,
      showRegionNames: request.settings.showRegionNames,
      onlyShowRegionNamesWithSchools: request.settings.onlyShowRegionNamesWithSchools,
      showInfoRectangle: request.settings.showInfoRectangle,
      showMiddleSchool: request.settings.showMiddleSchool,
      enableLocalLayoutOptimization: request.settings.enableLocalLayoutOptimization,
      infoRectanglePlacement: request.settings.infoRectanglePlacement,
      cardDraggingEnabled: false,
    });
    try {
      renderer.setRegionSelectionEnabled(false);
      renderer.setSaveImageFontScale(request.fontScale);
      renderer.setSaveImageVisualScale(request.visualScale);
      renderer.setData(request.data);
      await renderer.renderBaseMap();
      reportProgress(0.4);
      await renderer.applySnapshot(request.mapSnapshot);
      await waitForRenderSettlement(request.signal);
      reportProgress(0.6);
      return renderer;
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  });
}

export async function exportRegionToPng(
  request: RegionPngExportRequest,
): Promise<void> {
  return exportSceneToPng(request, async (host, reportProgress) => {
    const renderer = new RegionDetailRenderer(
      host,
      undefined,
      request.settings.showRegionNames,
      request.settings.onlyShowRegionNamesWithSchools,
      request.settings.showInfoRectangle,
      request.settings.infoRectanglePlacement,
      request.settings.enableLocalLayoutOptimization,
      request.settings.cardGroupingMode,
      false,
      false,
      request.settings.interactionMode,
    );
    try {
      renderer.setFontScale(request.fontScale);
      renderer.setVisualScale(request.visualScale);
      await renderer.render(request.selection, request.data);
      reportProgress(0.4);
      renderer.applySnapshot(request.regionSnapshot);
      await waitForRenderSettlement(request.signal);
      reportProgress(0.6);
      return renderer;
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  });
}

async function exportSceneToPng(
  request: BasePngExportRequest,
  createScene: (
    host: HTMLElement,
    reportProgress: (progress: number) => void,
  ) => Promise<PngSceneRenderer>,
): Promise<void> {
  const reportProgress = (progress: number): void => {
    request.signal?.throwIfAborted();
    request.onProgress?.(progress);
  };
  validateExportDimensions(request.width, request.height);
  reportProgress(0.03);
  await waitForDocumentFonts(request.signal);
  reportProgress(0.1);

  const host = createRenderHost(request.width, request.height);
  document.body.append(host);
  let renderer: PngSceneRenderer | null = null;

  try {
    renderer = await createScene(host, reportProgress);

    const svg = renderer.getSvgElement();
    svg.setAttribute('width', String(request.width));
    svg.setAttribute('height', String(request.height));
    await addBackground(
      svg,
      request.background,
      request.width,
      request.height,
      request.signal,
    );
    reportProgress(0.68);
    await inlineSvgImages(svg, request.signal);
    reportProgress(0.78);
    inlineComputedSvgStyles(svg);
    reportProgress(0.82);
    const png = await renderSvgToPng(
      svg,
      request.width,
      request.height,
      reportProgress,
      request.signal,
    );
    request.signal?.throwIfAborted();
    downloadBlob(png, request.filename);
    reportProgress(1);
  } finally {
    renderer?.destroy();
    host.remove();
  }
}

function createRenderHost(width: number, height: number): HTMLDivElement {
  const host = document.createElement('div');
  host.dataset.testid = 'png-export-scene';
  host.style.position = 'fixed';
  host.style.left = '-100000px';
  host.style.top = '0';
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.style.pointerEvents = 'none';
  return host;
}

async function waitForDocumentFonts(signal?: AbortSignal): Promise<void> {
  if (!document.fonts) return;
  try {
    await abortable(document.fonts.ready, signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error('字体加载失败', { cause: error });
  }
}

async function waitForRenderSettlement(signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, Math.max(250, defaultConfig.layoutTransitionDurationMs) + 20);
    const handleAbort = (): void => {
      window.clearTimeout(timeout);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

async function addBackground(
  svg: SVGSVGElement,
  background: PngExportBackground,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<void> {
  const layer = document.createElementNS(SVG_NAMESPACE, 'g');
  layer.setAttribute('class', 'export-background');
  const color = document.createElementNS(SVG_NAMESPACE, 'rect');
  color.setAttribute('width', String(width));
  color.setAttribute('height', String(height));
  color.setAttribute('fill', background.color || 'transparent');
  layer.append(color);

  if (background.imageUrl) {
    const image = document.createElementNS(SVG_NAMESPACE, 'image');
    image.setAttribute('width', String(width));
    image.setAttribute('height', String(height));
    image.setAttribute(
      'preserveAspectRatio',
      background.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice',
    );
    try {
      image.setAttribute('href', await resourceUrlToDataUrl(background.imageUrl, signal));
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new Error('背景图片加载失败', { cause: error });
    }
    layer.append(image);
  }
  svg.insertBefore(layer, svg.firstChild);
}

async function inlineSvgImages(svg: SVGSVGElement, signal?: AbortSignal): Promise<void> {
  const images = Array.from(svg.querySelectorAll<SVGImageElement>('image'));
  await Promise.all(images.map(async (image) => {
    const href = image.getAttribute('href');
    if (!href || href.startsWith('data:')) return;
    try {
      image.setAttribute('href', await resourceUrlToDataUrl(href, signal));
    } catch (error) {
      if (isAbortError(error)) throw error;
      const card = image.closest('g.middle-school-card') as SVGGElement | null;
      if (!card) throw new Error(`图片资源加载失败: ${href}`, { cause: error });
      const kind = image.classList.contains('middle-school-title-image-dark') ? 'dark' : 'light';
      card.classList.add(`is-title-${kind}-failed`);
      image.remove();
    }
  }));
}

async function resourceUrlToDataUrl(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetchAppResource(url, { signal });
  if (!response.ok) throw new Error(`资源请求失败 (${response.status})`);
  return blobToDataUrl(await response.blob(), signal);
}

function blobToDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const reader = new FileReader();
    const handleAbort = (): void => {
      reader.abort();
      reject(createAbortError());
    };
    reader.addEventListener('load', () => {
      signal?.removeEventListener('abort', handleAbort);
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('无法读取图片资源'));
    }, { once: true });
    reader.addEventListener('error', () => {
      signal?.removeEventListener('abort', handleAbort);
      reject(reader.error ?? new Error('无法读取图片资源'));
    }, { once: true });
    signal?.addEventListener('abort', handleAbort, { once: true });
    reader.readAsDataURL(blob);
  });
}

function inlineComputedSvgStyles(svg: SVGSVGElement): void {
  for (const element of [svg, ...Array.from(svg.querySelectorAll<SVGElement>('*'))]) {
    const computed = getComputedStyle(element);
    for (const property of SVG_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) element.style.setProperty(property, value);
    }
  }
}

async function renderSvgToPng(
  svg: SVGSVGElement,
  width: number,
  height: number,
  reportProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const markup = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);
  try {
    const image = await loadImage(objectUrl, signal);
    reportProgress(0.9);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建图片画布');
    context.drawImage(image, 0, 0, width, height);
    reportProgress(0.95);
    const png = await canvasToPngBlob(canvas, signal);
    reportProgress(0.99);
    return png;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error('PNG 图片生成失败', { cause: error });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const image = new Image();
    const handleAbort = (): void => {
      image.src = '';
      reject(createAbortError());
    };
    image.addEventListener('load', () => {
      signal?.removeEventListener('abort', handleAbort);
      resolve(image);
    }, { once: true });
    image.addEventListener('error', () => {
      signal?.removeEventListener('abort', handleAbort);
      reject(new Error('SVG 场景无法载入'));
    }, { once: true });
    signal?.addEventListener('abort', handleAbort, { once: true });
    image.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    let settled = false;
    const handleAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(createAbortError());
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
    canvas.toBlob((blob) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', handleAbort);
      if (blob) resolve(blob);
      else reject(new Error('浏览器未能编码 PNG 图片'));
    }, 'image/png');
  });
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const handleAbort = (): void => reject(createAbortError());
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', handleAbort);
        reject(error);
      },
    );
  });
}

function createAbortError(): DOMException {
  return new DOMException('图片生成已取消', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
