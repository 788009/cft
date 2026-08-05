import { expect, test } from '@playwright/test';
import { centerDomesticSchools, zoomMapToScale } from './helpers';

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

test('updates strict school search highlights without moving the map', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const overlay = map.locator('g.school-overlay');
  const mapGeometry = map.locator('g.map-geometry');
  const input = page.getByTestId('search-input');
  if (await input.isHidden()) await page.getByTestId('search-toggle').click();
  const schoolTitle = map.locator('text.card-university, text.school-label-title').first();
  await expect(schoolTitle).toBeVisible();
  await expect(input).toBeEnabled();
  const school = (await schoolTitle.textContent())?.trim();
  if (!school || school.length < 2) throw new Error('学校名称不足以验证包含联想');
  const initialTransform = await mapGeometry.getAttribute('transform');

  await input.fill(school.slice(0, -1));
  await expect(page.getByTestId('search-suggestions')).toBeVisible();
  await expect(overlay).toHaveAttribute('data-search-school-count', '0');

  await input.fill(school);
  await expect(overlay).not.toHaveAttribute('data-search-school-count', '0');
  await expect(map.locator('text.is-search-match').filter({ hasText: school }).first()).toBeVisible();
  expect(await mapGeometry.getAttribute('transform')).toBe(initialTransform);

  await page.getByTestId('clear-search').click();
  await expect(input).toHaveValue('');
  await expect(overlay).toHaveAttribute('data-search-school-count', '0');
  await expect(overlay).toHaveAttribute('data-search-student-count', '0');
  await expect(map.locator('.is-search-match')).toHaveCount(0);
});

test('selects suggestions with the keyboard and highlights matching students', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const overlay = map.locator('g.school-overlay');
  const input = page.getByTestId('search-input');
  if (await input.isHidden()) await page.getByTestId('search-toggle').click();
  const schoolTitle = map.locator('text.card-university, text.school-label-title').first();
  await expect(schoolTitle).toBeVisible();
  const school = (await schoolTitle.textContent())?.trim();
  if (!school) throw new Error('缺少学校名称');

  await input.fill(school.slice(0, 1));
  const firstSuggestion = page.getByTestId('search-suggestion').first();
  await expect(firstSuggestion).toBeVisible();
  const suggestionValue = await firstSuggestion.getAttribute('data-value');
  if (!suggestionValue) throw new Error('联想项缺少查询值');
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', 'search-suggestion-0');
  await input.press('Enter');
  await expect(input).toHaveValue(suggestionValue);
  await expect(page.getByTestId('search-suggestions')).toBeHidden();

  const studentName = map.locator('text.student-name').first();
  await expect(studentName).toBeVisible();
  const name = (await studentName.textContent())?.trim();
  if (!name) throw new Error('缺少学生姓名');
  await input.fill(name);
  await expect(overlay).not.toHaveAttribute('data-search-student-count', '0');
  await expect(map.locator('text.student-name.is-search-match').first()).toBeVisible();
  await expect(overlay).toHaveAttribute('data-search-school-count', '0');
});

test('places search after controls in the same corner and reserves its map area', async ({ page }) => {
  await page.goto('/');

  const search = page.getByTestId('search-control');
  const settings = page.getByTestId('settings-button');
  const searchButton = page.getByTestId('search-toggle');
  await expect(search).toHaveAttribute('data-corner', 'top-left');
  const compact = await search.getAttribute('data-compact') === 'true';
  const searchBox = await (compact ? searchButton : page.getByTestId('search-field')).boundingBox();
  const settingsBox = await settings.boundingBox();
  if (!searchBox || !settingsBox) throw new Error('搜索或设置控件没有可用尺寸');
  expect(searchBox.x).toBeGreaterThanOrEqual(settingsBox.x + settingsBox.width);

  const labels = page.getByTestId('map-container').locator('g.school-label[opacity="1"]');
  await expect(labels).not.toHaveCount(0);
  const overlaps = await labels.evaluateAll((nodes, obstacle) => nodes.filter((node) => {
    const rect = node.getBoundingClientRect();
    return !(
      rect.right <= obstacle.x ||
      rect.left >= obstacle.x + obstacle.width ||
      rect.bottom <= obstacle.y ||
      rect.top >= obstacle.y + obstacle.height
    );
  }).length, searchBox);
  expect(overlaps).toBe(0);
});

