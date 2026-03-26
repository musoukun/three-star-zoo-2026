/**
 * E2E テスト: 勝利条件とバーストペナルティ
 *
 * 前提: サーバー(port 2567) と クライアント(port 3000) が起動済み
 *
 * テストケース:
 *   1. 星3つ購入して勝利 — 星3＋うんち6以下でターン終了 → 勝利モーダル表示
 *   2. バースト: 星あり → 星-1, コイン・うんちリセット
 *   3. バースト: 星なし → 最高コスト動物を市場に返却, コイン・うんちリセット
 */
import { test, expect, type Page } from '@playwright/test';

const SS_DIR = 'e2e/screenshots/win-burst';
let ssIndex = 0;

function log(msg: string) {
  console.log(`[E2E-win-burst] ${msg}`);
}

async function ss(page: Page, who: string, testName: string, label: string) {
  ssIndex++;
  const prefix = String(ssIndex).padStart(3, '0');
  const safe = `${testName}_${label}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
  await page.screenshot({ path: `${SS_DIR}/${prefix}_${who}_${safe}.png` });
  log(`  ss[${prefix}] ${who}: ${label}`);
}

async function ssBoth(alice: Page, bob: Page, testName: string, label: string) {
  await Promise.all([
    ss(alice, 'alice', testName, label),
    ss(bob, 'bob', testName, label),
  ]);
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function clickAction(page: Page, text: string | RegExp, timeout = 10000) {
  const btn = page.locator('.action-panel').getByRole('button', { name: text }).first();
  await btn.waitFor({ state: 'visible', timeout });
  await btn.click();
}

// === デバッグコマンド ===

async function debugSetDice(page: Page, dice: number[]) {
  await page.evaluate((d) => {
    (window as any).__colyseusRoom?.send('__debugSetDice', { dice: d });
  }, dice);
  await sleep(100);
}

async function debugSetCoins(page: Page, playerId: string, coins: number) {
  await page.evaluate(({ pid, c }) => {
    (window as any).__colyseusRoom?.send('__debugSetCoins', { playerId: pid, coins: c });
  }, { pid: playerId, c: coins });
  await sleep(100);
}

async function debugSetStars(page: Page, playerId: string, stars: number) {
  await page.evaluate(({ pid, s }) => {
    (window as any).__colyseusRoom?.send('__debugSetStars', { playerId: pid, stars: s });
  }, { pid: playerId, s: stars });
  await sleep(100);
}

async function debugSetPoop(page: Page, playerId: string, poop: number) {
  await page.evaluate(({ pid, p }) => {
    (window as any).__colyseusRoom?.send('__debugSetPoop', { playerId: pid, poop: p });
  }, { pid: playerId, p: poop });
  await sleep(100);
}

async function getSessionId(page: Page): Promise<string> {
  return await page.evaluate(() => (window as any).__colyseusRoom?.sessionId ?? '');
}

async function getCoins(page: Page, sessionId: string): Promise<number> {
  return await page.evaluate((sid) => {
    const p = (window as any).__colyseusRoom?.state?.players?.get(sid);
    return p ? p.coins : -1;
  }, sessionId);
}

async function getStars(page: Page, sessionId: string): Promise<number> {
  return await page.evaluate((sid) => {
    const p = (window as any).__colyseusRoom?.state?.players?.get(sid);
    return p ? p.stars : -1;
  }, sessionId);
}

async function getPoop(page: Page, sessionId: string): Promise<number> {
  return await page.evaluate((sid) => {
    const p = (window as any).__colyseusRoom?.state?.players?.get(sid);
    return p ? p.poopTokens : -1;
  }, sessionId);
}

/** ケージ内の動物数を取得 */
async function getAnimalCount(page: Page, sessionId: string): Promise<number> {
  return await page.evaluate((sid) => {
    const p = (window as any).__colyseusRoom?.state?.players?.get(sid);
    if (!p) return -1;
    let count = 0;
    for (const cage of p.cages) {
      count += cage.slots.length;
    }
    return count;
  }, sessionId);
}

async function placeAnimalInCage(page: Page, animalName: string, cageNum: number) {
  const cageLabel = cageNum === 11 ? '11&12' : String(cageNum);
  const cages = page.locator('.my-board-area .cage');
  const count = await cages.count();
  for (let i = 0; i < count; i++) {
    const cage = cages.nth(i);
    const numText = await cage.locator('.cage-num').textContent() || '';
    if (numText.trim() === cageLabel) {
      const placeBtn = cage.locator('.cage-place-btn').filter({ hasText: animalName });
      if (await placeBtn.count() > 0) {
        await placeBtn.first().click();
        return;
      }
    }
  }
  log(`  WARN: cage ${cageNum} not found for ${animalName}, using fallback`);
  await page.locator('.cage-place-btn').filter({ hasText: animalName }).first().click();
}

// === ゲームセットアップ ===

async function startGame(browser: any, roomSuffix: string, testName: string) {
  const ctxAlice = await browser.newContext();
  const ctxBob = await browser.newContext();
  const alice = await ctxAlice.newPage();
  const bob = await ctxBob.newPage();

  await alice.goto('/');
  await alice.fill('input[placeholder="名前を入力..."]', 'アリス');
  await alice.getByRole('button', { name: /ルームを作成/ }).first().click();
  await alice.fill('input[placeholder="部屋の名前..."]', `WB_${roomSuffix}`);
  await alice.getByRole('button', { name: /作成して入室/ }).first().click();
  await sleep(500);

  await bob.goto('/');
  await bob.fill('input[placeholder="名前を入力..."]', 'ボブ');
  await sleep(2000);

  const targetRoom = bob.locator('div')
    .filter({ hasText: new RegExp(`WB_${roomSuffix}`) })
    .filter({ has: bob.getByRole('button', { name: '入室 →' }) })
    .last();
  await targetRoom.getByRole('button', { name: '入室 →' }).click();
  await sleep(500);

  await alice.getByText('ボブ', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await alice.getByRole('button', { name: /ゲーム開始 \(2人で対戦\)/ }).first().click();
  await sleep(500);
  await ssBoth(alice, bob, testName, 'game-started');

  const aliceId = await getSessionId(alice);
  const bobId = await getSessionId(bob);
  log(`  aliceId=${aliceId}, bobId=${bobId}`);

  return { alice, bob, aliceId, bobId, ctxAlice, ctxBob };
}

async function completeSetup(alice: Page, bob: Page, testName: string, placements?: {
  alice?: [string, number][];
  bob?: [string, number][];
}) {
  const ap = placements?.alice ?? [['レッサーパンダ', 1], ['ペンギン', 2]];
  const bp = placements?.bob ?? [['レッサーパンダ', 1], ['ペンギン', 2]];

  await alice.locator('.cage-place-btn').first().waitFor({ state: 'visible', timeout: 5000 });
  for (const [animal, cage] of ap) {
    await placeAnimalInCage(alice, animal, cage);
    await sleep(300);
  }

  await bob.locator('.cage-place-btn').first().waitFor({ state: 'visible', timeout: 5000 });
  for (const [animal, cage] of bp) {
    await placeAnimalInCage(bob, animal, cage);
    await sleep(300);
  }

  await sleep(500);
  await ssBoth(alice, bob, testName, 'setup-complete');
}

async function advanceToIncome(page: Page, testName: string, who: string, dice1: number, dice2: number) {
  await clickAction(page, /うんちを受け取る/);
  await sleep(200);
  await debugSetDice(page, [dice1, dice2]);
  await clickAction(page, /2個振り/);
  await sleep(300);
  await ss(page, who, testName, `dice-${dice1}+${dice2}=${dice1 + dice2}`);
}

async function finishTurn(page: Page, testName: string, who: string) {
  await clickAction(page, /お買い物終了/);
  await sleep(200);
  const cleanDone = page.locator('.action-panel').getByRole('button', { name: /掃除終了/ });
  if (await cleanDone.count() > 0) {
    await cleanDone.click();
    await sleep(200);
  }
  await clickAction(page, /ターン終了/);
  await sleep(200);
}

async function skipBobTurn(bob: Page, testName: string) {
  await advanceToIncome(bob, testName, 'bob', 1, 2);
  await finishTurn(bob, testName, 'bob');
}

// === 効果解決（steal/choice） ===
async function resolveAllEffects(alice: Page, bob: Page) {
  let guard = 0;
  while (guard < 20) {
    guard++;
    await sleep(200);
    const aEffects = await alice.locator('.trade-submenu .trade-option').count();
    const bEffects = await bob.locator('.trade-submenu .trade-option').count();
    if (aEffects === 0 && bEffects === 0) break;

    const effectPage = aEffects > 0 ? alice : bob;
    const creation = effectPage.locator('.trade-option').filter({ hasText: 'コイン獲得' });
    if (await creation.count() > 0) {
      await creation.first().click();
    } else {
      const first = effectPage.locator('.trade-option').first();
      if (await first.isVisible()) await first.click();
    }
    await sleep(200);
  }
}

// =============================================================
// テスト
// =============================================================

test.describe('勝利とバースト', () => {

  // ----------------------------------------------------------
  // 1. 星3つ購入して勝利
  // ----------------------------------------------------------
  test('星3つ購入で勝利 — 勝利モーダル表示', async ({ browser }) => {
    const T = 'win';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'win1', T);
    try {
      await completeSetup(alice, bob, T);

      // アリスに30コイン、うんち0で安全に星3つ買える状態にする
      await debugSetCoins(alice, aliceId, 35);
      await sleep(200);
      await ss(alice, 'alice', T, 'coins-set-35');

      // --- ターン1: 星1つ目購入 ---
      await advanceToIncome(alice, T, 'alice', 1, 2);
      await resolveAllEffects(alice, bob);

      // 星を買う
      const starBtn = alice.locator('.action-panel').getByRole('button', { name: /星を買う/ });
      await expect(starBtn).toBeVisible({ timeout: 5000 });
      await starBtn.click();
      await sleep(300);
      await ss(alice, 'alice', T, 'star-1-bought');

      const stars1 = await getStars(alice, aliceId);
      log(`  星1つ目: ★${stars1}`);
      expect(stars1).toBe(1);

      await clickAction(alice, /お買い物終了/);
      await sleep(200);
      const cd1 = alice.locator('.action-panel').getByRole('button', { name: /掃除終了/ });
      if (await cd1.count() > 0) await cd1.click();
      await sleep(200);
      await clickAction(alice, /ターン終了/);
      await sleep(200);
      await ss(alice, 'alice', T, 'turn1-end');

      // ボブスキップ
      await skipBobTurn(bob, T);

      // --- ターン2: 星2つ目購入 ---
      await debugSetCoins(alice, aliceId, 15);
      await sleep(200);
      await advanceToIncome(alice, T, 'alice', 1, 2);
      await resolveAllEffects(alice, bob);

      await alice.locator('.action-panel').getByRole('button', { name: /星を買う/ }).click();
      await sleep(300);
      await ss(alice, 'alice', T, 'star-2-bought');

      const stars2 = await getStars(alice, aliceId);
      log(`  星2つ目: ★${stars2}`);
      expect(stars2).toBe(2);

      await clickAction(alice, /お買い物終了/);
      await sleep(200);
      const cd2 = alice.locator('.action-panel').getByRole('button', { name: /掃除終了/ });
      if (await cd2.count() > 0) await cd2.click();
      await sleep(200);
      await clickAction(alice, /ターン終了/);
      await sleep(200);

      await skipBobTurn(bob, T);

      // --- ターン3: 星3つ目購入 → 勝利 ---
      await debugSetCoins(alice, aliceId, 15);
      // うんちを0にしておく（バースト回避）
      await debugSetPoop(alice, aliceId, 0);
      await sleep(200);
      await ss(alice, 'alice', T, 'before-final-turn');

      await advanceToIncome(alice, T, 'alice', 1, 2);
      await resolveAllEffects(alice, bob);

      await alice.locator('.action-panel').getByRole('button', { name: /星を買う/ }).click();
      await sleep(300);
      await ss(alice, 'alice', T, 'star-3-bought');

      const stars3 = await getStars(alice, aliceId);
      log(`  星3つ目: ★${stars3}`);
      expect(stars3).toBe(3);

      // お買い物終了 → 掃除終了（うんち0なので不要だがフロー通り）
      await clickAction(alice, /お買い物終了/);
      await sleep(200);
      const cd3 = alice.locator('.action-panel').getByRole('button', { name: /掃除終了/ });
      if (await cd3.count() > 0) await cd3.click();
      await sleep(500);
      await ss(alice, 'alice', T, 'after-clean-phase');

      // 勝利モーダルが表示されるはず（掃除終了時にcheckWinが走る）
      const resultModal = alice.locator('.result-modal');
      await expect(resultModal).toBeVisible({ timeout: 10000 });
      await ssBoth(alice, bob, T, 'victory-modal');

      // 勝者がアリスであることを確認
      const winnerText = await resultModal.textContent();
      expect(winnerText).toContain('アリス');
      log(`  勝利モーダル表示: ${winnerText?.substring(0, 50)}...`);
      await ss(alice, 'alice', T, 'result-verified');

      log('OK 星3つで勝利');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  // ----------------------------------------------------------
  // 2. バースト: 星あり → 星-1, コイン・うんちリセット
  // ----------------------------------------------------------
  test('バースト(星あり): 星-1 + コイン・うんちリセット', async ({ browser }) => {
    const T = 'burst-star';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'burst1', T);
    try {
      await completeSetup(alice, bob, T);

      // アリスに星2, コイン10, うんち0を設定
      await debugSetStars(alice, aliceId, 2);
      await debugSetCoins(alice, aliceId, 10);
      await sleep(200);
      await ss(alice, 'alice', T, 'initial-state');

      // ターン: うんち→サイコロ→買物スキップ
      await advanceToIncome(alice, T, 'alice', 1, 2);
      await resolveAllEffects(alice, bob);
      await clickAction(alice, /お買い物終了/);
      await sleep(200);

      // うんちを7に設定（バースト閾値）
      await debugSetPoop(alice, aliceId, 7);
      await sleep(200);
      await ss(alice, 'alice', T, 'poop-set-to-7');

      const starsBefore = await getStars(alice, aliceId);
      const coinsBefore = await getCoins(alice, aliceId);
      log(`  バースト前: ★${starsBefore}, 💰${coinsBefore}, 💩7`);

      // 掃除終了 → バースト発動
      const cd = alice.locator('.action-panel').getByRole('button', { name: /掃除終了/ });
      await cd.click();
      await sleep(500);
      await ss(alice, 'alice', T, 'after-clean-burst');

      const starsAfter = await getStars(alice, aliceId);
      const coinsAfter = await getCoins(alice, aliceId);
      const poopAfter = await getPoop(alice, aliceId);
      log(`  バースト後: ★${starsAfter}, 💰${coinsAfter}, 💩${poopAfter}`);

      // 星-1
      expect(starsAfter).toBe(starsBefore - 1);
      // コイン・うんちリセット
      expect(coinsAfter).toBe(0);
      expect(poopAfter).toBe(0);

      await ss(alice, 'alice', T, 'burst-result-verified');
      log('OK バースト(星あり): 星-1 + リセット');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  // ----------------------------------------------------------
  // 3. バースト: 星なし → 最高コスト動物を市場に返却
  // ----------------------------------------------------------
  test('バースト(星なし): 最高コスト動物を返却 + リセット', async ({ browser }) => {
    const T = 'burst-animal';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'burst2', T);
    try {
      // レッサーパンダ(コスト0)→エリア1, ペンギン(コスト2)→エリア5
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 1], ['ペンギン', 5]],
      });

      // アシカ(コスト3)を購入 → エリア5にペンギンと同居(BLUE同士)
      await debugSetCoins(alice, aliceId, 10);
      await sleep(200);

      await advanceToIncome(alice, T, 'alice', 1, 2); // 空振り
      await resolveAllEffects(alice, bob);

      // アシカ購入
      const card = alice.locator('.market-card').filter({ hasText: 'カリフォルニアアシカ' });
      await card.click();
      await sleep(300);
      await alice.locator('.market-area .trade-option:not([disabled])').filter({ hasText: '#5' }).click();
      await sleep(300);
      await ss(alice, 'alice', T, 'sealion-bought');

      await clickAction(alice, /お買い物終了/);
      await sleep(200);

      const animalsBefore = await getAnimalCount(alice, aliceId);
      log(`  動物数(バースト前): ${animalsBefore}`);
      await ss(alice, 'alice', T, 'animals-before-burst');

      // 星0, うんち7に設定
      await debugSetStars(alice, aliceId, 0);
      await debugSetPoop(alice, aliceId, 7);
      await debugSetCoins(alice, aliceId, 5);
      await sleep(200);
      await ss(alice, 'alice', T, 'poop7-star0');

      const starsBefore = await getStars(alice, aliceId);
      log(`  バースト前: ★${starsBefore}, 動物${animalsBefore}匹, 💩7`);
      expect(starsBefore).toBe(0);

      // 掃除終了 → バースト発動
      const cd = alice.locator('.action-panel').getByRole('button', { name: /掃除終了/ });
      await cd.click();
      await sleep(500);
      await ss(alice, 'alice', T, 'after-burst');

      const starsAfter = await getStars(alice, aliceId);
      const coinsAfter = await getCoins(alice, aliceId);
      const poopAfter = await getPoop(alice, aliceId);
      const animalsAfter = await getAnimalCount(alice, aliceId);
      log(`  バースト後: ★${starsAfter}, 💰${coinsAfter}, 💩${poopAfter}, 動物${animalsAfter}匹`);

      // 星は0のまま（減らない）
      expect(starsAfter).toBe(0);
      // 最高コスト動物(アシカ, コスト3)が返却 → 動物数-1
      expect(animalsAfter).toBe(animalsBefore - 1);
      // コイン・うんちリセット
      expect(coinsAfter).toBe(0);
      expect(poopAfter).toBe(0);

      await ss(alice, 'alice', T, 'burst-animal-result-verified');
      log('OK バースト(星なし): 最高コスト動物返却 + リセット');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

});
