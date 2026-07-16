import { test as setup } from "@playwright/test";

const USERS = [
  { email: "test_user_main@example.com", password: "Password123!", stateFile: "playwright/.auth/user.json" },
  { email: "test_user_a@example.com", password: "Password123!", stateFile: "playwright/.auth/user-a.json" },
  { email: "test_user_b@example.com", password: "Password123!", stateFile: "playwright/.auth/user-b.json" },
];

for (const user of USERS) {
  setup(`setup auth for ${user.email}`, async ({ page }) => {
    // 1. Try registration first
    await page.goto("http://localhost:3000/register");
    await page.fill("#reg-email", user.email);
    await page.fill("#reg-password", user.password);
    await page.click("#register-submit");

    // Give it a moment to redirect or check url
    await page.waitForTimeout(2000);
    const url = page.url();

    // If it remains on register, user might already exist, so log them in
    if (url.includes("/register")) {
      console.log(`User ${user.email} might already exist or failed registration, trying login...`);
      await page.goto("http://localhost:3000/login");
      await page.fill("#email", user.email);
      await page.fill("#password", user.password);
      await page.click("#login-submit");
    }

    // Wait for redirect to dashboard
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // Save auth storage state
    await page.context().storageState({ path: user.stateFile });
    console.log(`Saved storage state for ${user.email} to ${user.stateFile}`);
  });
}
