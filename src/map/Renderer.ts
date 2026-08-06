import * as d3 from 'd3';
import { createProjection, getProjectedPoint } from './projection';
import { LevelManager, type MapLevel } from './LevelManager';
import { loadGeoJSON } from '@/data/fetcher';
import {
  MAP_STYLES,
  defaultConfig,
  type CardGroupingMode,
  type MapInteractionMode,
} from '@/config';
import type { ProcessedData, Student } from '@/types';
import type { MapViewState } from '@/state/ViewState';
import { SchoolOverlay } from './SchoolOverlay';
import { getInfoRectangle, type InfoRectanglePlacement } from './InfoRectangle';
import { calculateInitialMapTransform } from './InitialView';
import { rewindFeature } from './geo';
import type { RegionSelection } from '@/details/types';
import {
  getRegionAdcodesWithSchools,
  getRegionFeatureLabelLevel,
  getRegionLabelIdentity,
  type RegionLabelLevel,
} from './RegionLabels';
import { parseGeoJsonCenter, type RegionCenter } from './RegionCards';
import type { SearchResult } from '@/logic/search';
import type { Rect } from '@/logic/layout';

interface RegionLabelDatum {
  feature: any;
  adcode: string;
  name: string;
  hasSchools: boolean;
  level: RegionLabelLevel;
}

export interface MapRendererOptions {
  onViewChange?: (view: MapViewState) => void;
  onRegionSelect?: (selection: RegionSelection) => void;
  onStudentSelect?: (student: Student) => void;
  interactionMode?: MapInteractionMode;
  cardGroupingMode?: CardGroupingMode;
  showRegionNames?: boolean;
  onlyShowRegionNamesWithSchools?: boolean;
  showInfoRectangle?: boolean;
  showMiddleSchool?: boolean;
  enableLocalLayoutOptimization?: boolean;
  infoRectanglePlacement?: InfoRectanglePlacement;
  onInfoRectanglePlacementChange?: (placement: InfoRectanglePlacement) => void;
}

export class MapRenderer {
  private container: HTMLElement;
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private g: d3.Selection<SVGGElement, unknown, null, undefined>;
  private projection: d3.GeoProjection;
  private pathGenerator: d3.GeoPath;
  private zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown>;
  private levelManager: LevelManager;
  private destroyed = false;
  private readonly onViewChange?: (view: MapViewState) => void;
  private readonly onRegionSelect?: (selection: RegionSelection) => void;
  
  private validProvinces = new Set<string>();
  private validCities = new Set<string>();
  private readonly provinceNames = new Map<string, string>();
  private readonly cityNames = new Map<string, string>();
  private geoCache = new Map<string, any>();
  
  private requestedLevel: MapLevel = 'province';
  private transitionVersion = 0;
  private citiesRenderPromise: Promise<boolean> | null = null;
  private districtsRenderPromise: Promise<boolean> | null = null;
  private currentTransform = d3.zoomIdentity;
  private zoomInteractionChanged = false;
  private applyingInitialView = false;
  private initialViewApplied = false;
  private baseMapRendered = false;
  private dataReady = false;
  private interactionMode: MapInteractionMode;
  private cardGroupingMode: CardGroupingMode;
  private showRegionNames: boolean;
  private onlyShowRegionNamesWithSchools: boolean;
  private domesticSchools: ProcessedData['domesticSchools'] = [];
  private readonly schoolOverlay: SchoolOverlay;
  private infoRectangleEditing = false;
  private regionSelectionEnabled = true;
  private width: number;
  private height: number;
  private saveImageFontScale = 1;

  private layers: {
    provincesFill: d3.Selection<SVGGElement, unknown, null, undefined>;
    cities: d3.Selection<SVGGElement, unknown, null, undefined>;
    districts: d3.Selection<SVGGElement, unknown, null, undefined>;
    provincesBorder: d3.Selection<SVGGElement, unknown, null, undefined>;
    tendash: d3.Selection<SVGGElement, unknown, null, undefined>;
    provinceLabels: d3.Selection<SVGGElement, unknown, null, undefined>;
    cityLabels: d3.Selection<SVGGElement, unknown, null, undefined>;
    districtLabels: d3.Selection<SVGGElement, unknown, null, undefined>;
  };
  
