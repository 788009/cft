import type { ProcessedData } from '@/types';
import type { RegionSelection } from './types';
import { ModalShell } from './ModalShell';
import { RegionDetailRenderer } from '@/map/RegionDetailRenderer';

export class DetailController {
  private readonly container: HTMLElement;
  private regionShell: ModalShell | null = null;
  private regionRenderer: RegionDetailRenderer | null = null;
  private openVersion = 0;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public openRegion(selection: RegionSelection, data: ProcessedData): void {
    this.closeRegion();
    const version = ++this.openVersion;
    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.disabled = true;
    downloadButton.dataset.testid = 'download-region-image';
    downloadButton.className = 'h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-400 disabled:cursor-not-allowed';
    downloadButton.textContent = '下载图片';

    this.regionShell = new ModalShell(this.container, {
      testId: 'region-detail-dialog',
      title: selection.name,
      closeLabel: '关闭地区详情',
      actions: [downloadButton],
      onClose: () => this.closeRegion(),
    });
    this.regionRenderer = new RegionDetailRenderer(this.regionShell.body);
    void this.regionRenderer.render(selection, data).catch((error: unknown) => {
      if (version !== this.openVersion || !this.regionShell) return;
      console.error('地区详情加载失败:', error);
      const message = document.createElement('p');
      message.className = 'flex h-full items-center justify-center p-6 text-sm text-red-700';
      message.textContent = '地区详情加载失败';
      this.regionShell.body.replaceChildren(message);
    });
  }

  public closeAll(): void {
    this.closeRegion();
  }

  private closeRegion(): void {
    this.openVersion += 1;
    this.regionRenderer?.destroy();
    this.regionRenderer = null;
    this.regionShell?.destroy();
    this.regionShell = null;
  }
}
