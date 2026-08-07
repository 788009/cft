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
import { loadGuideMarkdown, loadMessageMarkdown } from '@/data/fetcher';
import { createSafeMarkdownContent } from './message';
import { isSupportedBackgroundImage } from '@/theme/BackgroundController';
import {
  SettingsStateStore,
  type AppSettingsState,
} from './SettingsState';

interface SettingOption<T extends string> {
  value: T;
  label: string;
  testId: string;
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
  onSaveImage: () => void;
  isCacheEnabled: () => boolean;
  onCacheEnabledChange: (enabled: boolean) => Promise<void>;
  onClearCache: () => Promise<void>;
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

const GUIDE_VERSION_KEY = 'cft.guide.version';

export class SettingsController {
  private readonly container: HTMLElement;
  private readonly stateStore: SettingsStateStore;
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
  private readonly onSaveImage: () => void;
  private readonly onCacheEnabledChange: (enabled: boolean) => Promise<void>;
  private readonly onClearCache: () => Promise<void>;
  private readonly unsubscribeState: () => void;
  private mode: MapInteractionMode;
  private themeMode: ThemeMode;
  private cardGroupingMode: CardGroupingMode;
  private showRegionNames: boolean;
  private onlyShowRegionNamesWithSchools: boolean;
  private showInfoRectangle: boolean;
  private showMiddleSchool: boolean;
  private enableLocalLayoutOptimization: boolean;
  private shell: ModalShell | null = null;
  private guideShell: ModalShell | null = null;
  private messageMarkdownPromise: Promise<string> | null = null;
  private guideMarkdownPromise: Promise<string> | null = null;
  private backgroundFileName: string | null = null;
  private cacheEnabled: boolean;
  private cacheOperationPending = false;

