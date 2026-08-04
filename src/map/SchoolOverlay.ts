import {
  select,
  type GeoProjection,
  type Selection,
  type ZoomTransform,
} from 'd3';
import { defaultConfig, type CardGroupingMode } from '@/config';
import {
  calculateFittingLayout,
  getConnectionPoint,
  isInside,
  isOverlap,
  type LayoutInput,
  type Point,
  type Rect,
} from '@/logic/layout';
import { getProjectedPoint } from '@/map/projection';
import {
  getDefaultInfoRectanglePlacement,
  getInfoRectangle,
  getInfoRectanglePlacement,
  moveInfoRectangle,
  resizeInfoRectangle,
  type InfoRectanglePlacement,
  type InfoRectangleResizeHandle,
} from '@/map/InfoRectangle';
import type { ProcessedData, SchoolGroup, Student } from '@/types';
import type { MapLevel } from './LevelManager';
import {
  createRegionCardGroups,
  getRegionSchoolGrid,
  type RegionCardGroup,
  type RegionCenter,
} from './RegionCards';

interface CardDatum {
  id: string;
  title: string;
  schools: SchoolGroup[];
  region: RegionCardGroup | null;
}

interface LabelScene {
  id: string;
  card: CardDatum;
  anchor: Point;
  rect: Rect;
  baseSize: { width: number; height: number };
  scale: number;
}

interface ForeignPanelScene {
  rect: Rect;
  baseSize: { width: number; height: number };
  scale: number;
  schools: SchoolGroup[];
}

export interface SchoolOverlayOptions {
  onStudentSelect?: (student: Student) => void;
  showInfoRectangle?: boolean;
  infoRectanglePlacement?: InfoRectanglePlacement;
  onInfoRectanglePlacementChange?: (placement: InfoRectanglePlacement) => void;
}

function textWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((width, character) => (
    width + (/^[\x00-\x7F]$/.test(character) ? fontSize * 0.6 : fontSize)
  ), 0);
}

function rowContentWidth(
  texts: string[],
  fontSize: number,
  columns: number,
  columnGap: number,
): number {
  let maximum = 0;
  for (let index = 0; index < texts.length; index += columns) {
    const row = texts.slice(index, index + columns);
    maximum = Math.max(
      maximum,
      row.length * Math.max(...row.map((text) => textWidth(text, fontSize))) +
        Math.max(0, row.length - 1) * columnGap,
    );
  }
  return maximum;
}

function cardSize(card: CardDatum): { width: number; height: number } {
  const style = defaultConfig.labelStyle;
  const students = card.schools.flatMap((school) => school.students);
  const regionGrid = card.region
    ? getRegionSchoolGrid(card.schools, style.studentsPerRow)
    : null;
  const effectiveStudentsPerRow = regionGrid?.studentsPerRow ?? style.studentsPerRow;
  const schoolContentWidths = card.schools.map((school) => Math.max(
    textWidth(school.university, style.universityFontSize),
    rowContentWidth(
      school.students.map((student) => student.name),
      style.studentFontSize,
      effectiveStudentsPerRow,
      style.studentColumnGap,
    ),
  ));
  const twoColumnContentWidth = regionGrid?.columns === 2
    ? Math.max(...schoolContentWidths) * 2 + style.regionColumnGap
    : 0;
  const contentWidth = Math.max(
    textWidth(card.title, card.region ? style.regionFontSize : style.universityFontSize),
    twoColumnContentWidth,
    ...schoolContentWidths,
    ...students.map((student) => textWidth(student.name, style.studentFontSize)),
  );
  const contentRows = regionGrid
    ? regionGrid.contentRows
    : 1 + Math.ceil(students.length / style.studentsPerRow);
  return {
    width: card.region
      ? Math.max(style.minWidth, contentWidth + style.paddingX * 2)
      : Math.max(style.minWidth, Math.min(style.maxWidth, contentWidth + style.paddingX * 2)),
    height: style.paddingY * 2 + style.lineHeight * contentRows,
  };
}

function schoolCard(school: SchoolGroup): CardDatum {
  return { id: school.university, title: school.university, schools: [school], region: null };
}

function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function foreignPanelSize(schools: SchoolGroup[]): { width: number; height: number } {
  const style = defaultConfig.labelStyle;
  const width = Math.max(
    style.minWidth,
    ...schools.map((school) => cardSize(schoolCard(school)).width),
  );
  const contentHeight = schools.reduce((height, school, index) => {
    const rows = Math.ceil(school.students.length / style.studentsPerRow);
    const spacing = index === 0 ? 0 : defaultConfig.labelSpacing;
    return height + spacing + style.lineHeight * (rows + 1);
  }, 0);

  return {
    width,
    height: style.paddingY * 2 + contentHeight,
  };
}

