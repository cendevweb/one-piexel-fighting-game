// End-to-end test of the online versus: `npm run e2e:online` (in apps/web).
//
// Starts a local PeerServer and a Vite dev server, opens two Chromium pages
// (host, then guest through the invite link), picks fighters, and plays:
//   1. a full match, both sides driven by the CPU (?bot), over a degraded
//      network (?netlag / ?netjitter / ?netloss on both pages);
//   2. a rematch, the guest now typing on the keyboard (walk, jump, chains,
//      specials, throw, ultimate) for about 30 s;
//   3. the guest closes its tab: the host is back in its room (same code),
//      a new guest joins, quits from the select, joins again;
//   4. the host closes its tab: the guest must show "ADVERSAIRE DÉCONNECTÉ".
// A spectator (?spectateur=CODE) arrives before the guest and watches match 1; a second
// one is turned away; during match 2 the first leaves and another arrives
// mid-match and must catch up. Each replays the same inputs as the players.
// Checks: no desync reported, both pages replay identical inputs to the same
// checksum and health, and the final confirmed states agree.
//
// Env: CHROMIUM_PATH (default /opt/pw-browsers/chromium when present),
// E2E_PORT (Vite, 5202), PEER_PORT (9202), SHOTS (screenshot folder, optional).
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PeerServer } from 'peer';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const VITE_PORT = Number(process.env.E2E_PORT ?? 5202);
const PEER_PORT = Number(process.env.PEER_PORT ?? 9202);
const SHOTS = process.env.SHOTS ?? '';
const NET = process.env.E2E_NET ?? 'netlag=40&netjitter=30&netloss=0.1';
const exe = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log('[e2e]', ...a);
let failures = 0;
const check = (ok, what) => { if (ok) log('OK  ', what); else { failures++; console.error('[e2e] FAIL', what); } };

const peer = PeerServer({ port: PEER_PORT, path: '/', host: '127.0.0.1', allow_discovery: false });
const vite = await createServer({ root, server: { port: VITE_PORT, host: '127.0.0.1', strictPort: true }, logLevel: 'warn' });
await vite.listen();
const origin = `http://127.0.0.1:${VITE_PORT}`;
const browser = await chromium.launch({ executablePath: exe });

async function page(name, { throttleTimers = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const p = await ctx.newPage();
    // Like a background tab in Chrome: fast timers fire once a second at most.
    // (Only the game loop's 60 Hz timer is that fast; it matters only while hidden.)
    if (throttleTimers) {
        await p.addInitScript(() => {
            const si = window.setInterval;
            window.setInterval = (f, d, ...a) => si(f, d !== undefined && d < 20 ? 1000 : d, ...a);
        });
    }
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
        if (m.text().includes('désynchronisation')) errors.push(m.text());
    });
    const tap = async (k, after = 150, hold = 40) => { await p.keyboard.down(k); await p.waitForTimeout(hold); await p.keyboard.up(k); await p.waitForTimeout(after); };
    const scene = () => p.evaluate(() => window.__opfgScene);
    const waitScene = async (s, ms = 20000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { if ((await scene()) === s) return true; await p.waitForTimeout(100); }
        throw new Error(`${name}: scène ${s} attendue, ${await scene()} affichée`);
    };
    const shot = (n) => (SHOTS ? p.locator('#screen').screenshot({ path: `${SHOTS}/${n}-${name}.png` }) : null);
    const fight = () => p.evaluate(() => {
        const d = window.__opfg;
        return d && { frame: d.frame, confirmedFrame: d.confirmedFrame, desync: d.desync, stats: d.stats, confirmed: d.confirmed, rtt: d.rtt(), seed: d.seed };
    });
    return { name, ctx, p, errors, tap, scene, waitScene, shot, fight };
}