test('expands and collapses the compact search control toward the viewport center', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-landscape-chromium', '仅验证小屏搜索控件');
  await page.goto('/');

  const search = page.getByTestId('search-control');
  const toggle = page.getByTestId('search-toggle');
  const input = page.getByTestId('search-input');
  await expect(search).toHaveAttribute('data-compact', 'true');
  await expect(search).toHaveAttribute('data-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(input).toBeHidden();
  const collapsedButtonBox = await toggle.boundingBox();

  await toggle.click();
  await expect(search).toHaveAttribute('data-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(input).toBeVisible();
  const expandedButtonBox = await toggle.boundingBox();
  if (!collapsedButtonBox || !expandedButtonBox) throw new Error('搜索按钮没有可用尺寸');
  expect(expandedButtonBox.x).toBeCloseTo(collapsedButtonBox.x, 0);

  await toggle.click();
  await expect(search).toHaveAttribute('data-expanded', 'false');
  await expect(input).toBeHidden();
});

test('renders interactive search arrows for matched schools outside the information range', async ({
  page,
}) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const svg = map.locator('svg');
  const input = page.getByTestId('search-input');
  if (await input.isHidden()) await page.getByTestId('search-toggle').click();
  const regionCard = map.locator('g.school-label:has(text.card-university)').first();
  await expect(regionCard).toBeVisible();
  const regionName = (await regionCard.locator('text.school-label-title').textContent())?.trim();
  const matchedSchoolCount = await regionCard.locator('text.card-university').count();
  if (!regionName || matchedSchoolCount === 0) throw new Error('地区卡片缺少搜索数据');
  await input.fill(regionName);
  await expect(map.locator('g.search-arrow')).toHaveCount(0);

  const box = await svg.boundingBox();
  if (!box) throw new Error('地图 SVG 没有可用尺寸');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 1.3, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();

  const arrows = map.locator('g.search-arrow');
  await expect(arrows).not.toHaveCount(0);
  const totalArrowCount = await arrows.evaluateAll((nodes) => nodes.reduce(
    (total, node) => total + Number((node as SVGGElement).dataset.count),
    0,
  ));
  expect(totalArrowCount).toBe(matchedSchoolCount);
  const firstArrow = arrows.first();
  await expect(firstArrow.locator('circle.search-arrow-hit')).toHaveAttribute('r', '22');
  const geometry = await map.evaluate((container) => {
    const arrow = container.querySelector<SVGGElement>('g.search-arrow');
    const info = container.querySelector<SVGRectElement>('rect.info-rectangle');
    if (!arrow || !info) return null;
    const match = arrow.getAttribute('transform')?.match(/translate\(([^,]+),([^\)]+)\)/);
    if (!match) return null;
    return {
      x: Number(match[1]),
      y: Number(match[2]),
      edge: arrow.dataset.edge,
      rect: {
        x: Number(info.getAttribute('x')),
        y: Number(info.getAttribute('y')),
        width: Number(info.getAttribute('width')),
        height: Number(info.getAttribute('height')),
      },
    };
  });
  if (!geometry) throw new Error('搜索箭头缺少几何信息');
  const expectedBoundary = geometry.edge === 'left'
    ? geometry.rect.x
    : geometry.edge === 'right'
      ? geometry.rect.x + geometry.rect.width
      : geometry.edge === 'top'
        ? geometry.rect.y
        : geometry.rect.y + geometry.rect.height;
  expect(geometry.edge === 'left' || geometry.edge === 'right' ? geometry.x : geometry.y)
    .toBeCloseTo(expectedBoundary, 5);

  await firstArrow.click({ force: true });
  await expect(firstArrow).toHaveAttribute('aria-pressed', 'true');
  const previousTransform = await firstArrow.getAttribute('transform');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 80, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => arrows.first().getAttribute('transform')).not.toBe(previousTransform);

  await page.getByTestId('clear-search').click();
  await expect(arrows).toHaveCount(0);
});

