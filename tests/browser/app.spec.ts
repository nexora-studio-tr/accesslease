import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('review, approve, expire and inspect observed access', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Every permission has a purpose.' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Inspect access: Mina Aras · Build Lab', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Permission preview' })).toBeVisible();
  await expect(page.getByText('build-lab', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve access', exact: true }).click();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Try a scenario', exact: true }).click();
  await page.getByRole('button', { name: 'Advance 49 hours', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page
    .getByRole('button', { name: 'Inspect access: Mina Aras · Build Lab', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Observed result' })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Ended', { exact: true })).toBeVisible();
});
test('member requests have a working form and cannot self-approve', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Demo persona' }).click();
  await page.getByRole('option', { name: 'Mina Aras · Member' }).click();
  await expect(page.getByText('Mina Aras', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Access catalog', exact: true }).click();
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Support Room', exact: true }) });
  await card.getByRole('button', { name: 'Request access' }).click();
  await page
    .getByLabel('Why do you need access?')
    .fill('Investigate a support issue with the external team.');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Access ledger', exact: true }).click();
  await page
    .getByRole('button', { name: 'Inspect access: Mina Aras · Support Room', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Approve access', exact: true })).toHaveCount(0);
});
test('Turkish UI, mobile layout and keyboard-accessible dialogs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Her yetkinin bir nedeni var.' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/mobile-tr.png', fullPage: true });
  const overflow = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    containers: [
      ...document.querySelectorAll(
        'html,body,#root,.radix-themes,.app-shell,.sidebar,.sidebar nav,.main-shell,.main-content,.ledger-primary,.table-wrap,.ledger-toolbar',
      ),
    ].map((e) => ({
      tag: e.tagName,
      cls: e.className,
      width: Math.round(e.getBoundingClientRect().width),
      scroll: e.scrollWidth,
      x: getComputedStyle(e).overflowX,
    })),
    elements: [...document.querySelectorAll('body *')]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
      .map((e) => ({
        tag: e.tagName,
        cls: e.className,
        right: Math.round(e.getBoundingClientRect().right),
      }))
      .slice(0, 4),
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
  await page.getByRole('button', { name: 'Erişim iste', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/screenshots/mobile-tr.png', fullPage: true });
});
test('desktop and dialog meet automated WCAG AA checks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Every permission has a purpose.' }),
  ).toBeVisible();
  const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect((await scan()).violations).toEqual([]);
  await page.screenshot({ path: 'artifacts/screenshots/desktop-en.png', fullPage: true });
  await page
    .getByRole('button', { name: 'Inspect access: Mina Aras · Build Lab', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Permission preview' })).toBeVisible();
  expect((await scan()).violations).toEqual([]);
  await page.screenshot({ path: 'artifacts/screenshots/preview-en.png', fullPage: true });
});
