import {
  select,
  type GeoProjection,
  type Selection,
  type ZoomTransform,
} from 'd3';
import { defaultConfig } from '@/config';
import {
  calculateLayout,
  getConnectionPoint,
  isOverlap,
  type LayoutInput,
  type Point,
  type Rect,
} from '@/logic/layout';
import { getProjectedPoint } from '@/map/projection';
import type { ProcessedData, SchoolGroup, Student } from '@/types';

interface LabelScene {
  id: string;
  school: SchoolGroup;
  anchor: Point;
  rect: Rect;
}

interface ForeignPanelScene {
  rect: Rect;
  schools: SchoolGroup[];
}

export interface SchoolOverlayOptions {
  onStudentSelect?: (student: Student) => void;
}

function textWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((width, character) => (
    width + (/^[\x00-\x7F]$/.test(character) ? fontSize * 0.6 : fontSize)
  ), 0);
}

function labelSize(school: SchoolGroup): { width: number; height: number } {
  const style = defaultConfig.labelStyle;
  const contentWidth = Math.max(
    textWidth(school.university, style.universityFontSize),
    ...school.students.map((student) => textWidth(student.name, style.studentFontSize)),
  );
  return {
    width: Math.max(style.minWidth, Math.min(style.maxWidth, contentWidth + style.paddingX * 2)),
    height: style.paddingY * 2 + style.lineHeight * (
      Math.ceil(school.students.length / style.studentsPerRow) + 1
    ),
  };
}

