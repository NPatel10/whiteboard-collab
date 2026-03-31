import { devices, expect, test } from '@playwright/test';

test('shows the landing state', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'Collaborative whiteboard' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Create board' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Join board' })).toBeVisible();
});

test('shows the owner board state after creating a board', async ({ page }) => {
	await page.goto('/');

	await page.getByRole('button', { name: 'Create board' }).click();

	await expect(
		page.getByRole('heading', {
			name: 'Shared board'
		})
	).toBeVisible();
	await expect(page.getByText('Owner board', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Share' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'People' })).toBeVisible();
});

test('shows the guest board state after joining a board', async ({ page }) => {
	await page.goto('/');

	await page.getByRole('button', { name: 'Join board' }).click();
	await page.getByLabel('Join code').fill('A7F3KQ9X');
	await page.getByLabel('Nickname').fill('Guest');
	await page.locator('form').getByRole('button', { name: 'Join board' }).click();

	await expect(
		page.getByRole('heading', {
			name: 'Joined board'
		})
	).toBeVisible();
	await expect(page.getByText('Guest board', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Kick' })).toHaveCount(0);
});

test('shows the invalid code flow for short join codes', async ({ page }) => {
	await page.goto('/');

	await page.getByRole('button', { name: 'Join board' }).click();
	await page.getByLabel('Join code').fill('BAD');
	await page.getByLabel('Nickname').fill('Guest');
	await page.locator('form').getByRole('button', { name: 'Join board' }).click();

	await expect(page.getByText('Invalid Code', { exact: true })).toBeVisible();
	await expect(page.getByText('Enter a valid 8-character board code.')).toBeVisible();
});

test.use({ ...devices['iPad Mini'] });

test('supports touch-first board controls on tablet layout', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Create board' }).click();

	await page.getByRole('button', { name: 'Board controls' }).tap();
	await expect(page.getByRole('heading', { name: 'Board controls', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Participants' }).tap();
	await expect(page.getByRole('heading', { name: 'Participants', exact: true })).toBeVisible();
});
