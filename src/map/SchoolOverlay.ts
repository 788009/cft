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

function centeredInfoRect(width: number, height: number): Rect {
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

export class SchoolOverlay {
  private readonly root: Selection<SVGGElement, unknown, null, undefined>;
  private readonly infoRectangle: Selection<SVGRectElement, unknown, null, undefined>;
  private readonly linesLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly anchorsLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly labelsLayer: Selection<SVGGElement, unknown, null, undefined>;
  private domesticSchools: SchoolGroup[] = [];
  private readonly positionHistory = new Map<string, Rect>();

  constructor(svg: Selection<SVGSVGElement, unknown, null, undefined>) {
    this.root = svg.append('g')
      .attr('class', 'school-overlay')
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
  }

  public setData(data: ProcessedData): void {
    this.domesticSchools = data.domesticSchools;
  }

  public update(
    width: number,
    height: number,
    projection: GeoProjection,
    transform: ZoomTransform,
  ): void {
    const infoRect = centeredInfoRect(width, height);
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
    for (const school of this.domesticSchools) {
      if (school.lat === null || school.lng === null) continue;
      const projected = getProjectedPoint(projection, school.lat, school.lng);
      if (!projected) continue;
      const [x, y] = transform.apply([projected.x, projected.y]);
      const anchor = { x, y };
      if (!containsPoint(infoRect, anchor)) continue;

      const size = labelSize(school);
      visibleInputs.push({ id: school.university, anchor, ...size });
      schoolsById.set(school.university, school);
    }

    const layout = calculateLayout(visibleInputs, this.positionHistory, {
      canvasRect,
      infoRect,
      obstacles: [],
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
    const labels = this.labelsLayer.selectAll<SVGGElement, LabelScene>('g.school-label')
      .data(scenes, (scene) => scene.id);
    const entered = labels.enter()
      .append('g')
      .attr('class', 'school-label')
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
}
