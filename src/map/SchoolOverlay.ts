import {
  select,
  type GeoProjection,
  type Selection,
  type ZoomTransform,
} from 'd3';
import { defaultConfig } from '@/config';
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
import type { ProcessedData, SchoolGroup, Student } from '@/types';

interface LabelScene {
  id: string;
  school: SchoolGroup;
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
      .style(
        'display',
        (options.showInfoRectangle ?? defaultConfig.showInfoRectangle) ? '' : 'none',
      );
    this.linesLayer = this.root.append('g').attr('class', 'school-lines');
    this.anchorsLayer = this.root.append('g').attr('class', 'school-anchors');
    this.labelsLayer = this.root.append('g').attr('class', 'school-labels');
    this.foreignLayer = this.root.append('g').attr('class', 'foreign-schools');
    document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
  }

  public setData(data: ProcessedData): void {
    this.setSchools(data.domesticSchools, data.foreignSchools);
  }

  public setShowInfoRectangle(show: boolean): void {
    this.infoRectangle.style('display', show ? '' : 'none');
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

    const baseVisibleInputs: LayoutInput[] = [];
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
      baseVisibleInputs.push({ id: school.university, anchor, ...size });
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
      const school = schoolsById.get(input.id);
      const baseInput = baseInputsById.get(input.id);
      if (!rect || !school || !baseInput) continue;
      this.positionHistory.set(input.id, rect);
      scenes.push({
        id: input.id,
        school,
        anchor: input.anchor,
        rect,
        baseSize: { width: baseInput.width, height: baseInput.height },
        scale: fittingLayout.scale,
      });
    }

    this.root
      .attr('data-visible-school-count', scenes.length)
      .attr('data-label-scale', fittingLayout.scale)
      .attr('data-layout-fits', String(fittingLayout.satisfiesHardConstraints));
    this.renderLines(scenes);
    this.renderAnchors(scenes);
    this.renderLabels(scenes);
    this.renderForeignPanel(foreignScene);
  }

  public destroy(): void {
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
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
      .attr('data-school', (scene) => scene.school.university)
      .attr('data-province-adcode', (scene) => scene.school.provinceAdcode)
      .attr('data-city-adcode', (scene) => scene.school.cityAdcode)
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
      .attr('data-school', (scene) => scene.school.university)
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
          (index % style.studentsPerRow) * (
            (scene.baseSize.width - style.paddingX * 2) / style.studentsPerRow
          )
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
          const schoolAdcode = hoveredRegion.level === 'province'
            ? scene.school.provinceAdcode
            : scene.school.cityAdcode;
          return schoolAdcode === hoveredRegion.adcode;
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