function rectAtCorner(size: { width: number; height: number }, canvasRect: Rect): Rect {
  const horizontal = defaultConfig.foreignCorner.endsWith('right')
    ? canvasRect.x + canvasRect.width - size.width
    : canvasRect.x;
  const vertical = defaultConfig.foreignCorner.startsWith('bottom')
    ? canvasRect.y + canvasRect.height - size.height
    : canvasRect.y;
  return { x: horizontal, y: vertical, ...size };
}

export class SchoolOverlay {
  private readonly root: Selection<SVGGElement, unknown, null, undefined>;
  private readonly infoRectangle: Selection<SVGRectElement, unknown, null, undefined>;
  private readonly linesLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly anchorsLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly labelsLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly foreignLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly editorLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly editorBlocker: Selection<SVGRectElement, unknown, null, undefined>;
  private readonly editorMoveSurface: Selection<SVGRectElement, unknown, null, undefined>;
  private readonly editorHandles: Selection<SVGGElement, InfoRectangleResizeHandle, SVGGElement, unknown>;
  private domesticSchools: SchoolGroup[] = [];
  private foreignSchools: SchoolGroup[] = [];
  private cardGroupingMode: CardGroupingMode = defaultConfig.cardGroupingMode;
  private mapLevel: MapLevel = 'province';
  private regionCenters = new Map<'province' | 'city', Map<string, RegionCenter>>([
    ['province', new Map()],
    ['city', new Map()],
  ]);
  private readonly positionHistory = new Map<string, Rect>();
  private readonly onStudentSelect?: (student: Student) => void;
  private readonly onInfoRectanglePlacementChange?: (placement: InfoRectanglePlacement) => void;
  private infoRectanglePlacement: InfoRectanglePlacement;
  private showInfoRectangle: boolean;
  private infoRectangleEditing = false;
  private width = 0;
  private height = 0;
  private currentInfoRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private endEditorDrag: (() => void) | null = null;
  private hoveredSchoolId: string | null = null;
  private hoveredRegion: { level: 'province' | 'city'; adcode: string } | null = null;
  private touchSelectedSchoolId: string | null = null;
  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    const target = event.target;
    const label = target instanceof Element ? target.closest('g.school-label') : null;
    if (label && this.labelsLayer.node()?.contains(label)) return;
    this.touchSelectedSchoolId = null;
    this.applyLineHighlight();
  };

  constructor(
    svg: Selection<SVGSVGElement, unknown, null, undefined>,
    options: SchoolOverlayOptions = {},
  ) {
    this.onStudentSelect = options.onStudentSelect;
    this.onInfoRectanglePlacementChange = options.onInfoRectanglePlacementChange;
    this.infoRectanglePlacement = options.infoRectanglePlacement
      ?? getDefaultInfoRectanglePlacement();
    this.showInfoRectangle = options.showInfoRectangle ?? defaultConfig.showInfoRectangle;
    this.root = svg.append('g')
      .attr('class', 'school-overlay')
      .attr('data-label-spacing', defaultConfig.labelSpacing)
      .style('pointer-events', 'none');
    this.infoRectangle = this.root.append('rect')
      .attr('class', 'info-rectangle')
      .attr('fill', 'rgba(255, 255, 255, 0.06)')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4 5')
      .attr('vector-effect', 'non-scaling-stroke')
      .style('pointer-events', 'none');
    this.linesLayer = this.root.append('g').attr('class', 'school-lines');
    this.anchorsLayer = this.root.append('g').attr('class', 'school-anchors');
    this.labelsLayer = this.root.append('g').attr('class', 'school-labels');
    this.foreignLayer = this.root.append('g').attr('class', 'foreign-schools');
    this.editorLayer = this.root.append('g')
      .attr('class', 'info-rectangle-editor')
      .attr('data-testid', 'info-rectangle-editor')
      .style('display', 'none')
      .style('pointer-events', 'none')
      .style('touch-action', 'none');
    this.editorBlocker = this.editorLayer.append('rect')
      .attr('class', 'info-rectangle-editor-blocker')
      .attr('fill', 'transparent')
      .style('pointer-events', 'all')
      .style('cursor', 'default');
    this.editorMoveSurface = this.editorLayer.append('rect')
      .attr('class', 'info-rectangle-move-surface')
      .attr('data-testid', 'info-rectangle-move-surface')
      .attr('fill', 'transparent')
      .style('pointer-events', 'all')
      .style('cursor', 'move')
      .on('pointerdown', (event: PointerEvent) => this.beginEditorDrag(event));
    const handles: InfoRectangleResizeHandle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
    this.editorHandles = this.editorLayer.selectAll<SVGGElement, InfoRectangleResizeHandle>(
      'g.info-rectangle-handle',
    )
      .data(handles)
      .enter()
      .append('g')
      .attr('class', 'info-rectangle-handle')
      .attr('data-handle', (handle) => handle)
      .style('pointer-events', 'all')
      .style('cursor', (handle) => `${handle}-resize`)
      .on('pointerdown', (event: PointerEvent, handle) => this.beginEditorDrag(event, handle));
    this.editorHandles.append('rect')
      .attr('class', 'info-rectangle-handle-hit')
      .attr('x', -defaultConfig.infoRectangleEditor.handleHitSize / 2)
      .attr('y', -defaultConfig.infoRectangleEditor.handleHitSize / 2)
      .attr('width', defaultConfig.infoRectangleEditor.handleHitSize)
      .attr('height', defaultConfig.infoRectangleEditor.handleHitSize)
      .attr('fill', 'transparent');
    this.editorHandles.append('rect')
      .attr('class', 'info-rectangle-handle-visual')
      .attr('x', -defaultConfig.infoRectangleEditor.handleSize / 2)
      .attr('y', -defaultConfig.infoRectangleEditor.handleSize / 2)
      .attr('width', defaultConfig.infoRectangleEditor.handleSize)
      .attr('height', defaultConfig.infoRectangleEditor.handleSize)
      .attr('rx', 2)
      .attr('fill', '#0f766e')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 2)
      .attr('vector-effect', 'non-scaling-stroke')
      .style('pointer-events', 'none');
    this.syncInfoRectangleVisibility();
    document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
  }

  public setData(data: ProcessedData): void {
    this.setSchools(data.domesticSchools, data.foreignSchools);
  }

  public setCardGroupingMode(mode: CardGroupingMode): void {
    this.cardGroupingMode = mode;
  }

  public setMapLevel(level: MapLevel): void {
    this.mapLevel = level;
  }

  public setRegionCenters(
    level: 'province' | 'city',
    centers: ReadonlyMap<string, RegionCenter>,
  ): void {
    this.regionCenters.set(level, new Map(centers));
  }

  public setShowInfoRectangle(show: boolean): void {
    this.showInfoRectangle = show;
    this.syncInfoRectangleVisibility();
  }

  public setInfoRectanglePlacement(placement: InfoRectanglePlacement): void {
    this.infoRectanglePlacement = { ...placement };
    this.updateInfoRectangleGeometry();
  }

  public getInfoRectanglePlacement(): InfoRectanglePlacement {
    return { ...this.infoRectanglePlacement };
  }

  public setInfoRectangleEditing(editing: boolean): void {
    this.infoRectangleEditing = editing;
    this.root.attr('data-info-rectangle-editing', String(editing));
    this.editorLayer.style('display', editing ? '' : 'none');
    this.setInteractionActive(editing);
    this.syncInfoRectangleVisibility();
    this.updateInfoRectangleGeometry();
  }

  public setSchools(domesticSchools: SchoolGroup[], foreignSchools: SchoolGroup[]): void {
    this.domesticSchools = domesticSchools;
    this.foreignSchools = foreignSchools;
    this.positionHistory.clear();
    this.hoveredSchoolId = null;
    this.hoveredRegion = null;
    this.touchSelectedSchoolId = null;
    this.applyLineHighlight();
  }

  public setHoveredRegion(level: 'province' | 'city', adcode: string): void {
    this.hoveredRegion = { level, adcode };
    this.applyLineHighlight();
  }

  public clearHoveredRegion(level?: 'province' | 'city', adcode?: string): void {
    if (
      level && adcode &&
      (this.hoveredRegion?.level !== level || this.hoveredRegion.adcode !== adcode)
    ) return;
    this.hoveredRegion = null;
    this.applyLineHighlight();
  }

  public setInteractionActive(active: boolean): void {
    this.root.attr('data-interacting', String(active));
    for (const layer of [this.linesLayer, this.anchorsLayer, this.labelsLayer, this.foreignLayer]) {
      layer.interrupt();
      if (active) {
        layer.style('visibility', 'hidden');
      } else {
        layer.style('visibility', null);
      }
    }
  }

  public resetLayout(): void {
    this.positionHistory.clear();
    for (const layer of [this.linesLayer, this.anchorsLayer, this.labelsLayer, this.foreignLayer]) {
      layer.selectAll('*').interrupt().remove();
    }
  }

  public update(
    width: number,
    height: number,
    projection: GeoProjection,
    transform: ZoomTransform,
  ): void {
    this.width = width;
    this.height = height;
    const infoRect = getInfoRectangle(width, height, this.infoRectanglePlacement);
    this.currentInfoRect = infoRect;
    const margin = defaultConfig.canvasMargin;
    const canvasRect: Rect = {
      x: margin,
      y: margin,
      width: Math.max(0, width - margin * 2),
      height: Math.max(0, height - margin * 2),
    };

    this.infoRectangle
      .attr('x', infoRect.x)
      .attr('y', infoRect.y)
      .attr('width', infoRect.width)
      .attr('height', infoRect.height);
    this.updateEditorGeometry();

    const baseVisibleInputs: LayoutInput[] = [];
    const cardsById = new Map<string, CardDatum>();
    const domesticAnchors: Point[] = [];
    for (const school of this.domesticSchools) {
      if (school.lat === null || school.lng === null) continue;
      const projected = getProjectedPoint(projection, school.lat, school.lng);
      if (!projected) continue;
      const [x, y] = transform.apply([projected.x, projected.y]);
      domesticAnchors.push({ x, y });
    }

    const cards: Array<CardDatum & { longitude: number; latitude: number }> = this.cardGroupingMode === 'region'
      ? createRegionCardGroups(
        this.domesticSchools,
        this.mapLevel,
        this.regionCenters.get(this.mapLevel === 'province' ? 'province' : 'city') ?? new Map(),
      ).map((region) => ({
        id: region.id,
        title: region.name,
        schools: region.schools,
        region,
        longitude: region.longitude,
        latitude: region.latitude,
      }))
      : this.domesticSchools.flatMap((school) => (
        school.lat === null || school.lng === null
          ? []
          : [{ ...schoolCard(school), longitude: school.lng, latitude: school.lat }]
      ));

    for (const card of cards) {
      const projected = getProjectedPoint(projection, card.latitude, card.longitude);
      if (!projected) continue;
      const [x, y] = transform.apply([projected.x, projected.y]);
      const anchor = { x, y };
      if (!containsPoint(infoRect, anchor)) continue;

      const size = cardSize(card);
      baseVisibleInputs.push({ id: card.id, anchor, ...size });
      cardsById.set(card.id, card);
    }

    const showForeignSchools = (
      this.foreignSchools.length > 0 &&
      domesticAnchors.length === this.domesticSchools.length &&
      domesticAnchors.every((anchor) => containsPoint(infoRect, anchor))
    );
    if (domesticAnchors.length > 0) {
      this.root
        .attr('data-domestic-anchor-min-x', Math.min(...domesticAnchors.map((anchor) => anchor.x)))
        .attr('data-domestic-anchor-max-x', Math.max(...domesticAnchors.map((anchor) => anchor.x)))
        .attr('data-domestic-anchor-min-y', Math.min(...domesticAnchors.map((anchor) => anchor.y)))
        .attr('data-domestic-anchor-max-y', Math.max(...domesticAnchors.map((anchor) => anchor.y)))
        .attr('data-all-domestic-in-range', String(showForeignSchools));
    }
    const baseForeignSize = showForeignSchools ? foreignPanelSize(this.foreignSchools) : null;
    const createForeignScene = (scale: number): ForeignPanelScene | null => {
      if (!baseForeignSize) return null;
      return {
        rect: rectAtCorner({
          width: baseForeignSize.width * scale,
          height: baseForeignSize.height * scale,
        }, canvasRect),
        baseSize: baseForeignSize,
        scale,
        schools: this.foreignSchools,
      };
    };
    const fullSizeForeignScene = createForeignScene(1);
    const historyConflictsWithForeignPanel = fullSizeForeignScene && Array.from(this.positionHistory.values())
      .some((rect) => isOverlap(rect, fullSizeForeignScene.rect, defaultConfig.labelSpacing));
    const layoutHistory = historyConflictsWithForeignPanel
      ? new Map<string, Rect>()
      : this.positionHistory;
    const fittingLayout = calculateFittingLayout(baseVisibleInputs, layoutHistory, {
      minScale: defaultConfig.labelScale.min,
      scaleStep: defaultConfig.labelScale.step,
      getConfig: (scale) => {
        const scene = createForeignScene(scale);
        return {
          canvasRect,
          infoRect,
          obstacles: scene ? [scene.rect] : [],
          spacing: defaultConfig.labelSpacing,
          weights: defaultConfig.layoutWeights,
        };
      },
      isScaleAllowed: (scale) => {
        const scene = createForeignScene(scale);
        return !scene || (
          isInside(scene.rect, canvasRect) &&
          !isOverlap(scene.rect, infoRect, 0)
        );
      },
    });
    const foreignScene = createForeignScene(fittingLayout.scale);
    const baseInputsById = new Map(baseVisibleInputs.map((input) => [input.id, input]));

    const scenes: LabelScene[] = [];
    for (const input of fittingLayout.inputs) {
      const rect = fittingLayout.layout.get(input.id);
      const card = cardsById.get(input.id);
      const baseInput = baseInputsById.get(input.id);
      if (!rect || !card || !baseInput) continue;
      this.positionHistory.set(input.id, rect);
      scenes.push({
        id: input.id,
        card,
        anchor: input.anchor,
        rect,
        baseSize: { width: baseInput.width, height: baseInput.height },
        scale: fittingLayout.scale,
      });
    }

    this.root
      .attr('data-visible-school-count', scenes.length)
      .attr('data-card-grouping', this.cardGroupingMode)
      .attr('data-label-scale', fittingLayout.scale)
      .attr('data-layout-fits', String(fittingLayout.satisfiesHardConstraints));
    this.renderLines(scenes);
    this.renderAnchors(scenes);
    this.renderLabels(scenes);
    this.renderForeignPanel(foreignScene);
  }

  public destroy(): void {
    this.endEditorDrag?.();
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    this.root.interrupt();
    this.root.selectAll('*').interrupt();
    this.root.remove();
  }

  private syncInfoRectangleVisibility(): void {
    this.infoRectangle.style(
      'display',
      this.showInfoRectangle || this.infoRectangleEditing ? '' : 'none',
    );
  }

  private updateInfoRectangleGeometry(): void {
    if (this.width <= 0 || this.height <= 0) return;
    this.currentInfoRect = getInfoRectangle(
      this.width,
      this.height,
      this.infoRectanglePlacement,
    );
    this.infoRectangle
      .attr('x', this.currentInfoRect.x)
      .attr('y', this.currentInfoRect.y)
      .attr('width', this.currentInfoRect.width)
      .attr('height', this.currentInfoRect.height);
    this.updateEditorGeometry();
  }

  private updateEditorGeometry(): void {
    const rect = this.currentInfoRect;
    this.editorBlocker
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', this.width)
      .attr('height', this.height);
    this.editorMoveSurface
      .attr('x', rect.x)
      .attr('y', rect.y)
      .attr('width', rect.width)
      .attr('height', rect.height);
    const points: Record<InfoRectangleResizeHandle, Point> = {
      n: { x: rect.x + rect.width / 2, y: rect.y },
      ne: { x: rect.x + rect.width, y: rect.y },
      e: { x: rect.x + rect.width, y: rect.y + rect.height / 2 },
      se: { x: rect.x + rect.width, y: rect.y + rect.height },
      s: { x: rect.x + rect.width / 2, y: rect.y + rect.height },
      sw: { x: rect.x, y: rect.y + rect.height },
      w: { x: rect.x, y: rect.y + rect.height / 2 },
      nw: { x: rect.x, y: rect.y },
    };
    this.editorHandles.attr(
      'transform',
      (handle) => `translate(${points[handle].x},${points[handle].y})`,
    );
    const hitSize = defaultConfig.infoRectangleEditor.handleHitSize;
    this.editorHandles.select<SVGRectElement>('rect.info-rectangle-handle-hit')
      .attr('x', (handle) => (
        handle === 'n' || handle === 's'
          ? -Math.max(hitSize, rect.width - hitSize) / 2
          : -hitSize / 2
      ))
      .attr('y', (handle) => (
        handle === 'e' || handle === 'w'
          ? -Math.max(hitSize, rect.height - hitSize) / 2
          : -hitSize / 2
      ))
      .attr('width', (handle) => (
        handle === 'n' || handle === 's'
          ? Math.max(hitSize, rect.width - hitSize)
          : hitSize
      ))
      .attr('height', (handle) => (
        handle === 'e' || handle === 'w'
          ? Math.max(hitSize, rect.height - hitSize)
          : hitSize
      ));
  }

  private beginEditorDrag(event: PointerEvent, handle?: InfoRectangleResizeHandle): void {
    if (!this.infoRectangleEditing) return;
    event.preventDefault();
    event.stopPropagation();
    this.endEditorDrag?.();

    const pointerId = event.pointerId;
    const start = this.clientToSvgPoint(event);
    const initial = { ...this.currentInfoRect };
    const margin = defaultConfig.canvasMargin;
    const bounds: Rect = {
      x: margin,
      y: margin,
      width: Math.max(0, this.width - margin * 2),
      height: Math.max(0, this.height - margin * 2),
    };
    const minWidth = Math.min(defaultConfig.infoRectangleEditor.minWidth, bounds.width);
    const minHeight = Math.min(defaultConfig.infoRectangleEditor.minHeight, bounds.height);
    const move = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const point = this.clientToSvgPoint(moveEvent);
      const deltaX = point.x - start.x;
      const deltaY = point.y - start.y;
      const next = handle
        ? resizeInfoRectangle(initial, handle, deltaX, deltaY, bounds, minWidth, minHeight)
        : moveInfoRectangle(initial, deltaX, deltaY, bounds);
      this.infoRectanglePlacement = getInfoRectanglePlacement(next, this.width, this.height);
      this.currentInfoRect = next;
      this.updateInfoRectangleGeometry();
      this.onInfoRectanglePlacementChange?.(this.getInfoRectanglePlacement());
    };
    const end = (endEvent?: PointerEvent): void => {
      if (endEvent && endEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      this.endEditorDrag = null;
    };
    this.endEditorDrag = () => end();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  private clientToSvgPoint(event: PointerEvent): Point {
    const svg = this.root.node()?.ownerSVGElement;
    const bounds = svg?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 };
    return {
      x: (event.clientX - bounds.left) * this.width / bounds.width,
      y: (event.clientY - bounds.top) * this.height / bounds.height,
    };
  }

  private renderLines(scenes: LabelScene[]): void {
    const lines = this.linesLayer.selectAll<SVGLineElement, LabelScene>('line.school-line')
      .data(scenes, (scene) => scene.id);

    lines.enter()
      .append('line')
      .attr('class', 'school-line')
      .attr('stroke', '#64748b')
      .attr('stroke-width', 1)
      .attr('opacity', 0)
      .attr('vector-effect', 'non-scaling-stroke')
      .merge(lines)
      .attr('data-school', (scene) => scene.card.region ? null : scene.card.schools[0]?.university)
      .attr('data-region-card', (scene) => scene.card.region?.adcode ?? null)
      .attr('data-province-adcode', (scene) => scene.card.schools[0]?.provinceAdcode)
      .attr('data-city-adcode', (scene) => scene.card.schools[0]?.cityAdcode)
      .attr('x1', (scene) => scene.anchor.x)
      .attr('y1', (scene) => scene.anchor.y)
      .attr('x2', (scene) => getConnectionPoint(scene.anchor, scene.rect).x)
      .attr('y2', (scene) => getConnectionPoint(scene.anchor, scene.rect).y)
      .attr('opacity', 0.72);

    this.applyLineHighlight();

    lines.exit()
      .transition()
      .duration(defaultConfig.layoutTransitionDurationMs)
      .attr('opacity', 0)
      .remove();
  }

  private renderAnchors(scenes: LabelScene[]): void {
    const anchors = this.anchorsLayer.selectAll<SVGCircleElement, LabelScene>('circle.school-anchor')
      .data(scenes, (scene) => scene.id);

    anchors.enter()
      .append('circle')
      .attr('class', 'school-anchor')
      .attr('r', defaultConfig.labelStyle.anchorRadius)
      .attr('fill', '#0f766e')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0)
      .merge(anchors)
      .attr('cx', (scene) => scene.anchor.x)
      .attr('cy', (scene) => scene.anchor.y)
      .attr('opacity', 1);

    anchors.exit()
      .transition()
      .duration(defaultConfig.layoutTransitionDurationMs)
      .attr('opacity', 0)
      .remove();
  }

  private renderLabels(scenes: LabelScene[]): void {
    const style = defaultConfig.labelStyle;
    const onStudentSelect = this.onStudentSelect;
    const labels = this.labelsLayer.selectAll<SVGGElement, LabelScene>('g.school-label')
      .data(scenes, (scene) => scene.id);
    const entered = labels.enter()
      .append('g')
      .attr('class', 'school-label')
      .attr('transform', (scene) => (
        `translate(${scene.rect.x},${scene.rect.y}) scale(${scene.scale})`
      ))
      .attr('opacity', 0)
      .style('pointer-events', 'auto');

    entered.append('rect')
      .attr('class', 'school-label-background')
      .attr('rx', 4)
      .attr('fill', '#ffffff')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 1);
    entered.append('text')
      .attr('class', 'school-label-title')
      .attr('fill', '#111827')
      .attr('font-size', style.universityFontSize)
      .attr('font-weight', 600);

    const merged = entered.merge(labels)
      .attr('data-school', (scene) => scene.card.region ? null : scene.card.schools[0]?.university)
      .attr('data-region-card', (scene) => scene.card.region?.adcode ?? null)
      .attr('data-card-title', (scene) => scene.card.title)
      .attr('data-university-columns', (scene) => (
        scene.card.region
          ? getRegionSchoolGrid(scene.card.schools, style.studentsPerRow).columns
          : 1
      ))
      .attr('data-label-x', (scene) => scene.rect.x)
      .attr('data-label-y', (scene) => scene.rect.y)
      .attr('data-label-width', (scene) => scene.rect.width)
      .attr('data-label-height', (scene) => scene.rect.height)
      .attr('data-label-scale', (scene) => scene.scale)
      .on('pointerenter.line-highlight', (event: PointerEvent, scene) => {
        if (event.pointerType === 'touch') return;
        this.hoveredSchoolId = scene.id;
        this.applyLineHighlight();
      })
      .on('pointerleave.line-highlight', (event: PointerEvent, scene) => {
        if (event.pointerType === 'touch' || this.hoveredSchoolId !== scene.id) return;
        this.hoveredSchoolId = null;
        this.applyLineHighlight();
      })
      .on('pointerdown.line-highlight', (event: PointerEvent, scene) => {
        if (event.pointerType !== 'touch') return;
        this.touchSelectedSchoolId = scene.id;
        this.applyLineHighlight();
      });

    this.applyLineHighlight();

    merged.select<SVGRectElement>('rect.school-label-background')
      .attr('width', (scene) => scene.baseSize.width)
      .attr('height', (scene) => scene.baseSize.height);
    merged.select<SVGTextElement>('text.school-label-title')
      .attr('x', style.paddingX)
      .attr('y', (scene) => style.paddingY + (
        scene.card.region ? style.regionFontSize : style.universityFontSize
      ))
      .attr('font-size', (scene) => (
        scene.card.region ? style.regionFontSize : style.universityFontSize
      ))
      .text((scene) => scene.card.title);

    merged.each(function updateCardContent(scene) {
      const regionGrid = scene.card.region
        ? getRegionSchoolGrid(scene.card.schools, style.studentsPerRow)
        : null;
      const universityRows = regionGrid?.placements ?? [];
      const studentColumns = regionGrid?.studentsPerRow ?? style.studentsPerRow;
      const studentColumnGap = studentColumns > 1 ? style.studentColumnGap : 0;
      const cardColumnGap = regionGrid?.columns === 2 ? style.regionColumnGap : 0;
      const cardColumnWidth = (
        scene.baseSize.width - style.paddingX * 2 - cardColumnGap
      ) / (regionGrid?.columns ?? 1);
      const studentColumnWidth = (
        cardColumnWidth - studentColumnGap * (studentColumns - 1)
      ) / studentColumns;
      const universityLabels = select(this)
        .selectAll<SVGTextElement, {
          school: SchoolGroup;
          column: number;
          row: number;
        }>('text.card-university')
        .data(universityRows, (item) => item.school.university);
      universityLabels.enter()
        .append('text')
        .attr('class', 'card-university')
        .attr('fill', '#334155')
        .attr('font-size', style.universityFontSize)
        .attr('font-weight', 600)
        .merge(universityLabels)
        .attr('x', (item) => (
          style.paddingX + item.column * (cardColumnWidth + cardColumnGap)
        ))
        .attr('y', (item) => style.paddingY + style.lineHeight * item.row)
        .text((item) => item.school.university);
      universityLabels.exit().remove();

      const studentRows = scene.card.schools.flatMap((school) => {
        const placement = universityRows.find((item) => item.school === school);
        const universityRow = placement?.row ?? 1;
        const firstStudentRow = scene.card.region ? universityRow + 1 : 2;
        return school.students.map((student, index) => ({
          student,
          cardColumn: placement?.column ?? 0,
          column: index % studentColumns,
          row: firstStudentRow + Math.floor(index / studentColumns),
        }));
      });
      const studentLabels = select(this).selectAll<SVGTextElement, {
        student: Student;
        cardColumn: number;
        column: number;
        row: number;
      }>('text.student-name')
        .data(studentRows, (item) => String(item.student.originalIndex));
      studentLabels.enter()
        .append('text')
        .attr('class', 'student-name')
        .attr('fill', '#475569')
        .attr('font-size', style.studentFontSize)
        .merge(studentLabels)
        .attr('x', (item) => (
          style.paddingX +
          item.cardColumn * (cardColumnWidth + cardColumnGap) +
          item.column * (
            studentColumnWidth + studentColumnGap
          )
        ))
        .attr('y', (item) => style.paddingY + style.lineHeight * item.row)
        .attr('data-student-index', (item) => item.student.originalIndex)
        .attr('data-has-contact', (item) => String(item.student.contact !== null))
        .attr('role', 'button')
        .attr('tabindex', 0)
        .attr('aria-label', (item) => `查看${item.student.name}详情`)
        .on('click', (event: MouseEvent, item) => {
          (event.currentTarget as SVGTextElement).focus();
          onStudentSelect?.(item.student);
        })
        .on('keydown', (event: KeyboardEvent, item) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onStudentSelect?.(item.student);
        })
        .text((item) => item.student.name);
      studentLabels.exit().remove();
    });

    merged.interrupt()
      .transition()
      .duration(defaultConfig.layoutTransitionDurationMs)
      .attr('transform', (scene) => (
        `translate(${scene.rect.x},${scene.rect.y}) scale(${scene.scale})`
      ))
      .attr('opacity', 1);

    labels.exit()
      .interrupt()
      .transition()
      .duration(defaultConfig.layoutTransitionDurationMs)
      .attr('opacity', 0)
      .remove();
  }

  private applyLineHighlight(): void {
    const hoveredSchoolId = this.hoveredSchoolId;
    const hoveredRegion = this.hoveredRegion;
    const touchSelectedSchoolId = this.touchSelectedSchoolId;
    const highlighted = this.linesLayer.selectAll<SVGLineElement, LabelScene>('line.school-line')
      .classed('is-highlighted', (scene) => {
        if (hoveredSchoolId) return scene.id === hoveredSchoolId;
        if (hoveredRegion) {
          return scene.card.schools.some((school) => (
            (hoveredRegion.level === 'province' ? school.provinceAdcode : school.cityAdcode)
              === hoveredRegion.adcode
          ));
        }
        return touchSelectedSchoolId !== null && scene.id === touchSelectedSchoolId;
      });
    highlighted.filter('.is-highlighted').raise();
    this.labelsLayer.selectAll<SVGGElement, LabelScene>('g.school-label')
      .classed('is-highlighted', (scene) => (
        scene.id === hoveredSchoolId || scene.id === touchSelectedSchoolId
      ));
  }

  private renderForeignPanel(scene: ForeignPanelScene | null): void {
    const style = defaultConfig.labelStyle;
    const onStudentSelect = this.onStudentSelect;
    const panels = this.foreignLayer.selectAll<SVGGElement, ForeignPanelScene>('g.foreign-schools-panel')
      .data(scene ? [scene] : []);
    const entered = panels.enter()
      .append('g')
      .attr('class', 'foreign-schools-panel')
      .attr('opacity', 0)
      .attr('transform', (scene) => (
        `translate(${scene.rect.x},${scene.rect.y}) scale(${scene.scale})`
      ))
      .style('pointer-events', 'auto');
    entered.append('rect')
      .attr('class', 'foreign-panel-background')
      .attr('rx', 4)
      .attr('fill', '#f8fafc')
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 1);

    const merged = entered.merge(panels)
      .attr('data-corner', defaultConfig.foreignCorner)
      .attr('data-panel-x', (panel) => panel.rect.x)
      .attr('data-panel-y', (panel) => panel.rect.y)
      .attr('data-panel-width', (panel) => panel.rect.width)
      .attr('data-panel-height', (panel) => panel.rect.height)
      .attr('data-label-scale', (panel) => panel.scale);
    merged.select<SVGRectElement>('rect.foreign-panel-background')
      .attr('width', (panel) => panel.baseSize.width)
      .attr('height', (panel) => panel.baseSize.height);

    merged.each(function updateSchools(panel) {
      let offsetY = style.paddingY;
      const schoolOffsets = new Map<string, number>();
      for (const school of panel.schools) {
        schoolOffsets.set(school.university, offsetY);
        const rows = Math.ceil(school.students.length / style.studentsPerRow);
        offsetY += style.lineHeight * (rows + 1) + defaultConfig.labelSpacing;
      }

      const groups = select(this).selectAll<SVGGElement, SchoolGroup>('g.foreign-school-group')
        .data(panel.schools, (school) => school.university);
      const groupEnter = groups.enter()
        .append('g')
        .attr('class', 'foreign-school-group');
      groupEnter.append('text')
        .attr('class', 'foreign-school-title')
        .attr('fill', '#0f172a')
        .attr('font-size', style.universityFontSize)
        .attr('font-weight', 600);

      const groupMerged = groupEnter.merge(groups)
        .attr('transform', (school) => `translate(${style.paddingX},${schoolOffsets.get(school.university)})`);
      groupMerged.select<SVGTextElement>('text.foreign-school-title')
        .attr('y', style.universityFontSize)
        .text((school) => school.university);
      groupMerged.each(function updateForeignStudents(school) {
        const students = select(this).selectAll<SVGTextElement, Student>('text.student-name')
          .data(school.students, (student) => String(student.originalIndex));
        students.enter()
          .append('text')
          .attr('class', 'student-name')
          .attr('fill', '#475569')
          .attr('font-size', style.studentFontSize)
          .merge(students)
          .attr('x', (_, index) => (
            (index % style.studentsPerRow) * (
              (panel.baseSize.width - style.paddingX * 2) / style.studentsPerRow
            )
          ))
          .attr('y', (_, index) => (
            style.lineHeight * (Math.floor(index / style.studentsPerRow) + 2)
          ))
          .attr('data-student-index', (student) => student.originalIndex)
          .attr('data-has-contact', (student) => String(student.contact !== null))
          .attr('role', 'button')
          .attr('tabindex', 0)
          .attr('aria-label', (student) => `查看${student.name}详情`)
          .on('click', (event: MouseEvent, student) => {
            (event.currentTarget as SVGTextElement).focus();
            onStudentSelect?.(student);
          })
          .on('keydown', (event: KeyboardEvent, student) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onStudentSelect?.(student);
          })
          .text((student) => student.name);
        students.exit().remove();
      });
      groups.exit().remove();
    });

    merged.interrupt()
      .transition()
      .duration(defaultConfig.layoutTransitionDurationMs)
      .attr('transform', (panel) => (
        `translate(${panel.rect.x},${panel.rect.y}) scale(${panel.scale})`
      ))
      .attr('opacity', 1);
    panels.exit()
      .interrupt()
      .transition()
      .duration(defaultConfig.layoutTransitionDurationMs)
      .attr('opacity', 0)
      .remove();
  }
}
