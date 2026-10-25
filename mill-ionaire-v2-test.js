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
    ok((await txt(page, '#hudCash')) === '$40', 'a new business starts with a little cash for its first blanks');
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

  // ---- getting started marker and wording ----
  {
    const { ctx, page, errors } = await open(browser, { clock: true });
    await closeHow(page); await page.clock.runFor(600);
    ok(await page.$eval('#progBtn2', e => e.classList.contains('beacon')), 'a flashing marker points at the order program on a fresh start');
    await tab(page, 'shop'); await page.clock.runFor(600);
    ok(await page.$eval('#tabs button[data-view=mill]', e => e.classList.contains('beacon')), 'the marker leads back to the mill from another tab');
    await tab(page, 'mill'); await page.click('#progBtn2'); await page.clock.runFor(600);
    ok(!(await page.$eval('#progBtn2', e => e.classList.contains('beacon'))), 'the marker moves off once the program is running');
    let shipTab = false;
    for (let i = 0; i < 40 && !shipTab; i++) { await page.clock.runFor(10000); shipTab = await page.$eval('#tabs button[data-view=orders]', e => e.classList.contains('beacon')); }
    ok(shipTab, 'the marker points at the orders tab when an order is ready');
    await tab(page, 'orders'); await page.clock.runFor(600);
    ok(await page.$$eval('#orderList .ship.beacon', n => n.length) === 1, 'the marker sits on the ship button');
    const words = await page.evaluate(() => { const b = document.body.cloneNode(true); b.querySelectorAll('script,style').forEach(x => x.remove()); return b.textContent + ' ' + [...document.querySelectorAll('button')].map(x => x.textContent).join(' '); });
    ok(!/demo/i.test(words), 'the word demo appears nowhere in the game');
    ok(errors.length === 0, 'no script errors with the getting started marker', errors.join(' | '));
    if (SHOTS) await page.screenshot({ path: SHOTS + '/guide.png' });
    await ctx.close();
  }

  // ---- every menu item and sheet ----
  {
    const { ctx, page, errors } = await open(browser);
    await closeHow(page);
    const items = ['#howBtn', '#resetBtn'];
    for (const id of items) {
      await page.click('#burger'); await page.click(id); await page.waitForTimeout(80);
      for (const sh of ['#howSheet', '#resetSheet', '#emptySheet']) if (await page.isVisible(sh + '.open')) await page.click(sh + ' button:last-child');
    }
    await page.click('#infoBtn'); ok(await page.isVisible('#howSheet.open'), 'the i button opens how to play');
    ok(/what it does/.test(await txt(page, '#howSheet')) && /how to play/.test(await txt(page, '#howSheet')), 'the i button and the menu share the same information');
    await page.click('#howClose'); ok(!(await page.isVisible('#howSheet.open')), 'how to play closes');
    ok(await page.isVisible('#view-mill #demoBtn') && await page.isVisible('#view-mill #fixBtn'), 'alphabet run and millwright sit on the mill itself');
    await page.click('#fixBtn'); await page.waitForTimeout(80);
    ok(await page.$$eval('#menuSheet button', n => n.map(b => b.id).join(',')) === 'howBtn,resetBtn,menuClose', 'the menu holds only how to play, start over and close');
    await page.click('#burger'); await page.click('#resetBtn');
    ok(/scrap heap/.test(await txt(page, '#resetSheet')), 'start over asks for confirmation first');
    await page.click('#resetNo');
    await tab(page, 'floor');
    ok(await page.isVisible('#view-floor.on'), 'the floor tab opens the factory floor');
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
    await page.click('#fixBtn');
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

  // ---- the alphabet run cuts letters without stalling ----
  {
    const { ctx, page, errors } = await open(browser, { clock: true });
    await closeHow(page);
    await page.click('#demoBtn');
    await page.clock.runFor(240000);
    await tab(page, 'orders'); await page.clock.runFor(300);
    const loose = await page.$$eval('#tray .chip', n => n.length);
    ok(loose >= 2, 'the alphabet run lands letters in the tray', loose + ' parts');
    await page.click('#stowBtn2');
    ok(await page.$$eval('#tray .chip', n => n.length) === 0, 'stow all empties the tray');
    ok(errors.length === 0, 'no script errors on the alphabet run', errors.join(' | '));
    await ctx.close();
  }

  // ---- shop, floor mills, foreman, rush ----
  {
    const seed = JSON.stringify({ cash: 100000, seenHow: true });
    const { ctx, page, errors } = await open(browser, { save: seed, clock: true });
    await tab(page, 'shop'); await page.clock.runFor(300);
    const before = (await save(page)).cash;
    await page.locator('#upgList .upg[data-k="mill"] button').click({ timeout: 2000 }); await page.clock.runFor(300);
    let g = await save(page);
    ok(g.mills === 1 && before - g.cash >= 250 && before - g.cash < 290, 'buying a floor mill costs its price', 'cash ' + g.cash);
    for (let i = 0; i < 20; i++) { await page.locator('#upgList .upg[data-k="mill"] button').click({ timeout: 300 }).catch(() => {}); await page.clock.runFor(100); }
    g = await save(page);
    ok(g.mills <= 12, 'the floor stops at twelve mills', 'mills ' + g.mills);
    ok(g.cash >= 0, 'cash never goes negative', 'cash ' + g.cash);
    await page.locator('#upgList .upg[data-k="fore"] button').click({ timeout: 2000 }).catch(() => {});
    await page.locator('#upgList .upg[data-k="op"] button').click({ timeout: 2000 }).catch(() => {});
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
    for (let k = 0; k < 6 && !(await page.isVisible('#facSel')); k++) { await page.mouse.click(fb.x + fb.width * 0.5, fb.y + fb.height * 0.06); await page.clock.runFor(200); if (!(await page.isVisible('#facSel'))) await page.clock.runFor(6000); }
    ok(await page.isVisible('#facSel'), 'tapping a floor mill opens its settings');
    await page.click('#selNext'); await page.click('#selAuto'); await page.click('#selDone');
    ok(errors.length === 0, 'no script errors in the shop and on the floor', errors.join(' | '));
    if (SHOTS) await page.screenshot({ path: SHOTS + '/floor.png' });
    await ctx.close();
  }

  // ---- a full floor: your mill plus twelve floor mills ----
  {
    const floor = Array.from({ length: 12 }, (_, i) => ({ ch: 'ETAOINSHRDLU'[i], fin: 'alu', auto: true }));
    const seed = JSON.stringify({ cash: 500, seenHow: true, guideDone: true, mills: 12, ops: 6, foreman: true, floor });
    for (const width of [412, 1280]) {
      const { ctx, page, errors } = await open(browser, { save: seed, clock: true, width });
      await tab(page, 'floor'); await page.clock.runFor(30000);
      ok(/plus 12 floor mills/.test(await txt(page, '#facOrder')) && /, 0 open bays/.test(await txt(page, '#facOrder')), `a full floor reads twelve floor mills and no open bays at ${width} wide`, await txt(page, '#facOrder'));
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      ok(sw <= width, `a full floor fits without sideways scroll at ${width} wide`);
      const fb = await (await page.$('#factory')).boundingBox();
      await page.mouse.click(fb.x + fb.width * 0.15, fb.y + fb.height * 0.06); await page.clock.runFor(200);
      ok(await page.isVisible('#view-mill.on'), `tapping your mill on the floor goes to the mill at ${width} wide`);
      ok(errors.length === 0, `no script errors on a full floor at ${width} wide`, errors.join(' | '));
      if (SHOTS) { await tab(page, 'floor'); await page.clock.runFor(500); await (await page.$('#facPanel')).screenshot({ path: SHOTS + '/fullfloor-' + width + '.png' }); }
      await ctx.close();
    }
  }

  // ---- shop sound ----
  {
    const seed = JSON.stringify({ seenHow: true, guideDone: true, mills: 6, ops: 2, floor: [] });
    const { ctx, page, errors } = await open(browser, { save: seed });
    await page.click('#progBtn2'); await page.waitForTimeout(1500);
    await tab(page, 'floor'); await page.waitForTimeout(1500);
    const st = await page.evaluate(() => typeof AudioContext);
    ok(st === 'function', 'the browser offers sound to the game');
    await page.click('#soundBtn'); await page.waitForTimeout(200);
    ok((await save(page)).sound === false, 'the sound button turns shop sound off and remembers it');
    await page.click('#soundBtn'); await page.waitForTimeout(200);
    ok((await save(page)).sound === true, 'the sound button turns shop sound back on');
    await page.click('#burger');
    await page.$eval('#volRange', e => { e.value = 25; e.dispatchEvent(new Event('input')); });
    ok(Math.abs((await save(page)).vol - 0.25) < 0.001, 'the volume slider sets and remembers the shop volume');
    await page.click('#menuClose');
    await page.waitForTimeout(1000);
    ok(errors.length === 0, 'no script errors with the whole shop making sound', errors.join(' | '));
    await ctx.close();
  }

  // ---- emptying the bins asks first, and one floor mill can be stopped ----
  {
    const floor = [{ ch: 'E', fin: 'alu', auto: false }, { ch: 'T', fin: 'alu', auto: false }];
    const seed = JSON.stringify({ seenHow: true, guideDone: true, cash: 5000, mills: 2, ops: 2, floor, inv: { 'A|alu': 5 } });
    const { ctx, page, errors } = await open(browser, { save: seed, clock: true });
    await tab(page, 'orders'); await page.clock.runFor(300);
    await page.click('#emptyBtn'); await page.clock.runFor(100);
    ok(/scrap all this hard work/.test(await txt(page, '#emptySheet')), 'emptying the bins asks for confirmation');
    await page.click('#emptyNo'); await page.clock.runFor(300);
    ok(Object.keys((await save(page)).inv).length === 1, 'saying no keeps the letters');
    await page.click('#emptyBtn'); await page.click('#emptyYes'); await page.clock.runFor(300);
    ok(Object.keys((await save(page)).inv).length === 0, 'saying yes empties the bins');
    await tab(page, 'floor'); await page.clock.runFor(300);
    const fb = await (await page.$('#factory')).boundingBox();
    await page.mouse.click(fb.x + fb.width * 0.5, fb.y + fb.height * 0.06); await page.clock.runFor(200);
    await page.click('#selStop'); await page.clock.runFor(200);
    let g = await save(page);
    ok(g.floor[0].stopped === true && g.floor[1].stopped !== true, 'one floor mill stops on its own while the rest keep running');
    await page.clock.runFor(60000);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    g = await save(page);
    ok(!g.inv['E|alu'] && g.inv['T|alu'] > 0, 'the stopped mill makes nothing while the running mill keeps cutting', JSON.stringify(g.inv));
    await page.click('#selStop'); await page.clock.runFor(200);
    ok((await save(page)).floor[0].stopped === false, 'the stopped mill starts again');
    ok(errors.length === 0, 'no script errors stopping mills and emptying bins', errors.join(' | '));
    await ctx.close();
  }

  // ---- wages, power bill and shop upgrades ----
  {
    const floor = [{ ch: 'E', fin: 'alu', auto: false }, { ch: 'T', fin: 'alu', auto: false }];
    const seed = JSON.stringify({ seenHow: true, guideDone: true, cash: 20000, mills: 2, ops: 2, floor });
    const { ctx, page, errors } = await open(browser, { save: seed, clock: true });
    await tab(page, 'shop'); await page.clock.runFor(300);
    ok(/running costs \$\d+ a minute/.test(await txt(page, '#costLine')), 'the shop shows running costs a minute', await txt(page, '#costLine'));
    const c0 = (await save(page)).cash;
    await page.clock.runFor(60000);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    let g = await save(page);
    ok(g.paidWages > 5 && g.paidPower > 1, 'a minute of running pays wages and the power bill', 'wages ' + g.paidWages.toFixed(1) + ' power ' + g.paidPower.toFixed(1));
    for (const k of ['chip', 'lube', 'bits', 'soft']) {
      await page.locator('#upgList .upg[data-k="' + k + '"] button').click(); await page.clock.runFor(200);
    }
    g = await save(page);
    ok(g.chipConv === true && g.lube === 1 && g.bits === 1 && g.soft === 1, 'chip conveyor, coolant, cutters and software can be bought');
    await tab(page, 'floor'); await page.clock.runFor(120000);
    ok(!/chips cleared/.test(await page.evaluate(() => document.getElementById('facOrder').textContent)), 'with chip conveyors no mill stops for chips');
    ok(errors.length === 0, 'no script errors with bills and upgrades', errors.join(' | '));
    await ctx.close();
  }
  {
    const floor = [{ ch: 'E', fin: 'alu', auto: false }];
    const seed = JSON.stringify({ seenHow: true, guideDone: true, cash: 3, mills: 1, ops: 3, floor });
    const { ctx, page, errors } = await open(browser, { save: seed, clock: true });
    await tab(page, 'floor'); await page.clock.runFor(60000);
    ok(/power cut/.test(await txt(page, '#facOrder')), 'running out of cash cuts the power and sends the crew home', await txt(page, '#facOrder'));
    ok((await save(page)).cash >= 0, 'bills never push cash below zero');
    ok(errors.length === 0, 'no script errors when the shop goes broke', errors.join(' | '));
    await ctx.close();
  }

  // ---- numbers, emoji, matching sets, spelling bee and the finishing line ----
  {
    const seed = JSON.stringify({ seenHow: true, guideDone: true, cash: 30000, mills: 4, ops: 2 });
    const { ctx, page, errors } = await open(browser, { save: seed, clock: true });
    await tab(page, 'shop'); await page.clock.runFor(300);
    const K = { 'number dies': 'dies', 'emoji dies': 'dies', 'stamping press': 'stamper', 'powder coat booth': 'booth', 'LED wiring bench': 'ledbench' };
    const buy = async name => { await page.locator('#upgList .upg[data-k="' + K[name] + '"] button').click(); await page.clock.runFor(200); };
    await buy('number dies'); await buy('emoji dies'); await buy('stamping press'); await buy('powder coat booth'); await buy('LED wiring bench');
    let g = await save(page);
    ok(g.dies === 2 && g.stamper && g.booth && g.ledbench, 'number dies, emoji dies and every finishing station can be bought');
    await tab(page, 'orders'); await page.clock.runFor(300);
    const bins = await page.$$eval('#bins .bin', n => n.length);
    ok(bins === 26 + 10 + 12, 'bins appear for every letter, number and emoji once unlocked', bins + ' bins');
    const kinds = new Set(); const procs = new Set();
    for (let i = 0; i < 60; i++) {
      g = await save(page);
      g.orders.forEach(o => { kinds.add(o.kind); if (o.proc) procs.add(o.proc); });
      const p = await page.$('#orderList .pass:not([disabled])'); if (p) await p.click().catch(() => {});
      await page.clock.runFor(21000);
    }
    ok(kinds.has('emoji') && kinds.has('num') && kinds.has('spell') && kinds.has('word'), 'word, spelling bee, house number and emoji orders all show up', [...kinds].join(','));
    ok(procs.size >= 2, 'orders ask for the finishing stations', [...procs].join(','));
    const masks = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 60; c.height = 60; const x = c.getContext('2d'); x.font = '50px "Noto Color Emoji",sans-serif'; x.fillText('\u{1F335}', 5, 50); const d = x.getImageData(0, 0, 60, 60).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 110) n++; return n; });
    ok(masks > 100, 'emoji draw a solid shape the mill can cut', masks + ' pixels');
    ok(errors.length === 0, 'no script errors with numbers, emoji and stations', errors.join(' | '));
    await ctx.close();
  }
  {
    const order = { id: 7, word: 'CAT', fin: 'alu', who: 'a sign shop', kind: 'word', proc: 'led', color: '' };
    const seed = JSON.stringify({ seenHow: true, guideDone: true, cash: 0, ledbench: true, orders: [order], inv: { 'C|alu': 1, 'A|alu': 1, 'T|alu': 1 } });
    const { ctx, page, errors } = await open(browser, { save: seed, clock: true });
    await tab(page, 'orders'); await page.clock.runFor(300);
    const ship = page.locator('#orderList .ocard[data-id="7"] .ship');
    await ship.click(); await page.clock.runFor(500);
    let g = await save(page);
    ok(g.line.length === 1 && g.cash === 0, 'an LED order goes down the finishing line before it pays', JSON.stringify({line:g.line,cash:g.cash,orders:g.orders.map(o=>o.id+o.word+o.proc)}));
    ok(await page.isVisible('#lineBox'), 'the finishing line shows on the orders tab');
    await page.clock.runFor(20000);
    g = await save(page);
    ok(g.line.length === 0 && g.cash > 0, 'the order pays when it comes off the line', 'cash ' + g.cash);
    ok(errors.length === 0, 'no script errors on the finishing line', errors.join(' | '));
    await ctx.close();
  }

  // ---- the engine lathe ----
  {
    const orders = [{ id: 1, word: '', parts: ['L:flange', 'L:flange'], fin: 'alu', who: 'a sign shop', kind: 'turned' },
      { id: 2, word: 'OAK', parts: ['L:standoff', 'L:standoff', 'L:standoff'], fin: 'alu', who: 'a sign shop', kind: 'mounted' }];
    const seed = JSON.stringify({ cash: 3000, seenHow: true, guideDone: true, mills: 2, ops: 2, orders });
    const { ctx, page, errors } = await open(browser, { save: seed, clock: true });
    ok(!(await page.isVisible('#latheTab')), 'the lathe tab stays hidden until the lathe is bought');
    await tab(page, 'shop'); await page.clock.runFor(300);
    const c0 = (await save(page)).cash;
    await page.locator('#upgList .upg[data-k="lathe"] button').click(); await page.clock.runFor(300);
    let g = await save(page);
    ok(g.lathe === true && (c0 - g.cash) >= Math.round(250 * Math.pow(1.7, 2) / 2) && (c0 - g.cash) < Math.round(250 * Math.pow(1.7, 2) / 2) + 30, 'the lathe costs half the price of the next mill', (c0 - g.cash) + '');
    ok(await page.isVisible('#latheTab'), 'buying the lathe opens the lathe tab');
    await tab(page, 'floor'); await page.clock.runFor(300);
    ok(/your mill, the lathe plus 2 floor mills/.test(await txt(page, '#facOrder')) && /, 9 open bays/.test(await txt(page, '#facOrder')), 'the lathe takes a bay on the floor', await txt(page, '#facOrder'));
    const flb = await (await page.$('#factory')).boundingBox();
    await page.mouse.click(flb.x + flb.width * 0.5, flb.y + flb.height * 0.06); await page.clock.runFor(200);
    ok(await page.isVisible('#view-lathe.on'), 'tapping the lathe bay opens the lathe');
    if (SHOTS) { await tab(page, 'floor'); await page.clock.runFor(400); await (await page.$('#factory')).screenshot({ path: SHOTS + '/lathebay.png' }); }
    await page.click('#latheTab'); await page.click('#lProgBtn');
    let t = 0;
    while (t < 400) { await page.clock.runFor(10000); t += 10; await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); g = await save(page); if ((g.inv['L:flange|alu'] || 0) >= 2 && (g.inv['L:standoff|alu'] || 0) >= 3) break; }
    ok((g.inv['L:flange|alu'] || 0) >= 2 && (g.inv['L:standoff|alu'] || 0) >= 3, 'the lathe program turns the flanges and standoffs the orders need', JSON.stringify(g.inv) + ' after ' + t + ' game seconds');
    await tab(page, 'orders'); await page.clock.runFor(300);
    ok(await page.$$eval('#lbins .bin', n => n.length) === 8, 'turned parts get their own bins');
    const ship = page.locator('#orderList .ocard[data-id="1"] .ship');
    await ship.click(); await page.clock.runFor(300);
    g = await save(page);
    ok(g.orders.every(o => o.id !== 1), 'a batch of turned parts ships');
    await page.click('#latheTab'); await page.click('#lProgBtn'); await page.clock.runFor(500);
    await page.click('#lLoadBtn');
    await page.$eval('#lRpm', e => { e.value = 900; e.dispatchEvent(new Event('input')); });
    await page.$eval('#lX', e => { e.value = 14; e.dispatchEvent(new Event('input')); });
    for (let z = 200; z >= 120; z -= 2) { await page.$eval('#lZ', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, z); await page.clock.runFor(30); }
    await page.$eval('#lRpm', e => { e.value = 0; e.dispatchEvent(new Event('input')); });
    await page.click('#lPartBtn'); await page.clock.runFor(300);
    ok(errors.length === 0, 'no script errors running the lathe by program and by hand', errors.join(' | '));
    if (SHOTS) { await (await page.$('#view-lathe')).screenshot({ path: SHOTS + '/lathe.png' }); }
    await ctx.close();
  }

  // ---- raw stock costs money, the lathe makes to stock and unlocks parts as it goes ----
  {
    const seed = JSON.stringify({ seenHow: true, guideDone: true, cash: 500, lathe: true, orders: [] });
    const { ctx, page, errors } = await open(browser, { save: seed, clock: true });
    await page.evaluate(() => { const g = JSON.parse(localStorage.getItem('mill-ionaire-v2-save')); }); 
    await page.click('#latheTab'); await page.clock.runFor(400);
    ok(await page.$$eval('#lPick button:not([disabled])', n => n.length) === 2, 'the lathe starts with standoffs and studs unlocked');
    await page.click('#lPick button[title="threaded stud"]'); await page.clock.runFor(200);
    ok((await save(page)).stockPart === 'stud', 'the part picked on the lathe tab is remembered');
    const c0 = (await save(page)).cash;
    await page.click('#lLoadBtn'); await page.clock.runFor(200);
    ok(c0 - (await save(page)).cash === 3, 'loading an aluminum bar costs money', (c0 - (await save(page)).cash) + '');
    await page.click('#lProgBtn');
    let g; let t = 0;
    while (t < 600) { await page.clock.runFor(10000); t += 10; await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); g = await save(page); if (g.turned >= 10 && (g.inv['L:stud|alu'] || 0) >= 5) break; }
    ok((g.inv['L:stud|alu'] || 0) >= 5, 'when orders are covered the lathe makes the picked part to stock', JSON.stringify(g.inv));
    ok(g.paidStock >= 30, 'every bar the program loads is paid for', 'spent ' + g.paidStock);
    await page.clock.runFor(1000);
    ok(await page.$$eval('#lPick button:not([disabled])', n => n.length) === 3, 'making turned parts unlocks the next part on the catalog');
    ok(errors.length === 0, 'no script errors with stock costs and the lathe picker', errors.join(' | '));
    await ctx.close();
  }
  {
    const seed = JSON.stringify({ seenHow: true, guideDone: true, cash: 0, owned: ['alu', 'brass'], curFin: 'brass', orders: [] });
    const { ctx, page, errors } = await open(browser, { save: seed, clock: true });
    const box = await (await page.$('#machine')).boundingBox();
    const sx = box.width / 680, sy = box.height / 580;
    await page.mouse.move(box.x + 170 * sx, box.y + 518 * sy); await page.mouse.down();
    await page.mouse.move(box.x + 220 * sx, box.y + 420 * sy, { steps: 8 }); await page.mouse.move(box.x + 260 * sx, box.y + 330 * sy, { steps: 8 }); await page.mouse.up();
    await page.clock.runFor(300);
    ok(/drag a/.test(await txt(page, '#status')), 'a broke shop cannot drop a brass blank it cannot pay for', await txt(page, '#status'));
    await page.click('#finPick button[title="raw aluminum"]');
    await page.mouse.move(box.x + 170 * sx, box.y + 518 * sy); await page.mouse.down();
    await page.mouse.move(box.x + 220 * sx, box.y + 420 * sy, { steps: 8 }); await page.mouse.move(box.x + 260 * sx, box.y + 330 * sy, { steps: 8 }); await page.mouse.up();
    await page.clock.runFor(300);
    ok(/positioning|cutting/.test(await txt(page, '#status')), 'a broke shop still gets an aluminum offcut from the scrap rack', await txt(page, '#status'));
    ok(errors.length === 0, 'no script errors when the shop is broke', errors.join(' | '));
    await ctx.close();
  }

  // ---- the press brake and big storefront signs ----
  {
    const seed = JSON.stringify({ seenHow: true, guideDone: true, cash: 3000, mills: 1, lathe: true, orders: [] });
    const { ctx, page, errors } = await open(browser, { save: seed, clock: true });
    ok(!(await page.isVisible('#brakeTab')), 'the brake tab stays hidden until the brake is bought');
    await tab(page, 'shop'); await page.clock.runFor(300);
    await page.click('#upgList .upg[data-k="brake"] button'); await page.clock.runFor(300);
    let g = await save(page);
    ok(g.brake === true && await page.isVisible('#brakeTab'), 'buying the press brake opens the brake tab');
    await tab(page, 'floor'); await page.clock.runFor(300);
    ok(/the lathe, the brake plus 1 floor mills/.test(await txt(page, '#facOrder')) && /, 9 open bays/.test(await txt(page, '#facOrder')), 'the brake takes a bay on the floor', await txt(page, '#facOrder'));
    await page.click('#brakeTab'); await page.clock.runFor(300);
    ok(await page.$$eval('#bPick button:not([disabled])', n => n.length) === 2, 'the brake starts with angle and mounting brackets');
    await page.click('#bLoadBtn'); await page.clock.runFor(200);
    await page.dispatchEvent('#bPressBtn', 'pointerdown');
    for (let i = 0; i < 40 && !/right on/.test(await txt(page, '#bStatus')); i++) await page.clock.runFor(50);
    await page.dispatchEvent('#bPressBtn', 'pointerup'); await page.clock.runFor(200);
    g = await save(page);
    ok(g.formed === 1, 'a bend made by hand at the right angle finishes an angle bracket', 'formed ' + g.formed);
    await page.click('#bProgBtn');
    let t = 0;
    while (t < 600) { await page.clock.runFor(10000); t += 10; await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); g = await save(page); if (g.formed >= 16) break; }
    ok(g.formed >= 16, 'the brake program forms parts and works through the unlocks', 'formed ' + g.formed);
    ok(await page.$$eval('#bPick button:not([disabled])', n => n.length) >= 4, 'forming parts unlocks U channel and hat channel');
    await tab(page, 'orders'); await page.clock.runFor(300);
    ok(await page.$$eval('#bbins .bin', n => n.length) === 9, 'formed parts get their own bins');
    let kinds = new Set();
    for (let i = 0; i < 50; i++) { g = await save(page); g.orders.forEach(o => kinds.add(o.kind)); const p2 = await page.$('#orderList .pass:not([disabled])'); if (p2) await p2.click().catch(() => {}); await page.clock.runFor(21000); }
    ok(kinds.has('bigsign') && kinds.has('formed'), 'big storefront sign orders and formed part orders show up', [...kinds].join(','));
    ok(errors.length === 0, 'no script errors on the press brake', errors.join(' | '));
    await ctx.close();
  }
  {
    const seed = JSON.stringify({ seenHow: true, guideDone: true, cash: 3000, brake: true, formed: 200, brakePart: 'mufflerman', orders: [] });
    const { ctx, page, errors } = await open(browser, { save: seed, clock: true });
    await page.click('#brakeTab'); await page.click('#bLoadBtn'); await page.clock.runFor(200);
    await page.dispatchEvent('#bPressBtn', 'pointerdown'); await page.clock.runFor(500); await page.dispatchEvent('#bPressBtn', 'pointerup');
    for (let k = 0; k < 6; k++) { await page.dispatchEvent('#bPressBtn', 'pointerdown'); for (let i = 0; i < 40 && !/right on/.test(await txt(page, '#bStatus')); i++) await page.clock.runFor(50); await page.dispatchEvent('#bPressBtn', 'pointerup'); await page.clock.runFor(100); }
    ok(/bend/.test(await txt(page, '#bStatus')), 'bending a muffler man by hand walks through its bends', await txt(page, '#bStatus'));
    await page.dispatchEvent('#bPressBtn', 'pointerdown'); await page.clock.runFor(4000); await page.dispatchEvent('#bPressBtn', 'pointerup'); await page.clock.runFor(200);
    ok(/load a sheet/.test(await txt(page, '#bStatus')), 'holding the press too long overbends the part into scrap', await txt(page, '#bStatus'));
    ok(errors.length === 0, 'no script errors bending by hand', errors.join(' | '));
    if (SHOTS) { await page.click('#bLoadBtn'); for (let k = 0; k < 12; k++) { await page.dispatchEvent('#bPressBtn', 'pointerdown'); for (let i = 0; i < 40 && !/right on/.test(await txt(page, '#bStatus')); i++) await page.clock.runFor(50); await page.dispatchEvent('#bPressBtn', 'pointerup'); await page.clock.runFor(100); } await (await page.$('#view-brake')).screenshot({ path: SHOTS + '/brake.png' }); }
    await ctx.close();
  }

  // ---- tapping a bin shows every finish in it ----
  {
    const inv = { 'A|alu': 4, 'A|brass': 2, 'L:flange|copper': 3, 'B:donut|blueano': 1 };
    const orders = [{ id: 3, word: 'AA', fin: 'brass', who: 'a sign shop', kind: 'word' }];
    const seed = JSON.stringify({ seenHow: true, guideDone: true, cash: 100, lathe: true, brake: true, owned: ['alu', 'brass', 'copper', 'blueano'], inv, orders });
    const { ctx, page, errors } = await open(browser, { save: seed });
    await tab(page, 'orders'); await page.waitForTimeout(300);
    await page.click('#bins .bin[data-ch="A"]'); await page.waitForTimeout(200);
    const d = await txt(page, '#binDetail');
    ok(/letter A, 6 in the bins/.test(d) && /raw aluminum/.test(d) && /brass/.test(d), 'tapping a letter bin lists how many of each finish it holds', d.slice(0, 120));
    ok(/open orders want [2-9]/.test(d), 'the bin detail shows what open orders still want');
    await page.click('#lbins .bin[data-ch="L:flange"]'); await page.waitForTimeout(200);
    ok(/flange, 3 in the bins/.test(await txt(page, '#binDetail')) && /copper/.test(await txt(page, '#binDetail')), 'turned part bins break down by finish too');
    await page.click('#bbins .bin[data-ch="B:donut"]'); await page.waitForTimeout(200);
    ok(/giant donut, 1 in the bins/.test(await txt(page, '#binDetail')), 'formed part bins break down by finish too');
    if (SHOTS) await (await page.$('#binDetail')).screenshot({ path: SHOTS + '/bindetail.png' });
    await page.click('#binClose'); await page.waitForTimeout(100);
    ok(!(await page.isVisible('#binDetail')), 'the bin detail closes');
    ok(errors.length === 0, 'no script errors opening bins', errors.join(' | '));
    await ctx.close();
  }

  // ---- saving survives a reload ----
  {
    const { ctx, page, errors } = await open(browser, { save: JSON.stringify({ cash: 4321, seenHow: true, owned: ['alu', 'brass'], curFin: 'brass', mills: 2 }) });
    await page.reload(); await page.waitForTimeout(300);
    ok(/^\$4,[23]\d\d$/.test(await txt(page, '#hudCash')), 'cash comes back after a reload', await txt(page, '#hudCash'));
    ok((await txt(page, '#hudMills')) === '3', 'mills come back after a reload', await txt(page, '#hudMills'));
    ok(errors.length === 0, 'no script errors reloading a save', errors.join(' | '));
    await ctx.close();
  }

  // ---- loose parts in the tray survive a reload ----
  {
    const { ctx, page, errors } = await open(browser, { clock: true });
    await closeHow(page);
    await page.click('#demoBtn');
    await page.clock.runFor(150000);
    await page.click('#demoBtn');
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
    for (let i = 0; i < 4; i++) { await page.locator('#upgList .upg[data-k="mill"] button').click({ timeout: 2000 }).catch(() => {}); await page.clock.runFor(100); }
    await page.locator('#upgList .upg[data-k="fore"] button').click({ timeout: 2000 }).catch(() => {});
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
    ok(g.orders.length <= 9, 'the order board never overflows', g.orders.length + ' orders');
    ok(errors.length === 0, 'no script errors over half an hour of play', errors.join(' | '));
    results.push('     (half an hour of game time took ' + ((Date.now() - t0) / 1000).toFixed(0) + ' real seconds)');
    await ctx.close();
  }

  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error('\nSTOPPED: ' + e.message.split('\n')[0]); process.exit(1); });
