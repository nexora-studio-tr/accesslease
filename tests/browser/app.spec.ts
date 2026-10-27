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

test('a holder requests a separately reviewed renewal with an unchanged original deadline', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Inspect access: Mina Aras · Build Lab', exact: true })
    .click();
  await page.getByRole('button', { name: 'Approve access', exact: true }).click();
  const rows = page
    .locator('.ledger-table tbody tr')
    .filter({ hasText: 'Mina Aras' })
    .filter({ hasText: 'Build Lab' });
  await expect(rows.getByText('Active', { exact: true })).toBeVisible();
  const originalDeadline = await rows.locator('.time-cell span').innerText();
  await page.getByRole('combobox', { name: 'Demo persona' }).click();
  await page.getByRole('option', { name: 'Mina Aras · Member' }).click();
  await page
    .getByRole('button', { name: 'Inspect access: Mina Aras · Build Lab', exact: true })
    .click();
  await page.getByRole('button', { name: 'Request more time', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Request more time', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'ACCESS PACKAGE', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText(
    'The existing deadline stays unchanged while waiting.',
  );
  await page
    .getByLabel('Why do you need access?')
    .fill('Continue release diagnostics during a separately approved term.');
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const renewal = rows.filter({ hasText: 'Renewal request' });
  await expect(renewal.getByText('Awaiting review', { exact: true })).toBeVisible();
  await expect(
    rows.filter({ hasNotText: 'Renewal request' }).locator('.time-cell span'),
  ).toHaveText(originalDeadline);
  await renewal
    .getByRole('button', { name: 'Inspect access: Mina Aras · Build Lab', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Approve access', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('combobox', { name: 'Demo persona' }).click();
  await page.getByRole('option', { name: /Nora Kaya/ }).click();
  await renewal
    .getByRole('button', { name: 'Inspect access: Mina Aras · Build Lab', exact: true })
    .click();
  await page.getByRole('button', { name: 'Approve access', exact: true }).click();
  await expect(renewal.getByText('Active', { exact: true })).toBeVisible();
  await expect(
    rows.filter({ hasNotText: 'Renewal request' }).locator('.time-cell span'),
  ).toHaveText(originalDeadline);
  await page.getByRole('combobox', { name: 'Demo persona' }).click();
  await page.getByRole('option', { name: 'Mina Aras · Member' }).click();
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const turkishRenewal = page
    .locator('.ledger-table tbody tr')
    .filter({ hasText: 'Yenileme başvurusu' });
  await turkishRenewal.getByRole('button', { name: /Erişimi incele: Mina Aras/ }).click();
  await page.getByRole('button', { name: 'Yenileme iste', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Yenileme iste', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Beklerken mevcut bitiş zamanı değişmez.');
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({ path: 'artifacts/screenshots/renewal-tr-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
