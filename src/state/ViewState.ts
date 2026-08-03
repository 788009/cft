import type { MapLevel } from '@/map/LevelManager';

export interface ViewportState {
  width: number;
  height: number;
  orientation: 'landscape' | 'portrait';
}

export interface MapViewState {
  x: number;
  y: number;
  k: number;
  level: MapLevel;
}

export interface ViewStateSnapshot {
  viewport: ViewportState;
  map: MapViewState;
}

type ViewStateListener = (snapshot: ViewStateSnapshot) => void;

function orientationFor(width: number, height: number): ViewportState['orientation'] {
  return height > width ? 'portrait' : 'landscape';
}

export class ViewState {
  private snapshot: ViewStateSnapshot;
  private readonly listeners = new Set<ViewStateListener>();

  constructor(width: number, height: number) {
    this.snapshot = {
      viewport: { width, height, orientation: orientationFor(width, height) },
      map: { x: 0, y: 0, k: 1, level: 'province' },
    };
  }

  public getSnapshot(): ViewStateSnapshot {
    return {
      viewport: { ...this.snapshot.viewport },
      map: { ...this.snapshot.map },
    };
  }

  public updateViewport(width: number, height: number): void {
    const nextViewport: ViewportState = { width, height, orientation: orientationFor(width, height) };
    const current = this.snapshot.viewport;
    if (
      current.width === nextViewport.width &&
      current.height === nextViewport.height &&
      current.orientation === nextViewport.orientation
    ) {
      return;
    }

    this.snapshot = { ...this.snapshot, viewport: nextViewport };
    this.emit();
  }

  public updateMap(map: MapViewState): void {
    const current = this.snapshot.map;
    if (current.x === map.x && current.y === map.y && current.k === map.k && current.level === map.level) {
      return;
    }

    this.snapshot = { ...this.snapshot, map: { ...map } };
    this.emit();
  }

  public subscribe(listener: ViewStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
