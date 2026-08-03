import { expect, test } from '@playwright/test';

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
