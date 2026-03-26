import { expect, test } from '@playwright/test';

test('shows the landing state', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'One route, five app states.' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Create board' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Join board' })).toBeVisible();
});

test('shows the owner board state after creating a board', async ({ page }) => {
	await page.goto('/');

	await page.getByRole('button', { name: 'Create board' }).click();

	await expect(page.getByRole('heading', { name: 'Authority view for snapshots and controls' })).toBeVisible();
	await expect(page.getByText('Owner board', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Share' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Kick' })).toBeVisible();
});

test('shows the guest board state after joining a board', async ({ page }) => {
	await page.goto('/');

	await page.getByRole('button', { name: 'Join board' }).click();
	await page.getByLabel('Join code').fill('A7F3KQ9X');
	await page.getByLabel('Nickname').fill('Guest');
	await page.locator('form').getByRole('button', { name: 'Join board' }).click();

	await expect(page.getByRole('heading', { name: 'Guest view with owner-synced state' })).toBeVisible();
	await expect(page.getByText('Guest board', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Kick' })).toHaveCount(0);
});
