import { defaultConfig } from '@/config';
import {
  calculateAreaFontScale,
  calculateInitialSaveImageLayout,
  createSaveImageModeLayout,
  resizeSaveImageMapRect,
  type ImageDimensions,
  type SaveImageMapResizeHandle,
  type SaveImageModeLayout,
} from './geometry';
import { SaveImageState } from './SaveImageState';
import type { SettingsController } from '@/settings/SettingsController';

export interface SaveImageControllerOptions {
  onExit: () => void;
  onLayoutChange: (layout: SaveImageModeLayout) => void;
  onFontScaleChange: (scale: number) => void;
}

export class SaveImageController {
  private readonly settings: SettingsController;
  private readonly onExit: () => void;
  private readonly onLayoutChange: (layout: SaveImageModeLayout) => void;
  private readonly onFontScaleChange: (scale: number) => void;
  private readonly root: HTMLDivElement;
  private readonly menu: HTMLElement;
  private readonly resizeHandles: Map<SaveImageMapResizeHandle, HTMLDivElement>;
  private readonly state = new SaveImageState();
  private layout: SaveImageModeLayout;
  private endMapResize: (() => void) | null = null;
  private widthInput!: HTMLInputElement;
  private heightInput!: HTMLInputElement;
  private fontScaleInput!: HTMLInputElement;

  constructor(
    container: HTMLElement,
    settings: SettingsController,
    options: SaveImageControllerOptions,
  ) {
    this.settings = settings;
    this.onExit = options.onExit;
    this.onLayoutChange = options.onLayoutChange;
    this.onFontScaleChange = options.onFontScaleChange;
    this.layout = this.calculateLayout();

    this.root = document.createElement('div');
    this.root.dataset.testid = 'save-image-mode';
    this.root.className = 'pointer-events-none absolute inset-0 z-30';

    this.menu = document.createElement('aside');
    this.menu.dataset.testid = 'save-image-menu';
    this.menu.className = [
      'pointer-events-auto absolute flex flex-col overflow-hidden border-slate-300',
      'bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900',
    ].join(' ');
    const scrollArea = document.createElement('div');
    scrollArea.dataset.testid = 'save-image-menu-scroll-area';
    scrollArea.className = 'min-h-0 flex-1 overflow-y-auto overscroll-contain';
    const settingsContent = this.settings.createContent(false, false);
    settingsContent.className = 'divide-y divide-slate-200 dark:divide-slate-700';
    scrollArea.append(this.createDimensionSettings(), settingsContent);
    this.menu.append(this.createHeader(), scrollArea);
    this.resizeHandles = this.createResizeHandles();
    this.root.append(this.menu, ...this.resizeHandles.values());
    container.append(this.root);
    this.syncLayout();
  }

  public getLayout(): SaveImageModeLayout {
    return this.layout;
  }

  public resize(viewportWidth: number, viewportHeight: number): void {
    this.layout = calculateInitialSaveImageLayout({
      viewportWidth,
      viewportHeight,
      mapAspectRatio: defaultConfig.export.initialMapAspectRatio,
      menuReservedRatio: defaultConfig.export.menuReservedRatio,
    });
    this.syncLayout();
  }

  public setVisible(visible: boolean): void {
    if (!visible) this.endMapResize?.();
    this.root.classList.toggle('hidden', !visible);
    this.root.setAttribute('aria-hidden', String(!visible));
  }

  public destroy(): void {
    this.endMapResize?.();
    this.root.remove();
  }

  private createHeader(): HTMLElement {
    const header = document.createElement('header');
    header.className = 'flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700';
    const title = document.createElement('h2');
    title.className = 'text-base font-semibold text-slate-900 dark:text-slate-100';
    title.textContent = '保存图片';
    const exit = document.createElement('button');
    exit.type = 'button';
    exit.dataset.testid = 'exit-save-image-mode';
    exit.className = 'min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus-visible:outline-teal-400';
    exit.textContent = '退出';
    exit.addEventListener('click', this.onExit);
    header.append(title, exit);
    return header;
  }

