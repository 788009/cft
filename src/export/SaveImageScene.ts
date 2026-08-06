import type { CardGroupingMode, MapInteractionMode } from '@/config';
import type { SaveImageModeLayout } from './geometry';
import type { SaveImageStateSnapshot } from './SaveImageState';

export interface SaveImageSceneSettings {
  cardGroupingMode: CardGroupingMode;
  interactionMode: MapInteractionMode;
  showRegionNames: boolean;
  onlyShowRegionNamesWithSchools: boolean;
  showInfoRectangle: boolean;
  showMiddleSchool: boolean;
  enableLocalLayoutOptimization: boolean;
}

export interface SaveImageScene {
  applyLayout: (layout: SaveImageModeLayout) => void;
  setFontScale: (scale: number) => void;
  setVisualScale: (scale: number) => void;
  setInfoRectangleEditing: (editing: boolean) => void;
  resetInfoRectangle: () => void;
  rearrangeCards: () => void;
  syncSettings: (settings: SaveImageSceneSettings) => void;
  syncAppearance: () => void;
  resetView: () => void;
  save: (
    snapshot: SaveImageStateSnapshot,
    onProgress: (progress: number) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  exit: () => void;
}
