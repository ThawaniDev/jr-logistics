import { expect, type Page } from "@playwright/test";

/** Navigate and wait until React has hydrated (a click before that would trigger a native form reload). */
export async function gotoReady(page: Page, url: string) {
  await page.goto(url);
  await page.waitForSelector('html[data-hydrated="true"]');
}

export async function otpLogin(page: Page, phone: string) {
  await gotoReady(page, "/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  const code = (await page.locator(".ltr-num.text-lg").textContent())!.trim();
  await page.getByLabel("Verification code").fill(code);
  await page.getByRole("button", { name: "Verify & continue" }).click();
  await page.waitForURL(/\/(business|driver|office|register|admin)/);
}
export async function staffLogin(page: Page, email: string, password: string) {
  await gotoReady(page, "/staff/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin/);
}
export const DEMO = { business: "0500000001", driver: "0500000011", office: "0500000002", staffPw: "Demo#Pass2026" };
