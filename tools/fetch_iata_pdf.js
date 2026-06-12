/* Discover & download the latest IATA "Air Passenger Market Analysis" PDF.
 *
 * IATA's economics library is JavaScript-rendered, so a plain HTTP GET can't
 * see the report links. This uses headless Chromium (Playwright) to render the
 * page, find the newest Air Passenger report, and download its PDF.
 *
 *   node tools/fetch_iata_pdf.js --out <path>   download -> writes path, prints "PDF_SAVED <path>"
 *   node tools/fetch_iata_pdf.js --diagnose      just list what links it can see
 *
 * Always prints the candidate links it found, so CI logs stay diagnosable.
 * Exits non-zero if no PDF could be downloaded.
 */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright');

const LIBRARY = 'https://www.iata.org/en/publications/economics/economics-library/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] || true) : def;
}

async function dismissBanners(page) {
  const sels = ['#onetrust-accept-btn-handler', 'button:has-text("Accept")',
                'button:has-text("I agree")', 'button:has-text("Got it")'];
  for (const s of sels) {
    try { const b = page.locator(s).first(); if (await b.count()) { await b.click({ timeout: 2000 }); } }
    catch (e) { /* ignore */ }
  }
}

(async () => {
  const diagnose = process.argv.includes('--diagnose');
  const out = arg('--out', '/tmp/iata_air_passenger.pdf');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, userAgent: UA });
  const page = await ctx.newPage();

  console.log('opening', LIBRARY);
  await page.goto(LIBRARY, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissBanners(page);
  // give the JS listing time to populate
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3500);

  // Collect every link, then keep those that look like an Air Passenger report.
  const links = await page.$$eval('a', as => as.map(a => ({
    text: (a.textContent || '').replace(/\s+/g, ' ').trim(),
    href: a.href || '',
  })));
  const re = /air[\s-]?passenger/i;
  const cands = links.filter(l => re.test(l.text) || re.test(l.href));
  // de-dup by href
  const seen = new Set();
  const uniq = cands.filter(l => l.href && !seen.has(l.href) && seen.add(l.href));

  console.log(`found ${uniq.length} candidate Air Passenger link(s):`);
  uniq.slice(0, 25).forEach(l => console.log('  -', JSON.stringify(l)));

  if (diagnose) { await browser.close(); return; }
  if (!uniq.length) { console.error('No Air Passenger links visible on the library page.'); process.exit(2); }

  // Try each candidate (newest first) until we land a PDF.
  for (const l of uniq) {
    try {
      let pdfUrl = null;
      if (/\.pdf(\?|$)/i.test(l.href)) {
        pdfUrl = l.href;
      } else {
        console.log('opening report page:', l.href);
        await page.goto(l.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await dismissBanners(page);
        await page.waitForTimeout(1500);
        const pdfs = await page.$$eval('a', as => as.map(a => a.href).filter(h => /\.pdf(\?|$)/i.test(h || '')));
        pdfUrl = pdfs.find(h => /passenger/i.test(h)) || pdfs[0] || null;
      }
      if (!pdfUrl) { console.log('  no PDF link on that page'); continue; }

      console.log('downloading PDF:', pdfUrl);
      const resp = await ctx.request.get(pdfUrl, { timeout: 60000 });
      const buf = await resp.body();
      if (buf.slice(0, 4).toString('latin1') !== '%PDF') {
        console.log('  not a PDF (status ' + resp.status() + ')'); continue;
      }
      fs.writeFileSync(out, buf);
      console.log('PDF_SAVED', out);
      await browser.close();
      return;
    } catch (e) {
      console.log('  attempt failed:', String(e.message || e).split('\n')[0]);
    }
  }

  await browser.close();
  console.error('Could not download any Air Passenger PDF.');
  process.exit(3);
})().catch(e => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1); });
