import { defaultConfig, type CardGroupingMode } from '@/config';
import type { ProcessedData } from '@/types';
import {
  MapRenderer,
  type MapRendererSnapshot,
} from '@/map/Renderer';
import type { InfoRectanglePlacement } from '@/map/InfoRectangle';
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

export interface PngExportSettings {
  cardGroupingMode: CardGroupingMode;
  showRegionNames: boolean;
  onlyShowRegionNamesWithSchools: boolean;
  showInfoRectangle: boolean;
  showMiddleSchool: boolean;
  enableLocalLayoutOptimization: boolean;
  infoRectanglePlacement: InfoRectanglePlacement;
}

export interface PngExportRequest {
  width: number;
  height: number;
  fontScale: number;
  visualScale: number;
  data: ProcessedData;
  mapSnapshot: MapRendererSnapshot;
  settings: PngExportSettings;
  background: PngExportBackground;
  filename: string;
}

export async function exportMapToPng(request: PngExportRequest): Promise<void> {
  validateExportDimensions(request.width, request.height);
  await waitForDocumentFonts();

  const host = createRenderHost(request.width, request.height);
  document.body.append(host);
  const renderer = new MapRenderer(host, {
    cardGroupingMode: request.settings.cardGroupingMode,
    showRegionNames: request.settings.showRegionNames,
    onlyShowRegionNamesWithSchools: request.settings.onlyShowRegionNamesWithSchools,
    showInfoRectangle: request.settings.showInfoRectangle,
    showMiddleSchool: request.settings.showMiddleSchool,
    enableLocalLayoutOptimization: request.settings.enableLocalLayoutOptimization,
    infoRectanglePlacement: request.settings.infoRectanglePlacement,
  });

  try {
    renderer.setRegionSelectionEnabled(false);
    renderer.setSaveImageFontScale(request.fontScale);
    renderer.setSaveImageVisualScale(request.visualScale);
    renderer.setData(request.data);
    await renderer.renderBaseMap();
    await renderer.applySnapshot(request.mapSnapshot);
    await waitForRenderSettlement();

    const svg = renderer.getSvgElement();
    svg.setAttribute('width', String(request.width));
    svg.setAttribute('height', String(request.height));
    await addBackground(svg, request.background, request.width, request.height);
    await inlineSvgImages(svg);
    inlineComputedSvgStyles(svg);
    const png = await renderSvgToPng(svg, request.width, request.height);
    downloadBlob(png, request.filename);
  } finally {
    renderer.destroy();
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

async function waitForDocumentFonts(): Promise<void> {
  if (!document.fonts) return;
  try {
    await document.fonts.ready;
  } catch (error) {
    throw new Error('字体加载失败', { cause: error });
  }
}

async function waitForRenderSettlement(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, Math.max(250, defaultConfig.layoutTransitionDurationMs) + 20);
  });
}

async function addBackground(
  svg: SVGSVGElement,
  background: PngExportBackground,
  width: number,
  height: number,
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
      image.setAttribute('href', await resourceUrlToDataUrl(background.imageUrl));
    } catch (error) {
      throw new Error('背景图片加载失败', { cause: error });
    }
    layer.append(image);
  }
  svg.insertBefore(layer, svg.firstChild);
}

async function inlineSvgImages(svg: SVGSVGElement): Promise<void> {
  const images = Array.from(svg.querySelectorAll<SVGImageElement>('image'));
  await Promise.all(images.map(async (image) => {
    const href = image.getAttribute('href');
    if (!href || href.startsWith('data:')) return;
    try {
      image.setAttribute('href', await resourceUrlToDataUrl(href));
    } catch (error) {
      const card = image.closest('g.middle-school-card') as SVGGElement | null;
      if (!card) throw new Error(`图片资源加载失败: ${href}`, { cause: error });
      const kind = image.classList.contains('middle-school-title-image-dark') ? 'dark' : 'light';
      card.classList.add(`is-title-${kind}-failed`);
      image.remove();
    }
  }));
}

async function resourceUrlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`资源请求失败 (${response.status})`);
  return blobToDataUrl(await response.blob());
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('无法读取图片资源'));
    }, { once: true });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('无法读取图片资源')), {
      once: true,
    });
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
): Promise<Blob> {
  const markup = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);
  try {
    const image = await loadImage(objectUrl);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建图片画布');
    context.drawImage(image, 0, 0, width, height);
    return await canvasToPngBlob(canvas);
  } catch (error) {
    throw new Error('PNG 图片生成失败', { cause: error });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('SVG 场景无法载入')), { once: true });
    image.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('浏览器未能编码 PNG 图片'));
    }, 'image/png');
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
