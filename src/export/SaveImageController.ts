import { defaultConfig } from '@/config';
import { calculateInitialSaveImageLayout, type SaveImageModeLayout } from './geometry';
import { SaveImageState } from './SaveImageState';
import type { SettingsController } from '@/settings/SettingsController';

export interface SaveImageControllerOptions {
  onExit: () => void;
  onLayoutChange: (layout: SaveImageModeLayout) => void;
}

export class SaveImageController {
  private readonly settings: SettingsController;
  private readonly onExit: () => void;
  private readonly onLayoutChange: (layout: SaveImageModeLayout) => void;
  private readonly root: HTMLDivElement;
  private readonly menu: HTMLElement;
  private readonly state = new SaveImageState();
  private layout: SaveImageModeLayout;
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
    const settingsContent = this.settings.createContent(false);
    settingsContent.className = 'divide-y divide-slate-200 dark:divide-slate-700';
    scrollArea.append(this.createDimensionSettings(), settingsContent);
    this.menu.append(this.createHeader(), scrollArea);
    this.root.append(this.menu);
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
    this.root.classList.toggle('hidden', !visible);
    this.root.setAttribute('aria-hidden', String(!visible));
  }

  public destroy(): void {
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
    this.onLayoutChange(this.layout);
  }

  private syncDimensionInputs(): void {
    const snapshot = this.state.getSnapshot();
    this.widthInput.value = String(snapshot.width);
    this.heightInput.value = String(snapshot.height);
  }
}
