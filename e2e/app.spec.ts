import { expect, test } from '@playwright/test';
import { centerDomesticSchools } from './helpers';

test('switches between portrait guidance and the landscape map', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto('/');

  const guide = page.getByTestId('orientation-guide');
  const map = page.getByTestId('map-container');
  await expect(guide).toBeHidden();
  await expect(map.locator('svg')).toBeVisible();
  await expect(map.locator('.layer-provinces-fill path')).not.toHaveCount(0);

  await page.setViewportSize({ width: 600, height: 900 });
  await expect(guide).toBeVisible();
  await expect(map).toBeHidden();
  await expect(map.locator('svg')).toHaveCount(0);

  await page.setViewportSize({ width: 900, height: 600 });
  await expect(guide).toBeHidden();
  await expect(map.locator('svg')).toBeVisible();
  await expect(map.locator('.layer-provinces-fill path')).not.toHaveCount(0);
});

test('zooms, changes detail level, pans and recomputes paths after resize', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const svg = map.locator('svg');
  const mapGroup = svg.locator(':scope > g.map-geometry');
  const provincePath = map.locator('.layer-provinces-fill path').first();
  await expect(provincePath).toBeVisible();

  const initialPath = await provincePath.getAttribute('d');
  const box = await svg.boundingBox();
  if (!box) throw new Error('地图 SVG 没有可用尺寸');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -1_200);
  await expect(svg).toHaveAttribute('data-map-level', 'city');
  await expect(map.locator('.layer-cities path')).not.toHaveCount(0);

  await page.mouse.wheel(0, -1_200);
  await expect(svg).toHaveAttribute('data-map-level', 'district');
  await expect(map.locator('.layer-districts path')).not.toHaveCount(0);

  const zoomedTransform = await mapGroup.getAttribute('transform');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => mapGroup.getAttribute('transform')).not.toBe(zoomedTransform);

  await page.setViewportSize({ width: 1_000, height: 700 });
  await expect.poll(() => provincePath.getAttribute('d')).not.toBe(initialPath);
});

test('lays out visible school labels without overlap and keeps them stable while panning', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const labels = map.locator('g.school-label');
  await expect(labels).not.toHaveCount(0);

  const before = await map.evaluate((container) => {
    const info = container.querySelector<SVGRectElement>('rect.info-rectangle');
    const labelNodes = Array.from(container.querySelectorAll<SVGGElement>('g.school-label'));
    return {
      info: info ? {
        x: Number(info.getAttribute('x')),
        y: Number(info.getAttribute('y')),
        width: Number(info.getAttribute('width')),
        height: Number(info.getAttribute('height')),
      } : null,
      labels: labelNodes.map((label) => ({
        school: label.dataset.school ?? '',
        x: Number(label.dataset.labelX),
        y: Number(label.dataset.labelY),
        width: Number(label.dataset.labelWidth),
        height: Number(label.dataset.labelHeight),
        studentCount: label.querySelectorAll('text.student-name').length,
      })),
      lineCount: container.querySelectorAll('line.school-line').length,
      anchorCount: container.querySelectorAll('circle.school-anchor').length,
      spacing: Number(container.querySelector<SVGGElement>('g.school-overlay')?.dataset.labelSpacing),
    };
  });

  expect(before.info).not.toBeNull();
  expect(before.lineCount).toBe(before.labels.length);
  expect(before.anchorCount).toBe(before.labels.length);
  expect(before.labels.every((label) => label.studentCount > 0)).toBe(true);

  const viewport = page.viewportSize();
  if (!viewport || !before.info) throw new Error('缺少视口或信息矩形');
  const overlaps = (a: typeof before.labels[number], b: typeof before.labels[number], spacing = 0) => !(
    a.x + a.width + spacing <= b.x ||
    b.x + b.width + spacing <= a.x ||
    a.y + a.height + spacing <= b.y ||
    b.y + b.height + spacing <= a.y
  );
  for (const [index, label] of before.labels.entries()) {
    expect(label.x).toBeGreaterThanOrEqual(0);
    expect(label.y).toBeGreaterThanOrEqual(0);
    expect(label.x + label.width).toBeLessThanOrEqual(viewport.width);
    expect(label.y + label.height).toBeLessThanOrEqual(viewport.height);
    expect(overlaps(label, { school: 'info', studentCount: 0, ...before.info })).toBe(false);
    for (const other of before.labels.slice(index + 1)) {
      expect(overlaps(label, other, before.spacing)).toBe(false);
    }
  }

  const svg = map.locator('svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('地图 SVG 没有可用尺寸');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 12, { steps: 3 });
  await page.mouse.up();

  const after = await labels.evaluateAll((nodes) => nodes.map((node) => {
    const label = node as SVGGElement;
    return {
      school: label.dataset.school ?? '',
      x: Number(label.dataset.labelX),
      y: Number(label.dataset.labelY),
    };
  }));
  const afterBySchool = new Map(after.map((label) => [label.school, label]));
  for (const label of before.labels) {
    const current = afterBySchool.get(label.school);
    if (!current) continue;
    expect(current.x).toBe(label.x);
    expect(current.y).toBe(label.y);
  }
});

