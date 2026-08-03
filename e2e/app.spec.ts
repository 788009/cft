import { expect, test } from '@playwright/test';

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
  const mapGroup = svg.locator(':scope > g');
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
