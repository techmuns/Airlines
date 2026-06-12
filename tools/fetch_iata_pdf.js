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
  // de-dup, then rank: the monthly report in the iata-repository (whose URL
  // streams the PDF directly) first, then other monthly links, then the rest.
  const score = (h) =>
    (/air-passenger-market-analysis-[a-z]+-\d{4}/i.test(h) ? 2 : 0) +
    (/iata-repository\/publications\/economic-reports/i.test(h) ? 1 : 0);
  const seen = new Set();
  const uniq = cands
    .filter(l => l.href && !seen.has(l.href) && seen.add(l.href))
    .sort((a, b) => score(b.href) - score(a.href));

  console.log(`found ${uniq.length} candidate Air Passenger link(s):`);
  uniq.slice(0, 25).forEach(l => console.log('  -', JSON.stringify(l)));

  if (diagnose) { await browser.close(); return; }
  if (!uniq.length) { console.error('No Air Passenger links visible on the library page.'); process.exit(2); }

  // GET a URL and return its bytes if they are a PDF (follows redirects).
  async function fetchPdf(url) {
    try {
      const resp = await ctx.request.get(url, { timeout: 60000 });
      const buf = await resp.body();
      if (buf.slice(0, 4).toString('latin1') === '%PDF') return buf;
    } catch (e) { /* fall through */ }
    return null;
  }

  for (const l of uniq) {
    try {
      // (1) Many IATA report URLs stream the PDF directly.
      let buf = await fetchPdf(l.href);
      if (buf) { fs.writeFileSync(out, buf); console.log('PDF_SAVED', out, '(direct)'); await browser.close(); return; }

      // (2) Otherwise it is an HTML page — render it and look for a PDF link.
      console.log('opening report page:', l.href);
      const dl = page.waitForEvent('download', { timeout: 6000 }).catch(() => null);
      await page.goto(l.href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      const d = await dl;                 // the page may itself trigger a download
      if (d) {
        const p = await d.path().catch(() => null);
        if (p) { fs.copyFileSync(p, out); console.log('PDF_SAVED', out, '(navigation download)'); await browser.close(); return; }
      }
      await dismissBanners(page);
      await page.waitForTimeout(1200);
      const hrefs = await page.$$eval('a', as => as.map(a => a.href || '').filter(Boolean));
      const pdfs = hrefs.filter(h => /\.pdf(\?|$)/i.test(h) || /globalassets|getmedia/i.test(h));
      console.log('  PDF-like links on page:', pdfs.slice(0, 6).join(' | ') || '(none)');
      for (const h of pdfs) {
        buf = await fetchPdf(h);
        if (buf) { fs.writeFileSync(out, buf); console.log('PDF_SAVED', out); await browser.close(); return; }
      }
    } catch (e) {
      console.log('  attempt failed:', String(e.message || e).split('\n')[0]);
    }
  }

  await browser.close();
  console.error('Could not download any Air Passenger PDF.');
  process.exit(3);
})().catch(e => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1); });
