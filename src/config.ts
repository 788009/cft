export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type MapInteractionMode = 'stable' | 'hide-and-reflow';
export type CardGroupingMode = 'school' | 'region';
export type ThemeMode = 'system' | 'light' | 'dark';

export interface AppConfig {
  dataBasePath: string;
  infoRectangleWidthRatio: number;
  infoRectangleHeightRatio: number;
  infoRectangleEditor: {
    minWidth: number;
    minHeight: number;
    handleSize: number;
    handleHitSize: number;
  };
  initialSchoolExtentRatio: number;
  mapZoomExtent: {
    min: number;
    max: number;
  };
  canvasMargin: number;
  labelSpacing: number;
  layoutTransitionDurationMs: number;
  labelScale: {
    min: number;
    step: number;
  };
  lineFan: {
    sharedAnchorTolerance: number;
    minimumAngleDegrees: number;
  };
  labelStyle: {
    minWidth: number;
    maxWidth: number;
    regionColumnGap: number;
    studentColumnGap: number;
    paddingX: number;
    paddingY: number;
    lineHeight: number;
    regionFontSize: number;
    universityFontSize: number;
    studentFontSize: number;
    studentsPerRow: number;
    anchorRadius: number;
  };
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
    directionAlignment: number;
    lineCrowding: number;
    lineIntersection: number;
    lineOcclusion: number;
    infoEdgeDistance: number;
    distance: number;
    stability: number;
  };
  searchSuggestionLimit: number;
  searchControl: {
    corner: Corner;
    desktopWidth: number;
    compactBreakpoint: number;
    compactExpandedWidth: number;
    controlSize: number;
    viewportMargin: number;
    siblingGap: number;
  };
  searchArrowMergeDistance: number;
  searchArrowHitSize: number;
  foreignCorner: Corner;
  settingsButtonCorner: Corner;
  mapInteractionMode: MapInteractionMode;
  cardGroupingMode: CardGroupingMode;
  themeMode: ThemeMode;
  showRegionNames: boolean;
  onlyShowRegionNamesWithSchools: boolean;
  showInfoRectangle: boolean;
  showMiddleSchool: boolean;
  enableLocalLayoutOptimization: boolean;
  middleSchoolStyle: {
    markerRadius: number;
    haloRadius: number;
    lineMinWidth: number;
    lineMaxWidth: number;
    lineLogarithmicStep: number;
    lineInnerGlowSpread: number;
    lineOuterGlowSpread: number;
  };
  regionLabelFontSize: number;
  export: {
    defaultWidth: number;
    defaultHeight: number;
    minDimension: number;
    maxDimension: number;
    maxTotalPixels: number;
    defaultFit: 'cover' | 'contain';
  };
}

export function resolveDataBasePath(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/data`;
}

export const defaultConfig: AppConfig = {
  dataBasePath: resolveDataBasePath(import.meta.env.BASE_URL),
  infoRectangleWidthRatio: 0.5,
  infoRectangleHeightRatio: 0.5,
  infoRectangleEditor: {
    minWidth: 120,
    minHeight: 80,
    handleSize: 12,
    handleHitSize: 44,
  },
  initialSchoolExtentRatio: 0.8,
  mapZoomExtent: {
    min: 1,
    max: 20,
  },
  canvasMargin: 20,
  labelSpacing: 4,
  layoutTransitionDurationMs: 200,
  labelScale: {
    min: 0.5,
    step: 0.1,
  },
  lineFan: {
    sharedAnchorTolerance: 2,
    minimumAngleDegrees: 8,
  },
  labelStyle: {
    minWidth: 80,
    maxWidth: 224,
    regionColumnGap: 12,
    studentColumnGap: 6,
    paddingX: 5,
    paddingY: 7,
    lineHeight: 15,
    regionFontSize: 14,
    universityFontSize: 12,
    studentFontSize: 11,
    studentsPerRow: 2,
    anchorRadius: 3,
  },
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
    anchorOcclusion: 0,
    directionAlignment: 80,
    lineCrowding: 50,
    lineIntersection: 10,
    lineOcclusion: 30,
    infoEdgeDistance: 20,
    distance: 100,
    stability: 0,
  },
  searchSuggestionLimit: 8,
  searchControl: {
    corner: 'top-left',
    desktopWidth: 448,
    compactBreakpoint: 960,
    compactExpandedWidth: 320,
    controlSize: 44,
    viewportMargin: 12,
    siblingGap: 8,
  },
  searchArrowMergeDistance: 48,
  searchArrowHitSize: 44,
  foreignCorner: 'top-right',
  settingsButtonCorner: 'top-left',
  mapInteractionMode: 'stable',
  cardGroupingMode: 'region',
  themeMode: 'system',
  showRegionNames: true,
  onlyShowRegionNamesWithSchools: true,
  showInfoRectangle: false,
  showMiddleSchool: true,
  enableLocalLayoutOptimization: false,
  middleSchoolStyle: {
    markerRadius: 3.5,
    haloRadius: 7,
    lineMinWidth: 1.5,
    lineMaxWidth: 6,
    lineLogarithmicStep: 1.1,
    lineInnerGlowSpread: 4,
    lineOuterGlowSpread: 9,
  },
  regionLabelFontSize: 11,
  export: {
    defaultWidth: 3840,
    defaultHeight: 2160,
    minDimension: 512,
    maxDimension: 8192,
    maxTotalPixels: 32000000,
    defaultFit: 'cover',
  },
};

// 地图样式配置项
export const MAP_STYLES = {
  // 省级边界
  provincesBorder: {
    stroke: '#6b7280',
    strokeWidth: 0.4,
  },
  // 十段线
  tenDash: {
    stroke: '#6b7280',
    strokeWidth: 1.2,
  },
  // 地级市轮廓
  cities: {
    stroke: '#a1a1aa',
    strokeWidth: 0.3,
  },
  // 区县轮廓
  districts: {
    stroke: '#a1a1aa',
    strokeWidth: 0.2,
  },
};