test('centers domestic school extremes and fits their dominant span to the information range', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const svg = map.locator('svg');
  await expect(svg).toHaveAttribute('data-initial-view-applied', 'true');
  const geometry = await map.evaluate((container) => {
    const svgNode = container.querySelector<SVGSVGElement>('svg');
    const overlay = container.querySelector<SVGGElement>('g.school-overlay');
    const info = container.querySelector<SVGRectElement>('rect.info-rectangle');
    if (!svgNode || !overlay || !info) return null;
    return {
      viewportWidth: svgNode.viewBox.baseVal.width,
      viewportHeight: svgNode.viewBox.baseVal.height,
      minX: Number(overlay.dataset.domesticAnchorMinX),
      maxX: Number(overlay.dataset.domesticAnchorMaxX),
      minY: Number(overlay.dataset.domesticAnchorMinY),
      maxY: Number(overlay.dataset.domesticAnchorMaxY),
      infoWidth: Number(info.getAttribute('width')),
      infoHeight: Number(info.getAttribute('height')),
      allDomesticInRange: overlay.dataset.allDomesticInRange,
    };
  });
  if (!geometry) throw new Error('缺少初始地图或学校锚点几何信息');

  expect((geometry.minX + geometry.maxX) / 2).toBeCloseTo(geometry.viewportWidth / 2, 5);
  expect((geometry.minY + geometry.maxY) / 2).toBeCloseTo(geometry.viewportHeight / 2, 5);
  const horizontalRatio = (geometry.maxX - geometry.minX) / geometry.infoWidth;
  const verticalRatio = (geometry.maxY - geometry.minY) / geometry.infoHeight;
  expect(Math.max(horizontalRatio, verticalRatio)).toBeCloseTo(0.8, 5);
  expect(horizontalRatio).toBeLessThanOrEqual(0.8 + 1e-6);
  expect(verticalRatio).toBeLessThanOrEqual(0.8 + 1e-6);
  expect(geometry.allDomesticInRange).toBe('true');
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

  await zoomMapToScale(page, 3);
  await expect(svg).toHaveAttribute('data-map-level', 'city');
  await expect(map.locator('.layer-cities path')).not.toHaveCount(0);

  await zoomMapToScale(page, 7);
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

test('hides school overlays while panning and recomputes the complete layout afterwards', async ({ page }) => {
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

  const overlay = map.locator('g.school-overlay');
  await expect(overlay).toHaveAttribute('data-interacting', 'true');
  await expect(labels.first()).toBeHidden();
  await expect(map.locator('line.school-line').first()).toBeHidden();
  await expect(map.locator('g.foreign-schools-panel')).toBeHidden();

  await page.mouse.up();

  await expect(overlay).toHaveAttribute('data-interacting', 'false');
  await expect(labels.first()).toBeVisible();

  const after = await labels.evaluateAll((nodes) => nodes.map((node) => {
    const label = node as SVGGElement;
    return {
      school: label.dataset.school ?? '',
      x: Number(label.dataset.labelX),
      y: Number(label.dataset.labelY),
      width: Number(label.dataset.labelWidth),
      height: Number(label.dataset.labelHeight),
      studentCount: label.querySelectorAll('text.student-name').length,
    };
  }));
  for (const [index, label] of after.entries()) {
    expect(label.x).toBeGreaterThanOrEqual(0);
    expect(label.y).toBeGreaterThanOrEqual(0);
    expect(label.x + label.width).toBeLessThanOrEqual(viewport.width);
    expect(label.y + label.height).toBeLessThanOrEqual(viewport.height);
    expect(overlaps(label, { school: 'info', ...before.info })).toBe(false);
    for (const other of after.slice(index + 1)) {
      expect(overlaps(label, other, before.spacing)).toBe(false);
    }
  }
});

test('switches to the stable layout mode from settings', async ({ page }) => {
  await page.goto('/');

  const settingsButton = page.getByTestId('settings-button');
  await expect(settingsButton).toHaveAttribute('data-corner', 'top-left');
  await settingsButton.click();

  const dialog = page.getByTestId('settings-dialog');
  const stableMode = page.getByTestId('interaction-mode-stable');
  const reflowMode = page.getByTestId('interaction-mode-hide-and-reflow');
  await expect(dialog).toBeVisible();
  await expect(reflowMode).toHaveAttribute('aria-checked', 'true');
  await expect(stableMode).toHaveAttribute('aria-checked', 'false');
  await stableMode.click();
  await expect(stableMode).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('close-settings-dialog').click();

  const map = page.getByTestId('map-container');
  const svg = map.locator('svg');
  const overlay = map.locator('g.school-overlay');
  const labels = map.locator('g.school-label');
  const lines = map.locator('line.school-line');
  const box = await svg.boundingBox();
  if (!box) throw new Error('地图 SVG 没有可用尺寸');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 12, { steps: 3 });
  await expect(overlay).not.toHaveAttribute('data-interacting', 'true');
  await expect(labels.first()).toBeVisible();
  await expect(lines.first()).toHaveAttribute('opacity', '0.72');
  expect(await lines.first().evaluate((line) => getComputedStyle(line).visibility)).toBe('visible');
  await page.mouse.up();
  await expect(labels.first()).toBeVisible();
});

test('keeps local layout optimization optional and disabled by default', async ({ page }) => {
  await page.goto('/');

  const overlay = page.getByTestId('map-container').locator('g.school-overlay');
  await expect(overlay).toHaveAttribute('data-local-layout-optimization', 'false');
  await page.getByTestId('settings-button').click();

  const toggle = page.getByTestId('local-layout-optimization-toggle');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('可能降低移动和缩放时的流畅度', { exact: true })).toBeVisible();
  await toggle.click();

  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(overlay).toHaveAttribute('data-local-layout-optimization', 'true');
});

test('keeps two-column region card text inside the card without overlaps', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('settings-button').click();
  await page.getByTestId('card-grouping-region').click();
  await page.getByTestId('close-settings-dialog').click();

  const overlay = page.locator('g.school-overlay');
  await expect(overlay).toHaveAttribute('data-card-grouping', 'region');
  const cards = page.locator('g.school-label[data-university-columns="2"]');
  await expect(cards.first()).toBeVisible();

  const results = await cards.evaluateAll((nodes) => nodes.map((node) => {
    const background = node.querySelector<SVGRectElement>('rect.school-label-background');
    if (!background) throw new Error('地区卡片缺少外框');
    const width = background.width.baseVal.value;
    const height = background.height.baseVal.value;
    const textBoxes = Array.from(node.querySelectorAll<SVGGraphicsElement>('text')).map((text) => {
      const box = text.getBBox();
      return { x: box.x, y: box.y, width: box.width, height: box.height, text: text.textContent };
    });
    const overflow = textBoxes.filter((box) => (
      box.x < -0.5 || box.y < -0.5 ||
      box.x + box.width > width + 0.5 || box.y + box.height > height + 0.5
    ));
    const overlaps = textBoxes.flatMap((box, index) => textBoxes.slice(index + 1)
      .filter((other) => !(
        box.x + box.width <= other.x + 0.5 ||
        other.x + other.width <= box.x + 0.5 ||
        box.y + box.height <= other.y + 0.5 ||
        other.y + other.height <= box.y + 0.5
      ))
      .map((other) => [box.text, other.text]));
    return { overflow, overlaps };
  }));
  expect(results.flatMap((result) => result.overflow)).toEqual([]);
  expect(results.flatMap((result) => result.overlaps)).toEqual([]);
});

