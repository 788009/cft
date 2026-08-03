import settingsIconUrl from '@/assets/icons/settings.svg';
import {
  defaultConfig,
  type Corner,
  type MapInteractionMode,
  type ThemeMode,
} from '@/config';
import { ModalShell } from '@/details/ModalShell';

interface SettingOption<T extends string> {
  value: T;
  label: string;
  testId: string;
}

const MODE_OPTIONS: SettingOption<MapInteractionMode>[] = [
  { value: 'stable', label: '保持显示', testId: 'interaction-mode-stable' },
  { value: 'hide-and-reflow', label: '隐藏并重排', testId: 'interaction-mode-hide-and-reflow' },
];

const THEME_OPTIONS: SettingOption<ThemeMode>[] = [
  { value: 'system', label: '跟随系统', testId: 'theme-mode-system' },
  { value: 'light', label: '浅色', testId: 'theme-mode-light' },
  { value: 'dark', label: '深色', testId: 'theme-mode-dark' },
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
  private readonly onShowRegionNamesChange: (show: boolean) => void;
  private readonly onOnlyShowRegionNamesWithSchoolsChange: (only: boolean) => void;
  private readonly onShowInfoRectangleChange: (show: boolean) => void;
  private mode: MapInteractionMode;
  private themeMode: ThemeMode;
  private showRegionNames: boolean;
  private onlyShowRegionNamesWithSchools: boolean;
  private showInfoRectangle: boolean;
  private shell: ModalShell | null = null;

  constructor(
    container: HTMLElement,
    initialMode: MapInteractionMode,
    initialThemeMode: ThemeMode,
    initialShowRegionNames: boolean,
    initialOnlyShowRegionNamesWithSchools: boolean,
    initialShowInfoRectangle: boolean,
    onModeChange: (mode: MapInteractionMode) => void,
    onThemeModeChange: (mode: ThemeMode) => void,
    onShowRegionNamesChange: (show: boolean) => void,
    onOnlyShowRegionNamesWithSchoolsChange: (only: boolean) => void,
    onShowInfoRectangleChange: (show: boolean) => void,
  ) {
    this.container = container;
    this.mode = initialMode;
    this.themeMode = initialThemeMode;
    this.showRegionNames = initialShowRegionNames;
    this.onlyShowRegionNamesWithSchools = initialOnlyShowRegionNamesWithSchools;
    this.showInfoRectangle = initialShowInfoRectangle;
    this.onModeChange = onModeChange;
    this.onThemeModeChange = onThemeModeChange;
    this.onShowRegionNamesChange = onShowRegionNamesChange;
    this.onOnlyShowRegionNamesWithSchoolsChange = onOnlyShowRegionNamesWithSchoolsChange;
    this.onShowInfoRectangleChange = onShowInfoRectangleChange;
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
      panelClass: 'relative flex max-h-[90vh] w-[min(92vw,460px)] flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900',
      bodyClass: 'overflow-auto bg-white p-4 dark:bg-slate-900',
      onClose: () => this.close(),
    });

    const content = document.createElement('div');
    content.className = 'grid gap-5';
    content.append(
      this.createChoiceGroup(
        '地图移动与缩放',
        '地图移动与缩放时的卡片显示模式',
        'interaction-mode',
        MODE_OPTIONS,
        (value) => this.selectMode(value),
      ),
      this.createChoiceGroup(
        '外观',
        '界面外观',
        'theme-mode',
        THEME_OPTIONS,
        (value) => this.selectThemeMode(value),
      ),
      this.createToggleSetting(),
    );
    this.shell.body.append(content);
    this.updateChoices();
  };

  private createChoiceGroup<T extends string>(
    label: string,
    ariaLabel: string,
    setting: string,
    options: SettingOption<T>[],
    onSelect: (value: T) => void,
  ): HTMLFieldSetElement {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.className = 'mb-2 text-sm font-medium text-slate-700 dark:text-slate-300';
    legend.textContent = label;
    const choices = document.createElement('div');
    choices.className = 'grid overflow-hidden rounded-md border border-slate-300 dark:border-slate-700';
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

  private createToggleSetting(): HTMLFieldSetElement {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.className = 'mb-2 text-sm font-medium text-slate-700 dark:text-slate-300';
    legend.textContent = '地图标注';

    const toggle = this.createSwitch(
      'region-names-toggle',
      '显示地区名称',
      () => this.selectShowRegionNames(!this.showRegionNames),
    );
    const filterSetting = document.createElement('div');
    filterSetting.dataset.testid = 'region-names-school-filter-setting';
    filterSetting.className = 'mt-2';
    filterSetting.append(this.createSwitch(
      'region-names-school-filter-toggle',
      '仅显示有大学的地区',
      () => this.selectOnlyShowRegionNamesWithSchools(!this.onlyShowRegionNamesWithSchools),
    ));
    const infoRectangleSetting = document.createElement('div');
    infoRectangleSetting.className = 'mt-2';
    infoRectangleSetting.append(this.createSwitch(
      'info-rectangle-toggle',
      '显示信息范围框',
      () => this.selectShowInfoRectangle(!this.showInfoRectangle),
    ));
    fieldset.append(legend, toggle, filterSetting, infoRectangleSetting);
    return fieldset;
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
      'flex min-h-11 w-full items-center justify-between gap-3 rounded-md border px-3 text-sm font-medium',
      'border-slate-300 bg-white text-slate-700 focus-visible:outline-2 focus-visible:outline-teal-700',
      'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:focus-visible:outline-teal-400',
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

  private updateChoices(): void {
    if (!this.shell) return;
    for (const choice of this.shell.body.querySelectorAll<HTMLButtonElement>('[role="radio"][data-setting]')) {
      const selectedValue = choice.dataset.setting === 'interaction-mode'
        ? this.mode
        : this.themeMode;
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
    this.updateSwitch(toggle, this.showRegionNames);
    this.updateSwitch(filterToggle, this.onlyShowRegionNamesWithSchools);
    this.updateSwitch(infoRectangleToggle, this.showInfoRectangle);
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
