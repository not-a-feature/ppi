import { expect, type Page } from '@playwright/test';

export const password = 'Browser-fixture-only-2026!';

export async function login(page: Page, zx: string, value = password) {
  await page.goto('/login');
  await page.getByLabel('zx-Kennung').fill(zx);
  await page.getByLabel('Passwort', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/lectures$/);
}