test('follows the browser color scheme and supports explicit theme settings', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme-mode', 'system');
  await expect(root).toHaveAttribute('data-resolved-theme', 'dark');
  await expect(root).toHaveClass(/dark/);

  await page.getByTestId('settings-button').click();
  const systemMode = page.getByTestId('theme-mode-system');
  const lightMode = page.getByTestId('theme-mode-light');
  const darkMode = page.getByTestId('theme-mode-dark');
  await expect(systemMode).toHaveAttribute('aria-checked', 'true');
  await lightMode.click();
  await expect(root).toHaveAttribute('data-theme-mode', 'light');
  await expect(root).toHaveAttribute('data-resolved-theme', 'light');
  await expect(root).not.toHaveClass(/dark/);
  await darkMode.click();
  await expect(root).toHaveAttribute('data-theme-mode', 'dark');
  await expect(root).toHaveAttribute('data-resolved-theme', 'dark');
  await expect(root).toHaveClass(/dark/);
});

test('shows region names for the current map level and toggles them from settings', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const svg = map.locator('svg');
  const provinceLabels = map.locator('.layer-province-labels text.region-name-label');
  const visibleLabelCount = (labels: typeof provinceLabels) => labels.evaluateAll((nodes) => (
    nodes.filter((node) => getComputedStyle(node).display !== 'none').length
  ));
  await expect(provinceLabels).toHaveCount(34);
  await expect(provinceLabels.filter({ hasText: '陕西省' })).toHaveCount(1);
  await expect(provinceLabels.filter({ hasText: '西安市' })).toHaveCount(0);
  await expect(provinceLabels.first()).toBeVisible();
  const provinceWithSchoolsCount = await map.locator(
    '.layer-provinces-fill path.region-actionable',
  ).count();
  await expect.poll(() => visibleLabelCount(provinceLabels)).toBe(provinceWithSchoolsCount);
  expect(provinceWithSchoolsCount).toBeLessThan(await provinceLabels.count());

  await page.getByTestId('settings-button').click();
  const toggle = page.getByTestId('region-names-toggle');
  const filterSetting = page.getByTestId('region-names-school-filter-setting');
  const filterToggle = page.getByTestId('region-names-school-filter-toggle');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(filterSetting).toBeVisible();
  await expect(filterToggle).toHaveAttribute('aria-checked', 'true');
  const mainToggleBox = await toggle.boundingBox();
  const filterToggleBox = await filterToggle.boundingBox();
  if (!mainToggleBox || !filterToggleBox) throw new Error('地区名称开关没有可用尺寸');
  expect(filterToggleBox.x).toBeGreaterThan(mainToggleBox.x);
  expect(filterToggleBox.width).toBeLessThan(mainToggleBox.width);
  for (const switchControl of [toggle, filterToggle]) {
    const trackBox = await switchControl.locator('[data-toggle-track="true"]').boundingBox();
    const thumbBox = await switchControl.locator('[data-toggle-thumb="true"]').boundingBox();
    if (!trackBox || !thumbBox) throw new Error('地区名称开关图形没有可用尺寸');
    expect(thumbBox.x).toBeGreaterThanOrEqual(trackBox.x);
    expect(thumbBox.x + thumbBox.width).toBeLessThanOrEqual(trackBox.x + trackBox.width);
  }
  await filterToggle.click();
  await expect(filterToggle).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => visibleLabelCount(provinceLabels)).toBe(34);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(filterSetting).toBeHidden();
  await page.getByTestId('close-settings-dialog').click();
  await expect(provinceLabels.first()).toBeHidden();

  const province = map.locator('.layer-provinces-fill path.region-actionable').first();
  await province.click({ force: true });
  const detailMap = page.getByTestId('region-detail-map');
  await expect(detailMap.locator('.region-detail-geometry path')).not.toHaveCount(0);
  await expect(detailMap.locator('.region-detail-labels')).toBeHidden();
  await page.getByTestId('close-region-detail-dialog').click();

  await page.getByTestId('settings-button').click();
  await expect(filterSetting).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(filterSetting).toBeVisible();
  await expect(filterToggle).toHaveAttribute('aria-checked', 'false');
  await filterToggle.click();
  await expect(filterToggle).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('close-settings-dialog').click();
  await expect(provinceLabels.first()).toBeVisible();

  await zoomMapToScale(page, 3);
  await expect(svg).toHaveAttribute('data-map-level', 'city');
  const cityLabels = map.locator('.layer-city-labels text.region-name-label');
  await expect(cityLabels).not.toHaveCount(0);
  await expect(cityLabels.first()).toBeVisible();
  await expect.poll(() => visibleLabelCount(cityLabels)).toBeGreaterThan(0);
  expect(await visibleLabelCount(cityLabels)).toBeLessThan(await cityLabels.count());
  await expect(provinceLabels.first()).toBeHidden();

  await zoomMapToScale(page, 7);
  await expect(svg).toHaveAttribute('data-map-level', 'district');
  const districtLabels = map.locator('.layer-district-labels text.region-name-label');
  await expect(districtLabels).not.toHaveCount(0);
  await expect.poll(() => visibleLabelCount(districtLabels)).toBeGreaterThan(0);
  expect(await visibleLabelCount(districtLabels)).toBeLessThan(await districtLabels.count());
  await expect(cityLabels.first()).toBeHidden();
});

