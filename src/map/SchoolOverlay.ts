import {
  select,
  type GeoProjection,
  type Selection,
  type ZoomTransform,
} from 'd3';
import { defaultConfig, type CardGroupingMode, type Corner } from '@/config';
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
import type {
  MiddleSchoolInfo,
  ProcessedData,
  SchoolGroup,
  Student,
  TeacherEntry,
} from '@/types';
import type { MapLevel } from './LevelManager';
import {
  createRegionCardGroups,
  getRegionSchoolGrid,
  type RegionCardGroup,
  type RegionCenter,
} from './RegionCards';
import type { SearchResult } from '@/logic/search';
import { calculateArrows, type ArrowGroup } from '@/logic/arrow';
import { calculateMiddleSchoolLineWidth } from './MiddleSchool';
import { getDataAssetUrl } from '@/data/fetcher';

const MIDDLE_SCHOOL_CARD_ID = '\u0000middle-school-card';
const TEACHER_PANEL_ID = '\u0000teacher-panel';
const FOREIGN_PANEL_ID = '\u0000foreign-panel';

export interface NormalizedCardPosition {
  xRatio: number;
  yRatio: number;
}

interface DraggableCardScene {
  id: string;
  rect: Rect;
  scale: number;
}

interface CardDatum {
  id: string;
  title: string;
  schools: SchoolGroup[];
  region: RegionCardGroup | null;
}

interface AnchoredCardDatum extends CardDatum {
  longitude: number;
  latitude: number;
}

interface MiddleSchoolConnection {
  id: string;
  anchor: Point;
  middleSchoolAnchor: Point;
  studentCount: number;
}

interface MiddleSchoolCardScene {
  id: string;
  info: MiddleSchoolInfo;
  anchor: Point;
  connection: Point;
  rect: Rect;
  baseSize: { width: number; height: number };
  scale: number;
}

interface MiddleSchoolTitleImage {
  kind: 'light' | 'dark';
  url: string;
}

interface LabelScene {
  id: string;
  card: CardDatum;
  anchor: Point;
  connection: Point;
  rect: Rect;
  baseSize: { width: number; height: number };
  scale: number;
}

interface ForeignPanelScene {
  id: string;
  rect: Rect;
  baseSize: { width: number; height: number };
  scale: number;
  schools: SchoolGroup[];
}

interface TeacherPanelScene {
  id: string;
  rect: Rect;
  baseSize: { width: number; height: number };
  scale: number;
  teachers: TeacherEntry[];
}

type CardScene = LabelScene | MiddleSchoolCardScene | ForeignPanelScene | TeacherPanelScene;

interface TeacherPanelRow {
  teacher: TeacherEntry;
  nameLines: string[];
  startLine: number;
}

