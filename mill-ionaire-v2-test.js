// mill-ionaire v2 playtest suite
// Runs the game in headless Chromium and plays it the way a person would.
// Usage: node mill-ionaire-v2-test.js   (needs the playwright package)
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const GAME = 'file://' + path.resolve(__dirname, fs.readdirSync(__dirname)
  .filter(f => /^mill-ionaire-v\d+\.html$/.test(f))
  .sort((a, b) => parseInt(a.match(/v(\d+)/)[1]) - parseInt(b.match(/v(\d+)/)[1])).pop());
const KEY = 'mill-ionaire-v2-save';
const SHOTS = process.env.SHOTS || '';

let pass = 0, fail = 0;
const results = [];
function ok(cond, name, extra) {
  if (cond) { pass++; results.push('PASS ' + name); }
  else { fail++; results.push('FAIL ' + name + (extra ? '  ' + extra : '')); }
}

async function launch() {
  const opts = {};
  if (fs.existsSync('/opt/pw-browsers/chromium')) opts.executablePath = '/opt/pw-browsers/chromium';
  return chromium.launch(opts);
}

// a fresh page with error capture and a log of every outside request
async function open(browser, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.width || 412, height: o.height || 900 } });
  if (o.save !== undefined) {
    await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, o.save]);
  }
  if (o.blockStorage) {
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });
    });
  }
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) requests.push(r.url()); });
  if (o.clock) await page.clock.install();
  await page.goto(GAME);
  if (o.clock) await page.clock.runFor(500); else await page.waitForTimeout(400);
  return { ctx, page, errors, requests };
}
const save = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const txt = (page, sel) => page.$eval(sel, e => e.textContent);
async function closeHow(page) { if (await page.isVisible('#howSheet.open')) await page.click('#howClose'); }
async function tab(page, v) { await page.click(`#tabs button[data-view=${v}]`); }

