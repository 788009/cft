export interface InfoRectangleEditorOptions {
  onConfirm: () => void;
  onReset: () => void;
}

export class InfoRectangleEditorController {
  private readonly container: HTMLElement;
  private root: HTMLDivElement | null = null;
  private onConfirm: (() => void) | null = null;
  private onReset: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public open(options: InfoRectangleEditorOptions): void {
    this.close();
    this.onConfirm = options.onConfirm;
    this.onReset = options.onReset;

    const root = document.createElement('div');
    root.dataset.testid = 'info-rectangle-editor-controls';
    root.className = [
      'pointer-events-auto fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 gap-2',
      'rounded-md border border-slate-300 bg-white p-2 shadow-lg',
      'dark:border-slate-700 dark:bg-slate-900',
    ].join(' ');

    const reset = this.createButton('恢复默认', 'reset-info-rectangle', false);
    reset.addEventListener('click', this.handleReset);
    const confirm = this.createButton('确认', 'confirm-info-rectangle', true);
    confirm.addEventListener('click', this.handleConfirm);
    root.append(reset, confirm);
    this.container.append(root);
    this.root = root;
    window.addEventListener('keydown', this.handleKeyDown);
    confirm.focus();
  }

  public close(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    this.root?.querySelector('[data-testid="reset-info-rectangle"]')
      ?.removeEventListener('click', this.handleReset);
    this.root?.querySelector('[data-testid="confirm-info-rectangle"]')
      ?.removeEventListener('click', this.handleConfirm);
    this.root?.remove();
    this.root = null;
    this.onConfirm = null;
    this.onReset = null;
  }

  private createButton(label: string, testId: string, primary: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = testId;
    button.className = primary
      ? 'min-h-11 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400 dark:focus-visible:outline-teal-400'
      : 'min-h-11 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:outline-teal-400';
    button.textContent = label;
    return button;
  }

  private readonly handleConfirm = (): void => {
    this.onConfirm?.();
  };

  private readonly handleReset = (): void => {
    this.onReset?.();
    this.root?.querySelector<HTMLButtonElement>('[data-testid="confirm-info-rectangle"]')?.focus();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.isComposing) return;
    if (event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    this.onConfirm?.();
  };
}
