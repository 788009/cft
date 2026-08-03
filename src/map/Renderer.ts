import * as d3 from 'd3';
import { createProjection } from './projection';
import { LevelManager, type MapLevel } from './LevelManager';
import { loadGeoJSON } from '@/data/fetcher';
import { MAP_STYLES } from '@/config';
import type { ProcessedData } from '@/types';

// 计算多边形顶点缠绕面积
function ringArea(ring: number[][]): number {
  let area = 0;
  for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
    const p1 = ring[i];
    const p2 = ring[j];
    area += (p2[0] - p1[0]) * (p2[1] + p1[1]);
  }
  return area;
}

// 纠正 Feature 中的多边形缠绕方向 (RFC 7946 标准：外环逆时针 area < 0)
function rewindFeature(feature: any): any {
  if (!feature || !feature.geometry) return feature;
  
  const cloned = JSON.parse(JSON.stringify(feature));
  const geom = cloned.geometry;

  const fixPolygon = (rings: number[][][]) => {
    if (!rings || rings.length === 0) return rings;
    if (ringArea(rings[0]) > 0) {
      rings[0].reverse();
    }
    for (let i = 1; i < rings.length; i++) {
      if (ringArea(rings[i]) < 0) {
        rings[i].reverse();
      }
    }
    return rings;
  };

  if (geom.type === 'Polygon') {
    fixPolygon(geom.coordinates);
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates.forEach((polygon: number[][][]) => fixPolygon(polygon));
  }
  return cloned;
}

export class MapRenderer {
  private container: HTMLElement;
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private g: d3.Selection<SVGGElement, unknown, null, undefined>;
  private projection: d3.GeoProjection;
  private pathGenerator: d3.GeoPath;
  private zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown>;
  private levelManager: LevelManager;
  
  private validProvinces = new Set<string>();
  private validCities = new Set<string>();
  private geoCache = new Map<string, any>();
  
  private currentRenderedLevel: MapLevel = 'province';

  private layers: {
    provincesFill: d3.Selection<SVGGElement, unknown, null, undefined>;
    cities: d3.Selection<SVGGElement, unknown, null, undefined>;
    districts: d3.Selection<SVGGElement, unknown, null, undefined>;
    provincesBorder: d3.Selection<SVGGElement, unknown, null, undefined>;
    tendash: d3.Selection<SVGGElement, unknown, null, undefined>;
  };
  
  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`找不到容器: ${containerId}`);
    this.container = el;

    const { width, height } = this.container.getBoundingClientRect();
    
    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .style('display', 'block');

    this.g = this.svg.append('g');

    this.layers = {
      provincesFill: this.g.append('g').attr('class', 'layer-provinces-fill'),
      cities: this.g.append('g').attr('class', 'layer-cities').style('opacity', 0),
      districts: this.g.append('g').attr('class', 'layer-districts').style('opacity', 0),
      provincesBorder: this.g.append('g').attr('class', 'layer-provinces-border').style('pointer-events', 'none'),
      tendash: this.g.append('g').attr('class', 'layer-tendash').style('pointer-events', 'none')
    };

    this.projection = createProjection(width, height);
    this.pathGenerator = d3.geoPath().projection(this.projection);
    this.levelManager = new LevelManager();

    this.zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 20])
      .on('zoom', (event) => this.handleZoom(event));

    this.svg.call(this.zoomBehavior);
    window.addEventListener('resize', () => this.handleResize());
  }

  public setData(data: ProcessedData) {
    this.validProvinces.clear();
    this.validCities.clear();
    
    for (const school of data.domesticSchools) {
      if (school.provinceAdcode) this.validProvinces.add(String(school.provinceAdcode));
      if (school.cityAdcode) this.validCities.add(String(school.cityAdcode));
    }
  }

  private handleZoom(event: d3.D3ZoomEvent<SVGSVGElement, unknown>) {
    this.g.attr('transform', event.transform.toString());
    const newLevel = this.levelManager.update(event.transform.k);
    
    if (newLevel !== this.currentRenderedLevel) {
      this.currentRenderedLevel = newLevel;
      this.updateLayerVisibility();
    }
  }

  private handleResize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.svg.attr('viewBox', `0 0 ${width} ${height}`);
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

  private async updateLayerVisibility() {
    const level = this.currentRenderedLevel;

    if (level === 'city' || level === 'district') {
      await this.renderCities();
    }
    if (level === 'district') {
      await this.renderDistricts();
    }

    this.layers.cities.transition().duration(250)
      .style('opacity', level === 'city' || level === 'district' ? 1 : 0);
      
    this.layers.districts.transition().duration(250)
      .style('opacity', level === 'district' ? 1 : 0);
  }

  private async renderCities() {
    if (this.layers.cities.selectAll('path').size() > 0) return;

    const features: any[] = [];
    for (const adcode of Array.from(this.validProvinces)) {
      try {
        const data = await this.fetchGeoJSON(`provinces/${adcode}.json`);
        const fixedFeatures = (data.features || []).map(rewindFeature);
        features.push(...fixedFeatures);
      } catch (e) {
        // 忽略缺失文件
      }
    }

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
  }

  private async renderDistricts() {
    if (this.layers.districts.selectAll('path').size() > 0) return;

    const features: any[] = [];
    for (const adcode of Array.from(this.validCities)) {
      try {
        const data = await this.fetchGeoJSON(`cities/${adcode}.json`);
        if (data && data.features) {
          const fixedFeatures = data.features.map(rewindFeature);
          features.push(...fixedFeatures);
        }
      } catch (e) {
        // 忽略缺失文件
      }
    }

    this.layers.districts.selectAll('path')
      .data(features)
      .enter()
      .append('path')
      .attr('d', (d: any) => this.pathGenerator(d))
      .attr('fill', '#ffffff')
      .attr('stroke', MAP_STYLES.districts.stroke)
      .attr('stroke-width', MAP_STYLES.districts.strokeWidth)
      .attr('vector-effect', 'non-scaling-stroke');
  }
}
