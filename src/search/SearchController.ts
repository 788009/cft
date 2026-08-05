import { defaultConfig } from '@/config';
import {
  createSearchIndex,
  executeSearch,
  getSearchSuggestions,
  type SearchIndex,
  type SearchResult,
  type SearchSuggestion,
} from '@/logic/search';
import type { SchoolGroup, Student } from '@/types';
import searchIconUrl from '@/assets/icons/search.svg';
import closeIconUrl from '@/assets/icons/x.svg';
import type { Rect } from '@/logic/layout';
import { getSearchControlPlacement } from './placement';

export type SearchResultChangeHandler = (result: SearchResult) => void;
export type SearchObstacleChangeHandler = (obstacles: Rect[]) => void;

export class SearchController {
  private readonly container: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly field: HTMLDivElement;
  private readonly searchButton: HTMLButtonElement;
  private readonly input: HTMLInputElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly list: HTMLDivElement;
  private readonly onResultChange: SearchResultChangeHandler;
  private readonly onObstacleChange: SearchObstacleChangeHandler;
  private index: SearchIndex = createSearchIndex([], []);
  private suggestions: SearchSuggestion[] = [];
  private activeSuggestionIndex = -1;
  private composing = false;
  private visible = true;
  private compact = false;
  private compactExpanded = false;
  private placementFrame: number | null = null;

  constructor(
    container: HTMLElement,
    onResultChange: SearchResultChangeHandler,
    onObstacleChange: SearchObstacleChangeHandler,
  ) {
    this.container = container;
    this.onResultChange = onResultChange;
    this.onObstacleChange = onObstacleChange;
    this.root = document.createElement('div');
    this.root.dataset.testid = 'search-control';
    this.root.dataset.corner = defaultConfig.searchControl.corner;
    this.root.className = 'pointer-events-auto absolute z-20';

    this.field = document.createElement('div');
    this.field.dataset.testid = 'search-field';
    this.field.className = [
      'flex h-11 items-center rounded-md border border-slate-300 bg-white shadow-sm',
      'overflow-hidden transition-[width] duration-200',
      'focus-within:border-teal-700 focus-within:ring-2 focus-within:ring-teal-700/20',
      'dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-teal-400',
      'dark:focus-within:ring-teal-400/20',
    ].join(' ');

    this.searchButton = document.createElement('button');
    this.searchButton.type = 'button';
    this.searchButton.dataset.testid = 'search-toggle';
    this.searchButton.className = [
      'flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-600',
      'hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-teal-700',
      'dark:text-slate-300 dark:hover:bg-slate-800 dark:focus-visible:outline-teal-400',
    ].join(' ');
    this.searchButton.setAttribute('aria-label', '聚焦搜索');
    const searchIcon = document.createElement('img');
    searchIcon.src = searchIconUrl;
    searchIcon.alt = '';
    searchIcon.className = 'h-5 w-5 shrink-0 opacity-70 dark:invert';
    searchIcon.setAttribute('aria-hidden', 'true');
    this.searchButton.append(searchIcon);

    const label = document.createElement('label');
    label.htmlFor = 'school-search-input';
    label.className = 'sr-only';
    label.textContent = '搜索同学或学校';

    this.input = document.createElement('input');
    this.input.id = 'school-search-input';
    this.input.type = 'text';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.disabled = true;
    this.input.dataset.testid = 'search-input';
    this.input.className = [
      'h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-slate-900 outline-none',
      'placeholder:text-slate-400 disabled:cursor-wait dark:text-slate-100',
      'dark:placeholder:text-slate-500',
    ].join(' ');
    this.input.placeholder = '搜索姓名、简称、大学或地区';
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-controls', 'search-suggestions');
    this.input.setAttribute('aria-expanded', 'false');

    this.clearButton = document.createElement('button');
    this.clearButton.type = 'button';
    this.clearButton.dataset.testid = 'clear-search';
    this.clearButton.className = [
      'hidden h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-500',
      'hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-teal-700',
      'dark:text-slate-400 dark:hover:bg-slate-800 dark:focus-visible:outline-teal-400',
    ].join(' ');
    this.clearButton.setAttribute('aria-label', '清空搜索');
    const clearIcon = document.createElement('img');
    clearIcon.src = closeIconUrl;
    clearIcon.alt = '';
    clearIcon.className = 'h-4 w-4 dark:invert';
    clearIcon.setAttribute('aria-hidden', 'true');
    this.clearButton.append(clearIcon);

    this.list = document.createElement('div');
    this.list.id = 'search-suggestions';
    this.list.dataset.testid = 'search-suggestions';
    this.list.className = [
      'absolute left-0 hidden w-full max-h-[min(20rem,calc(100vh-4.5rem))]',
      defaultConfig.searchControl.corner.startsWith('top') ? 'top-full mt-1' : 'bottom-full mb-1',
      'overflow-y-auto rounded-md border',
      'border-slate-300 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900',
    ].join(' ');
    this.list.setAttribute('role', 'listbox');

    this.field.append(this.searchButton, label, this.input, this.clearButton);
    this.root.append(this.field, this.list);
    this.container.append(this.root);

    this.searchButton.addEventListener('click', this.handleSearchButtonClick);
    this.input.addEventListener('input', this.handleInput);
    this.input.addEventListener('focus', this.handleFocus);
    this.input.addEventListener('keydown', this.handleKeyDown);
    this.input.addEventListener('compositionstart', this.handleCompositionStart);
    this.input.addEventListener('compositionend', this.handleCompositionEnd);
    this.clearButton.addEventListener('click', this.clear);
    document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
    window.addEventListener('resize', this.handleResize);
    this.updateResponsiveLayout();
  }

