import { loadInitialData } from '@/data/fetcher';
import { MapRenderer } from '@/map/Renderer';
import { ViewState } from '@/state/ViewState';
import type { ProcessedData } from '@/types';
import { DetailController } from '@/details/DetailController';
import {
  defaultConfig,
  type CardGroupingMode,
  type MapInteractionMode,
} from '@/config';
import { SettingsController } from '@/settings/SettingsController';
import { ThemeController } from '@/theme/ThemeController';
import { BackgroundController } from '@/theme/BackgroundController';
import {
  getDefaultInfoRectanglePlacement,
  getInfoRectangleMode,
  type InfoRectangleMode,
  type InfoRectanglePlacement,
} from '@/map/InfoRectangle';
import { InfoRectangleEditorController } from '@/settings/InfoRectangleEditorController';
import { SearchController } from '@/search/SearchController';
import type { SearchResult } from '@/logic/search';
import type { Rect } from '@/logic/layout';
import { SettingsStateStore } from '@/settings/SettingsState';
import { SaveImageController } from '@/export/SaveImageController';
import type { SaveImageModeLayout } from '@/export/geometry';

export class AppController {
  private readonly mapContainer: HTMLElement;
  private readonly uiContainer: HTMLElement;
  private readonly viewState: ViewState;
  private readonly details: DetailController;
  private readonly settings: SettingsController;
  private readonly infoRectangleEditor: InfoRectangleEditorController;
  private readonly search: SearchController;
  private readonly theme: ThemeController;
  private readonly background: BackgroundController;
  private readonly settingsState: SettingsStateStore;
  private interactionMode: MapInteractionMode = defaultConfig.mapInteractionMode;
  private cardGroupingMode: CardGroupingMode = defaultConfig.cardGroupingMode;
  private showRegionNames = defaultConfig.showRegionNames;
  private onlyShowRegionNamesWithSchools = defaultConfig.onlyShowRegionNamesWithSchools;
  private showInfoRectangle = defaultConfig.showInfoRectangle;
  private showMiddleSchool = defaultConfig.showMiddleSchool;
  private enableLocalLayoutOptimization = defaultConfig.enableLocalLayoutOptimization;
  private infoRectanglePlacement: InfoRectanglePlacement;
  private infoRectangleMode: InfoRectangleMode;
  private infoRectangleEditing = false;
  private dataPromise: Promise<ProcessedData> | null = null;
  private renderer: MapRenderer | null = null;
  private searchResult: SearchResult = {
    matchedStudents: new Set(),
    matchedSchools: new Set(),
    targetSchools: new Set(),
  };
  private searchObstacles: Rect[] = [];
  private renderVersion = 0;
  private started = false;
  private saveImage: SaveImageController | null = null;
  private saveImageFontScale = 1;

