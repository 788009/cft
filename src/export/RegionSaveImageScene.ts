import type { ProcessedData } from '@/types';
import type { RegionSelection } from '@/details/types';
import type { InfoRectanglePlacement } from '@/map/InfoRectangle';
import { RegionDetailRenderer } from '@/map/RegionDetailRenderer';
import type { SaveImageModeLayout } from './geometry';
import { exportRegionToPng, type PngExportBackground } from './PngExporter';
import type {
  SaveImageScene,
  SaveImageSceneSettings,
} from './SaveImageScene';
import type { SaveImageStateSnapshot } from './SaveImageState';

interface RegionSaveImageSceneOptions {
  container: HTMLElement;
  selection: RegionSelection;
  data: ProcessedData;
  settings: SaveImageSceneSettings;
  infoRectanglePlacement: InfoRectanglePlacement;
  getBackground: () => PngExportBackground;
}

export class RegionSaveImageScene implements SaveImageScene {
  private readonly host: HTMLDivElement;
  private readonly renderer: RegionDetailRenderer;
  private readonly selection: RegionSelection;
  private readonly data: ProcessedData;
  private readonly getBackground: () => PngExportBackground;
  private appliedSettings: SaveImageSceneSettings;
  private exited = false;

  private constructor(
    options: RegionSaveImageSceneOptions,
    host: HTMLDivElement,
    renderer: RegionDetailRenderer,
  ) {
    this.host = host;
    this.renderer = renderer;
    this.selection = options.selection;
    this.data = options.data;
    this.getBackground = options.getBackground;
    this.appliedSettings = options.settings;
  }

  public static async create(
    options: RegionSaveImageSceneOptions,
  ): Promise<RegionSaveImageScene> {
    const host = document.createElement('div');
    host.dataset.testid = 'region-save-image-map';
    host.className = [
      'pointer-events-auto absolute left-0 top-0 z-20 overflow-hidden',
      'bg-gray-50 dark:bg-slate-950',
    ].join(' ');
    host.style.width = `${window.innerWidth}px`;
    host.style.height = `${window.innerHeight}px`;
    options.container.append(host);

    const renderer = new RegionDetailRenderer(
      host,
      undefined,
      options.settings.showRegionNames,
      options.settings.onlyShowRegionNamesWithSchools,
      options.settings.showInfoRectangle,
      options.infoRectanglePlacement,
      options.settings.enableLocalLayoutOptimization,
      options.settings.cardGroupingMode,
      true,
      true,
      options.settings.interactionMode,
    );
    const scene = new RegionSaveImageScene(options, host, renderer);
    scene.syncAppearance();
    try {
      await renderer.render(options.selection, options.data);
      return scene;
    } catch (error) {
      scene.exit();
      throw error;
    }
  }

  public applyLayout(layout: SaveImageModeLayout): void {
    this.host.style.width = `${layout.mapRect.width}px`;
    this.host.style.height = `${layout.mapRect.height}px`;
    this.renderer.rearrangeCards();
  }

  public setFontScale(scale: number): void {
    this.renderer.setFontScale(scale);
  }

  public setVisualScale(scale: number): void {
    this.renderer.setVisualScale(scale);
  }

  public setInfoRectangleEditing(editing: boolean): void {
    this.renderer.setInfoRectangleEditing(editing);
  }

  public resetInfoRectangle(): void {
    this.renderer.resetInfoRectangle();
  }

  public rearrangeCards(): void {
    this.renderer.rearrangeCards();
  }

  public syncSettings(settings: SaveImageSceneSettings): void {
    const previous = this.appliedSettings;
    if (settings.showRegionNames !== previous.showRegionNames) {
      this.renderer.setShowRegionNames(settings.showRegionNames);
    }
    if (
      settings.onlyShowRegionNamesWithSchools !==
        previous.onlyShowRegionNamesWithSchools
    ) {
      this.renderer.setOnlyShowRegionNamesWithSchools(
        settings.onlyShowRegionNamesWithSchools,
      );
    }
    if (settings.showInfoRectangle !== previous.showInfoRectangle) {
      this.renderer.setShowInfoRectangle(settings.showInfoRectangle);
    }
    if (settings.cardGroupingMode !== previous.cardGroupingMode) {
      this.renderer.setCardGroupingMode(settings.cardGroupingMode);
    }
    if (settings.interactionMode !== previous.interactionMode) {
      this.renderer.setInteractionMode(settings.interactionMode);
    }
    if (
      settings.enableLocalLayoutOptimization !==
        previous.enableLocalLayoutOptimization
    ) {
      this.renderer.setLocalLayoutOptimizationEnabled(
        settings.enableLocalLayoutOptimization,
      );
    }
    this.appliedSettings = settings;
  }

  public syncAppearance(): void {
    const { imageUrl } = this.getBackground();
    this.host.style.backgroundImage = imageUrl ? `url("${imageUrl}")` : '';
    this.host.style.backgroundSize = imageUrl ? 'cover' : '';
    this.host.style.backgroundPosition = imageUrl ? 'center center' : '';
    this.host.style.backgroundRepeat = imageUrl ? 'no-repeat' : '';
  }

  public resetView(): void {
    this.renderer.resetView();
  }

  public async save(
    snapshot: SaveImageStateSnapshot,
    onProgress: (progress: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const regionSnapshot = this.renderer.getSnapshot();
    await exportRegionToPng({
      width: snapshot.width,
      height: snapshot.height,
      fontScale: snapshot.fontScale,
      visualScale: snapshot.fontScale / snapshot.fontScaleMultiplier,
      data: this.data,
      selection: this.selection,
      regionSnapshot,
      settings: {
        ...this.appliedSettings,
        infoRectanglePlacement: regionSnapshot.infoRectanglePlacement,
      },
      background: this.getBackground(),
      filename: `${this.selection.name}.png`,
      onProgress,
      signal,
    });
  }

  public exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.renderer.destroy();
    this.host.remove();
  }
}