export function getInfoRectangle(width: number, height: number): Rect {
  const rectWidth = width * defaultConfig.infoRectangleWidthRatio;
  const rectHeight = height * defaultConfig.infoRectangleHeightRatio;
  return {
    x: (width - rectWidth) / 2,
    y: (height - rectHeight) / 2,
    width: rectWidth,
    height: rectHeight,
  };
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
    ...schools.map((school) => labelSize(school).width),
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
  private domesticSchools: SchoolGroup[] = [];
  private foreignSchools: SchoolGroup[] = [];
  private readonly positionHistory = new Map<string, Rect>();
  private readonly onStudentSelect?: (student: Student) => void;

  constructor(
    svg: Selection<SVGSVGElement, unknown, null, undefined>,
    options: SchoolOverlayOptions = {},
  ) {
    this.onStudentSelect = options.onStudentSelect;
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
      .attr('vector-effect', 'non-scaling-stroke');
    this.linesLayer = this.root.append('g').attr('class', 'school-lines');
    this.anchorsLayer = this.root.append('g').attr('class', 'school-anchors');
    this.labelsLayer = this.root.append('g').attr('class', 'school-labels');
    this.foreignLayer = this.root.append('g').attr('class', 'foreign-schools');
  }

  public setData(data: ProcessedData): void {
    this.setSchools(data.domesticSchools, data.foreignSchools);
  }

  public setSchools(domesticSchools: SchoolGroup[], foreignSchools: SchoolGroup[]): void {
    this.domesticSchools = domesticSchools;
    this.foreignSchools = foreignSchools;
    this.positionHistory.clear();
  }

  public update(
    width: number,
    height: number,
    projection: GeoProjection,
    transform: ZoomTransform,
  ): void {
    const infoRect = getInfoRectangle(width, height);
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

    const visibleInputs: LayoutInput[] = [];
    const schoolsById = new Map<string, SchoolGroup>();
    const domesticAnchors: Point[] = [];
    for (const school of this.domesticSchools) {
      if (school.lat === null || school.lng === null) continue;
      const projected = getProjectedPoint(projection, school.lat, school.lng);
      if (!projected) continue;
      const [x, y] = transform.apply([projected.x, projected.y]);
      const anchor = { x, y };
      domesticAnchors.push(anchor);
      if (!containsPoint(infoRect, anchor)) continue;

      const size = labelSize(school);
      visibleInputs.push({ id: school.university, anchor, ...size });
      schoolsById.set(school.university, school);
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
    const foreignScene: ForeignPanelScene | null = showForeignSchools
      ? {
          rect: rectAtCorner(foreignPanelSize(this.foreignSchools), canvasRect),
          schools: this.foreignSchools,
        }
      : null;

    const historyConflictsWithForeignPanel = foreignScene && Array.from(this.positionHistory.values())
      .some((rect) => isOverlap(rect, foreignScene.rect, defaultConfig.labelSpacing));
    const layoutHistory = historyConflictsWithForeignPanel
      ? new Map<string, Rect>()
      : this.positionHistory;
    const layout = calculateLayout(visibleInputs, layoutHistory, {
      canvasRect,
      infoRect,
      obstacles: foreignScene ? [foreignScene.rect] : [],
      spacing: defaultConfig.labelSpacing,
      weights: defaultConfig.layoutWeights,
    });

    const scenes: LabelScene[] = [];
    for (const input of visibleInputs) {
      const rect = layout.get(input.id);
      const school = schoolsById.get(input.id);
      if (!rect || !school) continue;
      this.positionHistory.set(input.id, rect);
      scenes.push({ id: input.id, school, anchor: input.anchor, rect });
    }

    this.root.attr('data-visible-school-count', scenes.length);
    this.renderLines(scenes);
    this.renderAnchors(scenes);
    this.renderLabels(scenes);
    this.renderForeignPanel(foreignScene);
  }

  public destroy(): void {
    this.root.interrupt();
    this.root.selectAll('*').interrupt();
    this.root.remove();
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
      .attr('x1', (scene) => scene.anchor.x)
      .attr('y1', (scene) => scene.anchor.y)
      .attr('x2', (scene) => getConnectionPoint(scene.anchor, scene.rect).x)
      .attr('y2', (scene) => getConnectionPoint(scene.anchor, scene.rect).y)
      .attr('opacity', 0.72);

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
      .attr('transform', (scene) => `translate(${scene.rect.x},${scene.rect.y})`)
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
      .attr('data-school', (scene) => scene.school.university)
      .attr('data-label-x', (scene) => scene.rect.x)
      .attr('data-label-y', (scene) => scene.rect.y)
      .attr('data-label-width', (scene) => scene.rect.width)
      .attr('data-label-height', (scene) => scene.rect.height);

    merged.select<SVGRectElement>('rect.school-label-background')
      .attr('width', (scene) => scene.rect.width)
      .attr('height', (scene) => scene.rect.height);
    merged.select<SVGTextElement>('text.school-label-title')
      .attr('x', style.paddingX)
      .attr('y', style.paddingY + style.universityFontSize)
      .text((scene) => scene.school.university);

    merged.each(function updateStudents(scene) {
      const studentLabels = select(this).selectAll<SVGTextElement, Student>('text.student-name')
        .data(scene.school.students, (student) => String(student.originalIndex));
      studentLabels.enter()
        .append('text')
        .attr('class', 'student-name')
        .attr('fill', '#475569')
        .attr('font-size', style.studentFontSize)
        .merge(studentLabels)
        .attr('x', (_, index) => (
          style.paddingX +
          (index % style.studentsPerRow) * ((scene.rect.width - style.paddingX * 2) / style.studentsPerRow)
        ))
        .attr('y', (_, index) => (
          style.paddingY + style.lineHeight * (Math.floor(index / style.studentsPerRow) + 2)
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
      studentLabels.exit().remove();
    });

    merged.interrupt()
      .transition()
      .duration(defaultConfig.layoutTransitionDurationMs)
      .attr('transform', (scene) => `translate(${scene.rect.x},${scene.rect.y})`)
      .attr('opacity', 1);

    labels.exit()
      .interrupt()
      .transition()
      .duration(defaultConfig.layoutTransitionDurationMs)
      .attr('opacity', 0)
      .remove();
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
      .attr('transform', (scene) => `translate(${scene.rect.x},${scene.rect.y})`)
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
      .attr('data-panel-height', (panel) => panel.rect.height);
    merged.select<SVGRectElement>('rect.foreign-panel-background')
      .attr('width', (panel) => panel.rect.width)
      .attr('height', (panel) => panel.rect.height);

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
              (panel.rect.width - style.paddingX * 2) / style.studentsPerRow
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
      .attr('transform', (panel) => `translate(${panel.rect.x},${panel.rect.y})`)
      .attr('opacity', 1);
    panels.exit()
      .interrupt()
      .transition()
      .duration(defaultConfig.layoutTransitionDurationMs)
      .attr('opacity', 0)
      .remove();
  }
}