test('toggles the information range decoration on the map and region details', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const infoRectangle = map.locator('rect.info-rectangle');
  await expect(infoRectangle).toBeVisible();

  await page.getByTestId('settings-button').click();
  const regionNamesToggle = page.getByTestId('region-names-toggle');
  const schoolFilterToggle = page.getByTestId('region-names-school-filter-toggle');
  const infoRectangleToggle = page.getByTestId('info-rectangle-toggle');
  await expect(infoRectangleToggle).toHaveAttribute('aria-checked', 'true');

  const toggleBoxes = await Promise.all([
    regionNamesToggle.boundingBox(),
    schoolFilterToggle.boundingBox(),
    infoRectangleToggle.boundingBox(),
  ]);
  if (toggleBoxes.some((box) => box === null)) throw new Error('地图标注开关没有可用尺寸');
  const [regionNamesBox, schoolFilterBox, infoRectangleBox] = toggleBoxes;
  if (!regionNamesBox || !schoolFilterBox || !infoRectangleBox) {
    throw new Error('地图标注开关没有可用尺寸');
  }
  expect(schoolFilterBox.x).toBeCloseTo(regionNamesBox.x, 1);
  expect(infoRectangleBox.x).toBeCloseTo(regionNamesBox.x, 1);
  expect(schoolFilterBox.width).toBeCloseTo(regionNamesBox.width, 1);
  expect(infoRectangleBox.width).toBeCloseTo(regionNamesBox.width, 1);

  await infoRectangleToggle.click();
  await expect(infoRectangleToggle).toHaveAttribute('aria-checked', 'false');
  await expect(infoRectangle).toBeHidden();
  expect(await infoRectangle.evaluate((rectangle) => getComputedStyle(rectangle).display)).toBe('none');
  await page.getByTestId('close-settings-dialog').click();

  const province = map.locator('.layer-provinces-fill path.region-actionable').first();
  await province.click({ force: true });
  const detailInfoRectangle = page.getByTestId('region-detail-map').locator('rect.info-rectangle');
  await expect(detailInfoRectangle).toBeHidden();
  expect(await detailInfoRectangle.evaluate((rectangle) => getComputedStyle(rectangle).display))
    .toBe('none');
  await page.getByTestId('close-region-detail-dialog').click();

  await page.getByTestId('settings-button').click();
  await infoRectangleToggle.click();
  await expect(infoRectangleToggle).toHaveAttribute('aria-checked', 'true');
  await expect(infoRectangle).toBeVisible();
});