test('reserves the configured corner for foreign schools and toggles it with map coverage', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const panel = map.locator('g.foreign-schools-panel');
  await centerDomesticSchools(page);

  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('opacity', '1');
  await expect(panel).toHaveAttribute('data-corner', 'top-right');
  await expect(panel.locator('g.foreign-school-group')).not.toHaveCount(0);
  await expect(panel.locator('text.student-name')).not.toHaveCount(0);

  const geometry = await map.evaluate((container) => {
    const panelNode = container.querySelector<SVGGElement>('g.foreign-schools-panel');
    if (!panelNode) return null;
    const panelRect = {
      x: Number(panelNode.dataset.panelX),
      y: Number(panelNode.dataset.panelY),
      width: Number(panelNode.dataset.panelWidth),
      height: Number(panelNode.dataset.panelHeight),
    };
    const labels = Array.from(container.querySelectorAll<SVGGElement>('g.school-label')).map((label) => ({
      x: Number(label.dataset.labelX),
      y: Number(label.dataset.labelY),
      width: Number(label.dataset.labelWidth),
      height: Number(label.dataset.labelHeight),
    }));
    return {
      panelRect,
      labels,
      spacing: Number(container.querySelector<SVGGElement>('g.school-overlay')?.dataset.labelSpacing),
    };
  });
  const viewport = page.viewportSize();
  if (!geometry || !viewport) throw new Error('缺少国外学校面板或视口');
  expect(geometry.panelRect.y).toBe(20);
  expect(geometry.panelRect.x + geometry.panelRect.width).toBe(viewport.width - 20);
  for (const [index, label] of geometry.labels.entries()) {
    const separated = (
      label.x + label.width + geometry.spacing <= geometry.panelRect.x ||
      geometry.panelRect.x + geometry.panelRect.width + geometry.spacing <= label.x ||
      label.y + label.height + geometry.spacing <= geometry.panelRect.y ||
      geometry.panelRect.y + geometry.panelRect.height + geometry.spacing <= label.y
    );
    expect(separated).toBe(true);
    for (const other of geometry.labels.slice(index + 1)) {
      const labelsSeparated = (
        label.x + label.width + geometry.spacing <= other.x ||
        other.x + other.width + geometry.spacing <= label.x ||
        label.y + label.height + geometry.spacing <= other.y ||
        other.y + other.height + geometry.spacing <= label.y
      );
      expect(labelsSeparated, `标签间距冲突: ${JSON.stringify({ label, other })}`).toBe(true);
    }
  }

  const svg = map.locator('svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('地图 SVG 没有可用尺寸');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -2_400);
  await expect(panel).toHaveCount(0);

  await page.mouse.wheel(0, 2_400);
  await expect(panel).toBeVisible();
});

