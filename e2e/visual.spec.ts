import { expect, test } from '@playwright/test';
import { centerDomesticSchools } from './helpers';

test('renders the initial landscape map consistently', async ({ page }) => {
  await page.goto('/');
  const map = page.getByTestId('map-container');
  await expect(map.locator('.layer-provinces-fill path')).not.toHaveCount(0);
  const labels = map.locator('g.school-label');
  await expect(labels).not.toHaveCount(0);
  await expect(labels.first()).toBeVisible();

  await expect(page).toHaveScreenshot('initial-landscape.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.001,
  });
});

test('renders foreign schools in the configured corner', async ({ page }) => {
  await page.goto('/');
  await centerDomesticSchools(page);

  const map = page.getByTestId('map-container');
  const panel = map.locator('g.foreign-schools-panel');
  await expect(panel).toHaveAttribute('opacity', '1');
  await expect.poll(() => map.locator('g.school-label[opacity="1"]').count())
    .toBe(await map.locator('g.school-label').count());

  await expect(page).toHaveScreenshot('foreign-schools.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.001,
  });
});

test('renders a region detail scene consistently', async ({ page }) => {
  await page.goto('/');
  const provincePaths = page.getByTestId('map-container').locator(
    '.layer-provinces-fill path.region-actionable',
  );
  await expect(provincePaths).not.toHaveCount(0);
  await provincePaths.first().click({ force: true });

  const detailMap = page.getByTestId('region-detail-map');
  await expect(detailMap.locator('.region-detail-geometry path')).not.toHaveCount(0);
  await expect(detailMap.locator('g.school-label')).not.toHaveCount(0);
  await expect(page).toHaveScreenshot('region-detail.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.001,
  });
});

test('renders a personal detail dialog consistently', async ({ page }) => {
  await page.goto('/');
  const student = page.getByTestId('map-container').locator('g.school-label text.student-name').first();
  await expect(student).toBeVisible();
  await student.click({ force: true });
  await expect(page.getByTestId('person-detail-dialog')).toBeVisible();

  await expect(page).toHaveScreenshot('person-detail.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.001,
  });
});

test('renders uniformly scaled cards in compact landscape', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-landscape-chromium', '移动横屏基线已覆盖此状态');
  await page.setViewportSize({ width: 600, height: 300 });
  await page.goto('/');

  const overlay = page.getByTestId('map-container').locator('g.school-overlay');
  await expect.poll(async () => Number(await overlay.getAttribute('data-label-scale'))).toBeLessThan(1);
  await expect(overlay).toHaveAttribute('data-layout-fits', 'true');
  await expect(page).toHaveScreenshot('adaptive-label-scale.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.001,
  });
});
