import { expect, type Page } from "@playwright/test";

/**
 * The driver's shipment list (update J2): one card per shipment; a tap on a card opens the shipment sheet with its actions (arrive, deliver, can't deliver,
 * postpone). These helpers open that sheet the way a driver does.
 */

/** Opens the sticky "Next up" shipment (the one the driver is at, else the current / first one) and waits for its sheet. */
export async function openNext(page: Page) {
  await page.getByTestId("ship-next-open").click();
  await expect(page.getByTestId("current-stop")).toBeVisible();
}

/** Opens one shipment by its code (any card, locked or not) and returns its sheet. */
export async function openShipment(page: Page, code: string) {
  await page.locator(`[data-testid="ship-card"][data-code="${code}"] [data-testid="ship-code"]`).click();
  const sheet = page.locator(`[data-testid="current-stop"][data-code="${code}"], [data-testid="stop-detail"][data-code="${code}"]`);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The card of one shipment. */
export const shipCard = (page: Page, code: string) => page.locator(`[data-testid="ship-card"][data-code="${code}"]`);
