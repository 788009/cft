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
import {
  SettingsStateStore,
  type AppSettingsState,
} from '@/settings/SettingsState';
import { SaveImageController } from '@/export/SaveImageController';
import type { SaveImageModeLayout } from '@/export/geometry';
import type { SaveImageStateSnapshot } from '@/export/SaveImageState';
import { exportMapToPng } from '@/export/PngExporter';
import type {
  SaveImageScene,
  SaveImageSceneSettings,
} from '@/export/SaveImageScene';
import type { RegionSelection } from '@/details/types';
import { RegionSaveImageScene } from '@/export/RegionSaveImageScene';
import { AppCache } from '@/cache/AppCache';

export function createDefaultAppSettings(
  width: number,
  height: number,
): AppSettingsState {
  return {
    interactionMode: defaultConfig.mapInteractionMode,
    themeMode: defaultConfig.themeMode,
    backgroundFile: null,
    cardGroupingMode: defaultConfig.cardGroupingMode,
    showRegionNames: defaultConfig.showRegionNames,
    onlyShowRegionNamesWithSchools: defaultConfig.onlyShowRegionNamesWithSchools,
    showInfoRectangle: defaultConfig.showInfoRectangle,
    showMiddleSchool: defaultConfig.showMiddleSchool,
    enableLocalLayoutOptimization: defaultConfig.enableLocalLayoutOptimization,
    infoRectanglePlacement: getDefaultInfoRectanglePlacement(width, height),
  };
}

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
  private readonly cache: AppCache;
  private interactionMode: MapInteractionMode;
  private cardGroupingMode: CardGroupingMode;
  private showRegionNames: boolean;
  private onlyShowRegionNamesWithSchools: boolean;
  private showInfoRectangle: boolean;
  private showMiddleSchool: boolean;
  private enableLocalLayoutOptimization: boolean;
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
  private saveImageScene: SaveImageScene | null = null;
  private saveImageStarting = false;
  private saveImageFontScale = 1;
  private saveImageVisualScale = 1;

  constructor(cache: AppCache, initialSettings: AppSettingsState) {
    this.cache = cache;
    this.interactionMode = initialSettings.interactionMode;
    this.cardGroupingMode = initialSettings.cardGroupingMode;
    this.showRegionNames = initialSettings.showRegionNames;
    this.onlyShowRegionNamesWithSchools = initialSettings.onlyShowRegionNamesWithSchools;
    this.showInfoRectangle = initialSettings.showInfoRectangle;
    this.showMiddleSchool = initialSettings.showMiddleSchool;
    this.enableLocalLayoutOptimization = initialSettings.enableLocalLayoutOptimization;
    this.mapContainer = this.requireElement('map-container');
    this.uiContainer = this.requireElement('ui-container');
    this.viewState = new ViewState(window.innerWidth, window.innerHeight);
    this.settingsState = new SettingsStateStore(initialSettings);
    this.infoRectanglePlacement = { ...initialSettings.infoRectanglePlacement };
    this.infoRectangleMode = getInfoRectangleMode(window.innerWidth, window.innerHeight);
    this.details = new DetailController(
      this.uiContainer,
      this.showRegionNames,
      this.onlyShowRegionNamesWithSchools,
      this.showInfoRectangle,
      this.infoRectanglePlacement,
      this.enableLocalLayoutOptimization,
      this.cardGroupingMode,
      (selection, data) => void this.beginRegionSaveImageMode(selection, data),
    );
    this.background = new BackgroundController(
      this.mapContainer,
      defaultConfig.backgroundImages,
    );
    this.background.setUploadedFile(initialSettings.backgroundFile);
    this.theme = new ThemeController(
      initialSettings.themeMode,
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
          this.syncSaveImageSceneSettings();
        },
        onThemeModeChange: (mode) => {
          this.theme.setMode(mode);
          this.syncSaveImageSceneAppearance();
        },
        onBackgroundImageChange: (file) => {
          this.background.setUploadedFile(file);
          this.syncSaveImageSceneAppearance();
        },
        onCardGroupingModeChange: (mode) => {
          this.cardGroupingMode = mode;
          this.renderer?.setCardGroupingMode(mode);
          this.details.setCardGroupingMode(mode);
          this.syncSaveImageSceneSettings();
        },
        onShowRegionNamesChange: (show) => {
          this.showRegionNames = show;
          this.renderer?.setShowRegionNames(show);
          this.details.setShowRegionNames(show);
          this.syncSaveImageSceneSettings();
        },
        onOnlyShowRegionNamesWithSchoolsChange: (only) => {
          this.onlyShowRegionNamesWithSchools = only;
          this.renderer?.setOnlyShowRegionNamesWithSchools(only);
          this.details.setOnlyShowRegionNamesWithSchools(only);
          this.syncSaveImageSceneSettings();
        },
        onShowInfoRectangleChange: (show) => {
          this.showInfoRectangle = show;
          this.renderer?.setShowInfoRectangle(show);
          this.details.setShowInfoRectangle(show);
          this.syncSaveImageSceneSettings();
        },
        onShowMiddleSchoolChange: (show) => {
          this.showMiddleSchool = show;
          this.renderer?.setShowMiddleSchool(show);
          this.syncSaveImageSceneSettings();
        },
        onLocalLayoutOptimizationChange: (enabled) => {
          this.enableLocalLayoutOptimization = enabled;
          this.renderer?.setLocalLayoutOptimizationEnabled(enabled);
          this.details.setLocalLayoutOptimizationEnabled(enabled);
          this.syncSaveImageSceneSettings();
        },
        onEditInfoRectangle: () => this.beginInfoRectangleEditing(),
        onSaveImage: () => this.beginSaveImageMode(),
        isCacheEnabled: () => this.cache.isEnabled(),
        onCacheEnabledChange: async (enabled) => {
          const reload = await this.cache.setEnabled(
            enabled,
            this.settingsState.getSnapshot(),
          );
          if (reload) window.location.reload();
        },
        onClearCache: async () => this.cache.clear(),
      },
    );
    this.cache.bindSettings(
      this.settingsState,
      (settings) => this.applyCachedSettings(settings),
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
    this.saveImageScene?.exit();
    this.saveImageScene = null;
    this.mapContainer.classList.remove('hidden');
    this.restoreMapViewport();
    this.details.closeAll();
    this.infoRectangleEditor.close();
    this.search.destroy();
    this.settings.destroy();
    this.theme.destroy();
    this.background.destroy();
    this.cache.destroy();
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
          this.settingsState.update({ infoRectanglePlacement: placement });
          this.details.setInfoRectanglePlacement(placement);
        },
      });
      this.renderer = renderer;
      renderer.setRegionSelectionEnabled(!this.saveImage);
      renderer.setSaveImageFontScale(this.saveImageFontScale);
      renderer.setSaveImageVisualScale(this.saveImageVisualScale);
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
    if ((!this.renderer && !this.saveImageScene) || this.infoRectangleEditing) return;
    this.infoRectangleEditing = true;
    if (!this.saveImageScene) this.details.closeAll();
    this.settings.setButtonVisible(false);
    this.search.setVisible(false);
    this.saveImage?.setVisible(false);
    if (this.saveImageScene) {
      this.saveImageScene.setInfoRectangleEditing(true);
    } else {
      this.renderer?.setInfoRectangleEditing(true);
    }
    this.infoRectangleEditor.open({
      onConfirm: () => this.finishInfoRectangleEditing(),
      onReset: () => this.resetInfoRectanglePlacement(),
    });
  }

  private beginSaveImageMode(): void {
    if (this.saveImage || !this.renderer) return;
    this.details.closeAll();
    this.finishInfoRectangleEditing();
    const scene: SaveImageScene = {
      applyLayout: (layout) => this.applySaveImageLayout(layout),
      setFontScale: (scale) => this.applySaveImageFontScale(scale),
      setVisualScale: (scale) => this.applySaveImageVisualScale(scale),
      setInfoRectangleEditing: (editing) => {
        this.renderer?.setInfoRectangleEditing(editing);
      },
      resetInfoRectangle: () => this.resetMainSaveImageInfoRectangle(),
      rearrangeCards: () => this.renderer?.rearrangeCards(),
      syncSettings: () => {},
      syncAppearance: () => {},
      resetView: () => this.renderer?.resetToInitialView(),
      save: (snapshot, onProgress, signal) => (
        this.saveMapImage(snapshot, onProgress, signal)
      ),
      exit: () => {
        this.saveImageFontScale = 1;
        this.saveImageVisualScale = 1;
        this.renderer?.setSaveImageFontScale(1);
        this.renderer?.setSaveImageVisualScale(1);
        this.restoreMapViewport();
        this.renderer?.resetToInitialView();
      },
    };
    this.openSaveImageScene(scene);
  }

  private finishSaveImageMode(): void {
    if (!this.saveImage) return;
    const scene = this.saveImageScene;
    this.saveImage.destroy();
    this.saveImage = null;
    this.finishInfoRectangleEditing();
    this.saveImageScene = null;
    scene?.exit();
    this.mapContainer.classList.remove('hidden');
    this.details.setRegionVisible(true);
    this.renderer?.setRegionSelectionEnabled(true);
    this.settings.setButtonVisible(true);
    this.search.setVisible(true);
  }

  private openSaveImageScene(scene: SaveImageScene): void {
    this.saveImageScene = scene;
    this.settings.setButtonVisible(false);
    this.search.setVisible(false);
    this.renderer?.setRegionSelectionEnabled(false);
    this.saveImage = new SaveImageController(this.uiContainer, this.settings, {
      onExit: () => this.finishSaveImageMode(),
      onLayoutChange: (layout) => scene.applyLayout(layout),
      onFontScaleChange: (scale) => scene.setFontScale(scale),
      onVisualScaleChange: (scale) => scene.setVisualScale(scale),
      onRearrangeCards: () => scene.rearrangeCards(),
      onSave: (snapshot, onProgress, signal) => (
        scene.save(snapshot, onProgress, signal)
      ),
    });
    scene.resetView();
  }

  private async beginRegionSaveImageMode(
    selection: RegionSelection,
    data: ProcessedData,
  ): Promise<void> {
    if (this.saveImage || this.saveImageStarting) return;
    this.saveImageStarting = true;
    this.details.setRegionVisible(false);
    this.mapContainer.classList.add('hidden');
    this.settings.setButtonVisible(false);
    this.search.setVisible(false);
    this.renderer?.setRegionSelectionEnabled(false);

    try {
      const scene = await RegionSaveImageScene.create({
        container: this.uiContainer,
        selection,
        data,
        settings: this.getSaveImageSceneSettings(),
        infoRectanglePlacement: this.infoRectanglePlacement,
        getBackground: () => this.getPngExportBackground(),
      });
      if (!this.started || this.saveImage) {
        scene.exit();
        this.mapContainer.classList.remove('hidden');
        this.details.setRegionVisible(true);
        this.settings.setButtonVisible(true);
        this.search.setVisible(true);
        this.renderer?.setRegionSelectionEnabled(true);
        return;
      }
      this.openSaveImageScene(scene);
    } catch (error) {
      this.mapContainer.classList.remove('hidden');
      this.details.setRegionVisible(true);
      this.settings.setButtonVisible(true);
      this.search.setVisible(true);
      this.renderer?.setRegionSelectionEnabled(true);
      console.error('地区保存图片模式加载失败:', error);
    } finally {
      this.saveImageStarting = false;
    }
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

  private applySaveImageVisualScale(scale: number): void {
    this.saveImageVisualScale = scale;
    this.renderer?.setSaveImageVisualScale(scale);
  }

  private async saveMapImage(
    snapshot: SaveImageStateSnapshot,
    onProgress: (progress: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) throw new Error('地图尚未加载完成');
    const data = await this.getData();
    const background = this.background.getSnapshot();
    const mapBackground = getComputedStyle(this.mapContainer).backgroundColor;
    const bodyBackground = getComputedStyle(document.body).backgroundColor;
    await exportMapToPng({
      width: snapshot.width,
      height: snapshot.height,
      fontScale: snapshot.fontScale,
      visualScale: snapshot.fontScale / snapshot.fontScaleMultiplier,
      data,
      mapSnapshot: renderer.getSnapshot(),
      settings: {
        cardGroupingMode: this.cardGroupingMode,
        interactionMode: this.interactionMode,
        showRegionNames: this.showRegionNames,
        onlyShowRegionNamesWithSchools: this.onlyShowRegionNamesWithSchools,
        showInfoRectangle: this.showInfoRectangle,
        showMiddleSchool: this.showMiddleSchool,
        enableLocalLayoutOptimization: this.enableLocalLayoutOptimization,
        infoRectanglePlacement: this.infoRectanglePlacement,
      },
      background: {
        color: mapBackground !== 'rgba(0, 0, 0, 0)' ? mapBackground : bodyBackground,
        imageUrl: background.imageUrl,
        fit: defaultConfig.export.defaultFit,
      },
      filename: `${defaultConfig.pageTitle}.png`,
      onProgress,
      signal,
    });
  }

  private getSaveImageSceneSettings(): SaveImageSceneSettings {
    return {
      cardGroupingMode: this.cardGroupingMode,
      interactionMode: this.interactionMode,
      showRegionNames: this.showRegionNames,
      onlyShowRegionNamesWithSchools: this.onlyShowRegionNamesWithSchools,
      showInfoRectangle: this.showInfoRectangle,
      showMiddleSchool: this.showMiddleSchool,
      enableLocalLayoutOptimization: this.enableLocalLayoutOptimization,
    };
  }

  private syncSaveImageSceneSettings(): void {
    this.saveImageScene?.syncSettings(this.getSaveImageSceneSettings());
  }

  private syncSaveImageSceneAppearance(): void {
    this.saveImageScene?.syncAppearance();
  }

  private getPngExportBackground() {
    const background = this.background.getSnapshot();
    const mapBackground = getComputedStyle(this.mapContainer).backgroundColor;
    const bodyBackground = getComputedStyle(document.body).backgroundColor;
    return {
      color: mapBackground !== 'rgba(0, 0, 0, 0)'
        ? mapBackground
        : bodyBackground,
      imageUrl: background.imageUrl,
      fit: defaultConfig.export.defaultFit,
    } as const;
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
    this.settingsState.update({ infoRectanglePlacement: this.infoRectanglePlacement });
    this.renderer?.setInfoRectanglePlacement(this.infoRectanglePlacement);
    this.details.setInfoRectanglePlacement(this.infoRectanglePlacement);
  }

  private finishInfoRectangleEditing(): void {
    if (!this.infoRectangleEditing) return;
    this.infoRectangleEditing = false;
    if (this.saveImageScene) {
      this.saveImageScene.setInfoRectangleEditing(false);
    } else {
      this.renderer?.setInfoRectangleEditing(false);
    }
    this.infoRectangleEditor.close();
    if (this.saveImage) {
      this.saveImage.setVisible(true);
    } else {
      this.settings.setButtonVisible(true);
      this.search.setVisible(true);
    }
  }

  private resetInfoRectanglePlacement(): void {
    if (this.saveImageScene) {
      this.saveImageScene.resetInfoRectangle();
      return;
    }
    const mainViewport = this.viewState.getSnapshot().viewport;
    const width = mainViewport.width;
    const height = mainViewport.height;
    const placement = getDefaultInfoRectanglePlacement(width, height);
    this.infoRectanglePlacement = placement;
    this.settingsState.update({ infoRectanglePlacement: placement });
    this.renderer?.setInfoRectanglePlacement(placement);
    this.details.setInfoRectanglePlacement(placement);
  }

  private resetMainSaveImageInfoRectangle(): void {
    const viewport = this.viewState.getSnapshot().viewport;
    const mapRect = this.saveImage?.getLayout().mapRect;
    const width = mapRect?.width ?? viewport.width;
    const height = mapRect?.height ?? viewport.height;
    const placement = getDefaultInfoRectanglePlacement(width, height);
    this.infoRectanglePlacement = placement;
    this.settingsState.update({ infoRectanglePlacement: placement });
    this.renderer?.setInfoRectanglePlacement(placement);
    this.details.setInfoRectanglePlacement(placement);
  }

  private requireElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`找不到容器: ${id}`);
    return element;
  }

  private applyCachedSettings(settings: AppSettingsState): void {
    this.settingsState.update(settings);
    this.interactionMode = settings.interactionMode;
    this.cardGroupingMode = settings.cardGroupingMode;
    this.showRegionNames = settings.showRegionNames;
    this.onlyShowRegionNamesWithSchools = settings.onlyShowRegionNamesWithSchools;
    this.showInfoRectangle = settings.showInfoRectangle;
    this.showMiddleSchool = settings.showMiddleSchool;
    this.enableLocalLayoutOptimization = settings.enableLocalLayoutOptimization;
    this.infoRectanglePlacement = { ...settings.infoRectanglePlacement };

    this.theme.setMode(settings.themeMode);
    this.background.setUploadedFile(settings.backgroundFile);
    this.renderer?.setInteractionMode(settings.interactionMode);
    this.renderer?.setCardGroupingMode(settings.cardGroupingMode);
    this.renderer?.setShowRegionNames(settings.showRegionNames);
    this.renderer?.setOnlyShowRegionNamesWithSchools(
      settings.onlyShowRegionNamesWithSchools,
    );
    this.renderer?.setShowInfoRectangle(settings.showInfoRectangle);
    this.renderer?.setShowMiddleSchool(settings.showMiddleSchool);
    this.renderer?.setLocalLayoutOptimizationEnabled(
      settings.enableLocalLayoutOptimization,
    );
    this.renderer?.setInfoRectanglePlacement(settings.infoRectanglePlacement);
    this.details.setCardGroupingMode(settings.cardGroupingMode);
    this.details.setShowRegionNames(settings.showRegionNames);
    this.details.setOnlyShowRegionNamesWithSchools(
      settings.onlyShowRegionNamesWithSchools,
    );
    this.details.setShowInfoRectangle(settings.showInfoRectangle);
    this.details.setLocalLayoutOptimizationEnabled(
      settings.enableLocalLayoutOptimization,
    );
    this.details.setInfoRectanglePlacement(settings.infoRectanglePlacement);
    this.syncSaveImageSceneSettings();
    this.syncSaveImageSceneAppearance();
  }
}
