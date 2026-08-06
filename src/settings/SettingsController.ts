import settingsIconUrl from '@/assets/icons/settings.svg';
import uploadIconUrl from '@/assets/icons/upload.svg';
import closeIconUrl from '@/assets/icons/x.svg';
import {
  defaultConfig,
  type CardGroupingMode,
  type Corner,
  type MapInteractionMode,
  type ThemeMode,
} from '@/config';
import { ModalShell } from '@/details/ModalShell';
import { loadMessageHtml } from '@/data/fetcher';
import { createSafeMessageContent } from './message';
import { isSupportedBackgroundImage } from '@/theme/BackgroundController';

interface SettingOption<T extends string> {
  value: T;
  label: string;
  testId: string;
}

export interface SettingsState {
  interactionMode: MapInteractionMode;
  themeMode: ThemeMode;
  cardGroupingMode: CardGroupingMode;
  showRegionNames: boolean;
  onlyShowRegionNamesWithSchools: boolean;
  showInfoRectangle: boolean;
  showMiddleSchool: boolean;
  enableLocalLayoutOptimization: boolean;
}

export interface SettingsCallbacks {
  onInteractionModeChange: (mode: MapInteractionMode) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onBackgroundImageChange: (file: File | null) => void;
  onCardGroupingModeChange: (mode: CardGroupingMode) => void;
  onShowRegionNamesChange: (show: boolean) => void;
  onOnlyShowRegionNamesWithSchoolsChange: (only: boolean) => void;
  onShowInfoRectangleChange: (show: boolean) => void;
  onShowMiddleSchoolChange: (show: boolean) => void;
  onLocalLayoutOptimizationChange: (enabled: boolean) => void;
  onEditInfoRectangle: () => void;
}

const MODE_OPTIONS: SettingOption<MapInteractionMode>[] = [
  { value: 'stable', label: '持续显示', testId: 'interaction-mode-stable' },
  { value: 'hide-and-reflow', label: '操作时隐藏', testId: 'interaction-mode-hide-and-reflow' },
];

const THEME_OPTIONS: SettingOption<ThemeMode>[] = [
  { value: 'system', label: '跟随系统', testId: 'theme-mode-system' },
  { value: 'light', label: '浅色', testId: 'theme-mode-light' },
  { value: 'dark', label: '深色', testId: 'theme-mode-dark' },
];

const CARD_GROUPING_OPTIONS: SettingOption<CardGroupingMode>[] = [
  { value: 'school', label: '按大学分类', testId: 'card-grouping-school' },
  { value: 'region', label: '按地区分类', testId: 'card-grouping-region' },
];

const CORNER_CLASSES: Record<Corner, string> = {
  'top-left': 'top-3 left-3',
  'top-right': 'top-3 right-3',
  'bottom-left': 'bottom-3 left-3',
  'bottom-right': 'bottom-3 right-3',
};

export class SettingsController {
  private readonly container: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly onModeChange: (mode: MapInteractionMode) => void;
  private readonly onThemeModeChange: (mode: ThemeMode) => void;
  private readonly onBackgroundImageChange: (file: File | null) => void;
  private readonly onCardGroupingModeChange: (mode: CardGroupingMode) => void;
  private readonly onShowRegionNamesChange: (show: boolean) => void;
  private readonly onOnlyShowRegionNamesWithSchoolsChange: (only: boolean) => void;
  private readonly onShowInfoRectangleChange: (show: boolean) => void;
  private readonly onShowMiddleSchoolChange: (show: boolean) => void;
  private readonly onLocalLayoutOptimizationChange: (enabled: boolean) => void;
  private readonly onEditInfoRectangle: () => void;
  private mode: MapInteractionMode;
  private themeMode: ThemeMode;
  private cardGroupingMode: CardGroupingMode;
  private showRegionNames: boolean;
  private onlyShowRegionNamesWithSchools: boolean;
  private showInfoRectangle: boolean;
  private showMiddleSchool: boolean;
  private enableLocalLayoutOptimization: boolean;
  private shell: ModalShell | null = null;
  private messageHtmlPromise: Promise<string> | null = null;
  private backgroundFileName: string | null = null;

