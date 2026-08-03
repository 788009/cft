import { defaultConfig, type Corner, type MapInteractionMode } from '@/config';
import { ModalShell } from '@/details/ModalShell';

interface ModeOption {
  value: MapInteractionMode;
  label: string;
  testId: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: 'stable', label: '保持显示', testId: 'interaction-mode-stable' },
  { value: 'hide-and-reflow', label: '隐藏并重排', testId: 'interaction-mode-hide-and-reflow' },
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
  private mode: MapInteractionMode;
  private shell: ModalShell | null = null;

  constructor(
    container: HTMLElement,
    initialMode: MapInteractionMode,
    onModeChange: (mode: MapInteractionMode) => void,
  ) {
    this.container = container;
    this.mode = initialMode;
    this.onModeChange = onModeChange;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.dataset.testid = 'settings-button';
    this.button.dataset.corner = defaultConfig.settingsButtonCorner;
    this.button.className = [
      'absolute z-20 flex h-11 w-11 items-center justify-center rounded-md border',
      'border-slate-300 bg-white text-[22px] leading-none text-slate-700 shadow-sm',
      'pointer-events-auto hover:bg-slate-50 focus-visible:outline-2',
      'focus-visible:outline-offset-2 focus-visible:outline-teal-700',
      CORNER_CLASSES[defaultConfig.settingsButtonCorner],
    ].join(' ');
    this.button.textContent = '\u2699';
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
      panelClass: 'relative flex max-h-[90vh] w-[min(92vw,460px)] flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl',
      bodyClass: 'overflow-auto bg-white p-4',
      onClose: () => this.close(),
    });

    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.className = 'mb-2 text-sm font-medium text-slate-700';
    legend.textContent = '地图移动与缩放';
    const choices = document.createElement('div');
    choices.className = 'grid grid-cols-2 overflow-hidden rounded-md border border-slate-300';
    choices.setAttribute('role', 'radiogroup');
    choices.setAttribute('aria-label', '地图移动与缩放时的卡片显示模式');

    for (const option of MODE_OPTIONS) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.dataset.testid = option.testId;
      choice.dataset.mode = option.value;
      choice.className = 'min-h-11 border-r border-slate-300 px-3 text-sm font-medium last:border-r-0 focus-visible:relative focus-visible:outline-2 focus-visible:outline-teal-700';
      choice.setAttribute('role', 'radio');
      choice.textContent = option.label;
      choice.addEventListener('click', () => this.selectMode(option.value));
      choices.append(choice);
    }

    fieldset.append(legend, choices);
    this.shell.body.append(fieldset);
    this.updateChoices();
  };

  private selectMode(mode: MapInteractionMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.updateChoices();
    this.onModeChange(mode);
  }

  private updateChoices(): void {
    if (!this.shell) return;
    for (const choice of this.shell.body.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      const selected = choice.dataset.mode === this.mode;
      choice.setAttribute('aria-checked', String(selected));
      choice.classList.toggle('bg-teal-700', selected);
      choice.classList.toggle('text-white', selected);
      choice.classList.toggle('bg-white', !selected);
      choice.classList.toggle('text-slate-700', !selected);
    }
  }
}
