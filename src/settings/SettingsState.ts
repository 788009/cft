import type {
  CardGroupingMode,
  MapInteractionMode,
  ThemeMode,
} from '@/config';

export interface AppSettingsState {
  interactionMode: MapInteractionMode;
  themeMode: ThemeMode;
  backgroundFile: File | null;
  cardGroupingMode: CardGroupingMode;
  showRegionNames: boolean;
  onlyShowRegionNamesWithSchools: boolean;
  showInfoRectangle: boolean;
  showMiddleSchool: boolean;
  enableLocalLayoutOptimization: boolean;
}

export type SettingsStateListener = (state: Readonly<AppSettingsState>) => void;

export class SettingsStateStore {
  private state: AppSettingsState;
  private readonly listeners = new Set<SettingsStateListener>();

  constructor(initialState: AppSettingsState) {
    this.state = { ...initialState };
  }

  public getSnapshot(): Readonly<AppSettingsState> {
    return { ...this.state };
  }

  public update(patch: Partial<AppSettingsState>): Readonly<AppSettingsState> {
    const changed = Object.entries(patch).some(([key, value]) => (
      this.state[key as keyof AppSettingsState] !== value
    ));
    if (!changed) return this.getSnapshot();
    this.state = { ...this.state, ...patch };
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  public subscribe(listener: SettingsStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