test('moves and resizes the information range in its dedicated editing mode', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const infoRectangle = map.locator('rect.info-rectangle');
  await expect(map.locator('svg')).toHaveAttribute('data-initial-view-applied', 'true');
  await expect(infoRectangle).toBeVisible();
  const rectangleGeometry = async (rectangle = infoRectangle) => ({
    x: Number(await rectangle.getAttribute('x')),
    y: Number(await rectangle.getAttribute('y')),
    width: Number(await rectangle.getAttribute('width')),
    height: Number(await rectangle.getAttribute('height')),
  });
  const initial = await rectangleGeometry();

  await page.getByTestId('settings-button').click();
  await page.getByTestId('info-rectangle-toggle').click();
  await expect(infoRectangle).toBeHidden();
  await page.getByTestId('edit-info-rectangle').click();

  await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
  await expect(page.getByTestId('settings-button')).toBeHidden();
  await expect(page.getByTestId('info-rectangle-editor-controls')).toBeVisible();
  await expect(page.getByTestId('info-rectangle-editor')).toBeVisible();
  await expect(infoRectangle).toBeVisible();
  await expect(map.locator('g.school-label').first()).toBeHidden();
  await expect(map.locator('line.school-line').first()).toBeHidden();

  const handles = map.locator('g.info-rectangle-handle');
  await expect(handles).toHaveCount(8);
  const northHit = map.locator('[data-handle="n"] rect.info-rectangle-handle-hit');
  const eastHit = map.locator('[data-handle="e"] rect.info-rectangle-handle-hit');
  const cornerHit = map.locator('[data-handle="se"] rect.info-rectangle-handle-hit');
  expect(Number(await northHit.getAttribute('width'))).toBeGreaterThan(44);
  await expect(northHit).toHaveAttribute('height', '44');
  await expect(eastHit).toHaveAttribute('width', '44');
  expect(Number(await eastHit.getAttribute('height'))).toBeGreaterThan(44);
  await expect(cornerHit).toHaveAttribute('width', '44');
  await expect(cornerHit).toHaveAttribute('height', '44');

  const moveSurface = page.getByTestId('info-rectangle-move-surface');
  const moveBox = await moveSurface.boundingBox();
  if (!moveBox) throw new Error('信息范围框移动区域没有可用尺寸');
  await page.mouse.move(moveBox.x + moveBox.width / 3, moveBox.y + moveBox.height / 3);
  await page.mouse.down();
  await page.mouse.move(
    moveBox.x + moveBox.width / 3 + 50,
    moveBox.y + moveBox.height / 3 + 24,
    { steps: 4 },
  );
  await page.mouse.up();
  const moved = await rectangleGeometry();
  expect(moved.x).toBeCloseTo(initial.x + 50, 0);
  expect(moved.y).toBeCloseTo(initial.y + 24, 0);
  expect(moved.width).toBeCloseTo(initial.width, 1);
  expect(moved.height).toBeCloseTo(initial.height, 1);

  const southEastBox = await map.locator('g.info-rectangle-handle[data-handle="se"]').boundingBox();
  if (!southEastBox) throw new Error('信息范围框缩放手柄没有可用尺寸');
  await page.mouse.move(
    southEastBox.x + southEastBox.width / 2,
    southEastBox.y + southEastBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    southEastBox.x + southEastBox.width / 2 + 36,
    southEastBox.y + southEastBox.height / 2 + 20,
    { steps: 4 },
  );
  await page.mouse.up();
  const resized = await rectangleGeometry();
  expect(resized.width).toBeCloseTo(moved.width + 36, 0);
  expect(resized.height).toBeCloseTo(moved.height + 20, 0);

  await page.getByTestId('reset-info-rectangle').click();
  await expect.poll(() => rectangleGeometry()).toEqual(initial);

  const resetMoveBox = await moveSurface.boundingBox();
  if (!resetMoveBox) throw new Error('重置后的信息范围框没有可用尺寸');
  await page.mouse.move(resetMoveBox.x + 30, resetMoveBox.y + 30);
  await page.mouse.down();
  await page.mouse.move(resetMoveBox.x + 70, resetMoveBox.y + 46, { steps: 3 });
  await page.mouse.up();
  const confirmed = await rectangleGeometry();
  expect(confirmed.x).toBeCloseTo(initial.x + 40, 0);
  expect(confirmed.y).toBeCloseTo(initial.y + 16, 0);

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('info-rectangle-editor-controls')).toHaveCount(0);
  await expect(page.getByTestId('info-rectangle-editor')).toBeHidden();
  await expect(page.getByTestId('settings-button')).toBeVisible();
  await expect(map.locator('g.school-label').first()).toBeVisible();
  await expect(infoRectangle).toBeHidden();

  await page.getByTestId('settings-button').click();
  await page.getByTestId('info-rectangle-toggle').click();
  await page.getByTestId('close-settings-dialog').click();
  await expect(infoRectangle).toBeVisible();
  await expect.poll(() => rectangleGeometry()).toEqual(confirmed);

  await map.locator('.layer-provinces-fill path.region-actionable').first().click({ force: true });
  const detailMap = page.getByTestId('region-detail-map');
  const detailRectangle = detailMap.locator('rect.info-rectangle');
  await expect(detailRectangle).toBeVisible();
  const mainSvgBox = await map.locator('svg').boundingBox();
  const detailSvgBox = await detailMap.boundingBox();
  if (!mainSvgBox || !detailSvgBox) throw new Error('地图没有可用尺寸');
  const detail = await rectangleGeometry(detailRectangle);
  expect(detail.x / detailSvgBox.width).toBeCloseTo(confirmed.x / mainSvgBox.width, 4);
  expect(detail.y / detailSvgBox.height).toBeCloseTo(confirmed.y / mainSvgBox.height, 4);
  expect(detail.width / detailSvgBox.width).toBeCloseTo(confirmed.width / mainSvgBox.width, 4);
  expect(detail.height / detailSvgBox.height).toBeCloseTo(confirmed.height / mainSvgBox.height, 4);
});

test('highlights provinces on hover in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  const province = page.getByTestId('map-container').locator(
    '.layer-provinces-fill path.region-actionable',
  ).first();
  await expect(province).toBeVisible();
  const initialFill = await province.evaluate((element) => getComputedStyle(element).fill);
  await province.hover({ force: true });
  await expect.poll(() => province.evaluate((element) => getComputedStyle(element).fill))
    .toBe('rgb(19, 78, 74)');
  expect(initialFill).not.toBe('rgb(19, 78, 74)');
});

