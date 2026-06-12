/* Discover & download IATA "Air Passenger Market Analysis" report PDFs.
 *
 * IATA's economics library is JavaScript-rendered and its report URLs stream
 * the PDF directly, so this uses headless Chromium (Playwright) to render the
 * library and to fetch the PDF bytes.
 *
 *   node tools/fetch_iata_pdf.js --out <path>              latest report
 *   node tools/fetch_iata_pdf.js --url <reportUrl> --out <path>   a specific report
 *   node tools/fetch_iata_pdf.js --diagnose               just list visible links
 *
 * Prints "PDF_SAVED <path>" on success; exits non-zero if no PDF was found.
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
  const explicit = arg('--url', null);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, userAgent: UA });
  const page = await ctx.newPage();

  // GET a URL and return its bytes if they are a PDF (follows redirects).
  async function fetchPdf(url) {
    try {
      const resp = await ctx.request.get(url, { timeout: 60000 });
      const buf = await resp.body();
      if (buf.slice(0, 4).toString('latin1') === '%PDF') return buf;
    } catch (e) { /* fall through */ }
    return null;
  }

  async function tryCandidate(href) {
    // (1) Many IATA report URLs stream the PDF directly.
    let buf = await fetchPdf(href);
    if (buf) { fs.writeFileSync(out, buf); console.log('PDF_SAVED', out, '(direct)'); return true; }
    // (2) Otherwise render the page; it may itself trigger a download, or link a PDF.
    console.log('opening report page:', href);
    const dl = page.waitForEvent('download', { timeout: 6000 }).catch(() => null);
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const d = await dl;
    if (d) {
      const p = await d.path().catch(() => null);
      if (p) { fs.copyFileSync(p, out); console.log('PDF_SAVED', out, '(navigation download)'); return true; }
    }
    await dismissBanners(page);
    await page.waitForTimeout(1200);
    const hrefs = await page.$$eval('a', as => as.map(a => a.href || '').filter(Boolean));
    const pdfs = hrefs.filter(h => /\.pdf(\?|$)/i.test(h) || /globalassets|getmedia/i.test(h));
    console.log('  PDF-like links on page:', pdfs.slice(0, 6).join(' | ') || '(none)');
    for (const h of pdfs) {
      buf = await fetchPdf(h);
      if (buf) { fs.writeFileSync(out, buf); console.log('PDF_SAVED', out); return true; }
    }
    return false;
  }

  // ---- pick candidate report URLs ----
  let candidates;
  if (explicit) {
    candidates = [explicit];
  } else {
    console.log('opening', LIBRARY);
    await page.goto(LIBRARY, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissBanners(page);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3500);
    const links = await page.$$eval('a', as => as.map(a => ({
      text: (a.textContent || '').replace(/\s+/g, ' ').trim(), href: a.href || '',
    })));
    const re = /air[\s-]?passenger/i;
    // rank the monthly report in the iata-repository (streams the PDF) first
    const score = (h) =>
      (/air-passenger-market-analysis-[a-z]+-\d{4}/i.test(h) ? 2 : 0) +
      (/iata-repository\/publications\/economic-reports/i.test(h) ? 1 : 0);
    const seen = new Set();
    const uniq = links
      .filter(l => (re.test(l.text) || re.test(l.href)) && l.href && !seen.has(l.href) && seen.add(l.href))
      .sort((a, b) => score(b.href) - score(a.href));
    console.log(`found ${uniq.length} candidate Air Passenger link(s):`);
    uniq.slice(0, 25).forEach(l => console.log('  -', JSON.stringify(l)));
    if (diagnose) { await browser.close(); return; }
    candidates = uniq.map(l => l.href);
  }

  for (const href of candidates) {
    try {
      if (await tryCandidate(href)) { await browser.close(); return; }
    } catch (e) {
      console.log('  attempt failed:', String(e.message || e).split('\n')[0]);
    }
  }

  await browser.close();
  console.error('Could not download an Air Passenger PDF', explicit ? 'from ' + explicit : '');
  process.exit(3);
})().catch(e => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1); });