  constructor() {
    this.mapContainer = this.requireElement('map-container');
    this.uiContainer = this.requireElement('ui-container');
    this.viewState = new ViewState(window.innerWidth, window.innerHeight);
    this.settingsState = new SettingsStateStore({
      interactionMode: this.interactionMode,
      themeMode: defaultConfig.themeMode,
      backgroundFile: null,
      cardGroupingMode: this.cardGroupingMode,
      showRegionNames: this.showRegionNames,
      onlyShowRegionNamesWithSchools: this.onlyShowRegionNamesWithSchools,
      showInfoRectangle: this.showInfoRectangle,
      showMiddleSchool: this.showMiddleSchool,
      enableLocalLayoutOptimization: this.enableLocalLayoutOptimization,
    });
    this.infoRectanglePlacement = getDefaultInfoRectanglePlacement(
      window.innerWidth,
      window.innerHeight,
    );
    this.infoRectangleMode = getInfoRectangleMode(window.innerWidth, window.innerHeight);
    this.details = new DetailController(
      this.uiContainer,
      this.showRegionNames,
      this.onlyShowRegionNamesWithSchools,
      this.showInfoRectangle,
      this.infoRectanglePlacement,
      this.enableLocalLayoutOptimization,
      this.cardGroupingMode,
    );
    this.background = new BackgroundController(
      this.mapContainer,
      defaultConfig.backgroundImages,
    );
    this.theme = new ThemeController(
      defaultConfig.themeMode,
      (resolvedTheme) => this.background.setTheme(resolvedTheme),
    );
    this.infoRectangleEditor = new InfoRectangleEditorController(this.uiContainer);
    this.search = new SearchController(
      this.uiContainer,
      (result) => {
        this.searchResult = result;
        this.renderer?.setSearchResult(result);
      },
      (obstacles) => {
        this.searchObstacles = obstacles;
        this.renderer?.setUiObstacles(obstacles);
      },
    );
    this.settings = new SettingsController(
      this.uiContainer,
      this.settingsState,
      {
        onInteractionModeChange: (mode) => {
          this.interactionMode = mode;
          this.renderer?.setInteractionMode(mode);
        },
        onThemeModeChange: (mode) => this.theme.setMode(mode),
        onBackgroundImageChange: (file) => this.background.setUploadedFile(file),
        onCardGroupingModeChange: (mode) => {
          this.cardGroupingMode = mode;
          this.renderer?.setCardGroupingMode(mode);
          this.details.setCardGroupingMode(mode);
        },
        onShowRegionNamesChange: (show) => {
          this.showRegionNames = show;
          this.renderer?.setShowRegionNames(show);
          this.details.setShowRegionNames(show);
        },
        onOnlyShowRegionNamesWithSchoolsChange: (only) => {
          this.onlyShowRegionNamesWithSchools = only;
          this.renderer?.setOnlyShowRegionNamesWithSchools(only);
          this.details.setOnlyShowRegionNamesWithSchools(only);
        },
        onShowInfoRectangleChange: (show) => {
          this.showInfoRectangle = show;
          this.renderer?.setShowInfoRectangle(show);
          this.details.setShowInfoRectangle(show);
        },
        onShowMiddleSchoolChange: (show) => {
          this.showMiddleSchool = show;
          this.renderer?.setShowMiddleSchool(show);
        },
        onLocalLayoutOptimizationChange: (enabled) => {
          this.enableLocalLayoutOptimization = enabled;
          this.renderer?.setLocalLayoutOptimizationEnabled(enabled);
          this.details.setLocalLayoutOptimizationEnabled(enabled);
        },
        onEditInfoRectangle: () => this.beginInfoRectangleEditing(),
        onSaveImage: () => this.beginSaveImageMode(),
      },
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
    this.saveImage?.destroy();
    this.saveImage = null;
    this.restoreMapViewport();
    this.details.closeAll();
    this.infoRectangleEditor.close();
    this.search.destroy();
    this.settings.destroy();
    this.theme.destroy();
    this.background.destroy();
  }

  private readonly handleResize = (): void => {
    this.viewState.updateViewport(window.innerWidth, window.innerHeight);
    const { viewport } = this.viewState.getSnapshot();
    if (this.saveImage) {
      this.saveImage.resize(viewport.width, viewport.height);
      return;
    }
    this.applyViewport();
  };

  private applyViewport(): void {
    const { viewport } = this.viewState.getSnapshot();
    this.applyInfoRectangleMode(viewport.width, viewport.height);

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
        cardGroupingMode: this.cardGroupingMode,
        showRegionNames: this.showRegionNames,
        onlyShowRegionNamesWithSchools: this.onlyShowRegionNamesWithSchools,
        showInfoRectangle: this.showInfoRectangle,
        showMiddleSchool: this.showMiddleSchool,
        enableLocalLayoutOptimization: this.enableLocalLayoutOptimization,
        infoRectanglePlacement: this.infoRectanglePlacement,
        onInfoRectanglePlacementChange: (placement) => {
          this.infoRectanglePlacement = placement;
          this.details.setInfoRectanglePlacement(placement);
        },
      });
      this.renderer = renderer;
      renderer.setRegionSelectionEnabled(!this.saveImage);
      renderer.setSaveImageFontScale(this.saveImageFontScale);
      renderer.setData(data);
      renderer.setSearchResult(this.searchResult);
      renderer.setUiObstacles(this.searchObstacles);
      this.search.setData(data.students, data.schools);
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
    this.search.setVisible(false);
    this.saveImage?.setVisible(false);
    this.renderer.setInfoRectangleEditing(true);
    this.infoRectangleEditor.open({
      onConfirm: () => this.finishInfoRectangleEditing(),
      onReset: () => this.resetInfoRectanglePlacement(),
    });
  }

  private beginSaveImageMode(): void {
    if (this.saveImage) return;
    this.details.closeAll();
    this.finishInfoRectangleEditing();
    this.settings.setButtonVisible(false);
    this.search.setVisible(false);
    this.renderer?.setRegionSelectionEnabled(false);
    this.saveImage = new SaveImageController(this.uiContainer, this.settings, {
      onExit: () => this.finishSaveImageMode(),
      onLayoutChange: (layout) => this.applySaveImageLayout(layout),
      onFontScaleChange: (scale) => this.applySaveImageFontScale(scale),
    });
    this.renderer?.resetToInitialView();
  }

  private finishSaveImageMode(): void {
    if (!this.saveImage) return;
    this.saveImage.destroy();
    this.saveImage = null;
    this.saveImageFontScale = 1;
    this.renderer?.setSaveImageFontScale(1);
    this.renderer?.setRegionSelectionEnabled(true);
    this.restoreMapViewport();
    this.settings.setButtonVisible(true);
    this.search.setVisible(true);
  }

  private applySaveImageLayout(layout: SaveImageModeLayout): void {
    this.mapContainer.style.left = '0';
    this.mapContainer.style.top = '0';
    this.mapContainer.style.right = 'auto';
    this.mapContainer.style.bottom = 'auto';
    this.mapContainer.style.width = `${layout.mapRect.width}px`;
    this.mapContainer.style.height = `${layout.mapRect.height}px`;
    this.applyInfoRectangleMode(layout.mapRect.width, layout.mapRect.height);
    this.renderer?.resize(layout.mapRect.width, layout.mapRect.height, {
      resetCardLayout: true,
    });
  }

  private applySaveImageFontScale(scale: number): void {
    this.saveImageFontScale = scale;
    this.renderer?.setSaveImageFontScale(scale);
  }

  private restoreMapViewport(): void {
    this.mapContainer.style.left = '';
    this.mapContainer.style.top = '';
    this.mapContainer.style.right = '';
    this.mapContainer.style.bottom = '';
    this.mapContainer.style.width = '';
    this.mapContainer.style.height = '';
    this.applyInfoRectangleMode(window.innerWidth, window.innerHeight);
    this.renderer?.resize(window.innerWidth, window.innerHeight);
  }

  private applyInfoRectangleMode(width: number, height: number): void {
    const nextMode = getInfoRectangleMode(width, height);
    if (nextMode === this.infoRectangleMode) return;
    this.finishInfoRectangleEditing();
    this.infoRectangleMode = nextMode;
    this.infoRectanglePlacement = getDefaultInfoRectanglePlacement(width, height);
    this.renderer?.setInfoRectanglePlacement(this.infoRectanglePlacement);
    this.details.setInfoRectanglePlacement(this.infoRectanglePlacement);
  }

  private finishInfoRectangleEditing(): void {
    if (!this.infoRectangleEditing) return;
    this.infoRectangleEditing = false;
    this.renderer?.setInfoRectangleEditing(false);
    this.infoRectangleEditor.close();
    if (this.saveImage) {
      this.saveImage.setVisible(true);
    } else {
      this.settings.setButtonVisible(true);
      this.search.setVisible(true);
    }
  }

  private resetInfoRectanglePlacement(): void {
    const mainViewport = this.viewState.getSnapshot().viewport;
    const mapRect = this.saveImage?.getLayout().mapRect;
    const width = mapRect?.width ?? mainViewport.width;
    const height = mapRect?.height ?? mainViewport.height;
    const placement = getDefaultInfoRectanglePlacement(width, height);
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