test('highlights school lines from card and region hover', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const label = map.locator('g.school-label').first();
  await expect(label).toBeVisible();
  const school = await label.getAttribute('data-school');
  if (!school) throw new Error('学校卡片缺少学校标识');
  const escapedSchool = await page.evaluate((value) => CSS.escape(value), school);
  const schoolLine = map.locator(`line.school-line[data-school="${escapedSchool}"]`);

  await label.hover();
  await expect(label).toHaveClass(/is-highlighted/);
  await expect(schoolLine).toHaveClass(/is-highlighted/);
  await expect.poll(() => schoolLine.evaluate((line) => getComputedStyle(line).strokeWidth))
    .toBe('3px');
  await expect.poll(() => label.locator('rect.school-label-background').evaluate(
    (background) => getComputedStyle(background).strokeWidth,
  )).toBe('2px');
  await page.mouse.move(2, 2);
  await expect(label).not.toHaveClass(/is-highlighted/);
  await expect(schoolLine).not.toHaveClass(/is-highlighted/);

  const provinceAdcode = await schoolLine.getAttribute('data-province-adcode');
  if (!provinceAdcode) throw new Error('学校连线缺少省级 adcode');
  const province = map.locator(
    `.layer-provinces-fill path.region-actionable[data-region-adcode="${provinceAdcode}"]`,
  );
  const provinceLines = map.locator(
    `line.school-line[data-province-adcode="${provinceAdcode}"]`,
  );
  await province.hover({ force: true });
  await expect(provinceLines).not.toHaveCount(0);
  await expect.poll(() => provinceLines.evaluateAll((lines) => (
    lines.filter((line) => line.classList.contains('is-highlighted')).length
  ))).toBe(await provinceLines.count());
  await expect(map.locator('line.school-line.is-highlighted')).toHaveCount(
    await provinceLines.count(),
  );

  await page.getByTestId('settings-button').click();
  await page.getByTestId('interaction-mode-stable').click();
  await page.getByTestId('close-settings-dialog').click();
  const svg = map.locator('svg');
  const svgBox = await svg.boundingBox();
  const anchorX = Number(await schoolLine.getAttribute('x1'));
  const anchorY = Number(await schoolLine.getAttribute('y1'));
  if (!svgBox) throw new Error('地图 SVG 没有可用尺寸');
  await zoomMapToScale(page, 3, {
    x: svgBox.x + anchorX,
    y: svgBox.y + anchorY,
  });
  await expect(svg).toHaveAttribute('data-map-level', 'city');
  const cityLine = schoolLine;
  await expect(cityLine).toHaveAttribute('opacity', '0.72');
  expect(await cityLine.evaluate((line) => getComputedStyle(line).visibility)).toBe('visible');
  const cityAdcode = await cityLine.getAttribute('data-city-adcode');
  if (!cityAdcode) throw new Error('学校连线缺少市级 adcode');
  const city = map.locator(
    `.layer-cities path.region-actionable[data-region-adcode="${cityAdcode}"]`,
  );
  const cityLines = map.locator(`line.school-line[data-city-adcode="${cityAdcode}"]`);
  await city.hover({ force: true });
  await expect.poll(() => cityLines.evaluateAll((lines) => (
    lines.filter((line) => line.classList.contains('is-highlighted')).length
  ))).toBe(await cityLines.count());
  await expect(map.locator('line.school-line.is-highlighted')).toHaveCount(await cityLines.count());
});

test.describe('touch line highlighting', () => {
  test.use({ hasTouch: true });

  test('keeps a tapped card line highlighted until another area is tapped', async ({ page }) => {
    await page.goto('/');

    const map = page.getByTestId('map-container');
    const label = map.locator('g.school-label').first();
    const titleBox = await label.locator('text.school-label-title').boundingBox();
    const school = await label.getAttribute('data-school');
    if (!titleBox || !school) throw new Error('学校卡片不可触控');
    const escapedSchool = await page.evaluate((value) => CSS.escape(value), school);
    const schoolLine = map.locator(`line.school-line[data-school="${escapedSchool}"]`);

    await page.touchscreen.tap(
      titleBox.x + titleBox.width / 2,
      titleBox.y + titleBox.height / 2,
    );
    await expect(label).toHaveClass(/is-highlighted/);
    await expect(schoolLine).toHaveClass(/is-highlighted/);

    await page.getByTestId('settings-button').tap();
    await expect(label).not.toHaveClass(/is-highlighted/);
    await expect(schoolLine).not.toHaveClass(/is-highlighted/);
  });
});

