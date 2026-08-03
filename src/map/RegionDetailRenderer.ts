import { geoMercator, geoPath, select, zoomIdentity, type GeoProjection, type Selection } from 'd3';
import { defaultConfig, MAP_STYLES } from '@/config';
import { loadGeoJSON } from '@/data/fetcher';
import type { RegionSelection } from '@/details/types';
import { rewindFeature } from '@/map/geo';
import { getInfoRectangle, SchoolOverlay } from '@/map/SchoolOverlay';
import type { ProcessedData, SchoolGroup, Student } from '@/types';
import {
  getRegionAdcodesWithSchools,
  getRegionFeatureLabelLevel,
  getRegionLabelIdentity,
  type RegionLabelLevel,
} from '@/map/RegionLabels';

interface FeatureCollection {
  type: 'FeatureCollection';
  features: unknown[];
}

export class RegionDetailRenderer {
  private readonly container: HTMLElement;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly geometryLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly labelsLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly overlay: SchoolOverlay;
  private readonly resizeObserver: ResizeObserver;
  private featureCollection: FeatureCollection | null = null;
  private schools: SchoolGroup[] = [];
  private labelLevel: RegionLabelLevel = 'city';
  private showRegionNames: boolean;
  private onlyShowRegionNamesWithSchools: boolean;
  private destroyed = false;

  constructor(
    container: HTMLElement,
    onStudentSelect?: (student: Student) => void,
    showRegionNames = defaultConfig.showRegionNames,
    onlyShowRegionNamesWithSchools = defaultConfig.onlyShowRegionNamesWithSchools,
  ) {
    this.container = container;
    this.showRegionNames = showRegionNames;
    this.onlyShowRegionNamesWithSchools = onlyShowRegionNamesWithSchools;
    this.svg = select(container)
      .append('svg')
      .attr('class', 'region-detail-map')
      .attr('data-testid', 'region-detail-map')
      .attr('width', '100%')
      .attr('height', '100%')
      .style('display', 'block');
    this.geometryLayer = this.svg.append('g').attr('class', 'region-detail-geometry');
    this.labelsLayer = this.svg.append('g')
      .attr('class', 'region-detail-labels')
      .style('pointer-events', 'none');
    this.overlay = new SchoolOverlay(this.svg, { onStudentSelect });
    this.resizeObserver = new ResizeObserver(() => this.updateScene());
    this.resizeObserver.observe(container);
  }

  public async render(selection: RegionSelection, data: ProcessedData): Promise<void> {
    const directory = selection.level === 'province' ? 'provinces' : 'cities';
    const raw = await loadGeoJSON(`${directory}/${selection.adcode}.json`) as FeatureCollection;
    if (this.destroyed) return;

    this.featureCollection = {
      type: 'FeatureCollection',
      features: (raw.features ?? []).map(rewindFeature),
    };
    this.labelLevel = selection.level === 'province' ? 'city' : 'district';
    this.schools = selection.level === 'province'
      ? data.indexes.schoolsByProvinceAdcode.get(selection.adcode) ?? []
      : data.indexes.schoolsByCityAdcode.get(selection.adcode) ?? [];
    this.overlay.setSchools(this.schools, []);
    this.svg
      .attr('data-region-level', selection.level)
      .attr('data-region-adcode', selection.adcode)
      .attr('data-region-school-count', this.schools.length)
      .attr('aria-label', `${selection.name}地区地图`);
    this.updateScene();
  }

  public setShowRegionNames(show: boolean): void {
    this.showRegionNames = show;
    this.labelsLayer.style('display', show ? '' : 'none');
  }

  public setOnlyShowRegionNamesWithSchools(only: boolean): void {
    this.onlyShowRegionNamesWithSchools = only;
    this.labelsLayer.selectAll<SVGTextElement, { hasSchools: boolean }>('text.region-name-label')
      .style('display', (datum) => !only || datum.hasSchools ? '' : 'none');
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.overlay.destroy();
    this.svg.remove();
  }

  private updateScene(): void {
    if (this.destroyed || !this.featureCollection) return;
    const { width, height } = this.container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;

    this.svg.attr('viewBox', `0 0 ${width} ${height}`);
    const projection = this.createProjection(width, height);
    const pathGenerator = geoPath().projection(projection);
    this.geometryLayer.selectAll<SVGPathElement, unknown>('path')
      .data(this.featureCollection.features)
      .join('path')
      .attr('d', pathGenerator as never)
      .attr('fill', '#ffffff')
      .attr('stroke', MAP_STYLES.cities.stroke)
      .attr('stroke-width', Math.max(MAP_STYLES.cities.strokeWidth, 0.65))
      .attr('vector-effect', 'non-scaling-stroke');
    const features = this.featureCollection.features as never[];
    const cityAdcodesWithSchools = getRegionAdcodesWithSchools(features, 'city', this.schools);
    const districtAdcodesWithSchools = getRegionAdcodesWithSchools(
      features,
      'district',
      this.schools,
    );
    const labelData = this.featureCollection.features.flatMap((feature) => {
      const featureLevel = getRegionFeatureLabelLevel(feature as never, this.labelLevel);
      const identity = getRegionLabelIdentity(feature as never, featureLevel);
      const adcodesWithSchools = featureLevel === 'district'
        ? districtAdcodesWithSchools
        : cityAdcodesWithSchools;
      return identity ? [{
        feature,
        ...identity,
        level: featureLevel,
        hasSchools: adcodesWithSchools.has(identity.adcode),
      }] : [];
    });
    this.labelsLayer
      .style('display', this.showRegionNames ? '' : 'none')
      .selectAll<SVGTextElement, typeof labelData[number]>('text.region-name-label')
      .data(labelData, (datum) => datum.adcode)
      .join('text')
      .attr('class', 'region-name-label')
      .attr('data-region-label-level', (datum) => datum.level)
      .attr('data-region-adcode', (datum) => datum.adcode)
      .attr('x', (datum) => pathGenerator.centroid(datum.feature as never)[0])
      .attr('y', (datum) => pathGenerator.centroid(datum.feature as never)[1])
      .attr('font-size', defaultConfig.regionLabelFontSize)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('vector-effect', 'non-scaling-stroke')
      .style('display', (datum) => (
        !this.onlyShowRegionNamesWithSchools || datum.hasSchools ? '' : 'none'
      ))
      .text((datum) => datum.name);
    this.overlay.update(width, height, projection, zoomIdentity);
  }

  private createProjection(width: number, height: number): GeoProjection {
    const infoRect = getInfoRectangle(width, height);
    const inset = Math.min(defaultConfig.canvasMargin, infoRect.width / 8, infoRect.height / 8);
    return geoMercator().fitExtent([
      [infoRect.x + inset, infoRect.y + inset],
      [infoRect.x + infoRect.width - inset, infoRect.y + infoRect.height - inset],
    ], this.featureCollection as never);
  }
}
