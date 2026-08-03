import { defaultConfig } from '@/config';

export type MapLevel = 'province' | 'city' | 'district';

export interface LevelAvailability {
  city: boolean;
  district: boolean;
}

export class LevelManager {
  private currentLevel: MapLevel = 'province';
  private availability: LevelAvailability = { city: true, district: true };

  public update(k: number): MapLevel {
    const { kThresholds } = defaultConfig;

    if (!this.availability.city) {
      this.currentLevel = 'province';
      return this.currentLevel;
    }

    if (this.currentLevel === 'province') {
      if (this.availability.district && k >= kThresholds.districtHysteresisIn) {
        this.currentLevel = 'district';
      } else if (k >= kThresholds.cityHysteresisIn) {
        this.currentLevel = 'city';
      }
    } else if (this.currentLevel === 'city') {
      if (k < kThresholds.cityHysteresisOut) {
        this.currentLevel = 'province';
      } else if (this.availability.district && k >= kThresholds.districtHysteresisIn) {
        this.currentLevel = 'district';
      }
    } else if (this.currentLevel === 'district') {
      if (!this.availability.district || k < kThresholds.cityHysteresisOut) {
        this.currentLevel = k < kThresholds.cityHysteresisOut ? 'province' : 'city';
      } else if (k < kThresholds.districtHysteresisOut) {
        this.currentLevel = 'city';
      }
    }

    return this.currentLevel;
  }

  public getLevel(): MapLevel {
    return this.currentLevel;
  }

  public setAvailability(availability: Partial<LevelAvailability>): MapLevel {
    this.availability = { ...this.availability, ...availability };
    if (!this.availability.city) this.currentLevel = 'province';
    else if (!this.availability.district && this.currentLevel === 'district') this.currentLevel = 'city';
    return this.currentLevel;
  }
}
