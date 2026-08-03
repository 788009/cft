import { defaultConfig } from '@/config';

export type MapLevel = 'province' | 'city' | 'district';

export class LevelManager {
  private currentLevel: MapLevel = 'province';

  public update(k: number): MapLevel {
    const { kThresholds } = defaultConfig;

    if (this.currentLevel === 'province') {
      if (k >= kThresholds.cityHysteresisIn) {
        this.currentLevel = 'city';
      }
    } else if (this.currentLevel === 'city') {
      if (k < kThresholds.cityHysteresisOut) {
        this.currentLevel = 'province';
      } else if (k >= kThresholds.districtHysteresisIn) {
        this.currentLevel = 'district';
      }
    } else if (this.currentLevel === 'district') {
      if (k < kThresholds.districtHysteresisOut) {
        this.currentLevel = 'city';
      }
    }

    return this.currentLevel;
  }

  public getLevel(): MapLevel {
    return this.currentLevel;
  }
}
