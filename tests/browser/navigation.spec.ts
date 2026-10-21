import { test, expect } from '@playwright/test';
import { login } from './support.js';

test('headers stay aligned from desktop to mobile and keep the active admin tab visible', async ({
  page
}) => {
  await login(page, 'zxbrw00');
  await page.goto('/admin/users');
  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation', exact: true });
  const tabs = page.getByRole('navigation', { name: 'Verwaltung', exact: true });
  for (const width of [1440, 1024, 960, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        tabs.evaluate((element) => {
          const active = element.querySelector('[aria-current="page"]')!.getBoundingClientRect();
          const bounds = element.getBoundingClientRect();
          return active.left >= bounds.left && active.right <= bounds.right;
        })
      )
      .toBe(true);
    expect(
      await page
        .locator('.site-header')
        .evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true);
    if (width <= 960) {
      await expect(navigation).toBeHidden();
      await page.getByRole('button', { name: 'Navigation öffnen', exact: true }).click();
      await expect(navigation).toBeVisible();
      const links = await navigation.getByRole('link').all();
      for (const link of links) {
        const box = (await link.boundingBox())!;
        expect(box.width).toBeGreaterThan(230);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await page.keyboard.press('Escape');
      await expect(navigation).toBeHidden();
      await expect(
        page.getByRole('button', { name: 'Navigation öffnen', exact: true })
      ).toBeFocused();
    } else {
      await expect(navigation).toBeVisible();
      await expect(page.locator('.menu-toggle')).toBeHidden();
      const rows = await navigation.getByRole('link').evaluateAll((links) =>
        links.map((link) => {
          const box = link.getBoundingClientRect();
          return Math.round(box.top + box.height / 2);
        })
      );
      expect(new Set(rows).size).toBe(1);
    }
    const rows = await tabs
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => Math.round(link.getBoundingClientRect().top)));
    expect(new Set(rows).size).toBe(1);
    expect(
      await tabs.evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)
    ).toBe(true);
    if (width === 390 || width === 1024)
      await page.screenshot({ path: test.info().outputPath(`navigation-${width}.png`) });
  }
  await tabs.getByRole('link', { name: 'Einstellungen', exact: true }).click();
  await expect(tabs.getByRole('link', { name: 'Einstellungen', exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect
    .poll(async () =>
      tabs.evaluate((element) => {
        const active = element.querySelector('[aria-current="page"]')!;
        return (
          active.getBoundingClientRect().left >= element.getBoundingClientRect().left &&
          active.getBoundingClientRect().right <= element.getBoundingClientRect().right
        );
      })
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Navigation öffnen', exact: true }).click();
  await navigation.getByRole('link', { name: 'Konto', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(navigation).toBeHidden();
});