  public setData(students: Student[], schools: SchoolGroup[]): void {
    this.index = createSearchIndex(students, schools);
    this.input.disabled = false;
    this.updateSearch();
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.classList.toggle('hidden', !visible);
    this.root.setAttribute('aria-hidden', String(!visible));
    if (!visible) this.closeSuggestions();
    this.schedulePlacement();
  }

  public destroy(): void {
    this.searchButton.removeEventListener('click', this.handleSearchButtonClick);
    this.input.removeEventListener('input', this.handleInput);
    this.input.removeEventListener('focus', this.handleFocus);
    this.input.removeEventListener('keydown', this.handleKeyDown);
    this.input.removeEventListener('compositionstart', this.handleCompositionStart);
    this.input.removeEventListener('compositionend', this.handleCompositionEnd);
    this.clearButton.removeEventListener('click', this.clear);
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    window.removeEventListener('resize', this.handleResize);
    if (this.placementFrame !== null) cancelAnimationFrame(this.placementFrame);
    this.onObstacleChange([]);
    this.root.remove();
  }

  private readonly handleResize = (): void => {
    this.updateResponsiveLayout();
  };

  private readonly handleSearchButtonClick = (): void => {
    if (!this.compact) {
      this.input.focus();
      return;
    }
    this.compactExpanded = !this.compactExpanded;
    this.syncControlState();
    if (this.compactExpanded) this.input.focus();
    else {
      this.closeSuggestions();
      this.searchButton.focus();
    }
  };

  private readonly handleInput = (): void => {
    if (!this.composing) this.updateSearch();
  };

  private readonly handleFocus = (): void => {
    this.renderSuggestions();
  };

  private readonly handleCompositionStart = (): void => {
    this.composing = true;
  };

