import { loadInitialData } from '@/data/fetcher';
import { MapRenderer } from '@/map/Renderer';
import { ViewState } from '@/state/ViewState';
import type { ProcessedData } from '@/types';
import { DetailController } from '@/details/DetailController';

export class AppController {
  private readonly orientationGuide: HTMLElement;
  private readonly mapContainer: HTMLElement;
  private readonly uiContainer: HTMLElement;
  private readonly viewState: ViewState;
  private readonly details: DetailController;
  private dataPromise: Promise<ProcessedData> | null = null;
  private renderer: MapRenderer | null = null;
  private renderVersion = 0;
  private started = false;

  constructor() {
    this.orientationGuide = this.requireElement('orientation-guide');
    this.mapContainer = this.requireElement('map-container');
    this.uiContainer = this.requireElement('ui-container');
    this.viewState = new ViewState(window.innerWidth, window.innerHeight);
    this.details = new DetailController(this.uiContainer);
  }

  public start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('resize', this.handleResize);
    this.applyViewport();
  }

  public destroy(): void {
    if (!this.started) return;
    this.started = false;
    this.renderVersion += 1;
    window.removeEventListener('resize', this.handleResize);
    this.renderer?.destroy();
    this.renderer = null;
    this.details.closeAll();
  }

  private readonly handleResize = (): void => {
    this.viewState.updateViewport(window.innerWidth, window.innerHeight);
    this.applyViewport();
  };

  private applyViewport(): void {
    const { viewport } = this.viewState.getSnapshot();
    const isPortrait = viewport.orientation === 'portrait';

    this.orientationGuide.classList.toggle('hidden', !isPortrait);
    this.orientationGuide.setAttribute('aria-hidden', String(!isPortrait));
    this.mapContainer.classList.toggle('hidden', isPortrait);
    this.uiContainer.classList.toggle('hidden', isPortrait);

    if (isPortrait) {
      this.renderVersion += 1;
      this.renderer?.destroy();
      this.renderer = null;
      this.details.closeAll();
      return;
    }

    if (this.renderer) {
      this.renderer.resize(viewport.width, viewport.height);
      return;
    }

    const version = ++this.renderVersion;
    void this.mountMap(version);
  }

  private async mountMap(version: number): Promise<void> {
    try {
      const data = await this.getData();
      if (!this.started || version !== this.renderVersion) return;

      const renderer = new MapRenderer('map-container', {
        onViewChange: (view) => this.viewState.updateMap(view),
        onRegionSelect: (selection) => this.details.openRegion(selection, data),
      });
      this.renderer = renderer;
      renderer.setData(data);
      await renderer.renderBaseMap();

      if (!this.started || version !== this.renderVersion || this.renderer !== renderer) {
        renderer.destroy();
      }
    } catch (error) {
      if (version === this.renderVersion) console.error('初始化失败:', error);
    }
  }

  private getData(): Promise<ProcessedData> {
    if (!this.dataPromise) {
      this.dataPromise = loadInitialData().catch((error: unknown) => {
        this.dataPromise = null;
        throw error;
      });
    }
    return this.dataPromise;
  }

  private requireElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`找不到容器: ${id}`);
    return element;
  }
}
