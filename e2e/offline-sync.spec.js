import { test, expect, chromium } from "@playwright/test";

/**
 * E2E test: Offline sync flow
 *
 * Verifies the core local-first guarantee:
 *  1. User edits document online.
 *  2. User goes offline.
 *  3. User continues editing (saved to IndexedDB locally).
 *  4. User reconnects.
 *  5. All edits are synced — no data loss.
 */
test.describe("Offline sync flow", () => {
  test.use({ storageState: "playwright/.auth/user.json" });

  test("edits made offline are synced on reconnect", async ({ page, context }) => {
    // Navigate to a known test document
    await page.goto(process.env.TEST_DOC_URL || "http://localhost:3000/editor/77777777-7777-7777-7777-777777777777");
    await page.waitForSelector("#editor-content", { timeout: 10000 });

    // Wait for initial sync
    await page.waitForSelector(".status-synced", { timeout: 15000 });

    // Type something online
    const editor = page.locator(".tiptap-editor");
    await editor.click();
    await editor.type("Online edit — ");

    // Go offline
    await context.setOffline(true);

    // Wait for offline status indicator
    await page.waitForSelector(".status-offline", { timeout: 5000 });

    // Type more content offline
    await editor.type("Offline edit 1, ");
    await editor.type("Offline edit 2, ");
    await editor.type("Offline edit 3.");

    // Verify content is present locally
    const localContent = await editor.textContent();
    expect(localContent).toContain("Online edit");
    expect(localContent).toContain("Offline edit 1");
    expect(localContent).toContain("Offline edit 3");

    // Reconnect
    await context.setOffline(false);

    // Wait for sync to complete
    await page.waitForSelector(".status-synced", { timeout: 20000 });

    // Reload page to verify server has the data
    await page.reload();
    await page.waitForSelector("#editor-content", { timeout: 10000 });
    await page.waitForSelector(".status-synced", { timeout: 15000 });

    // Content should still be there after reload (from IndexedDB + Supabase)
    const reloadedContent = await page.locator(".tiptap-editor").textContent();
    expect(reloadedContent).toContain("Online edit");
    expect(reloadedContent).toContain("Offline edit 1");
    expect(reloadedContent).toContain("Offline edit 3");
  });

  test("two clients converge after concurrent edits", async ({ browser }) => {
    // Open two browser contexts (two users)
    const contextA = await browser.newContext({
      storageState: "playwright/.auth/user-a.json",
    });
    const contextB = await browser.newContext({
      storageState: "playwright/.auth/user-b.json",
    });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const docUrl = process.env.TEST_DOC_URL || "http://localhost:3000/editor/77777777-7777-7777-7777-777777777777";
    await pageA.goto(docUrl);
    await pageB.goto(docUrl);

    await pageA.waitForSelector(".status-synced", { timeout: 15000 });
    await pageB.waitForSelector(".status-synced", { timeout: 15000 });

    // Client A edits
    await pageA.locator(".tiptap-editor").click();
    await pageA.locator(".tiptap-editor").type("From A");

    // Client B edits concurrently
    await pageB.locator(".tiptap-editor").click();
    await pageB.locator(".tiptap-editor").type("From B");

    // Wait for both to sync
    await pageA.waitForSelector(".status-synced", { timeout: 15000 });
    await pageB.waitForSelector(".status-synced", { timeout: 15000 });

    // Allow realtime to propagate
    await pageA.waitForTimeout(2000);
    await pageB.waitForTimeout(2000);

    const contentA = await pageA.locator(".tiptap-editor").textContent();
    const contentB = await pageB.locator(".tiptap-editor").textContent();

    // Both clients should have the same content
    expect(contentA).toBe(contentB);
    expect(contentA).toContain("From A");
    expect(contentA).toContain("From B");

    await contextA.close();
    await contextB.close();
  });

  test("viewer cannot write — editor is read-only", async ({ page }) => {
    // This test requires viewer credentials
    test.skip(!process.env.VIEWER_DOC_URL, "VIEWER_DOC_URL not set");

    await page.goto(process.env.VIEWER_DOC_URL);
    await page.waitForSelector("#editor-content", { timeout: 10000 });

    // The editor should be read-only for viewers
    // (No toolbar controls, or toolbar is disabled)
    const toolbar = page.locator('[role="toolbar"]');
    await expect(toolbar).not.toBeVisible();
  });
});