  private readonly handleCompositionEnd = (): void => {
    this.composing = false;
    this.updateSearch();
  };

  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Node && !this.root.contains(event.target)) {
      this.closeSuggestions();
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveActiveSuggestion(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveActiveSuggestion(-1);
    } else if (event.key === 'Enter' && this.activeSuggestionIndex >= 0) {
      event.preventDefault();
      this.selectSuggestion(this.activeSuggestionIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.closeSuggestions();
    }
  };

  private readonly clear = (): void => {
    this.input.value = '';
    this.updateSearch();
    this.input.focus();
  };

  private updateSearch(): void {
    const query = this.input.value;
    this.onResultChange(executeSearch(query, this.index));
    this.suggestions = getSearchSuggestions(
      query,
      this.index,
      defaultConfig.searchSuggestionLimit,
    );
    this.activeSuggestionIndex = -1;
    this.syncClearButton();
    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    const expanded = (
      this.visible &&
      (!this.compact || this.compactExpanded) &&
      document.activeElement === this.input &&
      this.suggestions.length > 0
    );
    this.list.classList.toggle('hidden', !expanded);
    this.input.setAttribute('aria-expanded', String(expanded));
    if (!expanded) {
      this.input.removeAttribute('aria-activedescendant');
      return;
    }

    const options = this.suggestions.map((suggestion, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.id = `search-suggestion-${index}`;
      option.dataset.testid = 'search-suggestion';
      option.dataset.value = suggestion.value;
      option.className = [
        'flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm',
        'text-slate-800 hover:bg-slate-100 focus:outline-none dark:text-slate-100',
        'dark:hover:bg-slate-800',
      ].join(' ');
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === this.activeSuggestionIndex));
      option.classList.toggle('bg-slate-100', index === this.activeSuggestionIndex);
      option.classList.toggle('dark:bg-slate-800', index === this.activeSuggestionIndex);

      const value = document.createElement('span');
      value.className = 'min-w-0 truncate';
      value.textContent = suggestion.value;
      const field = document.createElement('span');
      field.className = 'shrink-0 text-xs text-slate-500 dark:text-slate-400';
      field.textContent = this.getFieldLabel(suggestion);
      option.append(value, field);
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => this.selectSuggestion(index));
      return option;
    });
    this.list.replaceChildren(...options);
    this.syncActiveDescendant();
  }

  private moveActiveSuggestion(direction: -1 | 1): void {
    if (this.suggestions.length === 0) return;
    if (this.list.classList.contains('hidden')) {
      this.renderSuggestions();
      if (this.list.classList.contains('hidden')) return;
    }
    this.activeSuggestionIndex = this.activeSuggestionIndex < 0
      ? direction === 1 ? 0 : this.suggestions.length - 1
      : (this.activeSuggestionIndex + direction + this.suggestions.length) % this.suggestions.length;
    for (const [index, option] of Array.from(this.list.children).entries()) {
      const selected = index === this.activeSuggestionIndex;
      option.setAttribute('aria-selected', String(selected));
      option.classList.toggle('bg-slate-100', selected);
      option.classList.toggle('dark:bg-slate-800', selected);
    }
    this.syncActiveDescendant();
  }

  private syncActiveDescendant(): void {
    if (this.activeSuggestionIndex < 0) {
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    const id = `search-suggestion-${this.activeSuggestionIndex}`;
    this.input.setAttribute('aria-activedescendant', id);
    document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
  }

  private selectSuggestion(index: number): void {
    const suggestion = this.suggestions[index];
    if (!suggestion) return;
    this.input.value = suggestion.value;
    this.updateSearch();
    this.closeSuggestions();
    this.input.focus();
  }

  private closeSuggestions(): void {
    this.activeSuggestionIndex = -1;
    this.list.classList.add('hidden');
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }

  private updateResponsiveLayout(): void {
    const compact = window.innerWidth < defaultConfig.searchControl.compactBreakpoint;
    if (compact !== this.compact) {
      this.compact = compact;
      this.compactExpanded = false;
    }
    this.syncControlState();
  }

  private syncControlState(): void {
    const showInput = !this.compact || this.compactExpanded;
    const width = this.getControlWidth();
    this.root.style.width = `${width}px`;
    this.field.style.width = `${width}px`;
    this.root.dataset.compact = String(this.compact);
    this.root.dataset.expanded = String(showInput);
    this.input.classList.toggle('hidden', !showInput);
    this.searchButton.setAttribute(
      'aria-label',
      this.compact ? showInput ? '收起搜索' : '展开搜索' : '聚焦搜索',
    );
    if (this.compact) this.searchButton.setAttribute('aria-expanded', String(showInput));
    else this.searchButton.removeAttribute('aria-expanded');
    this.syncClearButton();
    if (!showInput) this.closeSuggestions();
    this.schedulePlacement();
  }

  private syncClearButton(): void {
    const show = (!this.compact || this.compactExpanded) && this.input.value.length > 0;
    this.clearButton.classList.toggle('hidden', !show);
    this.clearButton.classList.toggle('flex', show);
  }

  private getControlWidth(): number {
    const config = defaultConfig.searchControl;
    const desired = this.compact
      ? this.compactExpanded ? config.compactExpandedWidth : config.controlSize
      : config.desktopWidth;
    return Math.max(
      config.controlSize,
      Math.min(desired, window.innerWidth - config.viewportMargin * 2),
    );
  }

  private schedulePlacement(): void {
    if (this.placementFrame !== null) cancelAnimationFrame(this.placementFrame);
    this.placementFrame = requestAnimationFrame(() => {
      this.placementFrame = null;
      this.updatePlacement();
    });
  }

  private updatePlacement(): void {
    const config = defaultConfig.searchControl;
    const occupiedRects = Array.from(
      this.container.querySelectorAll<HTMLElement>(`[data-corner="${config.corner}"]`),
    ).flatMap((element): Rect[] => {
      if (element === this.root || element.hidden || element.classList.contains('hidden')) return [];
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        ? [{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }]
        : [];
    });
    const placement = getSearchControlPlacement({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      width: this.getControlWidth(),
      height: config.controlSize,
      corner: config.corner,
      margin: config.viewportMargin,
      gap: config.siblingGap,
      occupiedRects,
    });
    this.root.style.left = `${placement.x}px`;
    this.root.style.top = `${placement.y}px`;

    if (!this.visible) {
      this.onObstacleChange([]);
      return;
    }
    const obstacleElement = this.compact ? this.searchButton : this.field;
    const obstacle = obstacleElement.getBoundingClientRect();
    this.onObstacleChange([{
      x: obstacle.x,
      y: obstacle.y,
      width: obstacle.width,
      height: obstacle.height,
    }]);
  }

  private getFieldLabel(suggestion: SearchSuggestion): string {
    const labels: Record<(typeof suggestion.fields)[number], string> = {
      name: '姓名',
      short: '简称',
      university: '大学',
      province: '省份',
      city: '城市',
    };
    return suggestion.fields.map((field) => labels[field]).join(' / ');
  }
}
