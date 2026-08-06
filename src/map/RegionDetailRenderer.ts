import {
  geoCentroid,
  geoMercator,
  geoPath,
  select,
  zoom,
  zoomIdentity,
  type GeoProjection,
  type Selection,
  type ZoomBehavior,
  type ZoomTransform,
} from 'd3';
import {
  defaultConfig,
  MAP_STYLES,
  type CardGroupingMode,
  type MapInteractionMode,
} from '@/config';
import { loadGeoJSON } from '@/data/fetcher';
import type { RegionSelection } from '@/details/types';
import { rewindFeature } from '@/map/geo';
import {
  SchoolOverlay,
  type NormalizedCardPosition,
} from '@/map/SchoolOverlay';
import {
  expandRectWithinBounds,
  getDefaultInfoRectanglePlacement,
  getInfoRectangle,
  getInfoRectanglePlacement,
  type InfoRectanglePlacement,
} from '@/map/InfoRectangle';
import type { ProcessedData, SchoolGroup, Student } from '@/types';
import {
  getRegionAdcodesWithSchools,
  getRegionFeatureLabelLevel,
  getRegionLabelIdentity,
  type RegionLabelLevel,
} from '@/map/RegionLabels';
import { parseGeoJsonCenter, type RegionCenter } from '@/map/RegionCards';

interface FeatureCollection {
  type: 'FeatureCollection';
  features: unknown[];
}

export interface RegionDetailRendererSnapshot {
  sourceWidth: number;
  sourceHeight: number;
  view: { x: number; y: number; k: number };
  infoRectanglePlacement: InfoRectanglePlacement;
  cardPositions: ReadonlyMap<string, NormalizedCardPosition>;
}

export class RegionDetailRenderer {
  private readonly container: HTMLElement;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly geometryLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly labelsLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly overlay: SchoolOverlay;
  private readonly resizeObserver: ResizeObserver;
  private readonly zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null;
  private featureCollection: FeatureCollection | null = null;
  private schools: SchoolGroup[] = [];
  private labelLevel: RegionLabelLevel = 'city';
  private showRegionNames: boolean;
  private onlyShowRegionNamesWithSchools: boolean;
  private infoRectanglePlacement: InfoRectanglePlacement;
  private automaticInfoRectangle = true;
  private fontScale = 1;
  private width = 0;
  private height = 0;
  private projection: GeoProjection | null = null;
  private currentTransform: ZoomTransform = zoomIdentity;
  private interactionMode: MapInteractionMode;
  private zoomInteractionChanged = false;
  private destroyed = false;