test('restores re-entering school labels at their saved position without sliding from the origin', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const svg = map.locator('svg');
  const labels = map.locator('g.school-label');
  await expect(labels).not.toHaveCount(0);
  const initialSchools = await labels.evaluateAll((nodes) => nodes.map((node) => (
    (node as SVGGElement).dataset.school ?? ''
  )));
  const box = await svg.boundingBox();
  if (!box) throw new Error('地图 SVG 没有可用尺寸');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -2_400);
  await expect.poll(() => labels.count()).toBeLessThan(initialSchools.length);
  const zoomedSchools = new Set(await labels.evaluateAll((nodes) => nodes.map((node) => (
    (node as SVGGElement).dataset.school ?? ''
  ))));
  const reEnteringSchool = initialSchools.find((school) => !zoomedSchools.has(school));
  if (!reEnteringSchool) throw new Error('没有学校在缩放后离开信息显示范围');

  const reEnteringLabel = map.locator(`g.school-label[data-school="${reEnteringSchool}"]`);
  await expect(reEnteringLabel).toHaveCount(0);
  await map.evaluate((container) => {
    const labelsLayer = container.querySelector('g.school-labels');
    if (!labelsLayer) throw new Error('缺少学校标签图层');
    const captures: Array<{ school: string; transform: string | null }> = [];
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof SVGGElement) || !node.classList.contains('school-label')) continue;
          captures.push({
            school: node.dataset.school ?? '',
            transform: node.getAttribute('transform'),
          });
        }
      }
    });
    observer.observe(labelsLayer, { childList: true });
    Object.assign(window, { __labelEntryObserver: observer, __labelEntryCaptures: captures });
  });

  await page.mouse.wheel(0, 2_400);
  await expect(reEnteringLabel).toBeVisible();
  const result = await map.evaluate((container, school) => {
    const label = Array.from(container.querySelectorAll<SVGGElement>('g.school-label'))
      .find((node) => node.dataset.school === school);
    const state = window as typeof window & {
      __labelEntryObserver?: MutationObserver;
      __labelEntryCaptures?: Array<{ school: string; transform: string | null }>;
    };
    state.__labelEntryObserver?.disconnect();
    const capture = state.__labelEntryCaptures?.find((entry) => entry.school === school);
    return {
      initialTransform: capture?.transform ?? null,
      expectedTransform: label
        ? `translate(${label.dataset.labelX},${label.dataset.labelY}) scale(${label.dataset.labelScale})`
        : null,
    };
  }, reEnteringSchool);

  expect(result.initialTransform).toBe(result.expectedTransform);
});

test('shrinks every card only when needed and restores full size with available space', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 300 });
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const overlay = map.locator('g.school-overlay');
  const labels = map.locator('g.school-label');
  await expect(labels).not.toHaveCount(0);
  const compact = await map.evaluate((container) => {
    const overlayNode = container.querySelector<SVGGElement>('g.school-overlay');
    const scale = Number(overlayNode?.dataset.labelScale);
    const spacing = Number(overlayNode?.dataset.labelSpacing);
    const cards = Array.from(container.querySelectorAll<SVGGElement>('g.school-label')).map((label) => ({
      x: Number(label.dataset.labelX),
      y: Number(label.dataset.labelY),
      width: Number(label.dataset.labelWidth),
      height: Number(label.dataset.labelHeight),
      scale: Number(label.dataset.labelScale),
      transform: label.getAttribute('transform') ?? '',
    }));
    const conflicts = cards.flatMap((card, index) => cards.slice(index + 1).filter((other) => !(
      card.x + card.width + spacing <= other.x ||
      other.x + other.width + spacing <= card.x ||
      card.y + card.height + spacing <= other.y ||
      other.y + other.height + spacing <= card.y
    ))).length;
    return {
      scale,
      fits: overlayNode?.dataset.layoutFits,
      conflicts,
      allCardsShareScale: cards.every((card) => (
        card.scale === scale && card.transform.includes(`scale(${scale})`)
      )),
    };
  });

  expect(compact.scale).toBeLessThan(1);
  expect(compact.fits).toBe('true');
  expect(compact.conflicts).toBe(0);
  expect(compact.allCardsShareScale).toBe(true);

  await page.setViewportSize({ width: 1_440, height: 900 });
  await expect.poll(async () => Number(await overlay.getAttribute('data-label-scale'))).toBe(1);
  await expect.poll(() => labels.evaluateAll((nodes) => nodes.every((node) => (
    (node as SVGGElement).dataset.labelScale === '1'
  )))).toBe(true);
});

test('reserves the configured corner for foreign schools and toggles it with map coverage', async ({ page }) => {
  await page.goto('/');

  const map = page.getByTestId('map-container');
  const panel = map.locator('g.foreign-schools-panel');
  await centerDomesticSchools(page);

  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('opacity', '1');
  await expect(panel).toHaveAttribute('data-corner', 'top-right');
  await expect.poll(async () => (
    await map.locator('g.school-overlay').getAttribute('data-label-scale') ===
    await panel.getAttribute('data-label-scale')
  )).toBe(true);
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
  await zoomMapToScale(page, 3);
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

  await zoomMapToScale(page, 7);
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

test('suppresses native focus outlines on clickable SVG elements', async ({ page }) => {
  await page.goto('/');

  const province = page.getByTestId('map-container').locator(
    '.layer-provinces-fill path.region-actionable',
  ).first();
  await expect(province).toBeVisible();
  await province.click({ force: true });
  await page.getByTestId('close-region-detail-dialog').click();
  await expect(province).toBeFocused();
  expect(await province.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');

  const student = page.getByTestId('map-container').locator('text.student-name').first();
  await expect(student).toBeVisible();
  await student.click({ force: true });
  await page.getByTestId('close-person-detail-dialog').click();
  await expect(student).toBeFocused();
  expect(await student.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');
});
