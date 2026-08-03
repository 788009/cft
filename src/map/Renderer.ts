import * as d3 from 'd3';
import { createProjection } from './projection';
import { LevelManager } from './LevelManager';
import { loadGeoJSON } from '@/data/fetcher';
import type { ProcessedData } from '@/types';

export class MapRenderer {
  private container: HTMLElement;
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private g: d3.Selection<SVGGElement, unknown, null, undefined>;
  private projection: d3.GeoProjection;
  private pathGenerator: d3.GeoPath;
  private zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown>;
  private levelManager: LevelManager;
  private data: ProcessedData | null = null;
  
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
    this.data = data;
  }

  private handleZoom(event: d3.D3ZoomEvent<SVGSVGElement, unknown>) {
    this.g.attr('transform', event.transform.toString());
    const newLevel = this.levelManager.update(event.transform.k);
    // 预留位置：后续将根据层级动态加载市/区县 GeoJSON，并触发标注更新
  }

  private handleResize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.svg.attr('viewBox', `0 0 ${width} ${height}`);
    this.projection = createProjection(width, height);
    this.pathGenerator = d3.geoPath().projection(this.projection);
    
    this.g.selectAll('path').attr('d', this.pathGenerator as any);
    // 预留位置：后续将重新计算布局
  }

  public async renderBaseMap() {
    try {
      const [provinces, tenDash] = await Promise.all([
        loadGeoJSON('china_provinces.json'),
        loadGeoJSON('10-dash.json')
      ]);

      this.g.append('g')
        .attr('class', 'layer-provinces')
        .selectAll('path')
        .data(provinces.features)
        .enter()
        .append('path')
        .attr('d', this.pathGenerator as any)
        .attr('fill', '#e5e7eb')
        .attr('stroke', '#9ca3af')
        .attr('stroke-width', 0.5)
        .attr('class', 'transition-colors duration-200');

      this.g.append('g')
        .attr('class', 'layer-tendash')
        .selectAll('path')
        .data(tenDash.features)
        .enter()
        .append('path')
        .attr('d', this.pathGenerator as any)
        .attr('stroke', '#9ca3af')
        .attr('stroke-width', 1.5)
        .attr('fill', 'none');

    } catch (error) {
      console.error('基础地图渲染失败:', error);
    }
  }
}