/** Both pages replay their input logs to the same frame: same checksum, same health. */
async function compare(A, B, label) {
    const [fa, fb] = [await A.fight(), await B.fight()];
    const n = Math.min(fa.confirmedFrame, fb.confirmedFrame);
    const [ra, rb] = await Promise.all([A, B].map((X) => X.p.evaluate((k) => window.__opfg.replay(k), n)));
    log(label, `frame ${n}`, 'hôte', JSON.stringify(ra), '| invité', JSON.stringify(rb));
    log(label, 'stats hôte', JSON.stringify(fa.stats), 'invité', JSON.stringify(fb.stats), `ping ${fa.rtt}/${fb.rtt} ms`);
    check(ra.sum === rb.sum, `${label}: checksums identiques après ${n} frames`);
    check(JSON.stringify(ra.health) === JSON.stringify(rb.health), `${label}: santé identique ${JSON.stringify(ra.health)}`);
    check(!fa.desync && !fb.desync, `${label}: aucune désynchronisation signalée`);
    return { fa, fb };
}

/** The spectator replays the same inputs as the host: same state after the same frames. */
async function specCompare(A, S, label) {
    const k = await S.p.evaluate(() => window.__opfgSpec.received());
    const host = await A.fight();
    const n = Math.min(k, host.confirmedFrame);
    const rs = await S.p.evaluate((x) => window.__opfgSpec.replay(x), n);
    const ra = await A.p.evaluate((x) => window.__opfg.replay(x), n);
    log(label, `spectateur ${n} frames`, JSON.stringify(rs), '| hôte', JSON.stringify(ra));
    check(n > 300 && rs.frames === n && rs.sum === ra.sum, `${label} : le spectateur voit le même combat (${n} frames)`);
}

