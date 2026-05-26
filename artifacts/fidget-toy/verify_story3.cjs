const { chromium } = require('playwright');
const fs = require('fs');
const TEMP = 'C:\\Users\\Zelas\\AppData\\Local\\Temp';

const BOMB_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="60" r="35" fill="black"/><rect x="44" y="15" width="12" height="20" fill="black"/></svg>';

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  await page.goto('http://localhost:5200/studio');
  await page.waitForTimeout(2000);

  const snap = async (name) => {
    const p = TEMP + '\\story3_' + name + '.png';
    await page.screenshot({ path: p });
    console.log('SNAP: ' + name + ' -> ' + p);
  };

  // Switch to Advanced mode
  await page.click('button:has-text("Advanced")');
  await page.waitForTimeout(500);

  // Upload SVG
  const svgPath = TEMP + '\\test_bomb.svg';
  fs.writeFileSync(svgPath, BOMB_SVG);
  const fileInput = page.locator('input[type=file]');
  await fileInput.setInputFiles(svgPath);
  await page.waitForTimeout(2000);
  await snap('03_svg_loaded');

  // Scroll sidebar to bottom
  const sidebar = page.locator('aside').first();
  await sidebar.evaluate(function(el) { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(400);

  // Find UV Print Jig section
  const uvHeader = page.locator('h2:has-text("UV Print Jig")');
  const uvVisible = await uvHeader.isVisible().catch(() => false);
  console.log('UV Print Jig visible: ' + uvVisible);

  // Enable jig
  const enableCheckbox = page.locator('label:has-text("Enable") input[type=checkbox]').last();
  const enableVisible = await enableCheckbox.isVisible().catch(() => false);
  console.log('Enable checkbox visible: ' + enableVisible);
  if (enableVisible) {
    await enableCheckbox.check();
    console.log('Jig enabled');
  }
  await page.waitForTimeout(1500);
  await sidebar.evaluate(function(el) { el.scrollTop = el.scrollHeight; });
  await snap('05_jig_enabled');

  // Check fit status
  const fitGreen = page.locator('.text-green-400').first();
  const fitRed = page.locator('.text-red-400').first();
  const greenVisible = await fitGreen.isVisible().catch(() => false);
  const redVisible = await fitRed.isVisible().catch(() => false);
  console.log('Fit status green: ' + greenVisible + ', red: ' + redVisible);
  if (greenVisible) console.log('Green text: ' + await fitGreen.textContent());
  if (redVisible) console.log('Red text: ' + await fitRed.textContent());

  await snap('06_canvas_with_jig');

  // Test Z slider
  const sliders = page.locator('[data-radix-slider-root]');
  const sliderCount = await sliders.count();
  console.log('Total sliders: ' + sliderCount);

  // Z adjust is the 2nd slider in jig section (first is clearance)
  if (sliderCount >= 2) {
    const zThumb = page.locator('[data-radix-slider-thumb]').nth(1);
    const box = await zThumb.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width/2 + 40, box.y + box.height/2);
      await page.mouse.up();
      await page.waitForTimeout(800);
      console.log('Z slider dragged right');
    }
  }
  await snap('07_z_adjusted');

  // Test Mirror X checkbox for Inner Clicker
  const innerMirrorLabel = page.locator('label').filter({ has: page.locator('input[type=checkbox]') }).filter({ hasText: 'Inner Clicker' }).first();
  const innerMirrorVisible = await innerMirrorLabel.isVisible().catch(() => false);
  console.log('Inner Clicker mirror label visible: ' + innerMirrorVisible);
  if (innerMirrorVisible) {
    await innerMirrorLabel.locator('input').check();
    await page.waitForTimeout(800);
    await snap('08_mirror_x_on');
    await innerMirrorLabel.locator('input').uncheck();
    await page.waitForTimeout(300);
  } else {
    await snap('08_mirror_x_not_found');
  }

  // Test rows=2, cols=2 overflow
  const rowsInput = page.locator('span:has-text("Rows")').locator('xpath=following-sibling::input[1]').first();
  const colsInput = page.locator('span:has-text("Columns")').locator('xpath=following-sibling::input[1]').first();

  // Alternative: get all number inputs in the sidebar Layout section
  const allNumInputs = page.locator('aside input[type=number]');
  const numCount = await allNumInputs.count();
  console.log('Number inputs: ' + numCount);

  // The rows and cols are the 4th and 5th number inputs (after width x2, z-adj, then rows, cols, spacing)
  // Actually: jigWidth, jigHeight, rows, cols, spacing
  if (numCount >= 4) {
    const rowsIn = allNumInputs.nth(numCount - 4); // rows
    const colsIn = allNumInputs.nth(numCount - 3); // cols
    const rVal = await rowsIn.inputValue();
    const cVal = await colsIn.inputValue();
    console.log('Rows input value: ' + rVal + ', cols: ' + cVal);
    await rowsIn.fill('2');
    await rowsIn.press('Tab');
    await page.waitForTimeout(200);
    await colsIn.fill('2');
    await colsIn.press('Tab');
    await page.waitForTimeout(800);
    console.log('Set 2x2');
    await sidebar.evaluate(function(el) { el.scrollTop = el.scrollHeight; });
    await snap('09_2x2_error');

    const errNow = page.locator('.text-red-400').first();
    const errNowVisible = await errNow.isVisible().catch(() => false);
    console.log('Red error after 2x2: ' + errNowVisible);
    if (errNowVisible) console.log('Error: ' + await errNow.textContent());

    // Reset
    await rowsIn.fill('1');
    await rowsIn.press('Tab');
    await colsIn.fill('1');
    await colsIn.press('Tab');
    await page.waitForTimeout(600);
  }

  // Test Outer Only
  const outerBtn = page.locator('button:has-text("Outer Shell")').first();
  const outerVisible = await outerBtn.isVisible().catch(() => false);
  if (outerVisible) {
    await outerBtn.click();
    await page.waitForTimeout(1200);
    await snap('10_outer_only');
    console.log('Outer Only selected');
  }

  // Test Both
  const bothBtn = page.locator('button:has-text("Both")').first();
  const bothVisible = await bothBtn.isVisible().catch(() => false);
  if (bothVisible) {
    await bothBtn.click();
    await page.waitForTimeout(1200);
    await snap('11_both');
    console.log('Both selected');
  }

  // Test Inner Only
  const innerBtn = page.locator('button:has-text("Inner Clicker")').first();
  const innerVisible = await innerBtn.isVisible().catch(() => false);
  if (innerVisible) {
    await innerBtn.click();
    await page.waitForTimeout(1200);
    await snap('12_inner_only');
    console.log('Inner Clicker selected');
  }

  console.log('ALL DONE');
  await browser.close();
})().catch(function(e) { console.error('ERROR: ' + e.message + '\n' + e.stack); process.exit(1); });
