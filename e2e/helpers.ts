import { expect, type Page } from '@playwright/test';

export async function centerDomesticSchools(page: Page): Promise<void> {
  const map = page.getByTestId('map-container');
  const panel = map.locator('g.foreign-schools-panel');
  await expect(map.locator('g.school-label')).not.toHaveCount(0);
  if (await panel.count() > 0) return;

  const centering = await map.evaluate((container) => {
    const overlay = container.querySelector<SVGGElement>('g.school-overlay');
    const info = container.querySelector<SVGRectElement>('rect.info-rectangle');
    if (!overlay || !info) return null;
    const infoCenterX = Number(info.getAttribute('x')) + Number(info.getAttribute('width')) / 2;
    const infoCenterY = Number(info.getAttribute('y')) + Number(info.getAttribute('height')) / 2;
    const anchorCenterX = (
      Number(overlay.dataset.domesticAnchorMinX) + Number(overlay.dataset.domesticAnchorMaxX)
    ) / 2;
    const anchorCenterY = (
      Number(overlay.dataset.domesticAnchorMinY) + Number(overlay.dataset.domesticAnchorMaxY)
    ) / 2;
    return { x: infoCenterX - anchorCenterX, y: infoCenterY - anchorCenterY };
  });
  const mapBox = await map.locator('svg').boundingBox();
  if (!centering || !mapBox) throw new Error('无法计算国内学校锚点居中位移');

  await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    mapBox.x + mapBox.width / 2 + centering.x,
    mapBox.y + mapBox.height / 2 + centering.y,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect(map.locator('g.school-overlay')).toHaveAttribute('data-all-domestic-in-range', 'true');
}

export async function zoomMapToScale(
  page: Page,
  targetScale: number,
  pointer?: { x: number; y: number },
): Promise<void> {
  const svg = page.getByTestId('map-container').locator('svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('地图 SVG 没有可用尺寸');
  const currentScale = await svg.evaluate((node) => (
    (node as SVGSVGElement & { __zoom?: { k: number } }).__zoom?.k ?? 1
  ));
  const deltaY = -Math.log2(targetScale / currentScale) / 0.002;
  await page.mouse.move(pointer?.x ?? box.x + box.width / 2, pointer?.y ?? box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
  await expect.poll(() => svg.evaluate((node) => (
    (node as SVGSVGElement & { __zoom?: { k: number } }).__zoom?.k ?? 1
  ))).toBeCloseTo(targetScale, 2);
}