  constructor(
    container: HTMLElement,
    onStudentSelect?: (student: Student) => void,
    showRegionNames = defaultConfig.showRegionNames,
    onlyShowRegionNamesWithSchools = defaultConfig.onlyShowRegionNamesWithSchools,
    showInfoRectangle = defaultConfig.showInfoRectangle,
    infoRectanglePlacement = getDefaultInfoRectanglePlacement(),
    enableLocalLayoutOptimization = defaultConfig.enableLocalLayoutOptimization,
    cardGroupingMode = defaultConfig.cardGroupingMode,
    cardDraggingEnabled = true,
    navigationEnabled = false,
    interactionMode = defaultConfig.mapInteractionMode,
  ) {
    this.container = container;
    this.showRegionNames = showRegionNames;
    this.onlyShowRegionNamesWithSchools = onlyShowRegionNamesWithSchools;
    this.infoRectanglePlacement = infoRectanglePlacement;
    this.interactionMode = interactionMode;
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
    this.overlay = new SchoolOverlay(this.svg, {
      onStudentSelect,
      showInfoRectangle,
      infoRectanglePlacement,
      enableLocalLayoutOptimization,
      onInfoRectanglePlacementChange: (placement) => {
        this.automaticInfoRectangle = false;
        this.infoRectanglePlacement = placement;
      },
    });
    this.overlay.setCardGroupingMode(cardGroupingMode);
    this.overlay.setCardDraggingEnabled(cardDraggingEnabled);
    this.overlay.setMapLevel('city');
    this.zoomBehavior = navigationEnabled
      ? zoom<SVGSVGElement, unknown>()
        .filter((event: Event) => this.shouldHandleMapNavigation(event))
        .scaleExtent([defaultConfig.mapZoomExtent.min, defaultConfig.mapZoomExtent.max])
        .on('start', () => {
          this.zoomInteractionChanged = false;
        })
        .on('zoom', (event) => this.handleZoom(event.transform))
        .on('end', () => this.handleZoomEnd())
      : null;
    if (this.zoomBehavior) {
      this.svg.style('touch-action', 'none').call(this.zoomBehavior);
    }
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
    this.overlay.setRegionCenters('city', this.getCityCenters(selection));
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

  public setShowInfoRectangle(show: boolean): void {
    this.overlay.setShowInfoRectangle(show);
  }

  public setInfoRectanglePlacement(placement: InfoRectanglePlacement): void {
    this.automaticInfoRectangle = false;
    this.infoRectanglePlacement = placement;
    this.overlay.setInfoRectanglePlacement(placement);
    this.updateScene();
  }

  public setLocalLayoutOptimizationEnabled(enabled: boolean): void {
    this.overlay.setLocalLayoutOptimizationEnabled(enabled);
    this.overlay.resetLayout();
    this.updateScene();
  }

  public setCardGroupingMode(mode: CardGroupingMode): void {
    this.overlay.setCardGroupingMode(mode);
    this.overlay.resetLayout();
    this.updateScene();
  }

  public setInteractionMode(mode: MapInteractionMode): void {
    if (mode === this.interactionMode) return;
    this.interactionMode = mode;
    this.overlay.resetLayout();
    this.updateScene();
  }

  public setFontScale(scale: number): void {
    this.fontScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    this.overlay.setFontScale(this.fontScale);
    this.overlay.resetLayout();
    this.updateScene();
  }

  public setVisualScale(scale: number): void {
    this.overlay.setVisualScale(scale);
    this.updateScene();
  }

  public setInfoRectangleEditing(editing: boolean): void {
    this.overlay.setInfoRectangleEditing(editing);
    if (!editing) {
      this.overlay.resetLayout();
      this.updateScene();
    }
  }

  public resetInfoRectangle(): void {
    this.automaticInfoRectangle = true;
    this.overlay.resetLayout();
    this.updateScene();
  }

  public resetView(): void {
    this.currentTransform = zoomIdentity;
    if (this.zoomBehavior) {
      this.svg.call(this.zoomBehavior.transform, zoomIdentity);
    } else {
      this.updateScene();
    }
    this.resetInfoRectangle();
  }

  public rearrangeCards(): void {
    this.overlay.resetLayout();
    this.updateScene();
  }

  public getSnapshot(): RegionDetailRendererSnapshot {
    return {
      sourceWidth: this.width,
      sourceHeight: this.height,
      view: {
        x: this.currentTransform.x,
        y: this.currentTransform.y,
        k: this.currentTransform.k,
      },
      infoRectanglePlacement: this.overlay.getInfoRectanglePlacement(),
      cardPositions: this.overlay.getNormalizedCardPositions(),
    };
  }

  public applySnapshot(snapshot: RegionDetailRendererSnapshot): void {
    if (snapshot.sourceWidth <= 0 || snapshot.sourceHeight <= 0) {
      throw new RangeError('地区地图快照尺寸无效');
    }
    this.currentTransform = zoomIdentity.translate(
      snapshot.view.x * this.width / snapshot.sourceWidth,
      snapshot.view.y * this.height / snapshot.sourceHeight,
    ).scale(snapshot.view.k);
    this.automaticInfoRectangle = false;
    this.infoRectanglePlacement = { ...snapshot.infoRectanglePlacement };
    this.overlay.setInfoRectanglePlacement(this.infoRectanglePlacement);
    this.overlay.setNormalizedCardPositions(snapshot.cardPositions);
    this.updateScene();
  }

  public getSvgElement(): SVGSVGElement {
    const svg = this.svg.node();
    if (!svg) throw new Error('地区地图 SVG 不可用');
    return svg;
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.svg.on('.zoom', null);
    this.overlay.destroy();
    this.svg.remove();
  }

  private updateScene(): void {
    if (this.destroyed || !this.featureCollection) return;
    const { width, height } = this.container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;

    this.svg.attr('viewBox', `0 0 ${width} ${height}`);
    const projection = this.createProjection(width, height);
    this.projection = projection;
    const pathGenerator = geoPath().projection(projection);
    const [[left, top], [right, bottom]] = pathGenerator.bounds(
      this.featureCollection as never,
    );
    const detailInfoRect = expandRectWithinBounds({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    }, defaultConfig.regionDetailInfoRectanglePadding, {
      x: 0,
      y: 0,
      width,
      height,
    });
    if (this.automaticInfoRectangle) {
      this.infoRectanglePlacement = getInfoRectanglePlacement(
        detailInfoRect,
        width,
        height,
      );
      this.overlay.setInfoRectanglePlacement(this.infoRectanglePlacement);
    }
    this.svg.attr(
      'data-info-rectangle-padding',
      defaultConfig.regionDetailInfoRectanglePadding,
    );
    this.geometryLayer.selectAll<SVGPathElement, unknown>('path')
      .data(this.featureCollection.features)
      .join('path')
      .attr('d', pathGenerator as never)
      .attr('fill', '#ffffff')
      .attr('stroke', MAP_STYLES.cities.stroke)
      .attr('stroke-width', Math.max(MAP_STYLES.cities.strokeWidth, 0.65))
      .attr('vector-effect', 'non-scaling-stroke');
    this.geometryLayer.attr('transform', this.currentTransform.toString());
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
      .attr(
        'font-size',
        defaultConfig.regionLabelFontSize * this.fontScale / this.currentTransform.k,
      )
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('vector-effect', 'non-scaling-stroke')
      .style('display', (datum) => (
        !this.onlyShowRegionNamesWithSchools || datum.hasSchools ? '' : 'none'
      ))
      .text((datum) => datum.name);
    this.labelsLayer.attr('transform', this.currentTransform.toString());
    this.overlay.update(width, height, projection, this.currentTransform);
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

  private handleZoom(transform: ZoomTransform): void {
    if (this.destroyed || !this.projection) return;
    if (!this.zoomInteractionChanged) {
      this.zoomInteractionChanged = true;
      if (this.interactionMode === 'hide-and-reflow') {
        this.overlay.setInteractionActive(true);
      }
    }
    this.currentTransform = transform;
    this.geometryLayer.attr('transform', transform.toString());
    this.labelsLayer
      .attr('transform', transform.toString())
      .selectAll<SVGTextElement, unknown>('text.region-name-label')
      .attr(
        'font-size',
        defaultConfig.regionLabelFontSize * this.fontScale / transform.k,
      );
    if (this.interactionMode === 'stable') {
      this.overlay.update(this.width, this.height, this.projection, transform);
    }
  }

  private handleZoomEnd(): void {
    if (
      this.destroyed ||
      !this.projection ||
      this.interactionMode !== 'hide-and-reflow' ||
      !this.zoomInteractionChanged
    ) return;
    this.overlay.resetLayout();
    this.overlay.update(
      this.width,
      this.height,
      this.projection,
      this.currentTransform,
    );
    this.overlay.setInteractionActive(false);
  }

  private createProjection(width: number, height: number): GeoProjection {
    const infoRect = getInfoRectangle(
      width,
      height,
      getDefaultInfoRectanglePlacement(width, height),
    );
    const inset = Math.min(defaultConfig.canvasMargin, infoRect.width / 8, infoRect.height / 8);
    return geoMercator().fitExtent([
      [infoRect.x + inset, infoRect.y + inset],
      [infoRect.x + infoRect.width - inset, infoRect.y + infoRect.height - inset],
    ], this.featureCollection as never);
  }

  private getCityCenters(selection: RegionSelection): Map<string, RegionCenter> {
    if (!this.featureCollection) return new Map();
    if (selection.level === 'city') {
      const [longitude, latitude] = geoCentroid(this.featureCollection as never);
      return new Map([[selection.adcode, {
        adcode: selection.adcode,
        name: selection.name,
        longitude,
        latitude,
      }]]);
    }

    const centers = new Map<string, RegionCenter>();
    for (const feature of this.featureCollection.features) {
      const properties = (feature as { properties?: Record<string, unknown> }).properties ?? {};
      const adcode = String(properties.city_adcode ?? properties.adcode ?? '');
      if (!adcode || centers.has(adcode)) continue;
      const coordinates = parseGeoJsonCenter(properties.center)
        ?? geoCentroid(feature as never);
      const name = adcode === selection.adcode
        ? selection.name
        : typeof properties.name === 'string' ? properties.name.trim() : '';
      if (!name || !coordinates.every(Number.isFinite)) continue;
      centers.set(adcode, {
        adcode,
        name,
        longitude: coordinates[0],
        latitude: coordinates[1],
      });
    }
    return centers;
  }
}