try {
    const A = await page('hote');
    await A.p.goto(`${origin}/?peer=127.0.0.1:${PEER_PORT}&bot=3&${NET}`);
    await A.waitScene('TitleScene');
    await A.tap('Enter', 700);
    await A.tap('KeyS'); await A.tap('KeyJ', 700); // VERSUS J1 CONTRE J2
    await A.tap('KeyS'); await A.tap('KeyS'); await A.shot('00-versus'); await A.tap('KeyJ', 300); // CRÉER UN SALON
    await A.waitScene('HostScene');
    await A.p.waitForTimeout(1500);
    await A.shot('01-salon');
    const invite = await A.p.evaluate(() => navigator.clipboard.readText());
    check(/[?&]salon=[A-Z2-9]{6}$/.test(invite), `lien copié : ${invite}`);
    await A.tap('KeyA', 400);
    const watchLink = await A.p.evaluate(() => navigator.clipboard.readText());
    check(/[?&]spectateur=[A-Z2-9]{6}$/.test(watchLink), `lien spectateur copié : ${watchLink}`);

    // The spectator arrives first, before the guest.
    const C = await page('spectateur');
    await C.p.goto(`${watchLink}&${NET}`);
    await C.waitScene('SpectateWaitScene');
    await C.p.waitForTimeout(500);
    await C.shot('02-attente');
    const B = await page('invite', { throttleTimers: true });
    await B.p.goto(`${invite}&bot=3&${NET}`);
    await Promise.all([A.waitScene('OnlineSelectScene'), B.waitScene('OnlineSelectScene')]);
    const D = await page('spectateur2');
    await D.p.goto(watchLink);
    await D.waitScene('JoinScene');
    await D.p.waitForTimeout(3000);
    await D.shot('02-refuse');
    check((await D.scene()) === 'JoinScene' && (await C.scene()) === 'SpectateWaitScene', 'second spectateur refusé, le premier reste');
    await D.ctx.close();
    await A.p.waitForTimeout(800);
    await A.tap('KeyD'); await A.tap('KeyD');
    await B.tap('KeyD'); await B.tap('KeyS');
    await A.p.waitForTimeout(500);
    await A.shot('02-select');
    await B.shot('02-select');
    await A.tap('KeyJ', 300); await B.tap('KeyJ', 300);
    await A.waitScene('OnlineStageScene');
    await A.tap('KeyD', 600);
    await B.shot('03-stage');
    await A.tap('KeyJ');
    await Promise.all([A.waitScene('OnlineVersusScene'), B.waitScene('OnlineVersusScene')]);
    await Promise.all([A.waitScene('OnlineFightScene'), B.waitScene('OnlineFightScene')]);
    log('combat 1 : les deux CPU jouent');
    await C.waitScene('SpectateFightScene');

    // 1. Full match, CPU against CPU.
    const t0 = Date.now();
    let shots = 0;
    while (Date.now() - t0 < 240000) {
        await A.p.waitForTimeout(3000);
        if (shots < 3) { shots++; await Promise.all([A.shot(`04-combat1-${shots}`), B.shot(`04-combat1-${shots}`), C.shot(`04-combat1-${shots}`)]); }
        const [fa, fb] = [await A.fight(), await B.fight()];
        if (!fa || !fb) break;
        if (fa.confirmed.phase === 'matchEnd' && fb.confirmed.phase === 'matchEnd') break;
    }
    const { fa, fb } = await compare(A, B, 'combat 1');
    check(fa.confirmed.phase === 'matchEnd' && fb.confirmed.phase === 'matchEnd', 'combat 1 terminé des deux côtés');
    check(fa.confirmed.winner === fb.confirmed.winner, `même vainqueur (${fa.confirmed.winner})`);
    await A.shot('05-ko'); await B.shot('05-ko');
    await specCompare(A, C, 'combat 1');
    await C.waitScene('SpectateWaitScene');
    await C.shot('06-attente');

    // Results: both ask for a rematch.
    await Promise.all([A.waitScene('OnlineResultsScene'), B.waitScene('OnlineResultsScene')]);
    await A.p.waitForTimeout(600);
    await A.tap('KeyJ', 600);
    await A.shot('06-resultats'); await B.shot('06-resultats');
    await B.tap('KeyJ', 300);
    await Promise.all([A.waitScene('OnlineVersusScene'), B.waitScene('OnlineVersusScene')]);
    await Promise.all([A.waitScene('OnlineFightScene'), B.waitScene('OnlineFightScene')]);
    const seeds = [await A.fight(), await B.fight()].map((f) => f.seed);
    check(seeds[0] === seeds[1] && seeds[0] !== fa.seed, 'revanche : nouveau combat, même graine des deux côtés');

    // 2. The guest plays on the keyboard for ~30 s.
    await B.p.evaluate(() => window.__opfg.setBot(null));
    await B.p.waitForTimeout(3500); // intro
    const combos = [
        ['KeyD', 400], ['KeyA', 250], ['KeyW', 100], ['KeyJ'], ['KeyJ'], ['KeyK'], ['KeyL'],
        ['KeyS+KeyD+KeyJ'], ['KeyS+KeyL'], ['KeyD+KeyW', 120], ['KeyU'], ['KeyI'], ['KeyS+KeyK'], ['KeyA+KeyS', 300]
    ];
    const t1 = Date.now();
    let n = 0;
    while (Date.now() - t1 < 30000) {
        const [keys, hold = 60] = combos[n++ % combos.length];
        const ks = keys.split('+');
        for (const k of ks) await B.p.keyboard.down(k);
        await B.p.waitForTimeout(hold);
        for (const k of ks.reverse()) await B.p.keyboard.up(k);
        await B.p.waitForTimeout(40 + (n % 5) * 30);
        if (n === 40) { await A.shot('07-combat2'); await B.shot('07-combat2'); }
        if ((await B.scene()) !== 'OnlineFightScene') break;
    }
    if ((await B.scene()) === 'OnlineFightScene') await compare(A, B, 'combat 2');

    // The spectator leaves; another one arrives mid-match and catches up.
    check((await C.scene()) === 'SpectateFightScene', 'spectateur : la revanche s\'affiche');
    await C.ctx.close();
    await A.p.waitForTimeout(1500);
    const E = await page('spectateur-tardif');
    await E.p.goto(watchLink);
    await E.waitScene('SpectateFightScene');
    await E.p.waitForTimeout(2500);
    await E.shot('07-spectateur-tardif');
    const [ha, se] = [await A.fight(), await E.p.evaluate(() => ({ frame: window.__opfgSpec.frame(), received: window.__opfgSpec.received() }))];
    log('spectateur tardif', `hôte frame ${ha.confirmedFrame}, spectateur lit ${se.frame} / ${se.received} reçues`);
    check(ha.confirmedFrame - se.frame < 40, 'spectateur tardif : rattrape le direct');
    await specCompare(A, E, 'spectateur tardif');

    // The guest's tab goes to the background for 6 s: no animation frames,
    // timers throttled to 1 Hz. The host must not freeze meanwhile.
    if ((await B.scene()) === 'OnlineFightScene') {
        await B.p.evaluate(() => {
            const w = window;
            w.__raf = w.requestAnimationFrame.bind(w);
            w.__pending = [];
            w.requestAnimationFrame = (cb) => { w.__pending.push(cb); return 0; };
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            w.dispatchEvent(new Event('blur'));
        });
        const [a0, b0] = [await A.fight(), await B.fight()];
        await A.p.waitForTimeout(6000);
        const [a1, b1] = [await A.fight(), await B.fight()];
        log('arrière-plan', `hôte +${a1.frame - a0.frame} frames, invité caché +${b1.frame - b0.frame} frames en 6 s`);
        check(a1.frame - a0.frame > 240, 'hôte : le combat continue quand l\'invité passe en arrière-plan');
        await B.p.evaluate(() => {
            const w = window;
            delete document.hidden;
            w.requestAnimationFrame = w.__raf;
            for (const cb of w.__pending) w.__raf(cb);
        });
        await B.p.waitForTimeout(1500);
        await B.shot('08-retour-premier-plan');
        if ((await B.scene()) === 'OnlineFightScene' && (await A.scene()) === 'OnlineFightScene') await compare(A, B, 'après arrière-plan');
    }

    // Escape: quit confirmation (no pause), then stay.
    if ((await B.scene()) === 'OnlineFightScene') {
        await B.tap('Escape', 300);
        await B.shot('08-quitter');
        await B.tap('Escape', 200);
    }

    // 3. The guest closes its tab mid-match: the host goes back to its room,
    //    same code, and the spectator waits with it. A new guest joins.
    await B.ctx.close();
    await A.waitScene('HostScene', 10000);
    await E.waitScene('SpectateWaitScene', 10000);
    await A.p.waitForTimeout(600);
    await A.shot('09-salon-rouvert'); await E.shot('09-attente');
    check(true, 'invité parti : l\'hôte revient à son salon, le spectateur attend');
    const F = await page('invite2');
    await F.p.goto(invite);
    await Promise.all([A.waitScene('OnlineSelectScene'), F.waitScene('OnlineSelectScene')]);
    check(true, 'un nouvel invité rejoint le même salon');
    // The new guest quits from the select: the room is still open.
    await F.p.waitForTimeout(600);
    await F.tap('Escape', 300); await F.tap('KeyS', 200); await F.tap('KeyJ', 300);
    await A.waitScene('HostScene', 10000);
    await F.waitScene('MainMenuScene', 10000);
    check(true, 'invité qui quitte la sélection : le salon reste ouvert');
    await F.p.goto(invite);
    await Promise.all([A.waitScene('OnlineSelectScene'), F.waitScene('OnlineSelectScene')]);

    // 4. The host closes its tab.
    await A.ctx.close();
    await F.waitScene('NetNoticeScene', 10000);
    await F.p.waitForTimeout(600);
    await F.shot('10-deconnecte');
    await E.waitScene('NetNoticeScene', 10000);
    await E.shot('10-fin-diffusion');
    check(true, 'spectateur : fin de diffusion affichée');
    await F.tap('Enter', 600);
    await F.waitScene('VersusMenuScene', 5000);
    check(true, 'invité : écran de déconnexion, puis menu VERSUS');
    const errs = [...A.errors, ...B.errors, ...C.errors, ...E.errors, ...F.errors].filter((e) => !/PeerJS|Failed to load resource|ERR_|WebSocket/i.test(e));
    check(errs.length === 0, `aucune erreur de page ${errs.length ? JSON.stringify(errs.slice(0, 5)) : ''}`);
} catch (e) {
    failures++;
    console.error('[e2e] ERREUR', e);
} finally {
    await browser.close();
    await vite.close();
    peer.close?.();
    log(failures ? `${failures} échec(s)` : 'tout est bon');
    process.exit(failures ? 1 : 0);
}