  private createDimensionSettings(): HTMLElement {
    const section = document.createElement('section');
    section.className = 'grid gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-700';
    const heading = document.createElement('h3');
    heading.className = 'text-sm font-semibold text-slate-900 dark:text-slate-100';
    heading.textContent = '图片尺寸';
    const fields = document.createElement('div');
    fields.className = 'grid grid-cols-2 gap-3';
    this.widthInput = this.createNumberInput('save-image-width', '宽度', this.state.getSnapshot().width);
    this.heightInput = this.createNumberInput('save-image-height', '高度', this.state.getSnapshot().height);
    fields.append(this.createLabeledInput('宽度', this.widthInput), this.createLabeledInput('高度', this.heightInput));

    const fontLabel = document.createElement('label');
    fontLabel.className = 'grid gap-1 text-sm text-slate-600 dark:text-slate-400';
    fontLabel.textContent = '字号倍率';
    this.fontScaleInput = this.createNumberInput(
      'save-image-font-scale',
      '字号倍率',
      this.state.getSnapshot().fontScaleMultiplier,
    );
    this.fontScaleInput.step = '0.1';
    this.fontScaleInput.min = '0.1';
    fontLabel.append(this.fontScaleInput);

    const save = document.createElement('button');
    save.type = 'button';
    save.disabled = true;
    save.dataset.testid = 'save-image-button';
    save.className = 'min-h-11 w-full rounded-md bg-teal-700 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950';
    save.textContent = '保存图片';
    section.append(heading, fields, fontLabel, save);

    this.widthInput.addEventListener('change', () => {
      const value = Number(this.widthInput.value);
      if (Number.isFinite(value) && value > 0) this.state.setWidth(value);
      this.syncDimensionInputs();
    });
    this.heightInput.addEventListener('change', () => {
      const value = Number(this.heightInput.value);
      if (Number.isFinite(value) && value > 0) this.state.setHeight(value);
      this.syncDimensionInputs();
    });
    this.fontScaleInput.addEventListener('change', () => {
      const value = Number(this.fontScaleInput.value);
      if (Number.isFinite(value) && value > 0) this.state.setFontScaleMultiplier(value);
      this.fontScaleInput.value = String(this.state.getSnapshot().fontScaleMultiplier);
      this.onFontScaleChange(this.getPreviewFontScale());
    });
    return section;
  }

  private createNumberInput(testId: string, ariaLabel: string, value: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.dataset.testid = testId;
    input.setAttribute('aria-label', ariaLabel);
    input.className = 'min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-teal-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus-visible:outline-teal-400';
    input.min = String(defaultConfig.export.minDimension);
    input.max = String(defaultConfig.export.maxDimension);
    input.value = String(value);
    return input;
  }

  private createLabeledInput(labelText: string, input: HTMLInputElement): HTMLElement {
    const label = document.createElement('label');
    label.className = 'grid gap-1 text-sm text-slate-600 dark:text-slate-400';
    label.textContent = labelText;
    label.append(input);
    return label;
  }

  private createResizeHandles(): Map<SaveImageMapResizeHandle, HTMLDivElement> {
    const handles = new Map<SaveImageMapResizeHandle, HTMLDivElement>();
    const cursors: Record<SaveImageMapResizeHandle, string> = {
      east: 'ew-resize',
      south: 'ns-resize',
      'south-east': 'nwse-resize',
    };
    for (const handle of ['east', 'south', 'south-east'] as const) {
      const hit = document.createElement('div');
      hit.dataset.testid = `save-image-map-resize-${handle}`;
      hit.dataset.handle = handle;
      hit.className = 'pointer-events-auto absolute touch-none';
      hit.style.cursor = cursors[handle];
      hit.addEventListener('pointerdown', (event) => this.beginMapResize(event, handle));

      const visual = document.createElement('div');
      visual.className = [
        'pointer-events-none absolute left-1/2 top-1/2 box-border',
        '-translate-x-1/2 -translate-y-1/2',
      ].join(' ');
      visual.style.width = `${defaultConfig.infoRectangleEditor.handleSize}px`;
      visual.style.height = `${defaultConfig.infoRectangleEditor.handleSize}px`;
      visual.style.border = '2px solid #ffffff';
      visual.style.borderRadius = '2px';
      visual.style.background = '#0f766e';
      hit.append(visual);
      handles.set(handle, hit);
    }
    return handles;
  }

