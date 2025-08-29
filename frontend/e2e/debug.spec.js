import { test } from '@playwright/test';

test('Debug - Check page content', async ({ page }) => {
  // Capture console errors
  page.on('console', msg => {
    console.log(`Console ${msg.type()}:`, msg.text());
  });
  
  page.on('pageerror', error => {
    console.log('Page error:', error.message);
  });
  
  // Navigate to the app with cache disabled
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  
  // Hard refresh to clear cache
  await page.reload({ waitUntil: 'networkidle' });
  
  // Wait a bit for React to render
  await page.waitForTimeout(2000);
  
  // Take screenshot
  await page.screenshot({ path: 'debug-screenshot.png' });
  
  // Check root element
  const rootContent = await page.locator('#root').innerHTML();
  console.log('Root element content:', rootContent);
  
  // Log all button text
  const buttons = await page.locator('button').all();
  console.log('Found buttons:', buttons.length);
  for (const button of buttons) {
    const text = await button.textContent();
    console.log('Button text:', text);
  }
  
  // Log page HTML
  const html = await page.content();
  console.log('Page HTML length:', html.length);
  console.log('Page title:', await page.title());
  
  // Check for specific elements
  console.log('Has Connect Wallet button:', await page.locator('button:has-text("Connect Wallet")').count());
});