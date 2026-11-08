import { test, expect } from '@playwright/test'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * D159 - both browse surfaces credit their data source in the subtitle:
 * "Discover anime by category and filters • AniList" (same for manga).
 * Owner (2026-11-01) asked for the exact wording.
 */

test('anime and manga browse subtitles credit AniList', async ({ page }) => {
  await routeTestAnilistMedia(page)
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto('/anime', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Discover anime by category and filters • AniList')).toBeVisible({ timeout: 30_000 })

  await page.goto('/manga', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Discover manga by category and filters • AniList')).toBeVisible({ timeout: 30_000 })
})