  constructor(
    container: HTMLElement,
    stateStore: SettingsStateStore,
    callbacks: SettingsCallbacks,
  ) {
    this.container = container;
    this.stateStore = stateStore;
    const initialState = stateStore.getSnapshot();
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
    this.onSaveImage = callbacks.onSaveImage;
    this.cacheEnabled = callbacks.isCacheEnabled();
    this.onCacheEnabledChange = callbacks.onCacheEnabledChange;
    this.onClearCache = callbacks.onClearCache;
    this.backgroundFileName = initialState.backgroundFile?.name ?? null;
    this.unsubscribeState = stateStore.subscribe((state) => this.applyState(state));
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

  public showGuideOnFirstVisit(): void {
    if (this.hasSeenCurrentGuide()) return;
    this.openGuide();
  }

  public setButtonVisible(visible: boolean): void {
    this.button.classList.toggle('hidden', !visible);
    this.button.setAttribute('aria-hidden', String(!visible));
  }

  public destroy(): void {
    this.close();
    this.closeGuide();
    this.unsubscribeState();
    this.button.removeEventListener('click', this.open);
    this.button.remove();
  }

  private readonly open = (): void => {
    this.closeGuide();
    this.close();
    this.shell = new ModalShell(this.container, {
      testId: 'settings-dialog',
      title: '设置',
      closeLabel: '关闭设置',
      panelClass: 'relative flex max-h-[90vh] w-[min(94vw,520px)] flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900',
      bodyClass: 'overflow-auto bg-white dark:bg-slate-900',
      onClose: () => this.close(),
    });

    this.shell.body.append(this.createContent(true));
  };

  public createContent(
    includeSaveImageEntry = false,
    includeMessage = true,
    includeCache = true,
  ): HTMLDivElement {
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
      ...(includeSaveImageEntry ? [this.createSaveImageSection()] : []),
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
          '移动和缩放时',
          '移动和缩放时的信息卡片显示方式',
          'interaction-mode',
          MODE_OPTIONS,
          (value) => this.selectMode(value),
        ),
        this.createLayoutOptimizationSetting(),
      ]),
      ...(includeCache ? [this.createSection('缓存', [this.createCacheSettings()])] : []),
      ...(includeMessage ? [this.createGuideSection()] : []),
      ...(includeMessage ? [this.createMessageSection()] : []),
    );
    this.updateChoices(content);
    return content;
  }

  private createSaveImageSection(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = 'open-save-image-mode';
    button.className = [
      'flex min-h-11 w-full items-center justify-center rounded-md bg-teal-700 px-4',
      'text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2',
      'focus-visible:outline-offset-2 focus-visible:outline-teal-700',
      'dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400',
      'dark:focus-visible:outline-teal-400',
    ].join(' ');
    button.textContent = '保存图片';
    button.addEventListener('click', () => {
      this.close();
      this.onSaveImage();
    });
    return this.createSection('保存图片', [button]);
  }

  private createMessageSection(): HTMLElement {
    const section = document.createElement('section');
    section.dataset.testid = 'settings-message';
    section.className = 'markdown-content settings-message px-5 py-4 sm:px-6';
    section.setAttribute('aria-busy', 'true');
    void this.loadMessage(section);
    return section;
  }

  private createGuideSection(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = 'open-guide';
    button.className = [
      'min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm font-medium',
      'text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-700',
      'dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
      'dark:focus-visible:outline-teal-400',
    ].join(' ');
    button.textContent = '打开使用说明';
    button.addEventListener('click', () => {
      this.close();
      this.openGuide();
    });
    return this.createSection('使用说明', [button]);
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
      error.textContent = '';
      this.stateStore.update({ backgroundFile: null });
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
      this.stateStore.update({ backgroundFile: file });
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
      this.messageMarkdownPromise ??= loadMessageMarkdown();
      const markdown = await this.messageMarkdownPromise;
      section.replaceChildren(createSafeMarkdownContent(markdown));
      section.setAttribute('aria-busy', 'false');
    } catch {
      this.messageMarkdownPromise = null;
      const error = document.createElement('p');
      error.className = 'text-sm text-red-700 dark:text-red-400';
      error.textContent = '内容加载失败';
      section.replaceChildren(error);
      section.setAttribute('aria-busy', 'false');
    }
  }

  private openGuide(): void {
    this.closeGuide();
    this.guideShell = new ModalShell(this.container, {
      testId: 'guide-dialog',
      title: '使用说明',
      closeLabel: '关闭使用说明',
      panelClass: 'relative flex max-h-[90vh] w-[min(94vw,760px)] flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900',
      bodyClass: 'overflow-auto bg-white dark:bg-slate-900',
      onClose: () => this.closeGuide(),
    });
    const content = document.createElement('article');
    content.dataset.testid = 'guide-content';
    content.className = 'markdown-content px-5 py-5 sm:px-7 sm:py-6';
    content.setAttribute('aria-busy', 'true');
    this.guideShell.body.append(content);
    void this.loadGuide(content);
  }

  private closeGuide(): void {
    this.guideShell?.destroy();
    this.guideShell = null;
  }

  private async loadGuide(content: HTMLElement): Promise<void> {
    try {
      this.guideMarkdownPromise ??= loadGuideMarkdown();
      const markdown = await this.guideMarkdownPromise;
      if (!content.isConnected) return;
      content.replaceChildren(createSafeMarkdownContent(markdown));
      content.setAttribute('aria-busy', 'false');
      this.markGuideSeen();
    } catch {
      this.guideMarkdownPromise = null;
      if (!content.isConnected) return;
      const error = document.createElement('p');
      error.className = 'text-sm text-red-700 dark:text-red-400';
      error.textContent = '使用说明加载失败';
      content.replaceChildren(error);
      content.setAttribute('aria-busy', 'false');
    }
  }

  private hasSeenCurrentGuide(): boolean {
    try {
      return localStorage.getItem(GUIDE_VERSION_KEY) === String(defaultConfig.guideVersion);
    } catch {
      return false;
    }
  }

  private markGuideSeen(): void {
    try {
      localStorage.setItem(GUIDE_VERSION_KEY, String(defaultConfig.guideVersion));
    } catch {
      // localStorage 不可用时，下次访问会重新显示说明。
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

  private createCacheSettings(): HTMLElement {
    const settings = document.createElement('div');
    settings.className = 'grid gap-3';
    const toggle = this.createSwitch(
      'cache-enabled-toggle',
      '启用缓存',
      () => void this.selectCacheEnabled(!this.cacheEnabled),
    );
    const description = document.createElement('p');
    description.className = 'text-xs leading-5 text-slate-500 dark:text-slate-400';
    description.textContent = '缓存设置和本地静态资源。关闭后将清除应用缓存并重新加载页面。';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.dataset.testid = 'clear-app-cache';
    clear.className = [
      'min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700',
      'hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-700',
      'dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
      'dark:focus-visible:outline-teal-400 disabled:cursor-not-allowed disabled:opacity-50',
    ].join(' ');
    clear.textContent = '清除缓存';
    const status = document.createElement('p');
    status.dataset.testid = 'cache-status';
    status.className = 'hidden text-xs text-slate-500 dark:text-slate-400';
    clear.addEventListener('click', () => void this.clearCache(clear, status));
    settings.append(toggle, description, clear, status);
    return settings;
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
    this.stateStore.update({ interactionMode: mode });
    this.onModeChange(mode);
  }

  private selectThemeMode(mode: ThemeMode): void {
    if (mode === this.themeMode) return;
    this.stateStore.update({ themeMode: mode });
    this.onThemeModeChange(mode);
  }

  private selectCardGroupingMode(mode: CardGroupingMode): void {
    if (mode === this.cardGroupingMode) return;
    this.stateStore.update({ cardGroupingMode: mode });
    this.onCardGroupingModeChange(mode);
  }

  private selectShowRegionNames(show: boolean): void {
    if (show === this.showRegionNames) return;
    this.stateStore.update({ showRegionNames: show });
    this.onShowRegionNamesChange(show);
  }

  private selectOnlyShowRegionNamesWithSchools(only: boolean): void {
    if (only === this.onlyShowRegionNamesWithSchools) return;
    this.stateStore.update({ onlyShowRegionNamesWithSchools: only });
    this.onOnlyShowRegionNamesWithSchoolsChange(only);
  }

  private selectShowInfoRectangle(show: boolean): void {
    if (show === this.showInfoRectangle) return;
    this.stateStore.update({ showInfoRectangle: show });
    this.onShowInfoRectangleChange(show);
  }

  private selectLocalLayoutOptimization(enabled: boolean): void {
    if (enabled === this.enableLocalLayoutOptimization) return;
    this.stateStore.update({ enableLocalLayoutOptimization: enabled });
    this.onLocalLayoutOptimizationChange(enabled);
  }

  private selectShowMiddleSchool(show: boolean): void {
    if (show === this.showMiddleSchool) return;
    this.stateStore.update({ showMiddleSchool: show });
    this.onShowMiddleSchoolChange(show);
  }

  private async selectCacheEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.cacheEnabled || this.cacheOperationPending) return;
    this.cacheOperationPending = true;
    this.updateCacheControls();
    try {
      await this.onCacheEnabledChange(enabled);
      this.cacheEnabled = enabled;
    } catch (error) {
      console.error('缓存开关更新失败:', error);
    } finally {
      this.cacheOperationPending = false;
      this.updateCacheControls();
    }
  }

  private async clearCache(button: HTMLButtonElement, status: HTMLElement): Promise<void> {
    if (this.cacheOperationPending) return;
    this.cacheOperationPending = true;
    this.updateCacheControls();
    status.textContent = '正在清除缓存';
    status.classList.remove('hidden');
    try {
      await this.onClearCache();
      status.textContent = '缓存已清除，设置已恢复默认值';
    } catch (error) {
      status.textContent = '缓存清除失败';
      console.error('缓存清除失败:', error);
    } finally {
      this.cacheOperationPending = false;
      button.disabled = false;
      this.updateCacheControls();
    }
  }

  private applyState(state: Readonly<AppSettingsState>): void {
    this.mode = state.interactionMode;
    this.themeMode = state.themeMode;
    this.cardGroupingMode = state.cardGroupingMode;
    this.showRegionNames = state.showRegionNames;
    this.onlyShowRegionNamesWithSchools = state.onlyShowRegionNamesWithSchools;
    this.showInfoRectangle = state.showInfoRectangle;
    this.showMiddleSchool = state.showMiddleSchool;
    this.enableLocalLayoutOptimization = state.enableLocalLayoutOptimization;
    this.backgroundFileName = state.backgroundFile?.name ?? null;
    this.updateChoices();
  }

  private updateChoices(root: ParentNode = this.container): void {
    const selectedValues: Record<string, string> = {
      'interaction-mode': this.mode,
      'card-grouping-mode': this.cardGroupingMode,
      'theme-mode': this.themeMode,
    };
    for (const choice of root.querySelectorAll<HTMLButtonElement>('[role="radio"][data-setting]')) {
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
    const toggle = root.querySelector<HTMLButtonElement>('[data-testid="region-names-toggle"]');
    const filterSetting = root.querySelector<HTMLElement>(
      '[data-testid="region-names-school-filter-setting"]',
    );
    const filterToggle = root.querySelector<HTMLButtonElement>(
      '[data-testid="region-names-school-filter-toggle"]',
    );
    const infoRectangleToggle = root.querySelector<HTMLButtonElement>(
      '[data-testid="info-rectangle-toggle"]',
    );
    const localLayoutOptimizationToggle = root.querySelector<HTMLButtonElement>(
      '[data-testid="local-layout-optimization-toggle"]',
    );
    const middleSchoolToggle = root.querySelector<HTMLButtonElement>(
      '[data-testid="middle-school-toggle"]',
    );
    const cacheToggle = root.querySelector<HTMLButtonElement>(
      '[data-testid="cache-enabled-toggle"]',
    );
    this.updateSwitch(toggle, this.showRegionNames);
    this.updateSwitch(filterToggle, this.onlyShowRegionNamesWithSchools);
    this.updateSwitch(infoRectangleToggle, this.showInfoRectangle);
    this.updateSwitch(localLayoutOptimizationToggle, this.enableLocalLayoutOptimization);
    this.updateSwitch(middleSchoolToggle, this.showMiddleSchool);
    this.updateSwitch(cacheToggle, this.cacheEnabled);
    filterSetting?.classList.toggle('hidden', !this.showRegionNames);
    filterSetting?.setAttribute('aria-hidden', String(!this.showRegionNames));
  }

  private updateCacheControls(): void {
    for (const toggle of this.container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="cache-enabled-toggle"]',
    )) {
      toggle.disabled = this.cacheOperationPending;
      this.updateSwitch(toggle, this.cacheEnabled);
    }
    for (const button of this.container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="clear-app-cache"]',
    )) {
      button.disabled = this.cacheOperationPending;
    }
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