  constructor(
    container: HTMLElement,
    initialState: SettingsState,
    callbacks: SettingsCallbacks,
  ) {
    this.container = container;
    this.mode = initialState.interactionMode;
    this.themeMode = initialState.themeMode;
    this.cardGroupingMode = initialState.cardGroupingMode;
    this.showRegionNames = initialState.showRegionNames;
    this.onlyShowRegionNamesWithSchools = initialState.onlyShowRegionNamesWithSchools;
    this.showInfoRectangle = initialState.showInfoRectangle;
    this.showMiddleSchool = initialState.showMiddleSchool;
    this.enableLocalLayoutOptimization = initialState.enableLocalLayoutOptimization;
    this.onModeChange = callbacks.onInteractionModeChange;
    this.onThemeModeChange = callbacks.onThemeModeChange;
    this.onBackgroundImageChange = callbacks.onBackgroundImageChange;
    this.onCardGroupingModeChange = callbacks.onCardGroupingModeChange;
    this.onShowRegionNamesChange = callbacks.onShowRegionNamesChange;
    this.onOnlyShowRegionNamesWithSchoolsChange = callbacks.onOnlyShowRegionNamesWithSchoolsChange;
    this.onShowInfoRectangleChange = callbacks.onShowInfoRectangleChange;
    this.onShowMiddleSchoolChange = callbacks.onShowMiddleSchoolChange;
    this.onLocalLayoutOptimizationChange = callbacks.onLocalLayoutOptimizationChange;
    this.onEditInfoRectangle = callbacks.onEditInfoRectangle;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.dataset.testid = 'settings-button';
    this.button.dataset.corner = defaultConfig.settingsButtonCorner;
    this.button.className = [
      'absolute z-20 flex h-11 w-11 items-center justify-center rounded-md border',
      'border-slate-300 bg-white text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900',
      'pointer-events-auto hover:bg-slate-50 focus-visible:outline-2 dark:hover:bg-slate-800',
      'focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:focus-visible:outline-teal-400',
      CORNER_CLASSES[defaultConfig.settingsButtonCorner],
    ].join(' ');
    const icon = document.createElement('img');
    icon.src = settingsIconUrl;
    icon.alt = '';
    icon.className = 'h-5 w-5 dark:invert';
    icon.setAttribute('aria-hidden', 'true');
    this.button.append(icon);
    this.button.title = '设置';
    this.button.setAttribute('aria-label', '打开设置');
    this.button.addEventListener('click', this.open);
    this.container.append(this.button);
  }

  public close(): void {
    this.shell?.destroy();
    this.shell = null;
  }

  public setButtonVisible(visible: boolean): void {
    this.button.classList.toggle('hidden', !visible);
    this.button.setAttribute('aria-hidden', String(!visible));
  }

  public destroy(): void {
    this.close();
    this.button.removeEventListener('click', this.open);
    this.button.remove();
  }

  private readonly open = (): void => {
    this.close();
    this.shell = new ModalShell(this.container, {
      testId: 'settings-dialog',
      title: '设置',
      closeLabel: '关闭设置',
      panelClass: 'relative flex max-h-[90vh] w-[min(94vw,520px)] flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900',
      bodyClass: 'overflow-auto bg-white dark:bg-slate-900',
      onClose: () => this.close(),
    });

    const content = document.createElement('div');
    content.className = 'divide-y divide-slate-200 dark:divide-slate-700';
    content.append(
      this.createSection('外观', [
        this.createChoiceGroup(
          '主题',
          '主题',
          'theme-mode',
          THEME_OPTIONS,
          (value) => this.selectThemeMode(value),
        ),
        this.createBackgroundSetting(),
      ]),
      this.createSection('地图信息', [this.createMapInformationSettings()]),
      this.createSection('信息卡片', [
        this.createChoiceGroup(
          '分组方式',
          '信息卡片分组方式',
          'card-grouping-mode',
          CARD_GROUPING_OPTIONS,
          (value) => this.selectCardGroupingMode(value),
        ),
        this.createChoiceGroup(
          '移动和缩放',
          '移动和缩放时的信息卡片显示方式',
          'interaction-mode',
          MODE_OPTIONS,
          (value) => this.selectMode(value),
        ),
        this.createLayoutOptimizationSetting(),
      ]),
      this.createMessageSection(),
    );
    this.shell.body.append(content);
    this.updateChoices();
  };

  private createMessageSection(): HTMLElement {
    const section = document.createElement('section');
    section.dataset.testid = 'settings-message';
    section.className = 'settings-message px-5 py-4 sm:px-6';
    section.setAttribute('aria-busy', 'true');
    void this.loadMessage(section);
    return section;
  }

