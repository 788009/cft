import * as d3 from 'd3';
import { createProjection } from './projection';
import { LevelManager, type MapLevel } from './LevelManager';
import { loadGeoJSON } from '@/data/fetcher';
import { MAP_STYLES, defaultConfig, type MapInteractionMode } from '@/config';
import type { ProcessedData, Student } from '@/types';
import type { MapViewState } from '@/state/ViewState';
import { SchoolOverlay } from './SchoolOverlay';
import { rewindFeature } from './geo';
import type { RegionSelection } from '@/details/types';

export interface MapRendererOptions {
  onViewChange?: (view: MapViewState) => void;
  onRegionSelect?: (selection: RegionSelection) => void;
  onStudentSelect?: (student: Student) => void;
  interactionMode?: MapInteractionMode;
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
  private interactionMode: MapInteractionMode;
  private readonly schoolOverlay: SchoolOverlay;
  private width: number;
  private height: number;

  private layers: {
    provincesFill: d3.Selection<SVGGElement, unknown, null, undefined>;
    cities: d3.Selection<SVGGElement, unknown, null, undefined>;
    districts: d3.Selection<SVGGElement, unknown, null, undefined>;
    provincesBorder: d3.Selection<SVGGElement, unknown, null, undefined>;
    tendash: d3.Selection<SVGGElement, unknown, null, undefined>;
  };
  
  constructor(containerId: string, options: MapRendererOptions = {}) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`找不到容器: ${containerId}`);
    this.container = el;
    this.onViewChange = options.onViewChange;
    this.onRegionSelect = options.onRegionSelect;
    this.interactionMode = options.interactionMode ?? defaultConfig.mapInteractionMode;

    const { width, height } = this.container.getBoundingClientRect();
    this.width = width;
    this.height = height;
    
    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('data-map-level', 'province')
      .style('display', 'block');

    this.g = this.svg.append('g').attr('class', 'map-geometry');

    this.layers = {
      provincesFill: this.g.append('g').attr('class', 'layer-provinces-fill'),
      cities: this.g.append('g').attr('class', 'layer-cities').style('opacity', 0).style('pointer-events', 'none'),
      districts: this.g.append('g').attr('class', 'layer-districts').style('opacity', 0).style('pointer-events', 'none'),
      provincesBorder: this.g.append('g').attr('class', 'layer-provinces-border').style('pointer-events', 'none'),
      tendash: this.g.append('g').attr('class', 'layer-tendash').style('pointer-events', 'none')
    };
    this.schoolOverlay = new SchoolOverlay(this.svg, {
      onStudentSelect: options.onStudentSelect,
    });

    this.projection = createProjection(width, height);
    this.pathGenerator = d3.geoPath().projection(this.projection);
    this.levelManager = new LevelManager();

    this.zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 20])
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
    
    for (const school of data.domesticSchools) {
      if (school.provinceAdcode) this.validProvinces.add(String(school.provinceAdcode));
      if (school.cityAdcode) this.validCities.add(String(school.cityAdcode));
      if (school.provinceAdcode) this.provinceNames.set(String(school.provinceAdcode), school.province);
      if (school.cityAdcode) this.cityNames.set(String(school.cityAdcode), school.city);
    }
    this.schoolOverlay.setData(data);
    this.updateSchoolOverlay();
  }

  public setInteractionMode(mode: MapInteractionMode): void {
    this.interactionMode = mode;
  }

  private handleZoomStart(): void {
    if (this.destroyed) return;
    this.zoomInteractionChanged = false;
  }

  private handleZoom(event: d3.D3ZoomEvent<SVGSVGElement, unknown>) {
    if (this.destroyed) return;
    if (this.interactionMode === 'hide-and-reflow' && !this.zoomInteractionChanged) {
      this.zoomInteractionChanged = true;
      this.schoolOverlay.setInteractionActive(true);
    }
    this.currentTransform = event.transform;
    this.g.attr('transform', event.transform.toString());
    if (this.interactionMode === 'stable') this.updateSchoolOverlay();
    const newLevel = this.levelManager.update(event.transform.k);
    this.emitViewChange(newLevel);

    if (newLevel !== this.requestedLevel) {
      this.requestedLevel = newLevel;
      const version = ++this.transitionVersion;
      void this.updateLayerVisibility(newLevel, version);
    }
  }

  private handleZoomEnd(): void {
    if (
      this.destroyed ||
      this.interactionMode !== 'hide-and-reflow' ||
      !this.zoomInteractionChanged
    ) return;
    this.schoolOverlay.resetLayout();
    this.updateSchoolOverlay();
    this.schoolOverlay.setInteractionActive(false);
  }

  public resize(width: number, height: number): void {
    if (this.destroyed) return;
    this.width = width;
    this.height = height;
    this.svg.attr('viewBox', `0 0 ${width} ${height}`);
    this.projection = createProjection(width, height);
    this.pathGenerator = d3.geoPath().projection(this.projection);
    this.g.selectAll<SVGPathElement, unknown>('path').attr('d', this.pathGenerator as any);
    this.updateSchoolOverlay();
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

      // 1. 省级色块填充
      this.layers.provincesFill.selectAll('path')
        .data(fixedProvincesFeatures)
        .enter()
        .append('path')
        .attr('d', this.pathGenerator as any)
        .attr('fill', (d: any) => {
          const adcode = String(d.properties.province_adcode);
          return this.validProvinces.has(adcode) ? '#ffffff' : '#e5e7eb';
        })
        .attr('stroke', 'none');
      this.bindRegionInteractions(this.layers.provincesFill.selectAll('path'), 'province');

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
    this.svg.attr('data-map-level', level);
    this.emitViewChange(level);

    this.layers.cities.transition().duration(250)
      .style('opacity', level === 'city' || level === 'district' ? 1 : 0);
      
    this.layers.districts.transition().duration(250)
      .style('opacity', level === 'district' ? 1 : 0);
    this.layers.provincesFill.style('pointer-events', level === 'province' ? 'auto' : 'none');
    this.layers.cities.style('pointer-events', level === 'city' ? 'auto' : 'none');
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
        .attr('fill', (d: any) => {
          const p = d.properties;
          const cityAdcode = String(p.city_adcode || p.adcode);
          return this.validCities.has(cityAdcode) ? '#ffffff' : '#e5e7eb';
        })
        .attr('stroke', MAP_STYLES.cities.stroke)
        .attr('stroke-width', MAP_STYLES.cities.strokeWidth)
        .attr('vector-effect', 'non-scaling-stroke');
      this.bindRegionInteractions(this.layers.cities.selectAll('path'), 'city');

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

  private emitViewChange(level: MapLevel): void {
    this.onViewChange?.({
      x: this.currentTransform.x,
      y: this.currentTransform.y,
      k: this.currentTransform.k,
      level,
    });
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
      if (this.requestedLevel !== level) return;
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
      .attr('role', (feature) => valid.has(adcodeFor(feature)) ? 'button' : null)
      .attr('tabindex', (feature) => valid.has(adcodeFor(feature)) ? 0 : null)
      .attr('aria-label', (feature) => {
        const name = names.get(adcodeFor(feature));
        return name ? `查看${name}详情` : null;
      })
      .on('click', activate)
      .on('keydown', (event: KeyboardEvent, feature) => {
        if (event.key === 'Enter' || event.key === ' ') activate(event, feature);
      });
  }

  private updateSchoolOverlay(): void {
    this.schoolOverlay.update(
      this.width,
      this.height,
      this.projection,
      this.currentTransform,
    );
  }
}
