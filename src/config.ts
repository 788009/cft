export interface AppConfig {
  dataBasePath: string;
  infoRectangleWidthRatio: number;
  infoRectangleHeightRatio: number;
  canvasMargin: number;
  labelSpacing: number;
  layoutTransitionDurationMs: number;
  kThresholds: {
    city: number;
    district: number;
    cityHysteresisIn: number;
    cityHysteresisOut: number;
    districtHysteresisIn: number;
    districtHysteresisOut: number;
  };
  layoutWeights: {
    overlap: number;
    outOfBounds: number;
    anchorOcclusion: number;
    lineIntersection: number;
    distance: number;
    stability: number;
  };
  searchArrowMergeDistance: number;
  foreignCorner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  export: {
    defaultWidth: number;
    defaultHeight: number;
    minDimension: number;
    maxDimension: number;
    maxTotalPixels: number;
    defaultFit: 'cover' | 'contain';
  };
}

export const defaultConfig: AppConfig = {
  dataBasePath: '/data',
  infoRectangleWidthRatio: 0.5,
  infoRectangleHeightRatio: 0.5,
  canvasMargin: 20,
  labelSpacing: 8,
  layoutTransitionDurationMs: 200,
  kThresholds: {
    city: 2.5,
    district: 6.0,
    cityHysteresisIn: 2.7,
    cityHysteresisOut: 2.3,
    districtHysteresisIn: 6.3,
    districtHysteresisOut: 5.7,
  },
  layoutWeights: {
    overlap: 10000,
    outOfBounds: 5000,
    anchorOcclusion: 2000,
    lineIntersection: 1000,
    distance: 10,
    stability: 50,
  },
  searchArrowMergeDistance: 48,
  foreignCorner: 'top-right',
  export: {
    defaultWidth: 3840,
    defaultHeight: 2160,
    minDimension: 512,
    maxDimension: 8192,
    maxTotalPixels: 32000000,
    defaultFit: 'cover',
  },
};