  constructor(containerId: string, options: MapRendererOptions = {}) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`找不到容器: ${containerId}`);
    this.container = el;
    this.onViewChange = options.onViewChange;
    this.onRegionSelect = options.onRegionSelect;
    this.interactionMode = options.interactionMode ?? defaultConfig.mapInteractionMode;
    this.cardGroupingMode = options.cardGroupingMode ?? defaultConfig.cardGroupingMode;
    this.showRegionNames = options.showRegionNames ?? defaultConfig.showRegionNames;
    this.onlyShowRegionNamesWithSchools = options.onlyShowRegionNamesWithSchools
      ?? defaultConfig.onlyShowRegionNamesWithSchools;

    const { width, height } = this.container.getBoundingClientRect();
    this.width = width;
    this.height = height;
    
    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('data-map-level', 'province')
      .style('display', 'block')
      .style('touch-action', 'none');

    this.g = this.svg.append('g').attr('class', 'map-geometry');

    this.layers = {
      provincesFill: this.g.append('g').attr('class', 'layer-provinces-fill'),
      cities: this.g.append('g').attr('class', 'layer-cities').style('opacity', 0).style('pointer-events', 'none'),
      districts: this.g.append('g').attr('class', 'layer-districts').style('opacity', 0).style('pointer-events', 'none'),
      provincesBorder: this.g.append('g').attr('class', 'layer-provinces-border').style('pointer-events', 'none'),
      tendash: this.g.append('g').attr('class', 'layer-tendash').style('pointer-events', 'none'),
      provinceLabels: this.g.append('g').attr('class', 'layer-province-labels').style('pointer-events', 'none'),
      cityLabels: this.g.append('g').attr('class', 'layer-city-labels').style('pointer-events', 'none'),
      districtLabels: this.g.append('g').attr('class', 'layer-district-labels').style('pointer-events', 'none'),
    };
    this.schoolOverlay = new SchoolOverlay(this.svg, {
      onStudentSelect: options.onStudentSelect,
      showInfoRectangle: options.showInfoRectangle,
      infoRectanglePlacement: options.infoRectanglePlacement,
      onInfoRectanglePlacementChange: options.onInfoRectanglePlacementChange,
      enableLocalLayoutOptimization: options.enableLocalLayoutOptimization,
      showMiddleSchool: options.showMiddleSchool,
    });
    this.schoolOverlay.setCardGroupingMode(this.cardGroupingMode);

    this.projection = createProjection(width, height);
    this.pathGenerator = d3.geoPath().projection(this.projection);
    this.levelManager = new LevelManager();

    this.zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .filter((event: Event) => this.shouldHandleMapNavigation(event))
      .scaleExtent([defaultConfig.mapZoomExtent.min, defaultConfig.mapZoomExtent.max])
      .on('start', () => this.handleZoomStart())
      .on('zoom', (event) => this.handleZoom(event))
      .on('end', () => this.handleZoomEnd());

    this.svg.call(this.zoomBehavior);
  }

  public setData(data: ProcessedData) {
    this.validProvinces.clear();
    this.validCities.clear();
    this.provinceNames.clear();
    this.cityNames.clear();
    this.domesticSchools = data.domesticSchools;
    this.dataReady = true;
    
    for (const school of data.domesticSchools) {
      if (school.provinceAdcode) this.validProvinces.add(String(school.provinceAdcode));
      if (school.cityAdcode) this.validCities.add(String(school.cityAdcode));
      if (school.provinceAdcode) this.provinceNames.set(String(school.provinceAdcode), school.province);
      if (school.cityAdcode) this.cityNames.set(String(school.cityAdcode), school.city);
    }
    this.schoolOverlay.setData(data);
    if (this.baseMapRendered) this.applyInitialView();
  }

  public setInteractionMode(mode: MapInteractionMode): void {
    if (mode === this.interactionMode) return;
    this.interactionMode = mode;
    this.schoolOverlay.resetLayout();
    this.updateSchoolOverlay();
  }

  public setSearchResult(result: SearchResult): void {
    this.schoolOverlay.setSearchResult(result);
    this.updateSchoolOverlay();
  }

  public setUiObstacles(obstacles: Rect[]): void {
    if (!this.schoolOverlay.setUiObstacles(obstacles)) return;
    this.updateSchoolOverlay();
  }

  public setCardGroupingMode(mode: CardGroupingMode): void {
    if (mode === this.cardGroupingMode) return;
    this.cardGroupingMode = mode;
    this.schoolOverlay.setCardGroupingMode(mode);
    this.schoolOverlay.setMapLevel(this.requestedLevel);
    this.schoolOverlay.resetLayout();
    this.updateSchoolOverlay();
  }

  public setShowRegionNames(show: boolean): void {
    this.showRegionNames = show;
    this.updateRegionLabelVisibility();
  }

  public setOnlyShowRegionNamesWithSchools(only: boolean): void {
    this.onlyShowRegionNamesWithSchools = only;
    this.updateRegionLabelFilter();
  }

  public setShowInfoRectangle(show: boolean): void {
    this.schoolOverlay.setShowInfoRectangle(show);
  }

  public setShowMiddleSchool(show: boolean): void {
    this.schoolOverlay.setShowMiddleSchool(show);
    this.schoolOverlay.resetLayout();
    this.updateSchoolOverlay();
  }

  public setSaveImageFontScale(scale: number): void {
    const nextScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    if (nextScale === this.saveImageFontScale) return;
    this.saveImageFontScale = nextScale;
    this.schoolOverlay.setFontScale(this.saveImageFontScale);
    this.schoolOverlay.resetLayout();
    this.updateRegionLabelScale();
    this.updateSchoolOverlay();
  }

  public setRegionSelectionEnabled(enabled: boolean): void {
    if (enabled === this.regionSelectionEnabled) return;
    this.regionSelectionEnabled = enabled;
    this.g.selectAll<SVGPathElement, unknown>('path.region-actionable')
      .attr('role', enabled ? 'button' : null)
      .attr('tabindex', enabled ? 0 : null);
    this.updateRegionInteractionAvailability();
    if (!enabled) this.schoolOverlay.clearHoveredRegion();
  }

  public setSaveImageCardDraggingEnabled(enabled: boolean): void {
    this.schoolOverlay.setCardDraggingEnabled(enabled);
    this.updateSchoolOverlay();
  }

  public rearrangeCards(): void {
    this.schoolOverlay.resetLayout();
    this.updateSchoolOverlay();
  }

  public setLocalLayoutOptimizationEnabled(enabled: boolean): void {
    this.schoolOverlay.setLocalLayoutOptimizationEnabled(enabled);
    this.schoolOverlay.resetLayout();
    this.updateSchoolOverlay();
  }

  public setInfoRectanglePlacement(placement: InfoRectanglePlacement): void {
    this.schoolOverlay.setInfoRectanglePlacement(placement);
    if (this.infoRectangleEditing) return;
    this.schoolOverlay.resetLayout();
    this.updateSchoolOverlay();
  }

  public setInfoRectangleEditing(editing: boolean): void {
    if (editing === this.infoRectangleEditing) return;
    this.infoRectangleEditing = editing;
    this.schoolOverlay.setInfoRectangleEditing(editing);
    if (!editing) {
      this.schoolOverlay.resetLayout();
      this.updateSchoolOverlay();
    }
  }

  private handleZoomStart(): void {
    if (this.destroyed) return;
    this.zoomInteractionChanged = false;
  }

  private shouldHandleMapNavigation(event: Event): boolean {
    const inputEvent = event as MouseEvent;
    if ((inputEvent.ctrlKey && event.type !== 'wheel') || inputEvent.button) return false;
    const target = event.target;
    return !(
      target instanceof Element &&
      target.closest('[data-block-map-navigation="true"]')
    );
  }

  private handleZoom(event: d3.D3ZoomEvent<SVGSVGElement, unknown>) {
    if (this.destroyed) return;
    if (
      !this.applyingInitialView &&
      this.interactionMode === 'hide-and-reflow' &&
      !this.zoomInteractionChanged
    ) {
      this.zoomInteractionChanged = true;
      this.schoolOverlay.setInteractionActive(true);
    }
    this.currentTransform = event.transform;
    this.g.attr('transform', event.transform.toString());
    this.updateRegionLabelScale();
    if (!this.applyingInitialView && this.interactionMode === 'stable') {
      this.updateSchoolOverlay();
    } else if (!this.applyingInitialView) {
      this.schoolOverlay.updateSearchArrows(
        this.width,
        this.height,
        this.projection,
        this.currentTransform,
      );
      this.schoolOverlay.updateMiddleSchoolConnections(
        this.width,
        this.height,
        this.projection,
        this.currentTransform,
      );
    }
    const newLevel = this.levelManager.update(event.transform.k);
    this.emitViewChange(newLevel);

    if (newLevel !== this.requestedLevel) {
      this.schoolOverlay.clearHoveredRegion();
      if (this.cardGroupingMode === 'region' && this.interactionMode === 'stable') {
        this.schoolOverlay.setInteractionActive(true);
      }
      this.requestedLevel = newLevel;
      const version = ++this.transitionVersion;
      void this.updateLayerVisibility(newLevel, version);
    }
  }

  private handleZoomEnd(): void {
    if (
      this.destroyed ||
      this.applyingInitialView ||
      this.interactionMode !== 'hide-and-reflow' ||
      !this.zoomInteractionChanged
    ) return;
    this.schoolOverlay.resetLayout();
    this.updateSchoolOverlay();
    this.schoolOverlay.setInteractionActive(false);
  }

  public resize(
    width: number,
    height: number,
    options: { resetCardLayout?: boolean } = {},
  ): void {
    if (this.destroyed) return;
    this.width = width;
    this.height = height;
    this.svg.attr('viewBox', `0 0 ${width} ${height}`);
    this.projection = createProjection(width, height);
    this.pathGenerator = d3.geoPath().projection(this.projection);
    this.g.selectAll<SVGPathElement, unknown>('path').attr('d', this.pathGenerator as any);
    this.updateRegionLabelGeometry();
    if (options.resetCardLayout) this.schoolOverlay.resetLayout();
    this.updateSchoolOverlay();
  }

  public resetToInitialView(): void {
    if (this.destroyed) return;
    this.initialViewApplied = false;
    this.applyInitialView();
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.transitionVersion += 1;
    this.svg.on('.zoom', null);
    this.svg.interrupt();
    this.g.selectAll('*').interrupt();
    this.schoolOverlay.destroy();
    this.svg.remove();
  }

  private async fetchGeoJSON(path: string) {
    if (this.geoCache.has(path)) {
      return this.geoCache.get(path);
    }
    const data = await loadGeoJSON(path);
    this.geoCache.set(path, data);
    return data;
  }

  public async renderBaseMap() {
    try {
      const [provinces, tenDash] = await Promise.all([
        this.fetchGeoJSON('china_provinces.json'),
        this.fetchGeoJSON('10-dash.json')
      ]);
      if (this.destroyed) return;

      const fixedProvincesFeatures = provinces.features.map(rewindFeature);
      this.schoolOverlay.setRegionCenters(
        'province',
        this.getRegionCenters(fixedProvincesFeatures, 'province'),
      );
      this.schoolOverlay.setRegionCenters(
        'city',
        this.getMunicipalityCenters(fixedProvincesFeatures),
      );

      // 1. 省级色块填充
      this.layers.provincesFill.selectAll('path')
        .data(fixedProvincesFeatures)
        .enter()
        .append('path')
        .attr('d', this.pathGenerator as any)
        .attr('data-has-schools', (d: any) => (
          String(this.validProvinces.has(String(d.properties.province_adcode)))
        ))
        .attr('fill', (d: any) => {
          const adcode = String(d.properties.province_adcode);
          return this.validProvinces.has(adcode) ? '#ffffff' : '#e5e7eb';
        })
        .attr('stroke', 'none');
      this.bindRegionInteractions(this.layers.provincesFill.selectAll('path'), 'province');
      this.renderRegionLabels(this.layers.provinceLabels, fixedProvincesFeatures, 'province');

      // 2. 省级主边界
      this.layers.provincesBorder.selectAll('path')
        .data(fixedProvincesFeatures)
        .enter()
        .append('path')
        .attr('d', this.pathGenerator as any)
        .attr('fill', 'none')
        .attr('stroke', MAP_STYLES.provincesBorder.stroke)
        .attr('stroke-width', MAP_STYLES.provincesBorder.strokeWidth)
        .attr('vector-effect', 'non-scaling-stroke');

      // 3. 十段线
      this.layers.tendash.selectAll('path')
        .data(tenDash.features)
        .enter()
        .append('path')
        .attr('d', this.pathGenerator as any)
        .attr('stroke', MAP_STYLES.tenDash.stroke)
        .attr('stroke-width', MAP_STYLES.tenDash.strokeWidth)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('fill', 'none');

      this.baseMapRendered = true;
      this.applyInitialView();

    } catch (error) {
      console.error('基础地图渲染失败:', error);
    }
  }

  private async updateLayerVisibility(requestedLevel: MapLevel, version: number): Promise<void> {
    let level = requestedLevel;

    if (level === 'city' || level === 'district') {
      const hasCities = await this.renderCities();
      if (this.destroyed || version !== this.transitionVersion) return;
      if (!hasCities) {
        level = this.levelManager.setAvailability({ city: false, district: false });
      }
    }
    if (level === 'district') {
      const hasDistricts = await this.renderDistricts();
      if (this.destroyed || version !== this.transitionVersion) return;
      if (!hasDistricts) {
        level = this.levelManager.setAvailability({ district: false });
      }
    }

    if (this.destroyed || version !== this.transitionVersion) return;
    this.requestedLevel = level;
    if (this.cardGroupingMode === 'region') {
      this.schoolOverlay.setMapLevel(level);
      this.schoolOverlay.resetLayout();
      this.updateSchoolOverlay();
      if (this.interactionMode === 'stable') this.schoolOverlay.setInteractionActive(false);
    }
    this.svg.attr('data-map-level', level);
    this.emitViewChange(level);

    this.layers.cities.transition().duration(250)
      .style('opacity', level === 'city' || level === 'district' ? 1 : 0);
      
    this.layers.districts.transition().duration(250)
      .style('opacity', level === 'district' ? 1 : 0);
    this.updateRegionInteractionAvailability();
    this.updateRegionLabelVisibility();
  }

  private renderCities(): Promise<boolean> {
    if (this.layers.cities.selectAll('path').size() > 0) return Promise.resolve(true);
    if (this.citiesRenderPromise) return this.citiesRenderPromise;

    this.citiesRenderPromise = this.loadDetailFeatures('provinces', this.validProvinces).then((features) => {
      if (this.destroyed) return false;

      this.layers.cities.selectAll('path')
        .data(features)
        .enter()
        .append('path')
        .attr('d', (d: any) => this.pathGenerator(d))
        .attr('data-has-schools', (d: any) => {
          const p = d.properties;
          return String(this.validCities.has(String(p.city_adcode || p.adcode)));
        })
        .attr('fill', (d: any) => {
          const p = d.properties;
          const cityAdcode = String(p.city_adcode || p.adcode);
          return this.validCities.has(cityAdcode) ? '#ffffff' : '#e5e7eb';
        })
        .attr('stroke', MAP_STYLES.cities.stroke)
        .attr('stroke-width', MAP_STYLES.cities.strokeWidth)
        .attr('vector-effect', 'non-scaling-stroke');
      this.bindRegionInteractions(this.layers.cities.selectAll('path'), 'city');
      this.renderRegionLabels(this.layers.cityLabels, features, 'city');
      const centers = this.getRegionCenters(features, 'city');
      const municipalityCenters = this.getMunicipalityCenters(
        this.layers.provincesFill.selectAll<SVGPathElement, any>('path').data(),
      );
      for (const [adcode, center] of municipalityCenters) centers.set(adcode, center);
      this.schoolOverlay.setRegionCenters('city', centers);

      return features.length > 0;
    });

    return this.citiesRenderPromise;
  }

  private renderDistricts(): Promise<boolean> {
    if (this.layers.districts.selectAll('path').size() > 0) return Promise.resolve(true);
    if (this.districtsRenderPromise) return this.districtsRenderPromise;

    this.districtsRenderPromise = this.loadDetailFeatures('cities', this.validCities).then((features) => {
      if (this.destroyed) return false;

      this.layers.districts.selectAll('path')
        .data(features)
        .enter()
        .append('path')
        .attr('d', (d: any) => this.pathGenerator(d))
        .attr('fill', '#ffffff')
        .attr('stroke', MAP_STYLES.districts.stroke)
        .attr('stroke-width', MAP_STYLES.districts.strokeWidth)
        .attr('vector-effect', 'non-scaling-stroke');
      this.renderRegionLabels(this.layers.districtLabels, features, 'district');

      return features.length > 0;
    });

    return this.districtsRenderPromise;
  }

  private async loadDetailFeatures(directory: string, adcodes: Set<string>): Promise<any[]> {
    const featureGroups = await Promise.all(Array.from(adcodes, async (adcode) => {
      try {
        const data = await this.fetchGeoJSON(`${directory}/${adcode}.json`);
        return (data.features ?? []).map(rewindFeature);
      } catch {
        return [];
      }
    }));

    return featureGroups.flat();
  }

  private getRegionCenters(
    features: any[],
    level: 'province' | 'city',
  ): Map<string, RegionCenter> {
    const centers = new Map<string, RegionCenter>();
    for (const feature of features) {
      const properties = feature.properties ?? {};
      const adcode = String(level === 'province'
        ? properties.province_adcode ?? ''
        : properties.city_adcode ?? properties.adcode ?? '');
      if (!adcode || centers.has(adcode)) continue;
      const coordinates = parseGeoJsonCenter(properties.center);
      if (!coordinates) continue;
      const name = level === 'province'
        ? this.provinceNames.get(adcode)
        : this.cityNames.get(adcode) ?? String(properties.name ?? '');
      if (!name) continue;
      centers.set(adcode, {
        adcode,
        name,
        longitude: coordinates[0],
        latitude: coordinates[1],
      });
    }
    return centers;
  }

  private getMunicipalityCenters(features: any[]): Map<string, RegionCenter> {
    const centers = this.getRegionCenters(features, 'province');
    return new Map(Array.from(centers).filter(([adcode]) => this.validCities.has(adcode)));
  }

  private emitViewChange(level: MapLevel): void {
    this.onViewChange?.({
      x: this.currentTransform.x,
      y: this.currentTransform.y,
      k: this.currentTransform.k,
      level,
    });
  }

  private renderRegionLabels(
    layer: d3.Selection<SVGGElement, unknown, null, undefined>,
    features: any[],
    level: RegionLabelLevel,
  ): void {
    const adcodesWithSchools = new Map<RegionLabelLevel, Set<string>>([
      ['city', getRegionAdcodesWithSchools(features, 'city', this.domesticSchools)],
      ['district', getRegionAdcodesWithSchools(features, 'district', this.domesticSchools)],
      ['province', getRegionAdcodesWithSchools(features, 'province', this.domesticSchools)],
    ]);
    const data = features.flatMap((feature): RegionLabelDatum[] => {
      const featureLevel = getRegionFeatureLabelLevel(feature, level);
      const identity = getRegionLabelIdentity(feature, featureLevel);
      return identity ? [{
        feature,
        ...identity,
        level: featureLevel,
        hasSchools: adcodesWithSchools.get(featureLevel)?.has(identity.adcode) ?? false,
      }] : [];
    });
    layer.selectAll<SVGTextElement, RegionLabelDatum>('text.region-name-label')
      .data(data, (datum) => datum.adcode)
      .join('text')
      .attr('class', 'region-name-label')
      .attr('data-region-label-level', (datum) => datum.level)
      .attr('data-region-adcode', (datum) => datum.adcode)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('vector-effect', 'non-scaling-stroke')
      .text((datum) => datum.name);
    this.updateRegionLabelGeometry();
    this.updateRegionLabelFilter();
    this.updateRegionLabelVisibility();
  }

  private updateRegionLabelGeometry(): void {
    this.g.selectAll<SVGTextElement, RegionLabelDatum>('text.region-name-label')
      .attr('x', (datum) => this.pathGenerator.centroid(datum.feature)[0])
      .attr('y', (datum) => this.pathGenerator.centroid(datum.feature)[1])
      .attr('font-size', defaultConfig.regionLabelFontSize * this.saveImageFontScale / this.currentTransform.k)
      .style('visibility', (datum) => {
        const [x, y] = this.pathGenerator.centroid(datum.feature);
        return Number.isFinite(x) && Number.isFinite(y) ? null : 'hidden';
      });
  }

  private updateRegionLabelScale(): void {
    this.g.selectAll<SVGTextElement, RegionLabelDatum>('text.region-name-label')
      .attr('font-size', defaultConfig.regionLabelFontSize * this.saveImageFontScale / this.currentTransform.k);
  }

  private updateRegionLabelFilter(): void {
    this.g.selectAll<SVGTextElement, RegionLabelDatum>('text.region-name-label')
      .style('display', (datum) => (
        !this.onlyShowRegionNamesWithSchools || datum.hasSchools ? '' : 'none'
      ));
  }

  private updateRegionLabelVisibility(): void {
    const level = this.requestedLevel;
    this.layers.provinceLabels.style(
      'display',
      this.showRegionNames && level === 'province' ? '' : 'none',
    );
    this.layers.cityLabels.style(
      'display',
      this.showRegionNames && level === 'city' ? '' : 'none',
    );
    this.layers.districtLabels.style(
      'display',
      this.showRegionNames && level === 'district' ? '' : 'none',
    );
  }

  private bindRegionInteractions(
    paths: d3.Selection<SVGPathElement, any, SVGGElement, unknown>,
    level: RegionSelection['level'],
  ): void {
    const adcodeFor = (feature: any): string => String(
      level === 'province'
        ? feature.properties?.province_adcode
        : feature.properties?.city_adcode || feature.properties?.adcode,
    );
    const names = level === 'province' ? this.provinceNames : this.cityNames;
    const valid = level === 'province' ? this.validProvinces : this.validCities;
    const activate = (event: Event, feature: any): void => {
      if (!this.regionSelectionEnabled || this.requestedLevel !== level) return;
      const adcode = adcodeFor(feature);
      const name = names.get(adcode);
      if (!valid.has(adcode) || !name) return;
      event.preventDefault();
      event.stopPropagation();
      this.onRegionSelect?.({ level, adcode, name });
    };

    paths
      .classed('region-actionable', (feature) => valid.has(adcodeFor(feature)))
      .attr('data-region-level', (feature) => valid.has(adcodeFor(feature)) ? level : null)
      .attr('data-region-adcode', (feature) => valid.has(adcodeFor(feature)) ? adcodeFor(feature) : null)
      .attr('role', (feature) => (
        this.regionSelectionEnabled && valid.has(adcodeFor(feature)) ? 'button' : null
      ))
      .attr('tabindex', (feature) => (
        this.regionSelectionEnabled && valid.has(adcodeFor(feature)) ? 0 : null
      ))
      .attr('aria-label', (feature) => {
        const name = names.get(adcodeFor(feature));
        return name ? `查看${name}详情` : null;
      })
      .on('pointerenter.line-highlight', (event: PointerEvent, feature) => {
        if (
          !this.regionSelectionEnabled ||
          event.pointerType === 'touch' ||
          this.requestedLevel !== level
        ) return;
        const adcode = adcodeFor(feature);
        if (valid.has(adcode)) this.schoolOverlay.setHoveredRegion(level, adcode);
      })
      .on('pointerleave.line-highlight', (event: PointerEvent, feature) => {
        if (event.pointerType === 'touch') return;
        this.schoolOverlay.clearHoveredRegion(level, adcodeFor(feature));
      })
      .on('click', activate)
      .on('keydown', (event: KeyboardEvent, feature) => {
        if (event.key === 'Enter' || event.key === ' ') activate(event, feature);
      });
  }

  private updateRegionInteractionAvailability(): void {
    this.layers.provincesFill.style(
      'pointer-events',
      this.regionSelectionEnabled && this.requestedLevel === 'province' ? 'auto' : 'none',
    );
    this.layers.cities.style(
      'pointer-events',
      this.regionSelectionEnabled && this.requestedLevel === 'city' ? 'auto' : 'none',
    );
  }

  private updateSchoolOverlay(): void {
    this.schoolOverlay.update(
      this.width,
      this.height,
      this.projection,
      this.currentTransform,
    );
  }

  private applyInitialView(): void {
    if (
      this.destroyed ||
      this.initialViewApplied ||
      !this.baseMapRendered ||
      !this.dataReady
    ) return;

    const points = this.domesticSchools.flatMap((school) => {
      if (school.lat === null || school.lng === null) return [];
      const point = getProjectedPoint(this.projection, school.lat, school.lng);
      return point ? [point] : [];
    });
    const infoRectangle = getInfoRectangle(
      this.width,
      this.height,
      this.schoolOverlay.getInfoRectanglePlacement(),
    );
    const fitted = calculateInitialMapTransform(
      points,
      { width: this.width, height: this.height },
      infoRectangle,
      defaultConfig.initialSchoolExtentRatio,
    );
    const transform = d3.zoomIdentity.translate(fitted.x, fitted.y).scale(fitted.k);
    this.zoomBehavior.scaleExtent([
      Math.min(defaultConfig.mapZoomExtent.min, fitted.k),
      Math.max(defaultConfig.mapZoomExtent.max, fitted.k),
    ]);
    this.applyingInitialView = true;
    try {
      this.svg.call(this.zoomBehavior.transform, transform);
    } finally {
      this.applyingInitialView = false;
    }
    this.initialViewApplied = true;
    this.svg
      .attr('data-initial-view-applied', 'true')
      .attr('data-initial-view-scale', fitted.k);
    this.schoolOverlay.resetLayout();
    this.updateSchoolOverlay();
  }
}