test('opens a static province detail scene with every indexed school', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const provincePaths = map.locator('.layer-provinces-fill path.region-actionable');
  await expect(provincePaths).not.toHaveCount(0);
  const provincePath = provincePaths.first();
  await provincePath.click({ force: true });

  const dialog = page.getByTestId('region-detail-dialog');
  const detailMap = page.getByTestId('region-detail-map');
  await expect(dialog).toBeVisible();
  await expect(detailMap).toHaveAttribute('data-region-level', 'province');
  await expect(detailMap.locator('.region-detail-geometry path')).not.toHaveCount(0);
  await expect(detailMap.locator('g.school-label')).not.toHaveCount(0);

  const expectedSchoolCount = Number(await detailMap.getAttribute('data-region-school-count'));
  await expect(detailMap.locator('g.school-label')).toHaveCount(expectedSchoolCount);
  const initialGeometryTransform = await detailMap.locator('.region-detail-geometry').getAttribute('transform');
  const detailBox = await detailMap.boundingBox();
  if (!detailBox) throw new Error('地区详情地图没有可用尺寸');
  await page.mouse.move(detailBox.x + detailBox.width / 2, detailBox.y + detailBox.height / 2);
  await page.mouse.wheel(0, -1_200);
  await expect.poll(() => detailMap.locator('.region-detail-geometry').getAttribute('transform'))
    .toBe(initialGeometryTransform);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('opens city details at city level and does not drill down from districts', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const svg = map.locator('svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('地图 SVG 没有可用尺寸');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -1_200);
  await expect(svg).toHaveAttribute('data-map-level', 'city');

  const cityPaths = map.locator('.layer-cities path.region-actionable');
  await expect(cityPaths).not.toHaveCount(0);
  const cityHitPoint = await map.evaluate((container) => {
    const rect = container.getBoundingClientRect();
    for (let y = Math.max(0, rect.top); y < Math.min(window.innerHeight, rect.bottom); y += 4) {
      for (let x = Math.max(0, rect.left); x < Math.min(window.innerWidth, rect.right); x += 4) {
        const element = document.elementFromPoint(x, y);
        if (element?.matches('.layer-cities path.region-actionable')) return { x, y };
      }
    }
    return null;
  });
  if (!cityHitPoint) throw new Error('当前视口内没有可点击的城市区域');
  await page.mouse.click(cityHitPoint.x, cityHitPoint.y);
  const dialog = page.getByTestId('region-detail-dialog');
  const detailMap = page.getByTestId('region-detail-map');
  await expect(dialog).toBeVisible();
  await expect(detailMap).toHaveAttribute('data-region-level', 'city');
  await expect(detailMap.locator('.region-detail-geometry path')).not.toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -1_200);
  await expect(svg).toHaveAttribute('data-map-level', 'district');
  await cityPaths.first().evaluate((path) => {
    path.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(dialog).toHaveCount(0);
});

test('shows personal details, omits an empty contact row and restores focus', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const studentsWithoutContact = map.locator(
    'g.school-label text.student-name[data-has-contact="false"]',
  );
  await expect(studentsWithoutContact).not.toHaveCount(0);
  const student = studentsWithoutContact.first();
  await student.click({ force: true });

  const dialog = page.getByTestId('person-detail-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('person-university-row')).toBeVisible();
  await expect(page.getByTestId('person-province-row')).toBeVisible();
  await expect(page.getByTestId('person-city-row')).toBeVisible();
  await expect(page.getByTestId('person-contact-row')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(student).toBeFocused();
});

test('opens personal details from region and foreign school scenes', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const provincePaths = map.locator('.layer-provinces-fill path.region-actionable');
  await expect(provincePaths).not.toHaveCount(0);
  await provincePaths.first().click({ force: true });

  const regionDialog = page.getByTestId('region-detail-dialog');
  const regionStudent = page.getByTestId('region-detail-map').locator('text.student-name').first();
  await expect(regionStudent).toBeVisible();
  await regionStudent.press('Enter');
  const personDialog = page.getByTestId('person-detail-dialog');
  await expect(personDialog).toBeVisible();
  await expect(regionDialog).toHaveAttribute('aria-hidden', 'true');

  await page.keyboard.press('Escape');
  await expect(personDialog).toHaveCount(0);
  await expect(regionDialog).toBeVisible();
  await expect(regionDialog).not.toHaveAttribute('aria-hidden', 'true');
  await expect(regionStudent).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(regionDialog).toHaveCount(0);

  await centerDomesticSchools(page);
  const foreignStudent = map.locator('g.foreign-schools-panel text.student-name').first();
  await expect(foreignStudent).toBeVisible();
  await foreignStudent.click({ force: true });
  await expect(personDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(personDialog).toHaveCount(0);
  await expect(foreignStudent).toBeFocused();
});
