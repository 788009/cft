import { loadInitialData } from '@/data/fetcher';
import { MapRenderer } from '@/map/Renderer';
import { ViewState } from '@/state/ViewState';
import type { ProcessedData } from '@/types';
import { DetailController } from '@/details/DetailController';
import { defaultConfig, type MapInteractionMode } from '@/config';
import { SettingsController } from '@/settings/SettingsController';
import { ThemeController } from '@/theme/ThemeController';
import {
  getDefaultInfoRectanglePlacement,
  type InfoRectanglePlacement,
} from '@/map/InfoRectangle';
import { InfoRectangleEditorController } from '@/settings/InfoRectangleEditorController';

export class AppController {
  private readonly orientationGuide: HTMLElement;
  private readonly mapContainer: HTMLElement;
  private readonly uiContainer: HTMLElement;
  private readonly viewState: ViewState;
  private readonly details: DetailController;
  private readonly settings: SettingsController;
  private readonly infoRectangleEditor: InfoRectangleEditorController;
  private readonly theme: ThemeController;
  private interactionMode: MapInteractionMode = defaultConfig.mapInteractionMode;
  private showRegionNames = defaultConfig.showRegionNames;
  private onlyShowRegionNamesWithSchools = defaultConfig.onlyShowRegionNamesWithSchools;
  private showInfoRectangle = defaultConfig.showInfoRectangle;
  private infoRectanglePlacement = getDefaultInfoRectanglePlacement();
  private infoRectangleEditing = false;
  private dataPromise: Promise<ProcessedData> | null = null;
  private renderer: MapRenderer | null = null;
  private renderVersion = 0;
  private started = false;

  constructor() {
    this.orientationGuide = this.requireElement('orientation-guide');
    this.mapContainer = this.requireElement('map-container');
    this.uiContainer = this.requireElement('ui-container');
    this.viewState = new ViewState(window.innerWidth, window.innerHeight);
    this.details = new DetailController(
      this.uiContainer,
      this.showRegionNames,
      this.onlyShowRegionNamesWithSchools,
      this.showInfoRectangle,
      this.infoRectanglePlacement,
    );
    this.theme = new ThemeController(defaultConfig.themeMode);
    this.infoRectangleEditor = new InfoRectangleEditorController(this.uiContainer);
    this.settings = new SettingsController(
      this.uiContainer,
      this.interactionMode,
      defaultConfig.themeMode,
      this.showRegionNames,
      this.onlyShowRegionNamesWithSchools,
      this.showInfoRectangle,
      (mode) => {
        this.interactionMode = mode;
        this.renderer?.setInteractionMode(mode);
      },
      (mode) => this.theme.setMode(mode),
      (show) => {
        this.showRegionNames = show;
        this.renderer?.setShowRegionNames(show);
        this.details.setShowRegionNames(show);
      },
      (only) => {
        this.onlyShowRegionNamesWithSchools = only;
        this.renderer?.setOnlyShowRegionNamesWithSchools(only);
        this.details.setOnlyShowRegionNamesWithSchools(only);
      },
      (show) => {
        this.showInfoRectangle = show;
        this.renderer?.setShowInfoRectangle(show);
        this.details.setShowInfoRectangle(show);
      },
      () => this.beginInfoRectangleEditing(),
    );
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
    this.infoRectangleEditor.close();
    this.settings.destroy();
    this.theme.destroy();
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
      this.finishInfoRectangleEditing();
      this.renderVersion += 1;
      this.renderer?.destroy();
      this.renderer = null;
      this.details.closeAll();
      this.settings.close();
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
        onStudentSelect: (student) => this.details.openPerson(student),
        interactionMode: this.interactionMode,
        showRegionNames: this.showRegionNames,
        onlyShowRegionNamesWithSchools: this.onlyShowRegionNamesWithSchools,
        showInfoRectangle: this.showInfoRectangle,
        infoRectanglePlacement: this.infoRectanglePlacement,
        onInfoRectanglePlacementChange: (placement) => {
          this.infoRectanglePlacement = placement;
          this.details.setInfoRectanglePlacement(placement);
        },
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

  private beginInfoRectangleEditing(): void {
    if (!this.renderer || this.infoRectangleEditing) return;
    this.infoRectangleEditing = true;
    this.details.closeAll();
    this.settings.setButtonVisible(false);
    this.renderer.setInfoRectangleEditing(true);
    this.infoRectangleEditor.open({
      onConfirm: () => this.finishInfoRectangleEditing(),
      onReset: () => this.resetInfoRectanglePlacement(),
    });
  }

  private finishInfoRectangleEditing(): void {
    if (!this.infoRectangleEditing) return;
    this.infoRectangleEditing = false;
    this.renderer?.setInfoRectangleEditing(false);
    this.infoRectangleEditor.close();
    this.settings.setButtonVisible(true);
  }

  private resetInfoRectanglePlacement(): void {
    const placement: InfoRectanglePlacement = getDefaultInfoRectanglePlacement();
    this.infoRectanglePlacement = placement;
    this.renderer?.setInfoRectanglePlacement(placement);
    this.details.setInfoRectanglePlacement(placement);
  }

  private requireElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`找不到容器: ${id}`);
    return element;
  }
}
