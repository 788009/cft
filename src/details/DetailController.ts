import type { ProcessedData, Student } from '@/types';
import type { RegionSelection } from './types';
import { ModalShell } from './ModalShell';
import { RegionDetailRenderer } from '@/map/RegionDetailRenderer';
import { getPersonDetailRows } from './person';

export class DetailController {
  private readonly container: HTMLElement;
  private regionShell: ModalShell | null = null;
  private regionRenderer: RegionDetailRenderer | null = null;
  private personShell: ModalShell | null = null;
  private openVersion = 0;
  private showRegionNames: boolean;
  private onlyShowRegionNamesWithSchools: boolean;
  private showInfoRectangle: boolean;

  constructor(
    container: HTMLElement,
    showRegionNames: boolean,
    onlyShowRegionNamesWithSchools: boolean,
    showInfoRectangle: boolean,
  ) {
    this.container = container;
    this.showRegionNames = showRegionNames;
    this.onlyShowRegionNamesWithSchools = onlyShowRegionNamesWithSchools;
    this.showInfoRectangle = showInfoRectangle;
  }

  public setShowRegionNames(show: boolean): void {
    this.showRegionNames = show;
    this.regionRenderer?.setShowRegionNames(show);
  }

  public setOnlyShowRegionNamesWithSchools(only: boolean): void {
    this.onlyShowRegionNamesWithSchools = only;
    this.regionRenderer?.setOnlyShowRegionNamesWithSchools(only);
  }

  public setShowInfoRectangle(show: boolean): void {
    this.showInfoRectangle = show;
    this.regionRenderer?.setShowInfoRectangle(show);
  }

  public openRegion(selection: RegionSelection, data: ProcessedData): void {
    this.closePerson();
    this.closeRegion();
    const version = ++this.openVersion;
    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.disabled = true;
    downloadButton.dataset.testid = 'download-region-image';
    downloadButton.className = 'h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-400 disabled:cursor-not-allowed dark:border-slate-700 dark:text-slate-500';
    downloadButton.textContent = '下载图片';

    this.regionShell = new ModalShell(this.container, {
      testId: 'region-detail-dialog',
      title: selection.name,
      closeLabel: '关闭地区详情',
      actions: [downloadButton],
      onClose: () => this.closeRegion(),
    });
    this.regionRenderer = new RegionDetailRenderer(
      this.regionShell.body,
      (student) => this.openPerson(student),
      this.showRegionNames,
      this.onlyShowRegionNamesWithSchools,
      this.showInfoRectangle,
    );
    void this.regionRenderer.render(selection, data).catch((error: unknown) => {
      if (version !== this.openVersion || !this.regionShell) return;
      console.error('地区详情加载失败:', error);
      const message = document.createElement('p');
      message.className = 'flex h-full items-center justify-center p-6 text-sm text-red-700 dark:text-red-400';
      message.textContent = '地区详情加载失败';
      this.regionShell.body.replaceChildren(message);
    });
  }

  public openPerson(student: Student): void {
    this.closePerson();
    this.personShell = new ModalShell(this.container, {
      testId: 'person-detail-dialog',
      title: student.name,
      closeLabel: '关闭个人详情',
      layerClass: 'z-40',
      panelClass: 'relative flex max-h-[90vh] w-[min(92vw,430px)] flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900',
      bodyClass: 'overflow-auto bg-white p-4 dark:bg-slate-900',
      onClose: () => this.closePerson(),
    });
    this.regionShell?.root.setAttribute('aria-hidden', 'true');
    if (this.regionShell) this.regionShell.root.inert = true;

    const details = document.createElement('dl');
    details.className = 'divide-y divide-slate-100 text-sm dark:divide-slate-800';
    for (const row of getPersonDetailRows(student)) {
      details.append(this.createPersonRow(row.label, row.value, `person-${row.key}`));
    }
    this.personShell.body.append(details);
  }

  public closeAll(): void {
    this.closePerson();
    this.closeRegion();
  }

  private closeRegion(): void {
    this.closePerson();
    this.openVersion += 1;
    this.regionRenderer?.destroy();
    this.regionRenderer = null;
    this.regionShell?.destroy();
    this.regionShell = null;
  }

  private closePerson(): void {
    if (this.regionShell) {
      this.regionShell.root.inert = false;
      this.regionShell.root.removeAttribute('aria-hidden');
    }
    this.personShell?.destroy();
    this.personShell = null;
  }

  private createPersonRow(label: string, value: string, testId: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0';
    row.dataset.testid = `${testId}-row`;
    const term = document.createElement('dt');
    term.className = 'text-slate-500 dark:text-slate-400';
    term.textContent = label;
    const description = document.createElement('dd');
    description.className = 'min-w-0 break-words font-medium text-slate-900 dark:text-slate-100';
    description.dataset.testid = testId;
    description.textContent = value;
    row.append(term, description);
    return row;
  }
}
