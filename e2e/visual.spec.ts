import { expect, test } from '@playwright/test';

test('renders the initial landscape map consistently', async ({ page }) => {
  await page.goto('/');
  const map = page.getByTestId('map-container');
  await expect(map.locator('.layer-provinces-fill path')).not.toHaveCount(0);

  await expect(page).toHaveScreenshot('initial-landscape.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  });
});
