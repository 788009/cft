import closeIconUrl from '@/assets/icons/x.svg';

interface ModalShellOptions {
  testId: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
  actions?: HTMLElement[];
  layerClass?: string;
  panelClass?: string;
  bodyClass?: string;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  return element;
}

export class ModalShell {
  public readonly root: HTMLDivElement;
  public readonly body: HTMLDivElement;
  private readonly previousFocus: (Element & { focus: () => void }) | null;
  private readonly onClose: () => void;

  constructor(container: HTMLElement, options: ModalShellOptions) {
    const activeElement = document.activeElement;
    this.previousFocus = activeElement && 'focus' in activeElement && typeof activeElement.focus === 'function'
      ? activeElement as Element & { focus: () => void }
      : null;
    this.onClose = options.onClose;

    this.root = createElement(
      'div',
      `fixed inset-0 ${options.layerClass ?? 'z-30'} flex items-center justify-center p-3 sm:p-5 pointer-events-auto`,
    );
    this.root.dataset.testid = options.testId;

    const backdrop = createElement('button', 'absolute inset-0 h-full w-full bg-slate-950/45 cursor-default');
    backdrop.type = 'button';
    backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-label', options.closeLabel);
    backdrop.addEventListener('click', this.onClose);

    const panel = createElement(
      'section',
      options.panelClass ?? 'relative flex h-[min(90vh,760px)] w-[min(94vw,1120px)] flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900',
    );
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const titleId = `${options.testId}-title`;
    panel.setAttribute('aria-labelledby', titleId);

    const header = createElement(
      'header',
      'flex min-h-14 shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-2 dark:border-slate-700',
    );
    const title = createElement('h2', 'min-w-0 flex-1 truncate text-base font-semibold text-slate-900 dark:text-slate-100');
    title.id = titleId;
    title.textContent = options.title;
    header.append(title, ...(options.actions ?? []));

    const closeButton = createElement(
      'button',
      'flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus-visible:outline-teal-400',
    );
    closeButton.type = 'button';
    closeButton.dataset.testid = `close-${options.testId}`;
    closeButton.setAttribute('aria-label', options.closeLabel);
    const closeIcon = createElement('img', 'h-5 w-5 dark:invert');
    closeIcon.src = closeIconUrl;
    closeIcon.alt = '';
    closeIcon.setAttribute('aria-hidden', 'true');
    closeButton.append(closeIcon);
    closeButton.addEventListener('click', this.onClose);
    header.append(closeButton);

    this.body = createElement('div', options.bodyClass ?? 'relative min-h-0 flex-1 bg-slate-50 dark:bg-slate-950');
    panel.append(header, this.body);
    this.root.append(backdrop, panel);
    this.root.addEventListener('keydown', this.handleKeyDown);
    container.append(this.root);
    closeButton.focus();
  }

  public destroy(): void {
    this.root.removeEventListener('keydown', this.handleKeyDown);
    this.root.remove();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(this.root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hidden);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}
