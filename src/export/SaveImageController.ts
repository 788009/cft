import { defaultConfig } from '@/config';
import {
  calculateAreaFontScale,
  calculateInitialSaveImageLayout,
  createSaveImageModeLayout,
  linkImageDimensions,
  resizeSaveImageMapRect,
  type ImageDimensions,
  type SaveImageMapResizeHandle,
  type SaveImageModeLayout,
} from './geometry';
import {
  SaveImageState,
  type SaveImageStateSnapshot,
} from './SaveImageState';
import type { SettingsController } from '@/settings/SettingsController';
import {
  getExportDimensionWarnings,
  validateExportDimensions,
} from './validation';
import { setDynamicExtraObstacles } from '@/logic/layout';
import type { Rect } from '@/logic/layout';

export interface SaveImageControllerOptions {
  onExit: () => void;
  onLayoutChange: (layout: SaveImageModeLayout) => void;
  onFontScaleChange: (scale: number) => void;
  onVisualScaleChange: (scale: number) => void;
  onRearrangeCards: () => void;
  onSave: (
    snapshot: SaveImageStateSnapshot,
    onProgress: (progress: number) => void,
    signal: AbortSignal,
  ) => Promise<void>;
}

export class SaveImageController {
  private readonly settings: SettingsController;
  private readonly onExit: () => void;
  private readonly onLayoutChange: (layout: SaveImageModeLayout) => void;
  private readonly onFontScaleChange: (scale: number) => void;
  private readonly onVisualScaleChange: (scale: number) => void;
  private readonly onRearrangeCards: () => void;
  private readonly onSave: SaveImageControllerOptions['onSave'];
  private readonly root: HTMLDivElement;
  private readonly menu: HTMLElement;
  private readonly blankSeparator: HTMLDivElement;
  private readonly resizeHandles: Map<SaveImageMapResizeHandle, HTMLDivElement>;
  private readonly state = new SaveImageState();
  private layout: SaveImageModeLayout;
  private endMapResize: (() => void) | null = null;
  private widthInput!: HTMLInputElement;
  private heightInput!: HTMLInputElement;
  private fontScaleInput!: HTMLInputElement;
  private saveButton!: HTMLButtonElement;
  private saveButtonLabel!: HTMLSpanElement;
  private saveButtonProgress!: HTMLSpanElement;
  private saveActions!: HTMLDivElement;
  private cancelButton!: HTMLButtonElement;
  private saveStatus!: HTMLParagraphElement;
  private generationAbortController: AbortController | null = null;

  private imagesContainer: HTMLDivElement;
  private editOverlay: HTMLDivElement;
  private imagesListContainer!: HTMLDivElement;
  private editingImageIds = new Set<string>();
  private imageElements = new Map<string, HTMLImageElement>();

  constructor(
    container: HTMLElement,
    settings: SettingsController,
    options: SaveImageControllerOptions,
  ) {
    this.settings = settings;
    this.onExit = options.onExit;
    this.onLayoutChange = options.onLayoutChange;
    this.onFontScaleChange = options.onFontScaleChange;
    this.onVisualScaleChange = options.onVisualScaleChange;
    this.onRearrangeCards = options.onRearrangeCards;
    this.onSave = options.onSave;
    this.layout = this.calculateLayout();

    this.root = document.createElement('div');
    this.root.dataset.testid = 'save-image-mode';
    this.root.className = 'pointer-events-none absolute inset-0 z-30';

    this.imagesContainer = document.createElement('div');
    this.imagesContainer.className = 'absolute pointer-events-none overflow-hidden';

    this.editOverlay = document.createElement('div');
    this.editOverlay.className = 'absolute hidden touch-none z-40 pointer-events-auto';
    this.editOverlay.style.cursor = 'move';
    this.setupEditOverlay();

    this.menu = document.createElement('aside');
    this.menu.dataset.testid = 'save-image-menu';
    this.menu.className = [
      'pointer-events-auto absolute flex flex-col overflow-hidden border-slate-300',
      'bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900',
    ].join(' ');
    this.blankSeparator = document.createElement('div');
    this.blankSeparator.dataset.testid = 'save-image-blank-separator';
    this.blankSeparator.className = [
      'pointer-events-none absolute border-slate-300 dark:border-slate-700',
    ].join(' ');
    const scrollArea = document.createElement('div');
    scrollArea.dataset.testid = 'save-image-menu-scroll-area';
    scrollArea.className = 'min-h-0 flex-1 overflow-y-auto overscroll-contain';
    const settingsContent = this.settings.createContent(false, false);
    settingsContent.className = 'divide-y divide-slate-200 dark:divide-slate-700';
    scrollArea.append(
      this.createDimensionSettings(),
      this.createImagesSection(),
      settingsContent,
    );
    this.menu.append(this.createHeader(), scrollArea);
    this.resizeHandles = this.createResizeHandles();
    this.root.append(
      this.imagesContainer,
      this.editOverlay,
      this.blankSeparator,
      this.menu,
      ...this.resizeHandles.values(),
    );
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
    this.generationAbortController?.abort();
    setDynamicExtraObstacles([]);
    this.root.remove();
  }