export interface SchoolOverlayOptions {
  onStudentSelect?: (student: Student) => void;
  showInfoRectangle?: boolean;
  infoRectanglePlacement?: InfoRectanglePlacement;
  onInfoRectanglePlacementChange?: (placement: InfoRectanglePlacement) => void;
  enableLocalLayoutOptimization?: boolean;
  showMiddleSchool?: boolean;
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

function rectAtCorner(
  size: { width: number; height: number },
  canvasRect: Rect,
  corner: Corner,
  inwardOffset = 0,
): Rect {
  const horizontal = corner.endsWith('right')
    ? canvasRect.x + canvasRect.width - size.width
    : canvasRect.x;
  const vertical = corner.startsWith('bottom')
    ? canvasRect.y + canvasRect.height - size.height - inwardOffset
    : canvasRect.y + inwardOffset;
  return { x: horizontal, y: vertical, ...size };
}

function rectAtCornerAvoidingObstacles(
  size: { width: number; height: number },
  canvasRect: Rect,
  corner: Corner,
  obstacles: Rect[],
): Rect {
  let inwardOffset = 0;
  for (let index = 0; index <= obstacles.length; index += 1) {
    const rect = rectAtCorner(size, canvasRect, corner, inwardOffset);
    const overlapping = obstacles.filter((obstacle) => (
      isOverlap(rect, obstacle, defaultConfig.labelSpacing)
    ));
    if (overlapping.length === 0) return rect;
    inwardOffset = Math.max(
      inwardOffset,
      ...overlapping.map((obstacle) => (
        corner.startsWith('bottom')
          ? canvasRect.y + canvasRect.height - obstacle.y + defaultConfig.labelSpacing
          : obstacle.y + obstacle.height - canvasRect.y + defaultConfig.labelSpacing
      )),
    );
  }
  return rectAtCorner(size, canvasRect, corner, inwardOffset);
}

function wrapTextByWidth(text: string, maximumWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const character of Array.from(text)) {
    const candidate = `${current}${character}`;
    if (current && textWidth(candidate, fontSize) > maximumWidth) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function teacherPanelLayout(teachers: TeacherEntry[]): {
  width: number;
  height: number;
  roleWidth: number;
  rows: TeacherPanelRow[];
} {
  const style = defaultConfig.labelStyle;
  const title = '教师';
  const roleWidth = Math.max(0, ...teachers.map((teacher) => (
    textWidth(teacher.role, style.studentFontSize)
  )));
  const desiredContentWidth = Math.max(
    textWidth(title, style.universityFontSize),
    ...teachers.flatMap((teacher) => teacher.names.map((name) => (
      roleWidth + style.studentColumnGap + textWidth(name, style.studentFontSize)
    ))),
  );
  const width = Math.max(
    style.minWidth,
    Math.min(style.maxWidth, desiredContentWidth + style.paddingX * 2),
  );
  const nameWidth = Math.max(
    style.studentFontSize,
    width - style.paddingX * 2 - roleWidth - style.studentColumnGap,
  );
  let startLine = 0;
  const rows = teachers.map((teacher) => {
    const nameLines = teacher.names.flatMap((name) => (
      wrapTextByWidth(name, nameWidth, style.studentFontSize)
    ));
    const row = { teacher, nameLines, startLine };
    startLine += Math.max(1, nameLines.length);
    return row;
  });
  return {
    width,
    height: style.paddingY * 2 + style.lineHeight * (1 + startLine),
    roleWidth,
    rows,
  };
}

function middleSchoolCardSize(info: MiddleSchoolInfo): {
  width: number;
  height: number;
  addressLines: string[];
  titleHeight: number;
} {
  const cardStyle = defaultConfig.middleSchoolStyle;
  const labelStyle = defaultConfig.labelStyle;
  const width = cardStyle.cardMaxWidth;
  const contentWidth = width - cardStyle.cardPaddingX * 2;
  const addressLines = wrapTextByWidth(
    info.address,
    contentWidth,
    labelStyle.studentFontSize,
  );
  const titleHeight = info.titleImg
    ? cardStyle.titleImageMaxHeight
    : labelStyle.lineHeight;
  return {
    width,
    height: cardStyle.cardPaddingY * 2 + titleHeight + cardStyle.cardContentGap +
      Math.max(1, addressLines.length) * labelStyle.lineHeight,
    addressLines,
    titleHeight,
  };
}

export class SchoolOverlay {
  private readonly root: Selection<SVGGElement, unknown, null, undefined>;
  private readonly infoRectangle: Selection<SVGRectElement, unknown, null, undefined>;
  private readonly linesLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly middleSchoolLinesLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly middleSchoolCardLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly middleSchoolMarkerLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly anchorsLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly labelsLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly foreignLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly teacherLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly searchArrowsLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly editorLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly editorBlocker: Selection<SVGRectElement, unknown, null, undefined>;
  private readonly editorMoveSurface: Selection<SVGRectElement, unknown, null, undefined>;
  private readonly editorHandles: Selection<SVGGElement, InfoRectangleResizeHandle, SVGGElement, unknown>;
  private domesticSchools: SchoolGroup[] = [];
  private foreignSchools: SchoolGroup[] = [];
  private teachers: TeacherEntry[] = [];
  private middleSchool: MiddleSchoolInfo | null = null;
  private cardGroupingMode: CardGroupingMode = defaultConfig.cardGroupingMode;
  private mapLevel: MapLevel = 'province';
  private regionCenters = new Map<'province' | 'city', Map<string, RegionCenter>>([
    ['province', new Map()],
    ['city', new Map()],
  ]);
  private readonly positionHistory = new Map<string, Rect>();
  private readonly manualCardPositions = new Map<string, NormalizedCardPosition>();
  private readonly onStudentSelect?: (student: Student) => void;
  private readonly onInfoRectanglePlacementChange?: (placement: InfoRectanglePlacement) => void;
  private infoRectanglePlacement: InfoRectanglePlacement;
  private showInfoRectangle: boolean;
  private enableLocalLayoutOptimization: boolean;
  private showMiddleSchool: boolean;
  private fontScale = 1;
  private cardDraggingEnabled = false;
  private infoRectangleEditing = false;
  private width = 0;
  private height = 0;
  private currentInfoRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private endEditorDrag: (() => void) | null = null;
  private endCardDrag: (() => void) | null = null;
  private suppressStudentSelectionUntil = 0;
  private hoveredSchoolId: string | null = null;
  private hoveredRegion: { level: 'province' | 'city'; adcode: string } | null = null;
  private touchSelectedSchoolId: string | null = null;
  private matchedStudents = new Set<Student>();
  private matchedSchools = new Set<SchoolGroup>();
  private matchedTargetSchools = new Set<SchoolGroup>();
  private uiObstacles: Rect[] = [];
  private selectedArrowKey: string | null = null;
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
    this.enableLocalLayoutOptimization = options.enableLocalLayoutOptimization
      ?? defaultConfig.enableLocalLayoutOptimization;
    this.showMiddleSchool = options.showMiddleSchool ?? defaultConfig.showMiddleSchool;
    this.root = svg.append('g')
      .attr('class', 'school-overlay')
      .attr('data-label-spacing', defaultConfig.labelSpacing)
      .attr('data-local-layout-optimization', String(this.enableLocalLayoutOptimization))
      .attr('data-show-middle-school', String(this.showMiddleSchool))
      .attr('data-card-dragging-enabled', 'false')
      .attr('data-manual-card-count', 0)
      .style('pointer-events', 'none');
    this.infoRectangle = this.root.append('rect')
      .attr('class', 'info-rectangle')
      .attr('fill', 'rgba(255, 255, 255, 0.06)')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4 5')
      .attr('vector-effect', 'non-scaling-stroke')
      .style('pointer-events', 'none');
    this.middleSchoolLinesLayer = this.root.append('g')
      .attr('class', 'middle-school-connections')
      .style('display', this.showMiddleSchool ? '' : 'none')
      .style('pointer-events', 'none');
    this.linesLayer = this.root.append('g').attr('class', 'school-lines');
    this.anchorsLayer = this.root.append('g').attr('class', 'school-anchors');
    this.labelsLayer = this.root.append('g').attr('class', 'school-labels');
    this.middleSchoolCardLayer = this.root.append('g')
      .attr('class', 'middle-school-card-layer')
      .style('display', this.showMiddleSchool ? '' : 'none');
    this.middleSchoolMarkerLayer = this.root.append('g')
      .attr('class', 'middle-school-markers')
      .style('display', this.showMiddleSchool ? '' : 'none')
      .style('pointer-events', 'none');
    this.foreignLayer = this.root.append('g').attr('class', 'foreign-schools');
    this.teacherLayer = this.root.append('g').attr('class', 'teachers');
    this.searchArrowsLayer = this.root.append('g').attr('class', 'search-arrows');
    this.editorLayer = this.root.append('g')
      .attr('class', 'info-rectangle-editor')
      .attr('data-testid', 'info-rectangle-editor')
      .attr('data-block-map-navigation', 'true')
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
    this.middleSchool = data.middleSchool;
    this.teachers = data.teachers;
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

  public setShowMiddleSchool(show: boolean): void {
    this.showMiddleSchool = show;
    this.root.attr('data-show-middle-school', String(show));
    this.middleSchoolLinesLayer.style('display', show ? '' : 'none');
    this.middleSchoolCardLayer.style('display', show ? '' : 'none');
    this.middleSchoolMarkerLayer.style('display', show ? '' : 'none');
  }

  public setFontScale(scale: number): void {
    this.fontScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  public setCardDraggingEnabled(enabled: boolean): void {
    if (enabled === this.cardDraggingEnabled) return;
    this.cardDraggingEnabled = enabled;
    this.root.attr('data-card-dragging-enabled', String(enabled));
    if (!enabled) this.resetLayout();
  }

  public setLocalLayoutOptimizationEnabled(enabled: boolean): void {
    this.enableLocalLayoutOptimization = enabled;
    this.root.attr('data-local-layout-optimization', String(enabled));
  }

  public setSearchResult(result: SearchResult): void {
    this.matchedStudents = new Set(result.matchedStudents);
    this.matchedSchools = new Set(result.matchedSchools);
    this.matchedTargetSchools = new Set(result.targetSchools);
    if (
      this.selectedArrowKey &&
      !Array.from(this.matchedTargetSchools).some((school) => (
        this.selectedArrowKey?.split('\u0000').includes(school.university)
      ))
    ) this.selectedArrowKey = null;
    this.root
      .attr('data-search-student-count', this.matchedStudents.size)
      .attr('data-search-school-count', this.matchedSchools.size);
    this.applySearchHighlight();
  }

  public setUiObstacles(obstacles: Rect[]): boolean {
    const next = obstacles.map((obstacle) => ({ ...obstacle }));
    const unchanged = (
      next.length === this.uiObstacles.length &&
      next.every((obstacle, index) => {
        const current = this.uiObstacles[index];
        return (
          current.x === obstacle.x &&
          current.y === obstacle.y &&
          current.width === obstacle.width &&
          current.height === obstacle.height
        );
      })
    );
    if (unchanged) return false;
    this.uiObstacles = next;
    return true;
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
    for (const layer of [
      this.linesLayer,
      this.anchorsLayer,
      this.labelsLayer,
      this.middleSchoolCardLayer,
      this.foreignLayer,
      this.teacherLayer,
    ]) {
      layer.interrupt();
      if (active) {
        layer.style('visibility', 'hidden');
      } else {
        layer.style('visibility', null);
      }
    }
  }

  public resetLayout(): void {
    this.endCardDrag?.();
    this.positionHistory.clear();
    this.manualCardPositions.clear();
    this.root.attr('data-manual-card-count', 0);
    for (const layer of [
      this.linesLayer,
      this.anchorsLayer,
      this.labelsLayer,
      this.middleSchoolCardLayer,
      this.foreignLayer,
      this.teacherLayer,
    ]) {
      layer.selectAll('*').interrupt().remove();
    }
  }

  public getNormalizedCardPositions(): ReadonlyMap<string, NormalizedCardPosition> {
    const positions = new Map<string, NormalizedCardPosition>();
    if (this.width <= 0 || this.height <= 0) return positions;
    for (const [id, rect] of this.positionHistory) {
      positions.set(id, {
        xRatio: rect.x / this.width,
        yRatio: rect.y / this.height,
      });
    }
    return positions;
  }

  public setNormalizedCardPositions(
    positions: ReadonlyMap<string, NormalizedCardPosition>,
  ): void {
    this.endCardDrag?.();
    this.positionHistory.clear();
    this.manualCardPositions.clear();
    for (const [id, position] of positions) {
      if (!Number.isFinite(position.xRatio) || !Number.isFinite(position.yRatio)) continue;
      this.manualCardPositions.set(id, { ...position });
    }
    this.root.attr('data-manual-card-count', this.manualCardPositions.size);
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
    const searchArrowGroups = this.calculateSearchArrowGroups(
      width,
      height,
      projection,
      transform,
      infoRect,
    );
    const arrowHalfSize = defaultConfig.searchArrowHitSize / 2;
    const searchArrowObstacles: Rect[] = searchArrowGroups.map((group) => ({
      x: group.x - arrowHalfSize,
      y: group.y - arrowHalfSize,
      width: defaultConfig.searchArrowHitSize,
      height: defaultConfig.searchArrowHitSize,
    }));

    this.infoRectangle
      .attr('x', infoRect.x)
      .attr('y', infoRect.y)
      .attr('width', infoRect.width)
      .attr('height', infoRect.height);
    this.updateEditorGeometry();

    const baseVisibleInputs: LayoutInput[] = [];
    const cardsById = new Map<string, CardDatum>();
    const baseCardSizes = new Map<string, { width: number; height: number }>();
    const fontScale = this.fontScale;
    const domesticAnchors: Point[] = [];
    for (const school of this.domesticSchools) {
      if (school.lat === null || school.lng === null) continue;
      const projected = getProjectedPoint(projection, school.lat, school.lng);
      if (!projected) continue;
      const [x, y] = transform.apply([projected.x, projected.y]);
      domesticAnchors.push({ x, y });
    }

    const cards = this.getAnchoredCards();
    this.renderMiddleSchoolOverlay(projection, transform, cards);
    const middleSchoolCardInput = this.getMiddleSchoolCardInput(projection, transform);
    if (middleSchoolCardInput) {
      baseVisibleInputs.push({
        ...middleSchoolCardInput,
        width: middleSchoolCardInput.width * fontScale,
        height: middleSchoolCardInput.height * fontScale,
      });
    }

    for (const card of cards) {
      const projected = getProjectedPoint(projection, card.latitude, card.longitude);
      if (!projected) continue;
      const [x, y] = transform.apply([projected.x, projected.y]);
      const anchor = { x, y };
      if (!containsPoint(infoRect, anchor)) continue;

      const size = cardSize(card);
      baseCardSizes.set(card.id, size);
      baseVisibleInputs.push({
        id: card.id,
        anchor,
        width: size.width * fontScale,
        height: size.height * fontScale,
      });
      cardsById.set(card.id, card);
    }

    const allDomesticAnchorsInRange = (
      domesticAnchors.length === this.domesticSchools.length &&
      domesticAnchors.every((anchor) => containsPoint(infoRect, anchor))
    );
    const showForeignSchools = (
      this.foreignSchools.length > 0 && allDomesticAnchorsInRange
    );
    const showTeachers = this.teachers.length > 0 && allDomesticAnchorsInRange;
    if (domesticAnchors.length > 0) {
      this.root
        .attr('data-domestic-anchor-min-x', Math.min(...domesticAnchors.map((anchor) => anchor.x)))
        .attr('data-domestic-anchor-max-x', Math.max(...domesticAnchors.map((anchor) => anchor.x)))
        .attr('data-domestic-anchor-min-y', Math.min(...domesticAnchors.map((anchor) => anchor.y)))
        .attr('data-domestic-anchor-max-y', Math.max(...domesticAnchors.map((anchor) => anchor.y)))
        .attr('data-all-domestic-in-range', String(allDomesticAnchorsInRange));
    }
    const baseTeacherSize = showTeachers
      ? teacherPanelLayout(this.teachers)
      : null;
    const createTeacherScene = (scale: number): TeacherPanelScene | null => {
      if (!baseTeacherSize) return null;
      const scaledSize = {
        width: baseTeacherSize.width * scale * fontScale,
        height: baseTeacherSize.height * scale * fontScale,
      };
      return {
        id: TEACHER_PANEL_ID,
        rect: rectAtCornerAvoidingObstacles(
          scaledSize,
          canvasRect,
          defaultConfig.teacherCorner,
          this.uiObstacles,
        ),
        baseSize: baseTeacherSize,
        scale: scale * fontScale,
        teachers: this.teachers,
      };
    };
    const baseForeignSize = showForeignSchools ? foreignPanelSize(this.foreignSchools) : null;
    const createForeignScene = (scale: number): ForeignPanelScene | null => {
      if (!baseForeignSize) return null;
      const teacherScene = createTeacherScene(scale);
      const scaledSize = {
        width: baseForeignSize.width * scale * fontScale,
        height: baseForeignSize.height * scale * fontScale,
      };
      return {
        id: FOREIGN_PANEL_ID,
        rect: rectAtCornerAvoidingObstacles(
          scaledSize,
          canvasRect,
          defaultConfig.foreignCorner,
          [
            ...this.uiObstacles,
            ...(teacherScene ? [teacherScene.rect] : []),
          ],
        ),
        baseSize: baseForeignSize,
        scale: scale * fontScale,
        schools: this.foreignSchools,
      };
    };
    const getFixedScenes = (scale: number): {
      teacher: TeacherPanelScene | null;
      foreign: ForeignPanelScene | null;
    } => ({
      teacher: createTeacherScene(scale),
      foreign: createForeignScene(scale),
    });
    const fullSizeTeacherScene = createTeacherScene(1);
    const fullSizeForeignScene = createForeignScene(1);
    const fullSizeFixedRects = [fullSizeTeacherScene, fullSizeForeignScene]
      .flatMap((scene) => scene ? [scene.rect] : []);
    const historyConflictsWithFixedPanel = Array.from(this.positionHistory.values())
      .some((rect) => fullSizeFixedRects.some((fixedRect) => (
        isOverlap(rect, fixedRect, defaultConfig.labelSpacing)
      )));
    const layoutHistory = historyConflictsWithFixedPanel
      ? new Map<string, Rect>()
      : new Map(this.positionHistory);
    for (const input of baseVisibleInputs) {
      const manualRect = this.getManualCardRect(input.id, input, canvasRect);
      if (manualRect) layoutHistory.set(input.id, manualRect);
    }
    const fittingLayout = calculateFittingLayout(baseVisibleInputs, layoutHistory, {
      minScale: defaultConfig.labelScale.min,
      scaleStep: defaultConfig.labelScale.step,
      optimize: this.enableLocalLayoutOptimization,
      getConfig: (scale) => {
        const fixedScenes = getFixedScenes(scale);
        return {
          canvasRect,
          infoRect,
          obstacles: [
            ...this.uiObstacles,
            ...searchArrowObstacles,
            ...(fixedScenes.teacher ? [fixedScenes.teacher.rect] : []),
            ...(fixedScenes.foreign ? [fixedScenes.foreign.rect] : []),
          ],
          spacing: defaultConfig.labelSpacing,
          lineFan: defaultConfig.lineFan,
          weights: defaultConfig.layoutWeights,
        };
      },
      isScaleAllowed: (scale) => {
        const fixedScenes = getFixedScenes(scale);
        const teacherAllowed = !fixedScenes.teacher || isInside(
          fixedScenes.teacher.rect,
          canvasRect,
        );
        const foreignAllowed = !fixedScenes.foreign || (
          isInside(fixedScenes.foreign.rect, canvasRect) &&
          !isOverlap(fixedScenes.foreign.rect, infoRect, 0)
        );
        return teacherAllowed && foreignAllowed;
      },
    });
    const teacherScene = this.applyManualFixedScenePosition(
      createTeacherScene(fittingLayout.scale),
      canvasRect,
    );
    const foreignScene = this.applyManualFixedScenePosition(
      createForeignScene(fittingLayout.scale),
      canvasRect,
    );
    const baseInputsById = new Map(baseVisibleInputs.map((input) => [input.id, input]));

    const scenes: LabelScene[] = [];
    let middleSchoolCardScene: MiddleSchoolCardScene | null = null;
    for (const input of fittingLayout.inputs) {
      const rect = fittingLayout.layout.get(input.id);
      const baseInput = baseInputsById.get(input.id);
      if (!rect || !baseInput) continue;
      const sceneRect = this.getManualCardRect(input.id, rect, canvasRect) ?? rect;
      const connection = this.manualCardPositions.has(input.id)
        ? getConnectionPoint(input.anchor, sceneRect)
        : fittingLayout.connections.get(input.id) ?? input.anchor;
      this.positionHistory.set(input.id, sceneRect);
      if (input.id === MIDDLE_SCHOOL_CARD_ID && this.middleSchool) {
        middleSchoolCardScene = {
          id: MIDDLE_SCHOOL_CARD_ID,
          info: this.middleSchool,
          anchor: input.anchor,
          connection,
          rect: sceneRect,
          baseSize: middleSchoolCardSize(this.middleSchool),
          scale: fittingLayout.scale * fontScale,
        };
        continue;
      }
      const card = cardsById.get(input.id);
      if (!card) continue;
      scenes.push({
        id: input.id,
        card,
        anchor: input.anchor,
        connection,
        rect: sceneRect,
        baseSize: baseCardSizes.get(input.id) ?? {
          width: baseInput.width / fontScale,
          height: baseInput.height / fontScale,
        },
        scale: fittingLayout.scale * fontScale,
      });
    }

    this.root
      .attr('data-visible-school-count', scenes.length)
      .attr('data-card-grouping', this.cardGroupingMode)
      .attr('data-label-scale', fittingLayout.scale * fontScale)
      .attr('data-layout-fits', String(fittingLayout.satisfiesHardConstraints));
    this.renderLines(scenes);
    this.renderAnchors(scenes);
    this.renderLabels(scenes);
    this.renderMiddleSchoolCard(middleSchoolCardScene);
    this.renderTeacherPanel(teacherScene);
    this.renderForeignPanel(foreignScene);
    this.renderSearchArrows(searchArrowGroups);
  }

  public updateMiddleSchoolConnections(
    width: number,
    height: number,
    projection: GeoProjection,
    transform: ZoomTransform,
  ): void {
    this.width = width;
    this.height = height;
    this.currentInfoRect = getInfoRectangle(width, height, this.infoRectanglePlacement);
    this.renderMiddleSchoolOverlay(projection, transform, this.getAnchoredCards());
  }

  public updateSearchArrows(
    width: number,
    height: number,
    projection: GeoProjection,
    transform: ZoomTransform,
  ): void {
    const infoRect = getInfoRectangle(width, height, this.infoRectanglePlacement);
    this.renderSearchArrows(this.calculateSearchArrowGroups(
      width,
      height,
      projection,
      transform,
      infoRect,
    ));
  }

  public destroy(): void {
    this.endEditorDrag?.();
    this.endCardDrag?.();
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

  private getManualCardRect(
    id: string,
    size: { width: number; height: number },
    bounds: Rect,
  ): Rect | null {
    const position = this.manualCardPositions.get(id);
    if (!position) return null;
    return this.constrainCardRect({
      x: position.xRatio * this.width,
      y: position.yRatio * this.height,
      width: size.width,
      height: size.height,
    }, bounds);
  }

  private applyManualFixedScenePosition<T extends DraggableCardScene>(
    scene: T | null,
    bounds: Rect,
  ): T | null {
    if (!scene) return null;
    const rect = this.getManualCardRect(scene.id, scene.rect, bounds);
    return rect ? { ...scene, rect } : scene;
  }

  private beginCardDrag(
    event: PointerEvent,
    scene: CardScene,
    group: SVGGElement,
  ): void {
    if (!this.cardDraggingEnabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.endCardDrag?.();

    const pointerId = event.pointerId;
    const start = this.clientToSvgPoint(event);
    const initialRect = { ...scene.rect };
    const margin = defaultConfig.canvasMargin;
    const bounds: Rect = {
      x: margin,
      y: margin,
      width: Math.max(0, this.width - margin * 2),
      height: Math.max(0, this.height - margin * 2),
    };
    let moved = false;
    const move = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const point = this.clientToSvgPoint(moveEvent);
      const rect = this.constrainCardRect({
        ...initialRect,
        x: initialRect.x + point.x - start.x,
        y: initialRect.y + point.y - start.y,
      }, bounds);
      moved ||= Math.abs(rect.x - initialRect.x) > 1 || Math.abs(rect.y - initialRect.y) > 1;
      scene.rect = rect;
      this.manualCardPositions.set(scene.id, {
        xRatio: this.width > 0 ? rect.x / this.width : 0,
        yRatio: this.height > 0 ? rect.y / this.height : 0,
      });
      this.root.attr('data-manual-card-count', this.manualCardPositions.size);
      if (this.positionHistory.has(scene.id)) this.positionHistory.set(scene.id, rect);
      this.updateDraggedCard(group, scene);
    };
    const end = (endEvent?: PointerEvent): void => {
      if (endEvent && endEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (moved) this.suppressStudentSelectionUntil = performance.now() + 300;
      this.endCardDrag = null;
    };
    this.endCardDrag = () => end();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  private constrainCardRect(rect: Rect, bounds: Rect): Rect {
    const maximumX = Math.max(bounds.x, bounds.x + bounds.width - rect.width);
    const maximumY = Math.max(bounds.y, bounds.y + bounds.height - rect.height);
    return {
      ...rect,
      x: Math.min(maximumX, Math.max(bounds.x, rect.x)),
      y: Math.min(maximumY, Math.max(bounds.y, rect.y)),
    };
  }

  private updateDraggedCard(group: SVGGElement, scene: CardScene): void {
    const normalized = this.manualCardPositions.get(scene.id);
    select(group)
      .interrupt()
      .attr('transform', `translate(${scene.rect.x},${scene.rect.y}) scale(${scene.scale})`)
      .attr('data-label-x', scene.rect.x)
      .attr('data-label-y', scene.rect.y)
      .attr('data-card-x', scene.rect.x)
      .attr('data-card-y', scene.rect.y)
      .attr('data-panel-x', scene.rect.x)
      .attr('data-panel-y', scene.rect.y)
      .attr('data-manual-x-ratio', () => normalized?.xRatio ?? null)
      .attr('data-manual-y-ratio', () => normalized?.yRatio ?? null);
    if (!('anchor' in scene) || !('connection' in scene)) return;
    scene.connection = getConnectionPoint(scene.anchor, scene.rect);
    if (scene.id === MIDDLE_SCHOOL_CARD_ID) {
      select(group).select<SVGLineElement>('line.middle-school-card-line')
        .attr('x1', (scene.anchor.x - scene.rect.x) / scene.scale)
        .attr('y1', (scene.anchor.y - scene.rect.y) / scene.scale)
        .attr('x2', (scene.connection.x - scene.rect.x) / scene.scale)
        .attr('y2', (scene.connection.y - scene.rect.y) / scene.scale);
      return;
    }
    this.linesLayer.selectAll<SVGLineElement, LabelScene>('line.school-line')
      .filter((lineScene) => lineScene.id === scene.id)
      .attr('x2', scene.connection.x)
      .attr('y2', scene.connection.y);
  }

  private shouldSuppressStudentSelection(): boolean {
    return performance.now() < this.suppressStudentSelectionUntil;
  }

  private getAnchoredCards(): AnchoredCardDatum[] {
    return this.cardGroupingMode === 'region'
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
  }

  private getMiddleSchoolCardInput(
    projection: GeoProjection,
    transform: ZoomTransform,
  ): LayoutInput | null {
    if (!this.showMiddleSchool || !this.middleSchool) return null;
    const projected = getProjectedPoint(
      projection,
      this.middleSchool.lat,
      this.middleSchool.lng,
    );
    if (!projected) return null;
    const [x, y] = transform.apply([projected.x, projected.y]);
    const anchor = { x, y };
    if (!containsPoint(this.currentInfoRect, anchor)) return null;
    const size = middleSchoolCardSize(this.middleSchool);
    return {
      id: MIDDLE_SCHOOL_CARD_ID,
      anchor,
      width: size.width,
      height: size.height,
    };
  }

  private renderMiddleSchoolOverlay(
    projection: GeoProjection,
    transform: ZoomTransform,
    cards: AnchoredCardDatum[],
  ): void {
    const middleSchool = this.middleSchool;
    const projectedMiddleSchool = middleSchool
      ? getProjectedPoint(projection, middleSchool.lat, middleSchool.lng)
      : null;
    if (!this.showMiddleSchool || !middleSchool || !projectedMiddleSchool) {
      this.middleSchoolLinesLayer.selectAll('*').remove();
      this.middleSchoolMarkerLayer.selectAll('*').remove();
      return;
    }

    const [middleSchoolX, middleSchoolY] = transform.apply([
      projectedMiddleSchool.x,
      projectedMiddleSchool.y,
    ]);
    const middleSchoolAnchor = { x: middleSchoolX, y: middleSchoolY };
    const connections = cards.flatMap((card): MiddleSchoolConnection[] => {
      const projected = getProjectedPoint(projection, card.latitude, card.longitude);
      if (!projected) return [];
      const [x, y] = transform.apply([projected.x, projected.y]);
      const anchor = { x, y };
      if (!containsPoint(this.currentInfoRect, anchor)) return [];
      return [{
        id: card.id,
        anchor,
        middleSchoolAnchor,
        studentCount: card.schools.reduce(
          (count, school) => count + school.students.length,
          0,
        ),
      }];
    });
    const lineStyle = defaultConfig.middleSchoolStyle;
    const connectionGroups = this.middleSchoolLinesLayer
      .selectAll<SVGGElement, MiddleSchoolConnection>('g.middle-school-connection-group')
      .data(connections, (connection) => connection.id)
      .join((enter) => {
        const group = enter.append('g').attr('class', 'middle-school-connection-group');
        group.append('line').attr(
          'class',
          'middle-school-connection-glow middle-school-connection-glow-outer',
        );
        group.append('line').attr(
          'class',
          'middle-school-connection-glow middle-school-connection-glow-inner',
        );
        group.append('line').attr('class', 'middle-school-connection');
        return group;
      })
      .attr('data-anchor-id', (connection) => connection.id)
      .attr('data-student-count', (connection) => connection.studentCount);
    const lineWidth = (connection: MiddleSchoolConnection): number => (
      calculateMiddleSchoolLineWidth(connection.studentCount, {
        minWidth: lineStyle.lineMinWidth,
        maxWidth: lineStyle.lineMaxWidth,
        logarithmicStep: lineStyle.lineLogarithmicStep,
      })
    );
    const setLineGeometry = (
      selection: Selection<SVGLineElement, MiddleSchoolConnection, SVGGElement, unknown>,
    ): void => {
      selection
        .attr('x1', (connection) => connection.middleSchoolAnchor.x)
        .attr('y1', (connection) => connection.middleSchoolAnchor.y)
        .attr('x2', (connection) => connection.anchor.x)
        .attr('y2', (connection) => connection.anchor.y)
        .attr('vector-effect', 'non-scaling-stroke');
    };
    const outerGlow = connectionGroups.select<SVGLineElement>(
      'line.middle-school-connection-glow-outer',
    ).attr(
      'stroke-width',
      (connection) => lineWidth(connection) + lineStyle.lineOuterGlowSpread,
    );
    const innerGlow = connectionGroups.select<SVGLineElement>(
      'line.middle-school-connection-glow-inner',
    ).attr(
      'stroke-width',
      (connection) => lineWidth(connection) + lineStyle.lineInnerGlowSpread,
    );
    const coreLines = connectionGroups.select<SVGLineElement>('line.middle-school-connection')
      .attr('data-anchor-id', (connection) => connection.id)
      .attr('data-student-count', (connection) => connection.studentCount)
      .attr('stroke-width', lineWidth);
    setLineGeometry(outerGlow);
    setLineGeometry(innerGlow);
    setLineGeometry(coreLines);

    const marker = this.middleSchoolMarkerLayer
      .selectAll<SVGGElement, MiddleSchoolInfo>('g.middle-school-marker')
      .data([middleSchool], (school) => school.name)
      .join((enter) => {
        const group = enter.append('g')
          .attr('class', 'middle-school-marker')
          .attr('role', 'img');
        group.append('circle')
          .attr('class', 'middle-school-marker-halo');
        group.append('circle')
          .attr('class', 'middle-school-marker-core');
        group.append('rect')
          .attr('class', 'middle-school-marker-center');
        return group;
      })
      .attr('aria-label', (school) => `${school.name}位置`)
      .attr('data-middle-school', (school) => school.name)
      .attr('transform', `translate(${middleSchoolX},${middleSchoolY})`);
    marker.select<SVGCircleElement>('circle.middle-school-marker-halo')
      .attr('r', lineStyle.haloRadius);
    marker.select<SVGCircleElement>('circle.middle-school-marker-core')
      .attr('r', lineStyle.markerRadius);
    const centerSize = lineStyle.markerRadius * 0.9;
    marker.select<SVGRectElement>('rect.middle-school-marker-center')
      .attr('x', -centerSize / 2)
      .attr('y', -centerSize / 2)
      .attr('width', centerSize)
      .attr('height', centerSize)
      .attr('transform', 'rotate(45)');
    this.root
      .attr('data-middle-school-x', middleSchoolX)
      .attr('data-middle-school-y', middleSchoolY)
      .attr('data-middle-school-connection-count', connections.length);
  }

  private renderMiddleSchoolCard(scene: MiddleSchoolCardScene | null): void {
    const cardStyle = defaultConfig.middleSchoolStyle;
    const labelStyle = defaultConfig.labelStyle;
    const cards = this.middleSchoolCardLayer
      .selectAll<SVGGElement, MiddleSchoolCardScene>('g.middle-school-card')
      .data(scene ? [scene] : [], (cardScene) => cardScene.info.name);
    const entered = cards.enter()
      .append('g')
      .attr('class', 'middle-school-card')
      .attr('transform', (cardScene) => (
        `translate(${cardScene.rect.x},${cardScene.rect.y}) scale(${cardScene.scale})`
      ))
      .attr('opacity', 0)
      .style('pointer-events', 'none');
    entered.append('line')
      .attr('class', 'middle-school-card-line')
      .attr('vector-effect', 'non-scaling-stroke');
    entered.append('rect')
      .attr('class', 'middle-school-card-background')
      .attr('rx', 4)
      .attr('vector-effect', 'non-scaling-stroke');
    entered.append('text')
      .attr('class', 'middle-school-card-name')
      .attr('font-size', labelStyle.universityFontSize)
      .attr('font-weight', 600);
    entered.append('g').attr('class', 'middle-school-title-images');
    entered.append('g').attr('class', 'middle-school-card-address-lines');

    const merged = entered.merge(cards)
      .attr('data-middle-school', (cardScene) => cardScene.info.name)
      .attr('data-card-x', (cardScene) => cardScene.rect.x)
      .attr('data-card-y', (cardScene) => cardScene.rect.y)
      .attr('data-card-width', (cardScene) => cardScene.rect.width)
      .attr('data-card-height', (cardScene) => cardScene.rect.height)
      .attr('data-card-scale', (cardScene) => cardScene.scale)
      .attr('data-block-map-navigation', () => (
        this.cardDraggingEnabled ? 'true' : null
      ))
      .attr('data-manual-x-ratio', (cardScene) => (
        this.manualCardPositions.get(cardScene.id)?.xRatio ?? null
      ))
      .attr('data-manual-y-ratio', (cardScene) => (
        this.manualCardPositions.get(cardScene.id)?.yRatio ?? null
      ))
      .classed('has-title-image', (cardScene) => Boolean(cardScene.info.titleImg))
      .classed('has-dark-title-image', (cardScene) => Boolean(cardScene.info.titleImgDark))
      .style('pointer-events', this.cardDraggingEnabled ? 'all' : 'none')
      .style('cursor', () => this.cardDraggingEnabled ? 'move' : null)
      .style('touch-action', () => this.cardDraggingEnabled ? 'none' : null)
      .on('pointerdown.card-drag', (event: PointerEvent, cardScene) => (
        this.beginCardDrag(event, cardScene, event.currentTarget as SVGGElement)
      ));

    merged.select<SVGLineElement>('line.middle-school-card-line')
      .attr('x1', (cardScene) => (
        (cardScene.anchor.x - cardScene.rect.x) / cardScene.scale
      ))
      .attr('y1', (cardScene) => (
        (cardScene.anchor.y - cardScene.rect.y) / cardScene.scale
      ))
      .attr('x2', (cardScene) => (
        (cardScene.connection.x - cardScene.rect.x) / cardScene.scale
      ))
      .attr('y2', (cardScene) => (
        (cardScene.connection.y - cardScene.rect.y) / cardScene.scale
      ));
    merged.select<SVGRectElement>('rect.middle-school-card-background')
      .attr('width', (cardScene) => cardScene.baseSize.width)
      .attr('height', (cardScene) => cardScene.baseSize.height);
    merged.select<SVGTextElement>('text.middle-school-card-name')
      .attr('font-size', labelStyle.universityFontSize)
      .attr('x', cardStyle.cardPaddingX)
      .attr('y', cardStyle.cardPaddingY + labelStyle.universityFontSize)
      .text((cardScene) => cardScene.info.name);

    merged.each(function updateMiddleSchoolCard(cardScene) {
      const size = middleSchoolCardSize(cardScene.info);
      const titleImages: MiddleSchoolTitleImage[] = [
        ...(cardScene.info.titleImg
          ? [{ kind: 'light' as const, url: getDataAssetUrl(cardScene.info.titleImg) }]
          : []),
        ...(cardScene.info.titleImgDark
          ? [{ kind: 'dark' as const, url: getDataAssetUrl(cardScene.info.titleImgDark) }]
          : []),
      ];
      const group = select(this);
      const images = group.select<SVGGElement>('g.middle-school-title-images')
        .selectAll<SVGImageElement, MiddleSchoolTitleImage>('image.middle-school-title-image')
        .data(titleImages, (image) => image.kind);
      images.enter()
        .append('image')
        .attr('class', (image) => `middle-school-title-image middle-school-title-image-${image.kind}`)
        .attr('preserveAspectRatio', 'xMinYMid meet')
        .on('error', function handleTitleImageError(_event, image) {
          select(this).style('display', 'none');
          group.classed(`is-title-${image.kind}-failed`, true);
        })
        .merge(images)
        .attr('href', (image) => image.url)
        .attr('x', cardStyle.cardPaddingX)
        .attr('y', cardStyle.cardPaddingY)
        .attr('width', Math.min(
          cardStyle.titleImageMaxWidth,
          size.width - cardStyle.cardPaddingX * 2,
        ))
        .attr('height', cardStyle.titleImageMaxHeight);
      images.exit().remove();

      const addressLines = group.select<SVGGElement>('g.middle-school-card-address-lines')
        .selectAll<SVGTextElement, string>('text.middle-school-card-address')
        .data(size.addressLines);
      addressLines.enter()
        .append('text')
        .attr('class', 'middle-school-card-address')
        .attr('font-size', labelStyle.studentFontSize)
        .merge(addressLines)
        .attr('font-size', labelStyle.studentFontSize)
        .attr('x', cardStyle.cardPaddingX)
        .attr('y', (_, index) => (
          cardStyle.cardPaddingY + size.titleHeight + cardStyle.cardContentGap +
          labelStyle.studentFontSize + index * labelStyle.lineHeight
        ))
        .text((line) => line);
      addressLines.exit().remove();
    });

    merged.interrupt()
      .transition()
      .duration(defaultConfig.layoutTransitionDurationMs)
      .attr('transform', (cardScene) => (
        `translate(${cardScene.rect.x},${cardScene.rect.y}) scale(${cardScene.scale})`
      ))
      .attr('opacity', 1);
    cards.exit()
      .interrupt()
      .transition()
      .duration(defaultConfig.layoutTransitionDurationMs)
      .attr('opacity', 0)
      .remove();
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
      .attr('x2', (scene) => scene.connection.x)
      .attr('y2', (scene) => scene.connection.y)
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
    const shouldSuppressStudentSelection = () => this.shouldSuppressStudentSelection();
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
      .attr('data-block-map-navigation', () => (
        this.cardDraggingEnabled ? 'true' : null
      ))
      .attr('data-manual-x-ratio', (scene) => this.manualCardPositions.get(scene.id)?.xRatio ?? null)
      .attr('data-manual-y-ratio', (scene) => this.manualCardPositions.get(scene.id)?.yRatio ?? null)
      .style('cursor', () => this.cardDraggingEnabled ? 'move' : null)
      .style('touch-action', () => this.cardDraggingEnabled ? 'none' : null)
      .on('pointerdown.card-drag', (event: PointerEvent, scene) => (
        this.beginCardDrag(event, scene, event.currentTarget as SVGGElement)
      ))
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
        .attr('font-weight', 600)
        .merge(universityLabels)
        .attr('font-size', style.universityFontSize)
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
        .merge(studentLabels)
        .attr('font-size', style.studentFontSize)
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
          if (shouldSuppressStudentSelection()) {
            event.preventDefault();
            return;
          }
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

    this.applySearchHighlight();

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

  private applySearchHighlight(): void {
    const matchedStudents = this.matchedStudents;
    const matchedSchools = this.matchedSchools;
    const sceneMatchesSchool = (scene: LabelScene): boolean => (
      scene.card.schools.some((school) => matchedSchools.has(school))
    );

    this.linesLayer.selectAll<SVGLineElement, LabelScene>('line.school-line')
      .classed('is-search-match', sceneMatchesSchool);
    this.anchorsLayer.selectAll<SVGCircleElement, LabelScene>('circle.school-anchor')
      .classed('is-search-match', sceneMatchesSchool);
    const labels = this.labelsLayer.selectAll<SVGGElement, LabelScene>('g.school-label')
      .classed('is-search-match', sceneMatchesSchool);
    labels.select<SVGTextElement>('text.school-label-title')
      .classed('is-search-match', (scene) => (
        !scene.card.region && matchedSchools.has(scene.card.schools[0])
      ));
    labels.selectAll<SVGTextElement, {
      school: SchoolGroup;
      column: number;
      row: number;
    }>('text.card-university')
      .classed('is-search-match', (item) => matchedSchools.has(item.school));
    labels.selectAll<SVGTextElement, { student: Student }>('text.student-name')
      .classed('is-search-match', (item) => matchedStudents.has(item.student));

    const foreignGroups = this.foreignLayer
      .selectAll<SVGGElement, SchoolGroup>('g.foreign-school-group')
      .classed('is-search-match', (school) => matchedSchools.has(school));
    foreignGroups.select<SVGTextElement>('text.foreign-school-title')
      .classed('is-search-match', (school) => matchedSchools.has(school));
    foreignGroups.selectAll<SVGTextElement, Student>('text.student-name')
      .classed('is-search-match', (student) => matchedStudents.has(student));
  }

  private calculateSearchArrowGroups(
    width: number,
    height: number,
    projection: GeoProjection,
    transform: ZoomTransform,
    infoRect: Rect,
  ): ArrowGroup[] {
    const targets = Array.from(this.matchedTargetSchools).flatMap((school) => {
      if (school.isForeign || school.lat === null || school.lng === null) return [];
      const projected = getProjectedPoint(projection, school.lat, school.lng);
      if (!projected) return [];
      const [x, y] = transform.apply([projected.x, projected.y]);
      return [{ id: school.university, target: { x, y } }];
    });
    return calculateArrows(
      { x: width / 2, y: height / 2 },
      infoRect,
      targets,
      defaultConfig.searchArrowMergeDistance,
    );
  }

  private renderSearchArrows(groups: ArrowGroup[]): void {
    const keyFor = (group: ArrowGroup): string => [...group.ids].sort().join('\u0000');
    if (this.selectedArrowKey && !groups.some((group) => keyFor(group) === this.selectedArrowKey)) {
      this.selectedArrowKey = null;
    }
    const arrows = this.searchArrowsLayer
      .selectAll<SVGGElement, ArrowGroup>('g.search-arrow')
      .data(groups, keyFor);
    const entered = arrows.enter()
      .append('g')
      .attr('class', 'search-arrow')
      .attr('role', 'button')
      .attr('tabindex', 0)
      .style('pointer-events', 'all');
    entered.append('circle')
      .attr('class', 'search-arrow-hit')
      .attr('r', defaultConfig.searchArrowHitSize / 2)
      .attr('fill', 'transparent');
    entered.append('circle')
      .attr('class', 'search-arrow-background')
      .attr('r', 14)
      .attr('fill', '#ffffff')
      .attr('stroke', '#b45309')
      .attr('stroke-width', 2);
    entered.append('path')
      .attr('class', 'search-arrow-direction')
      .attr('d', 'M -6 -7 L 9 0 L -6 7 Z')
      .attr('fill', '#b45309')
      .style('pointer-events', 'none');
    const badge = entered.append('g')
      .attr('class', 'search-arrow-badge')
      .style('pointer-events', 'none');
    badge.append('circle')
      .attr('cx', 11)
      .attr('cy', -11)
      .attr('r', 9)
      .attr('fill', '#b45309');
    badge.append('text')
      .attr('x', 11)
      .attr('y', -11)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', this.scaleFont(10))
      .attr('font-weight', 700)
      .attr('fill', '#ffffff');
    entered.append('title');

    const merged = entered.merge(arrows)
      .attr('transform', (group) => `translate(${group.x},${group.y})`)
      .attr('data-edge', (group) => group.edge)
      .attr('data-count', (group) => group.count)
      .attr('data-school-ids', (group) => group.ids.join('|'))
      .attr('aria-label', (group) => (
        group.count === 1
          ? `匹配学校：${group.ids[0]}`
          : `${group.count} 所匹配学校：${group.ids.join('、')}`
      ))
      .attr('aria-pressed', (group) => String(keyFor(group) === this.selectedArrowKey))
      .classed('is-selected', (group) => keyFor(group) === this.selectedArrowKey)
      .on('click', (_event, group) => this.toggleSearchArrow(keyFor(group)))
      .on('keydown', (event: KeyboardEvent, group) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.toggleSearchArrow(keyFor(group));
      });
    merged.select<SVGPathElement>('path.search-arrow-direction')
      .attr('transform', (group) => `rotate(${group.angle * 180 / Math.PI})`);
    merged.select<SVGGElement>('g.search-arrow-badge')
      .style('display', (group) => group.count > 1 ? '' : 'none');
    merged.select<SVGTextElement>('g.search-arrow-badge text')
      .attr('font-size', this.scaleFont(10))
      .text((group) => group.count);
    merged.select<SVGTitleElement>('title')
      .text((group) => group.ids.join('、'));
    arrows.exit().remove();
  }

  private toggleSearchArrow(key: string): void {
    this.selectedArrowKey = this.selectedArrowKey === key ? null : key;
    this.searchArrowsLayer.selectAll<SVGGElement, ArrowGroup>('g.search-arrow')
      .attr('aria-pressed', (group) => String(
        [...group.ids].sort().join('\u0000') === this.selectedArrowKey
      ))
      .classed('is-selected', (group) => (
        [...group.ids].sort().join('\u0000') === this.selectedArrowKey
      ));
  }

  private renderTeacherPanel(scene: TeacherPanelScene | null): void {
    const style = defaultConfig.labelStyle;
    const panels = this.teacherLayer
      .selectAll<SVGGElement, TeacherPanelScene>('g.teacher-panel')
      .data(scene ? [scene] : []);
    const entered = panels.enter()
      .append('g')
      .attr('class', 'teacher-panel')
      .attr('role', 'group')
      .attr('aria-label', '教师信息')
      .attr('opacity', 0)
      .attr('transform', (panel) => (
        `translate(${panel.rect.x},${panel.rect.y}) scale(${panel.scale})`
      ))
      .style('pointer-events', 'none');
    entered.append('rect')
      .attr('class', 'teacher-panel-background')
      .attr('rx', 4)
      .attr('vector-effect', 'non-scaling-stroke');
    entered.append('text')
      .attr('class', 'teacher-panel-title')
      .attr('font-size', style.universityFontSize)
      .attr('font-weight', 600)
      .text('教师');
    entered.append('g').attr('class', 'teacher-panel-rows');

    const merged = entered.merge(panels)
      .attr('data-corner', defaultConfig.teacherCorner)
      .attr('data-panel-x', (panel) => panel.rect.x)
      .attr('data-panel-y', (panel) => panel.rect.y)
      .attr('data-panel-width', (panel) => panel.rect.width)
      .attr('data-panel-height', (panel) => panel.rect.height)
      .attr('data-label-scale', (panel) => panel.scale)
      .attr('data-block-map-navigation', () => (
        this.cardDraggingEnabled ? 'true' : null
      ))
      .attr('data-manual-x-ratio', (panel) => this.manualCardPositions.get(panel.id)?.xRatio ?? null)
      .attr('data-manual-y-ratio', (panel) => this.manualCardPositions.get(panel.id)?.yRatio ?? null)
      .style('pointer-events', this.cardDraggingEnabled ? 'all' : 'none')
      .style('cursor', () => this.cardDraggingEnabled ? 'move' : null)
      .style('touch-action', () => this.cardDraggingEnabled ? 'none' : null)
      .on('pointerdown.card-drag', (event: PointerEvent, panel) => (
        this.beginCardDrag(event, panel, event.currentTarget as SVGGElement)
      ));
    merged.select<SVGRectElement>('rect.teacher-panel-background')
      .attr('width', (panel) => panel.baseSize.width)
      .attr('height', (panel) => panel.baseSize.height);
    merged.select<SVGTextElement>('text.teacher-panel-title')
      .attr('font-size', style.universityFontSize)
      .attr('x', style.paddingX)
      .attr('y', style.paddingY + style.universityFontSize);

    merged.each(function updateTeacherRows(panel) {
      const layout = teacherPanelLayout(panel.teachers);
      const rows = select(this).select<SVGGElement>('g.teacher-panel-rows')
        .selectAll<SVGGElement, TeacherPanelRow>('g.teacher-panel-row')
        .data(layout.rows, (row) => row.teacher.role);
      const rowEnter = rows.enter()
        .append('g')
        .attr('class', 'teacher-panel-row');
      rowEnter.append('text')
        .attr('class', 'teacher-role')
        .attr('font-size', style.studentFontSize);
      rowEnter.append('g').attr('class', 'teacher-name-lines');
      const rowMerged = rowEnter.merge(rows)
        .attr('transform', (row) => (
          `translate(${style.paddingX},${style.paddingY + style.lineHeight * (1 + row.startLine)})`
        ));
      rowMerged.select<SVGTextElement>('text.teacher-role')
        .attr('font-size', style.studentFontSize)
        .attr('y', style.studentFontSize)
        .text((row) => row.teacher.role);
      rowMerged.each(function updateTeacherNameLines(row) {
        const names = select(this).select<SVGGElement>('g.teacher-name-lines')
          .selectAll<SVGTextElement, string>('text.teacher-name')
          .data(row.nameLines);
        names.enter()
          .append('text')
          .attr('class', 'teacher-name')
          .merge(names)
          .attr('font-size', style.studentFontSize)
          .attr('x', layout.roleWidth + style.studentColumnGap)
          .attr('y', (_, index) => style.studentFontSize + index * style.lineHeight)
          .text((line) => line);
        names.exit().remove();
      });
      rows.exit().remove();
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

  private renderForeignPanel(scene: ForeignPanelScene | null): void {
    const style = defaultConfig.labelStyle;
    const onStudentSelect = this.onStudentSelect;
    const shouldSuppressStudentSelection = () => this.shouldSuppressStudentSelection();
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
      .attr('data-label-scale', (panel) => panel.scale)
      .attr('data-block-map-navigation', () => (
        this.cardDraggingEnabled ? 'true' : null
      ))
      .attr('data-manual-x-ratio', (panel) => this.manualCardPositions.get(panel.id)?.xRatio ?? null)
      .attr('data-manual-y-ratio', (panel) => this.manualCardPositions.get(panel.id)?.yRatio ?? null)
      .style('cursor', () => this.cardDraggingEnabled ? 'move' : null)
      .style('touch-action', () => this.cardDraggingEnabled ? 'none' : null)
      .on('pointerdown.card-drag', (event: PointerEvent, panel) => (
        this.beginCardDrag(event, panel, event.currentTarget as SVGGElement)
      ));
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
        .attr('font-size', style.universityFontSize)
        .attr('y', style.universityFontSize)
        .text((school) => school.university);
      groupMerged.each(function updateForeignStudents(school) {
        const students = select(this).selectAll<SVGTextElement, Student>('text.student-name')
          .data(school.students, (student) => String(student.originalIndex));
        students.enter()
          .append('text')
          .attr('class', 'student-name')
          .attr('fill', '#475569')
          .merge(students)
          .attr('font-size', style.studentFontSize)
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
            if (shouldSuppressStudentSelection()) {
              event.preventDefault();
              return;
            }
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

    this.applySearchHighlight();

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

  private scaleFont(size: number): number {
    return size * this.fontScale;
  }
}