  private calculateLayout(): SaveImageModeLayout {
    return calculateInitialSaveImageLayout({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      mapAspectRatio: defaultConfig.export.initialMapAspectRatio,
      menuReservedRatio: defaultConfig.export.menuReservedRatio,
    });
  }

  private syncLayout(): void {
    const { menuRect, menuPlacement } = this.layout;
    this.menu.style.left = `${menuRect.x}px`;
    this.menu.style.top = `${menuRect.y}px`;
    this.menu.style.width = `${menuRect.width}px`;
    this.menu.style.height = `${menuRect.height}px`;
    this.menu.dataset.placement = menuPlacement;
    this.menu.classList.toggle('border-l', menuPlacement === 'right');
    this.menu.classList.toggle('border-t', menuPlacement === 'bottom');
    this.syncResizeHandles();
    this.onLayoutChange(this.layout);
    this.onFontScaleChange(this.getPreviewFontScale());
  }

  private syncResizeHandles(): void {
    const { width, height } = this.layout.mapRect;
    const hitSize = defaultConfig.infoRectangleEditor.handleHitSize;
    const edgeWidth = Math.max(hitSize, width - hitSize);
    const edgeHeight = Math.max(hitSize, height - hitSize);
    const east = this.resizeHandles.get('east');
    const south = this.resizeHandles.get('south');
    const southEast = this.resizeHandles.get('south-east');
    if (!east || !south || !southEast) return;

    this.setHandleRect(east, width - hitSize / 2, hitSize / 2, hitSize, edgeHeight);
    this.setHandleRect(south, hitSize / 2, height - hitSize / 2, edgeWidth, hitSize);
    this.setHandleRect(
      southEast,
      width - hitSize / 2,
      height - hitSize / 2,
      hitSize,
      hitSize,
    );
  }

  private setHandleRect(
    handle: HTMLElement,
    left: number,
    top: number,
    width: number,
    height: number,
  ): void {
    handle.style.left = `${left}px`;
    handle.style.top = `${top}px`;
    handle.style.width = `${width}px`;
    handle.style.height = `${height}px`;
  }

  private beginMapResize(
    event: PointerEvent,
    handle: SaveImageMapResizeHandle,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    this.endMapResize?.();

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const initialLayout = this.layout;
    const initialDimensions: ImageDimensions = this.state.getSnapshot();
    const move = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const mapRect = resizeSaveImageMapRect({
        initialMapRect: initialLayout.mapRect,
        handle,
        deltaX: moveEvent.clientX - startX,
        deltaY: moveEvent.clientY - startY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        minWidth: defaultConfig.infoRectangleEditor.minWidth,
        minHeight: defaultConfig.infoRectangleEditor.minHeight,
      });
      this.layout = createSaveImageModeLayout(
        window.innerWidth,
        window.innerHeight,
        mapRect,
        initialLayout.menuPlacement,
      );
      this.state.applyMapResize(initialLayout.mapRect, mapRect, initialDimensions);
      this.syncDimensionInputs();
      this.syncLayout();
    };
    const end = (endEvent?: PointerEvent): void => {
      if (endEvent && endEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      this.endMapResize = null;
    };
    this.endMapResize = () => end();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  private getPreviewFontScale(): number {
    const snapshot = this.state.getSnapshot();
    return calculateAreaFontScale(
      { width: this.layout.mapRect.width, height: this.layout.mapRect.height },
      defaultConfig.export.fontScaleAreaRootRatio,
      snapshot.fontScaleMultiplier,
    );
  }

  private syncDimensionInputs(): void {
    const snapshot = this.state.getSnapshot();
    this.widthInput.value = String(snapshot.width);
    this.heightInput.value = String(snapshot.height);
  }
}