  private createBackgroundSetting(): HTMLElement {
    const setting = document.createElement('div');
    setting.className = 'grid gap-2';
    const label = document.createElement('span');
    label.className = 'text-sm text-slate-600 dark:text-slate-400';
    label.textContent = '背景图片';

    const controls = document.createElement('div');
    controls.className = 'flex items-center gap-2';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.dataset.testid = 'background-image-input';
    input.className = 'hidden';
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.dataset.testid = 'background-image-button';
    choose.className = [
      'inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-medium',
      'text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-700',
      'dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus-visible:outline-teal-400',
    ].join(' ');
    const uploadIcon = document.createElement('img');
    uploadIcon.src = uploadIconUrl;
    uploadIcon.alt = '';
    uploadIcon.className = 'h-4 w-4 dark:invert';
    uploadIcon.setAttribute('aria-hidden', 'true');
    choose.append(uploadIcon, document.createTextNode('选择图片'));
    choose.addEventListener('click', () => input.click());

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.dataset.testid = 'clear-background-image';
    clear.className = [
      'flex h-11 w-11 items-center justify-center rounded-md border border-slate-300 text-slate-600',
      'hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-700',
      'dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus-visible:outline-teal-400',
      'disabled:cursor-not-allowed disabled:opacity-50',
    ].join(' ');
    const clearIcon = document.createElement('img');
    clearIcon.src = closeIconUrl;
    clearIcon.alt = '';
    clearIcon.className = 'h-4 w-4 dark:invert';
    clearIcon.setAttribute('aria-hidden', 'true');
    clear.append(clearIcon);
    clear.title = '清除上传背景';
    clear.setAttribute('aria-label', '清除上传背景');
    clear.addEventListener('click', () => {
      input.value = '';
      this.backgroundFileName = null;
      error.textContent = '';
      this.onBackgroundImageChange(null);
      this.updateBackgroundStatus(status, error, clear);
    });

    const status = document.createElement('span');
    status.dataset.testid = 'background-image-name';
    status.className = 'min-w-0 truncate text-xs text-slate-500 dark:text-slate-400';
    const error = document.createElement('p');
    error.dataset.testid = 'background-image-error';
    error.className = 'hidden text-xs text-red-700 dark:text-red-400';
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      if (!file) return;
      if (!isSupportedBackgroundImage(file)) {
        error.textContent = '仅支持 PNG、JPEG 和 WebP 图片';
        error.classList.remove('hidden');
        input.value = '';
        return;
      }
      error.textContent = '';
      this.backgroundFileName = file.name;
      this.onBackgroundImageChange(file);
      input.value = '';
      this.updateBackgroundStatus(status, error, clear);
    });
    this.updateBackgroundStatus(status, error, clear);
    controls.append(input, choose, clear, status);
    setting.append(label, controls, error);
    return setting;
  }

  private updateBackgroundStatus(
    status: HTMLElement,
    error: HTMLElement,
    clear: HTMLButtonElement,
  ): void {
    status.textContent = this.backgroundFileName ?? '';
    status.classList.toggle('hidden', !this.backgroundFileName);
    error.classList.toggle('hidden', !error.textContent);
    clear.disabled = !this.backgroundFileName;
  }

  private async loadMessage(section: HTMLElement): Promise<void> {
    try {
      this.messageHtmlPromise ??= loadMessageHtml();
      const html = await this.messageHtmlPromise;
      section.replaceChildren(createSafeMessageContent(html));
      section.setAttribute('aria-busy', 'false');
    } catch {
      this.messageHtmlPromise = null;
      const error = document.createElement('p');
      error.className = 'text-sm text-red-700 dark:text-red-400';
      error.textContent = '内容加载失败';
      section.replaceChildren(error);
      section.setAttribute('aria-busy', 'false');
    }
  }

  private createSection(title: string, settings: HTMLElement[]): HTMLElement {
    const section = document.createElement('section');
    section.className = 'px-5 py-4 sm:px-6';
    const heading = document.createElement('h3');
    heading.className = 'text-sm font-semibold text-slate-900 dark:text-slate-100';
    heading.textContent = title;
    const body = document.createElement('div');
    body.className = 'mt-3 grid gap-4';
    body.append(...settings);
    section.append(heading, body);
    return section;
  }

  private createChoiceGroup<T extends string>(
    label: string,
    ariaLabel: string,
    setting: string,
    options: SettingOption<T>[],
    onSelect: (value: T) => void,
  ): HTMLFieldSetElement {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.className = 'mb-2 text-sm text-slate-600 dark:text-slate-400';
    legend.textContent = label;
    const choices = document.createElement('div');
    choices.className = 'grid overflow-hidden rounded-md border border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-950';
    choices.style.gridTemplateColumns = `repeat(${options.length}, minmax(0, 1fr))`;
    choices.setAttribute('role', 'radiogroup');
    choices.setAttribute('aria-label', ariaLabel);

    for (const option of options) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.dataset.testid = option.testId;
      choice.dataset.setting = setting;
      choice.dataset.value = option.value;
      choice.className = 'min-h-11 border-r border-slate-300 px-3 text-sm font-medium last:border-r-0 focus-visible:relative focus-visible:outline-2 focus-visible:outline-teal-700 dark:border-slate-700 dark:focus-visible:outline-teal-400';
      choice.setAttribute('role', 'radio');
      choice.textContent = option.label;
      choice.addEventListener('click', () => onSelect(option.value));
      choices.append(choice);
    }

    fieldset.append(legend, choices);
    return fieldset;
  }

  private createMapInformationSettings(): HTMLElement {
    const settings = document.createElement('div');
    settings.className = 'divide-y divide-slate-200 dark:divide-slate-700';
    const toggle = this.createSwitch(
      'region-names-toggle',
      '地区名称',
      () => this.selectShowRegionNames(!this.showRegionNames),
    );
    const filterSetting = document.createElement('div');
    filterSetting.dataset.testid = 'region-names-school-filter-setting';
    filterSetting.className = 'pl-4';
    filterSetting.append(this.createSwitch(
      'region-names-school-filter-toggle',
      '只显示有大学的地区',
      () => this.selectOnlyShowRegionNamesWithSchools(!this.onlyShowRegionNamesWithSchools),
    ));
    const infoRectangleSetting = document.createElement('div');
    infoRectangleSetting.className = 'flex min-h-14 items-center gap-3';
    const infoRectangleToggle = this.createSwitch(
      'info-rectangle-toggle',
      '信息范围框',
      () => this.selectShowInfoRectangle(!this.showInfoRectangle),
    );
    infoRectangleToggle.classList.add('min-w-0', 'flex-1');
    const editInfoRectangle = document.createElement('button');
    editInfoRectangle.type = 'button';
    editInfoRectangle.dataset.testid = 'edit-info-rectangle';
    editInfoRectangle.className = [
      'min-h-11 shrink-0 rounded-md border border-slate-300 px-3 text-sm font-medium',
      'text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-700',
      'dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
      'dark:focus-visible:outline-teal-400',
    ].join(' ');
    editInfoRectangle.textContent = '调整范围';
    editInfoRectangle.addEventListener('click', () => {
      this.close();
      this.onEditInfoRectangle();
    });
    infoRectangleSetting.append(infoRectangleToggle, editInfoRectangle);
    const middleSchoolToggle = this.createSwitch(
      'middle-school-toggle',
      '中学标记与连线',
      () => this.selectShowMiddleSchool(!this.showMiddleSchool),
    );
    settings.append(toggle, filterSetting, infoRectangleSetting, middleSchoolToggle);
    return settings;
  }

  private createLayoutOptimizationSetting(): HTMLElement {
    const setting = document.createElement('div');
    const toggle = this.createSwitch(
      'local-layout-optimization-toggle',
      '优化卡片排列',
      () => this.selectLocalLayoutOptimization(!this.enableLocalLayoutOptimization),
    );
    const description = document.createElement('p');
    description.className = 'text-xs leading-5 text-slate-500 dark:text-slate-400';
    description.textContent = '可能降低移动和缩放时的流畅度';
    setting.append(toggle, description);
    return setting;
  }

  private createSwitch(
    testId: string,
    labelText: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.dataset.testid = testId;
    toggle.className = [
      'flex min-h-14 w-full items-center justify-between gap-3 text-left text-sm font-medium',
      'text-slate-700 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-teal-700',
      'dark:text-slate-300 dark:hover:text-white dark:focus-visible:outline-teal-400',
    ].join(' ');
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', labelText);
    toggle.addEventListener('click', onClick);

    const label = document.createElement('span');
    label.textContent = labelText;
    const track = document.createElement('span');
    track.dataset.toggleTrack = 'true';
    track.className = 'relative block h-6 w-11 shrink-0 rounded-full transition-colors';
    track.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('span');
    thumb.dataset.toggleThumb = 'true';
    thumb.className = 'absolute top-1 block h-4 w-4 rounded-full bg-white shadow-sm transition-transform';
    track.append(thumb);
    toggle.append(label, track);
    return toggle;
  }

  private selectMode(mode: MapInteractionMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.updateChoices();
    this.onModeChange(mode);
  }

  private selectThemeMode(mode: ThemeMode): void {
    if (mode === this.themeMode) return;
    this.themeMode = mode;
    this.updateChoices();
    this.onThemeModeChange(mode);
  }

  private selectCardGroupingMode(mode: CardGroupingMode): void {
    if (mode === this.cardGroupingMode) return;
    this.cardGroupingMode = mode;
    this.updateChoices();
    this.onCardGroupingModeChange(mode);
  }

  private selectShowRegionNames(show: boolean): void {
    if (show === this.showRegionNames) return;
    this.showRegionNames = show;
    this.updateChoices();
    this.onShowRegionNamesChange(show);
  }

  private selectOnlyShowRegionNamesWithSchools(only: boolean): void {
    if (only === this.onlyShowRegionNamesWithSchools) return;
    this.onlyShowRegionNamesWithSchools = only;
    this.updateChoices();
    this.onOnlyShowRegionNamesWithSchoolsChange(only);
  }

  private selectShowInfoRectangle(show: boolean): void {
    if (show === this.showInfoRectangle) return;
    this.showInfoRectangle = show;
    this.updateChoices();
    this.onShowInfoRectangleChange(show);
  }

  private selectLocalLayoutOptimization(enabled: boolean): void {
    if (enabled === this.enableLocalLayoutOptimization) return;
    this.enableLocalLayoutOptimization = enabled;
    this.updateChoices();
    this.onLocalLayoutOptimizationChange(enabled);
  }

  private selectShowMiddleSchool(show: boolean): void {
    if (show === this.showMiddleSchool) return;
    this.showMiddleSchool = show;
    this.updateChoices();
    this.onShowMiddleSchoolChange(show);
  }

  private updateChoices(): void {
    if (!this.shell) return;
    const selectedValues: Record<string, string> = {
      'interaction-mode': this.mode,
      'card-grouping-mode': this.cardGroupingMode,
      'theme-mode': this.themeMode,
    };
    for (const choice of this.shell.body.querySelectorAll<HTMLButtonElement>('[role="radio"][data-setting]')) {
      const selectedValue = selectedValues[choice.dataset.setting ?? ''];
      const selected = choice.dataset.value === selectedValue;
      choice.setAttribute('aria-checked', String(selected));
      choice.classList.toggle('bg-teal-700', selected);
      choice.classList.toggle('text-white', selected);
      choice.classList.toggle('dark:bg-teal-500', selected);
      choice.classList.toggle('dark:text-slate-950', selected);
      choice.classList.toggle('bg-white', !selected);
      choice.classList.toggle('text-slate-700', !selected);
      choice.classList.toggle('dark:bg-slate-900', !selected);
      choice.classList.toggle('dark:text-slate-300', !selected);
    }
    const toggle = this.shell.body.querySelector<HTMLButtonElement>('[data-testid="region-names-toggle"]');
    const filterSetting = this.shell.body.querySelector<HTMLElement>(
      '[data-testid="region-names-school-filter-setting"]',
    );
    const filterToggle = this.shell.body.querySelector<HTMLButtonElement>(
      '[data-testid="region-names-school-filter-toggle"]',
    );
    const infoRectangleToggle = this.shell.body.querySelector<HTMLButtonElement>(
      '[data-testid="info-rectangle-toggle"]',
    );
    const localLayoutOptimizationToggle = this.shell.body.querySelector<HTMLButtonElement>(
      '[data-testid="local-layout-optimization-toggle"]',
    );
    const middleSchoolToggle = this.shell.body.querySelector<HTMLButtonElement>(
      '[data-testid="middle-school-toggle"]',
    );
    this.updateSwitch(toggle, this.showRegionNames);
    this.updateSwitch(filterToggle, this.onlyShowRegionNamesWithSchools);
    this.updateSwitch(infoRectangleToggle, this.showInfoRectangle);
    this.updateSwitch(localLayoutOptimizationToggle, this.enableLocalLayoutOptimization);
    this.updateSwitch(middleSchoolToggle, this.showMiddleSchool);
    filterSetting?.classList.toggle('hidden', !this.showRegionNames);
    filterSetting?.setAttribute('aria-hidden', String(!this.showRegionNames));
  }

  private updateSwitch(toggle: HTMLButtonElement | null, checked: boolean): void {
    const track = toggle?.querySelector<HTMLElement>('[data-toggle-track="true"]');
    const thumb = toggle?.querySelector<HTMLElement>('[data-toggle-thumb="true"]');
    toggle?.setAttribute('aria-checked', String(checked));
    track?.classList.toggle('bg-teal-700', checked);
    track?.classList.toggle('dark:bg-teal-500', checked);
    track?.classList.toggle('bg-slate-300', !checked);
    track?.classList.toggle('dark:bg-slate-700', !checked);
    thumb?.classList.toggle('translate-x-6', checked);
    thumb?.classList.toggle('translate-x-1', !checked);
  }
}