  private setupEditOverlay(): void {
    const activePointers = new Map<number, PointerEvent>();
    const initialRects = new Map<string, Rect>();
    
    let startX = 0;
    let startY = 0;
    let initialDistance = 0;
    let initialMidX = 0;
    let initialMidY = 0;

    this.editOverlay.addEventListener('pointerdown', (e) => {
      if (this.editingImageIds.size === 0) return;
      activePointers.set(e.pointerId, e);
      this.editOverlay.setPointerCapture(e.pointerId);

      // 记录所有选中图片的初始位置
      initialRects.clear();
      for (const id of this.editingImageIds) {
        const img = this.state.getSnapshot().addedImages.find(i => i.id === id);
        if (img) initialRects.set(id, { ...img.rect });
      }

      if (activePointers.size === 1) {
        startX = e.clientX;
        startY = e.clientY;
      } else if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        initialDistance = Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY);
        initialMidX = (pts[0].clientX + pts[1].clientX) / 2;
        initialMidY = (pts[0].clientY + pts[1].clientY) / 2;
      }
    });

    this.editOverlay.addEventListener('pointermove', (e) => {
      if (this.editingImageIds.size === 0 || initialRects.size === 0 || !activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, e);

      if (activePointers.size === 1) {
        const pts = Array.from(activePointers.values());
        const dx = pts[0].clientX - startX;
        const dy = pts[0].clientY - startY;
        
        for (const [id, initialRect] of initialRects) {
          const newRect = { ...initialRect, x: initialRect.x + dx, y: initialRect.y + dy };
          this.state.updateImageRect(id, newRect);
        }
        this.syncAddedImagesDOM();
      } else if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        const currentDistance = Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY);
        const currentMidX = (pts[0].clientX + pts[1].clientX) / 2;
        const currentMidY = (pts[0].clientY + pts[1].clientY) / 2;

        if (initialDistance < 5) return;

        let actualScale = currentDistance / initialDistance;
        
        // 遍历所有选中的图片，确保任一图片缩放后都不会小于 1px
        for (const [_, initialRect] of initialRects) {
          if (initialRect.width * actualScale < 1) actualScale = Math.max(actualScale, 1 / initialRect.width);
          if (initialRect.height * actualScale < 1) actualScale = Math.max(actualScale, 1 / initialRect.height);
        }

        const overlayRect = this.editOverlay.getBoundingClientRect();
        const localMidX = initialMidX - overlayRect.left;
        const localMidY = initialMidY - overlayRect.top;
        const dx = currentMidX - initialMidX;
        const dy = currentMidY - initialMidY;

        for (const [id, initialRect] of initialRects) {
          const newRect = {
            x: localMidX - (localMidX - initialRect.x) * actualScale + dx,
            y: localMidY - (localMidY - initialRect.y) * actualScale + dy,
            width: initialRect.width * actualScale,
            height: initialRect.height * actualScale,
          };
          this.state.updateImageRect(id, newRect);
        }
        this.syncAddedImagesDOM();
      }
    });

    const endDrag = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      
      if (activePointers.size === 1 && this.editingImageIds.size > 0) {
        initialRects.clear();
        for (const id of this.editingImageIds) {
          const img = this.state.getSnapshot().addedImages.find(i => i.id === id);
          if (img) initialRects.set(id, { ...img.rect });
        }
        const remainingPointer = Array.from(activePointers.values())[0];
        startX = remainingPointer.clientX;
        startY = remainingPointer.clientY;
      } else if (activePointers.size === 0) {
        initialRects.clear();
      }
    };

    this.editOverlay.addEventListener('pointerup', endDrag);
    this.editOverlay.addEventListener('pointercancel', endDrag);

    this.editOverlay.addEventListener('wheel', (e) => {
      if (this.editingImageIds.size === 0) return;
      e.preventDefault();
      
      const scale = e.deltaY > 0 ? 0.9 : 1.1;
      const rectX = e.offsetX;
      const rectY = e.offsetY;

      let actualScale = scale;
      // 第一次遍历：计算适用于所有选中图片的缩放极限
      for (const id of this.editingImageIds) {
        const img = this.state.getSnapshot().addedImages.find(i => i.id === id);
        if (!img) continue;
        if (img.rect.width * scale < 1) actualScale = Math.max(actualScale, 1 / img.rect.width);
        if (img.rect.height * scale < 1) actualScale = Math.max(actualScale, 1 / img.rect.height);
      }

      // 第二次遍历：应用缩放
      for (const id of this.editingImageIds) {
        const img = this.state.getSnapshot().addedImages.find(i => i.id === id);
        if (!img) continue;
        const rect = img.rect;
        const newRect = {
          x: rectX - (rectX - rect.x) * actualScale,
          y: rectY - (rectY - rect.y) * actualScale,
          width: rect.width * actualScale,
          height: rect.height * actualScale,
        };
        this.state.updateImageRect(id, newRect);
      }
      this.syncAddedImagesDOM();
    }, { passive: false });
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

    this.saveButton = document.createElement('button');
    this.saveButton.type = 'button';
    this.saveButton.dataset.testid = 'save-image-button';
    this.saveButton.className = 'relative min-h-11 w-full overflow-hidden rounded-md bg-teal-700 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950';
    this.saveButtonProgress = document.createElement('span');
    this.saveButtonProgress.dataset.testid = 'save-image-progress';
    this.saveButtonProgress.className = 'pointer-events-none absolute inset-y-0 left-0 hidden bg-teal-950/30 dark:bg-teal-950/25';
    this.saveButtonProgress.setAttribute('aria-hidden', 'true');
    this.saveButtonLabel = document.createElement('span');
    this.saveButtonLabel.dataset.testid = 'save-image-button-label';
    this.saveButtonLabel.className = 'relative z-10';
    this.saveButtonLabel.textContent = '保存图片';
    this.saveButton.append(this.saveButtonProgress, this.saveButtonLabel);
    this.cancelButton = document.createElement('button');
    this.cancelButton.type = 'button';
    this.cancelButton.dataset.testid = 'cancel-save-image';
    this.cancelButton.className = 'hidden min-h-11 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-700 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950 dark:focus-visible:outline-red-300';
    this.cancelButton.textContent = '取消';
    this.cancelButton.addEventListener('click', () => {
      this.cancelButton.disabled = true;
      this.generationAbortController?.abort();
    });
    this.saveActions = document.createElement('div');
    this.saveActions.dataset.testid = 'save-image-actions';
    this.saveActions.className = 'grid grid-cols-1 gap-2';
    this.saveActions.append(this.saveButton, this.cancelButton);
    this.saveStatus = document.createElement('p');
    this.saveStatus.dataset.testid = 'save-image-status';
    this.saveStatus.className = 'hidden text-sm text-red-700 dark:text-red-300';
    this.saveStatus.setAttribute('role', 'alert');
    this.saveButton.addEventListener('click', async () => {
      if (this.saveButton.disabled) return;
      this.saveButton.disabled = true;
      this.saveButton.setAttribute('aria-busy', 'true');
      this.cancelButton.disabled = false;
      this.cancelButton.classList.remove('hidden');
      this.saveActions.style.gridTemplateColumns = 'minmax(0, 4fr) minmax(72px, 1fr)';
      this.setSaveProgress(0);
      this.widthInput.disabled = true;
      this.heightInput.disabled = true;
      this.fontScaleInput.disabled = true;
      this.setSaveStatus(null);
      const abortController = new AbortController();
      this.generationAbortController = abortController;
      let outcome: 'success' | 'cancelled' | 'failed' = 'success';
      try {
        // 在导出前，将图片的 UI 像素坐标放大到 Export 图片像素坐标
        const snapshot = this.state.getSnapshot();
        const scaleX = snapshot.width / this.layout.mapRect.width;
        const scaleY = snapshot.height / this.layout.mapRect.height;
        
        const scaledSnapshot = {
          ...snapshot,
          addedImages: snapshot.addedImages.map(img => ({
            ...img,
            rect: {
              x: img.rect.x * scaleX,
              y: img.rect.y * scaleY,
              width: img.rect.width * scaleX,
              height: img.rect.height * scaleY,
            }
          }))
        };

        await this.onSave(
          scaledSnapshot,
          (progress) => this.setSaveProgress(progress),
          abortController.signal,
        );
      } catch (error) {
        if (isAbortError(error)) {
          outcome = 'cancelled';
          this.setSaveStatus('已取消生成图片', 'warning');
        } else {
          outcome = 'failed';
          this.setSaveStatus(error instanceof Error ? error.message : '图片生成失败', 'error');
        }
      } finally {
        if (this.generationAbortController === abortController) {
          this.generationAbortController = null;
        }
        this.saveButton.disabled = false;
        this.saveButton.removeAttribute('aria-busy');
        this.saveButtonProgress.classList.add('hidden');
        this.saveButtonLabel.textContent = '保存图片';
        this.cancelButton.classList.add('hidden');
        this.cancelButton.disabled = false;
        this.saveActions.style.gridTemplateColumns = '';
        this.widthInput.disabled = false;
        this.heightInput.disabled = false;
        this.fontScaleInput.disabled = false;
        if (outcome === 'success') this.syncDimensionWarning();
      }
    });
    const rearrange = document.createElement('button');
    rearrange.type = 'button';
    rearrange.dataset.testid = 'save-image-rearrange-cards';
    rearrange.className = 'min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-700 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:outline-teal-400';
    rearrange.textContent = '重排';
    rearrange.addEventListener('click', () => {
      // 在手动重排前，先同步一次最新的图片约束区域
      this.applyObstaclesAndReflow();
      this.onRearrangeCards();
    });
    section.append(
      heading,
      fields,
      fontLabel,
      rearrange,
      this.saveActions,
      this.saveStatus,
    );

    this.widthInput.addEventListener('change', () => {
      const value = Number(this.widthInput.value);
      if (!this.applyDimensionChange('width', value)) return;
      this.syncDimensionInputs();
    });
    this.heightInput.addEventListener('change', () => {
      const value = Number(this.heightInput.value);
      if (!this.applyDimensionChange('height', value)) return;
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

  private createImagesSection(): HTMLElement {
    const section = document.createElement('section');
    section.className = 'grid gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-700';
    const heading = document.createElement('h3');
    heading.className = 'text-sm font-semibold text-slate-900 dark:text-slate-100';
    heading.textContent = '添加图片';

    const buttonsRow = document.createElement('div');
    buttonsRow.className = 'flex gap-2 flex-wrap';

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';
    uploadBtn.textContent = '上传';
    uploadBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const url = URL.createObjectURL(file);
          this.addLoadedImage(url, file.name);
        }
      });
      input.click();
    });
    buttonsRow.append(uploadBtn);

    for (const preset of defaultConfig.export.presetImages) {
      const preBtn = document.createElement('button');
      preBtn.className = 'rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';
      preBtn.textContent = preset.title;
      preBtn.addEventListener('click', () => this.addLoadedImage(preset.url, preset.title));
      buttonsRow.append(preBtn);
    }

    this.imagesListContainer = document.createElement('div');
    this.imagesListContainer.className = 'grid gap-2';

    section.append(heading, buttonsRow, this.imagesListContainer);
    return section;
  }

  private addLoadedImage(url: string, title: string): void {
    const img = new Image();
    img.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w === 0 || h === 0) { w = 150; h = 150; }
      
      // 保持长宽比，最大边长为 150
      const scale = Math.min(150 / w, 150 / h);
      const width = w * scale;
      const height = h * scale;
      
      const x = (this.layout.mapRect.width - width) / 2;
      const y = (this.layout.mapRect.height - height) / 2;
      
      // 添加图片并获取最新的状态快照
      const snapshot = this.state.addImage({ url, title, rect: { x, y, width, height } });
      
      // 自动进入该图片的编辑模式（最新添加的图片位于数组末尾）
      const newImg = snapshot.addedImages[snapshot.addedImages.length - 1];
      this.editingImageIds.clear();
      this.editingImageIds.add(newImg.id);
      this.editOverlay.classList.remove('hidden');

      this.syncImagesListDOM();
      this.syncAddedImagesDOM();
      this.applyObstaclesAndReflow();
    };
    img.src = url;
  }

  private syncImagesListDOM(): void {
    this.imagesListContainer.innerHTML = '';
    const images = this.state.getSnapshot().addedImages;
    for (const img of images) {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-2 p-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700';

      const title = document.createElement('span');
      title.className = 'text-sm text-slate-700 dark:text-slate-300 truncate flex-1';
      title.textContent = img.title;

      const editBtn = document.createElement('button');
      editBtn.className = 'text-sm text-teal-600 dark:text-teal-400 font-medium px-2';
      editBtn.textContent = this.editingImageIds.has(img.id) ? '完成' : '编辑';
      editBtn.addEventListener('click', () => {
        if (this.editingImageIds.has(img.id)) {
          this.editingImageIds.delete(img.id);
        } else {
          this.editingImageIds.add(img.id);
        }
        
        if (this.editingImageIds.size === 0) {
          this.editOverlay.classList.add('hidden');
          this.applyObstaclesAndReflow();
        } else {
          this.editOverlay.classList.remove('hidden');
        }
        this.syncImagesListDOM();
        this.syncAddedImagesDOM();
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'text-sm text-red-600 dark:text-red-400 font-medium px-2';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => {
        if (this.editingImageIds.has(img.id)) {
          this.editingImageIds.delete(img.id);
          if (this.editingImageIds.size === 0) {
            this.editOverlay.classList.add('hidden');
          }
        }
        this.state.removeImage(img.id);
        this.syncImagesListDOM();
        this.syncAddedImagesDOM();
        this.applyObstaclesAndReflow();
      });

      row.append(title, editBtn, delBtn);
      this.imagesListContainer.append(row);
    }
  }

  private syncAddedImagesDOM(): void {
    const images = this.state.getSnapshot().addedImages;
    const currentIds = new Set(images.map((i) => i.id));
    for (const [id, el] of this.imageElements) {
      if (!currentIds.has(id)) {
        el.remove();
        this.imageElements.delete(id);
      }
    }
    for (const img of images) {
      let el = this.imageElements.get(img.id);
      if (!el) {
        el = document.createElement('img');
        el.src = img.url;
        el.className = 'absolute max-w-none';
        this.imagesContainer.append(el);
        this.imageElements.set(img.id, el);
      }
      el.style.left = `${img.rect.x}px`;
      el.style.top = `${img.rect.y}px`;
      el.style.width = `${img.rect.width}px`;
      el.style.height = `${img.rect.height}px`;
      // 如果处于编辑模式且当前图片未被选中，则使其半透明
      el.style.opacity = this.editingImageIds.size > 0 && !this.editingImageIds.has(img.id) ? '0.5' : '1';
    }
  }

  private applyObstaclesAndReflow(): void {
    const obstacles = this.state.getSnapshot().addedImages.map((i) => i.rect);
    setDynamicExtraObstacles(obstacles);
  }

  private createNumberInput(testId: string, ariaLabel: string, value: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.dataset.testid = testId;
    input.setAttribute('aria-label', ariaLabel);
    input.className = 'min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-teal-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus-visible:outline-teal-400';
    input.min = '1';
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

    this.imagesContainer.style.left = `${this.layout.mapRect.x}px`;
    this.imagesContainer.style.top = `${this.layout.mapRect.y}px`;
    this.imagesContainer.style.width = `${this.layout.mapRect.width}px`;
    this.imagesContainer.style.height = `${this.layout.mapRect.height}px`;

    this.editOverlay.style.left = `${this.layout.mapRect.x}px`;
    this.editOverlay.style.top = `${this.layout.mapRect.y}px`;
    this.editOverlay.style.width = `${this.layout.mapRect.width}px`;
    this.editOverlay.style.height = `${this.layout.mapRect.height}px`;

    this.syncBlankSeparator();
    this.syncResizeHandles();
    this.syncAddedImagesDOM();
    this.onLayoutChange(this.layout);
    this.onFontScaleChange(this.getPreviewFontScale());
    this.onVisualScaleChange(this.getPreviewVisualScale());
  }

  private syncBlankSeparator(): void {
    const blankRect = this.layout.blankRects[0];
    this.blankSeparator.classList.toggle('hidden', !blankRect);
    if (!blankRect) return;

    this.blankSeparator.style.left = `${blankRect.x}px`;
    this.blankSeparator.style.top = `${blankRect.y}px`;
    this.blankSeparator.style.width = `${blankRect.width}px`;
    this.blankSeparator.style.height = `${blankRect.height}px`;
    this.blankSeparator.classList.toggle(
      'border-t',
      this.layout.menuPlacement === 'right',
    );
    this.blankSeparator.classList.toggle(
      'border-l',
      this.layout.menuPlacement === 'bottom',
    );
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

    if (this.editingImageIds.size > 0) {
      this.editingImageIds.clear();
      this.editOverlay.classList.add('hidden');
      this.syncImagesListDOM();
      this.syncAddedImagesDOM();
      this.applyObstaclesAndReflow();
    }

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
      this.syncDimensionWarning();
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

  private getPreviewVisualScale(): number {
    return calculateAreaFontScale(
      { width: this.layout.mapRect.width, height: this.layout.mapRect.height },
      defaultConfig.export.fontScaleAreaRootRatio,
    );
  }

  private applyDimensionChange(changed: 'width' | 'height', value: number): boolean {
    try {
      const current = this.state.getSnapshot();
      const candidate = linkImageDimensions(changed, value, current.aspectRatio);
      validateExportDimensions(candidate.width, candidate.height);
      if (changed === 'width') this.state.setWidth(value);
      else this.state.setHeight(value);
      this.syncDimensionWarning();
      this.saveButton.disabled = false;
      return true;
    } catch (error) {
      this.setSaveStatus(
        error instanceof Error ? error.message : '图片尺寸无效',
        'error',
      );
      this.saveButton.disabled = true;
      return false;
    }
  }

  private syncDimensionWarning(): void {
    const snapshot = this.state.getSnapshot();
    const warnings = getExportDimensionWarnings(snapshot.width, snapshot.height);
    this.setSaveStatus(warnings.length > 0 ? warnings.join('；') : null, 'warning');
  }

  private setSaveStatus(
    message: string | null,
    kind: 'warning' | 'error' = 'warning',
  ): void {
    this.saveStatus.textContent = message ?? '';
    this.saveStatus.classList.toggle('hidden', !message);
    this.saveStatus.classList.toggle('text-red-700', Boolean(message) && kind === 'error');
    this.saveStatus.classList.toggle('dark:text-red-300', Boolean(message) && kind === 'error');
    this.saveStatus.classList.toggle('text-amber-700', Boolean(message) && kind === 'warning');
    this.saveStatus.classList.toggle('dark:text-amber-300', Boolean(message) && kind === 'warning');
  }

  private setSaveProgress(progress: number): void {
    const normalized = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
    const percentage = Math.round(normalized * 100);
    this.saveButtonProgress.classList.remove('hidden');
    this.saveButtonProgress.style.width = `${percentage}%`;
    this.saveButtonLabel.textContent = `正在生成 ${percentage}%`;
  }

  private syncDimensionInputs(): void {
    const snapshot = this.state.getSnapshot();
    this.widthInput.value = String(snapshot.width);
    this.heightInput.value = String(snapshot.height);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