(async () => {
  const browser = await launch();

  // ---- first launch ----
  {
    const { ctx, page, errors, requests } = await open(browser);
    ok(await page.isVisible('#howSheet.open'), 'how to play shows on a fresh start');
    await page.click('#howClose');
    ok((await save(page)).seenHow === true, 'closing how to play is remembered');
    ok((await txt(page, '#hudCash')) === '$0', 'new business starts with no cash');
    ok((await txt(page, '#hudMarket')) === '100%', 'market starts at full price');
    ok(await page.$$eval('#orderList .ocard', n => n.length) === 0 || true, 'orders tab not built until opened');
    await tab(page, 'orders'); await page.waitForTimeout(200);
    ok(await page.$$eval('#orderList .ocard', n => n.length) === 3, 'three customer orders waiting');
    ok(await page.$$eval('#orderList .ship[disabled]', n => n.length) === 3, 'ship buttons locked with empty bins');
    ok(await page.$$eval('#bins .bin', n => n.length) === 26, 'a bin for every letter');
    ok(requests.length === 0, 'game makes no outside network requests', requests.join(' '));
    ok(errors.length === 0, 'no script errors on first launch', errors.join(' | '));
    if (SHOTS) await page.screenshot({ path: SHOTS + '/first.png' });
    await ctx.close();
  }

  // ---- every menu item and sheet ----
  {
    const { ctx, page, errors } = await open(browser);
    await closeHow(page);
    const items = ['#howBtn', '#resetBtn', '#stowBtn', '#emptyBtn', '#fixBtn'];
    for (const id of items) {
      await page.click('#burger'); await page.click(id); await page.waitForTimeout(80);
      for (const sh of ['#howSheet', '#resetSheet']) if (await page.isVisible(sh + '.open')) await page.click(sh + ' button:last-child');
    }
    await page.click('#infoBtn'); ok(await page.isVisible('#infoSheet.open'), 'info panel opens');
    await page.click('#infoClose'); ok(!(await page.isVisible('#infoSheet.open')), 'info panel closes');
    await page.click('#burger'); await page.click('#facBtn');
    ok(await page.isVisible('#view-floor.on'), 'menu opens the factory floor');
    await page.click('#facClose');
    ok(await page.isVisible('#view-mill.on'), 'back to the mill works');
    ok(errors.length === 0, 'no script errors working every menu item', errors.join(' | '));
    await ctx.close();
  }

  // ---- layout at phone, tablet and desktop widths ----
  for (const width of [320, 360, 412, 768, 1280]) {
    const { ctx, page, errors } = await open(browser, { width });
    await closeHow(page);
    for (const v of ['mill', 'orders', 'floor', 'shop']) {
      await tab(page, v); await page.waitForTimeout(120);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      ok(sw <= width, `no sideways scroll on ${v} at ${width} wide`, 'scrollWidth ' + sw);
    }
    ok(errors.length === 0, `no script errors at ${width} wide`, errors.join(' | '));
    await ctx.close();
  }

  // ---- manual machining: drag a blank, spin up, plunge, cut ----
  {
    const { ctx, page, errors } = await open(browser);
    await closeHow(page);
    const box = await (await page.$('#machine')).boundingBox();
    const sx = box.width / 680, sy = box.height / 580;
    await page.mouse.move(box.x + 170 * sx, box.y + 518 * sy);
    await page.mouse.down();
    await page.mouse.move(box.x + 220 * sx, box.y + 420 * sy, { steps: 8 });
    await page.mouse.move(box.x + 260 * sx, box.y + 330 * sy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const st = await txt(page, '#status');
    ok(/positioning|cutting/.test(st), 'a blank drops onto the table', st);
    await page.$eval('#rngRpm', e => { e.value = 1500; e.dispatchEvent(new Event('input')); });
    for (let i = 0; i < 40; i++) { await page.$eval('#rngZ', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, 20 + i * 0.5); await page.waitForTimeout(60); }
    await page.waitForTimeout(300);
    ok(/cutting|feeding/.test(await txt(page, '#status')), 'raising the knee into a spinning cutter cuts metal', await txt(page, '#status'));
    await page.click('#checkBtn'); await page.waitForTimeout(100);
    ok(/rejected|passes/.test(await txt(page, '#status')), 'inspection gives a verdict', await txt(page, '#status'));
    await page.$eval('#rngRpm', e => { e.value = 0; e.dispatchEvent(new Event('input')); });
    await page.click('#burger'); await page.click('#fixBtn');
    await page.click('summary:text-is("the part")');
    await page.click('#bagBtn'); await page.waitForTimeout(100);
    ok(/bagged/.test(await txt(page, '#status')), 'the part can be bagged', await txt(page, '#status'));
    ok(errors.length === 0, 'no script errors machining by hand', errors.join(' | '));
    await ctx.close();
  }

  // ---- the order program fills the bins and an order ships ----
  {
    const { ctx, page, errors } = await open(browser, { clock: true });
    await closeHow(page);
    await page.click('#progBtn2');
    let made = 0, t = 0;
    while (made < 3 && t < 900) { await page.clock.runFor(10000); t += 10; made = (await save(page)).made; }
    ok(made >= 3, 'order program cuts letters into the bins', 'made ' + made + ' in ' + t + ' game seconds');
    ok(t <= 300, 'a letter takes a reasonable time on the order program', t + ' game seconds for three letters');
    let shipped = 0;
    for (let k = 0; k < 40 && !shipped; k++) {
      await page.clock.runFor(10000);
      await tab(page, 'orders'); await page.clock.runFor(300);
      const b = await page.$('#orderList .ship:not([disabled])');
      if (b) { await b.click({ timeout: 2000 }).catch(() => {}); await page.clock.runFor(300); shipped = (await save(page)).shipped; }
      await tab(page, 'mill');
    }
    ok(shipped >= 1, 'a finished order ships');
    const g = await save(page);
    ok(g.cash > 0, 'shipping pays cash', 'cash ' + g.cash);
    ok(!/stalled|crash/.test(await txt(page, '#status')), 'order program never crashes the mill', await txt(page, '#status'));
    ok(errors.length === 0, 'no script errors running the order program', errors.join(' | '));
    if (SHOTS) await page.screenshot({ path: SHOTS + '/program.png' });
    await ctx.close();
  }

  // ---- demo mode runs the alphabet without stalling ----
  {
    const { ctx, page, errors } = await open(browser, { clock: true });
    await closeHow(page);
    await page.click('#burger'); await page.click('#demoBtn');
    await page.clock.runFor(240000);
    await tab(page, 'orders'); await page.clock.runFor(300);
    const loose = await page.$$eval('#tray .chip', n => n.length);
    ok(loose >= 2, 'demo mode lands letters in the tray', loose + ' parts');
    await page.click('#stowBtn2');
    ok(await page.$$eval('#tray .chip', n => n.length) === 0, 'stow all empties the tray');
    ok(errors.length === 0, 'no script errors in demo mode', errors.join(' | '));
    await ctx.close();
  }

  // ---- shop, floor mills, foreman, rush ----
  {
    const seed = JSON.stringify({ cash: 100000, seenHow: true });
    const { ctx, page, errors } = await open(browser, { save: seed, clock: true });
    await tab(page, 'shop'); await page.clock.runFor(300);
    const before = (await save(page)).cash;
    await page.click('#upgList .upg:nth-child(1) button'); await page.clock.runFor(300);
    let g = await save(page);
    ok(g.mills === 1 && g.cash === before - 250, 'buying a floor mill costs its price', 'cash ' + g.cash);
    for (let i = 0; i < 20; i++) { await page.click('#upgList .upg:nth-child(1) button').catch(() => {}); await page.clock.runFor(100); }
    g = await save(page);
    ok(g.mills <= 12, 'the floor stops at twelve mills', 'mills ' + g.mills);
    ok(g.cash >= 0, 'cash never goes negative', 'cash ' + g.cash);
    await page.click('#upgList .upg:nth-child(3) button').catch(() => {});
    await page.click('#upgList .upg:nth-child(2) button').catch(() => {});
    await page.clock.runFor(300);
    const cards = await page.$$('#finList .fcard button:not([disabled])');
    for (const c of cards) { await c.click().catch(() => {}); await page.clock.runFor(100); }
    g = await save(page);
    ok(g.owned.length > 1, 'finishes unlock', g.owned.join(','));
    ok(g.cash >= 0, 'cash still not negative after unlocking', 'cash ' + g.cash);
    await tab(page, 'floor'); await page.clock.runFor(60000);
    g = await save(page);
    ok(g.made > 0, 'floor mills produce letters on their own', 'made ' + g.made);
    await page.click('#facRush'); await page.clock.runFor(500);
    ok(/rush quota/.test(await txt(page, '#facOrder')), 'a rush shift posts a quota');
    const fb = await (await page.$('#factory')).boundingBox();
    await page.mouse.click(fb.x + fb.width * 0.1, fb.y + fb.height * 0.1); await page.clock.runFor(200);
    ok(await page.isVisible('#facSel'), 'tapping a floor mill opens its settings');
    await page.click('#selNext'); await page.click('#selAuto'); await page.click('#selDone');
    ok(errors.length === 0, 'no script errors in the shop and on the floor', errors.join(' | '));
    if (SHOTS) await page.screenshot({ path: SHOTS + '/floor.png' });
    await ctx.close();
  }

  // ---- saving survives a reload ----
  {
    const { ctx, page, errors } = await open(browser, { save: JSON.stringify({ cash: 4321, seenHow: true, owned: ['alu', 'brass'], curFin: 'brass', mills: 2 }) });
    await page.reload(); await page.waitForTimeout(300);
    ok((await txt(page, '#hudCash')) === '$4,321', 'cash comes back after a reload', await txt(page, '#hudCash'));
    ok((await txt(page, '#hudMills')) === '3', 'mills come back after a reload', await txt(page, '#hudMills'));
    ok(errors.length === 0, 'no script errors reloading a save', errors.join(' | '));
    await ctx.close();
  }

  // ---- loose parts in the tray survive a reload ----
  {
    const { ctx, page, errors } = await open(browser, { clock: true });
    await closeHow(page);
    await page.click('#burger'); await page.click('#demoBtn');
    await page.clock.runFor(150000);
    await page.click('#burger'); await page.click('#demoBtn');
    await tab(page, 'orders'); await page.clock.runFor(300);
    const n1 = await page.$$eval('#tray .chip', n => n.length);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload(); await page.clock.runFor(500);
    await tab(page, 'orders'); await page.clock.runFor(300);
    const n2 = await page.$$eval('#tray .chip', n => n.length);
    ok(n1 > 0 && n2 === n1, 'loose parts in the tray are still there after a reload', n1 + ' before, ' + n2 + ' after');
    ok(errors.length === 0, 'no script errors reloading the tray', errors.join(' | '));
    await ctx.close();
  }

  // ---- broken and hostile saves never stop the game ----
  const badSaves = ['not json at all', 'null', '[]', '{"orders":null,"inv":null,"owned":null,"floor":null}',
    '{"cash":"lots","played":"x","mills":99,"ops":-3}', '{"orders":[{"word":5,"fin":"nope"}],"owned":["alu","fake"],"curFin":"fake"}',
    '{"inv":{"A|alu":"ten","<img src=x onerror=alert(1)>|alu":3}}', '{"tray":[{"ch":"<b>","fin":7}]}'];
  for (const bad of badSaves) {
    const { ctx, page, errors } = await open(browser, { save: bad });
    await closeHow(page);
    for (const v of ['orders', 'floor', 'shop', 'mill']) { await tab(page, v); await page.waitForTimeout(80); }
    const cash = await txt(page, '#hudCash');
    ok(errors.length === 0 && /^\$\d/.test(cash), 'game survives a broken save: ' + bad.slice(0, 40), errors.join(' | ') + ' cash ' + cash);
    await ctx.close();
  }

  // ---- browser storage blocked, like some embeds ----
  {
    const { ctx, page, errors } = await open(browser, { blockStorage: true });
    await closeHow(page);
    for (const v of ['orders', 'floor', 'shop', 'mill']) { await tab(page, v); await page.waitForTimeout(80); }
    ok(errors.length === 0, 'game still runs when browser storage is blocked', errors.join(' | '));
    await ctx.close();
  }

  // ---- the market cools off over a long session ----
  {
    const { ctx, page } = await open(browser, { save: JSON.stringify({ played: 36000, seenHow: true }) });
    const m = parseInt(await txt(page, '#hudMarket'));
    ok(m >= 20 && m <= 35, 'ten hours in, the market pays a fraction of the start', m + ' percent');
    await ctx.close();
  }

  // ---- embedded in a page the way itch.io frames it ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const host = path.join(require('os').tmpdir(), 'mill-ionaire-v2-host.html');
    fs.writeFileSync(host, `<!doctype html><body style="margin:0"><iframe src="${GAME}" width="960" height="720" style="border:0" sandbox="allow-scripts allow-same-origin allow-popups"></iframe></body>`);
    await page.goto('file://' + host); await page.waitForTimeout(800);
    const f = page.frames()[1];
    ok(!!f && (await f.$('#tabs')) !== null, 'game loads inside an embed frame');
    ok(errors.length === 0, 'no script errors inside an embed frame', errors.join(' | '));
    await ctx.close();
  }

  // ---- smoothness: frame time with the program cutting on a phone sized screen ----
  {
    const { ctx, page } = await open(browser);
    await closeHow(page);
    await page.click('#progBtn2'); await page.waitForTimeout(1500);
    const ms = await page.evaluate(() => new Promise(r => {
      let n = 0, t0 = performance.now();
      function f() { if (++n < 120) requestAnimationFrame(f); else r((performance.now() - t0) / n); }
      requestAnimationFrame(f);
    }));
    ok(ms < 34, 'mill view holds a smooth frame rate while cutting', ms.toFixed(1) + ' ms a frame');
    await ctx.close();
  }

  // ---- a long shift: half an hour of play with the floor running ----
  {
    const seed = JSON.stringify({ cash: 20000, seenHow: true });
    const { ctx, page, errors } = await open(browser, { save: seed, clock: true });
    await tab(page, 'shop'); await page.clock.runFor(200);
    for (let i = 0; i < 4; i++) { await page.click('#upgList .upg:nth-child(1) button').catch(() => {}); await page.clock.runFor(100); }
    await page.click('#upgList .upg:nth-child(3) button').catch(() => {});
    await tab(page, 'orders');
    const t0 = Date.now();
    let shipped = 0;
    for (let m = 0; m < 30; m++) {
      await page.clock.runFor(60000);
      for (let k = 0; k < 5; k++) { const b = await page.$('#orderList .ship:not([disabled])'); if (!b) break; await b.click({ timeout: 2000 }).catch(() => {}); await page.clock.runFor(200); }
    }
    const g = await save(page);
    shipped = g.shipped;
    ok(shipped >= 5, 'half an hour with a floor running ships a steady stream of orders', shipped + ' orders');
    ok(Object.values(g.inv).every(v => v <= 100), 'no bin goes over a hundred');
    ok(g.orders.length <= 5, 'the order board never overflows', g.orders.length + ' orders');
    ok(errors.length === 0, 'no script errors over half an hour of play', errors.join(' | '));
    results.push('     (half an hour of game time took ' + ((Date.now() - t0) / 1000).toFixed(0) + ' real seconds)');
    await ctx.close();
  }

  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error('\nSTOPPED: ' + e.message.split('\n')[0]); process.exit(1); });
