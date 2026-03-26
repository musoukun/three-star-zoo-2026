/**
 * E2E テスト: 動物の効果検証
 *
 * 前提: サーバー(port 2567) と クライアント(port 3000) が起動済み
 *
 * デバッグ用メッセージでサイコロの出目を固定し、
 * 各動物の効果が仕様通りに動作するか検証する。
 */
import { test, expect, type Page } from '@playwright/test';

const SS_DIR = 'e2e/screenshots/effects';
let ssIndex = 0;

// ===== ユーティリティ =====

function log(msg: string) {
  console.log(`[E2E-effects] ${msg}`);
}

/** スクリーンショット（テスト名プレフィックス付き） */
async function ss(page: Page, who: string, testName: string, label: string) {
  ssIndex++;
  const prefix = String(ssIndex).padStart(3, '0');
  const safe = `${testName}_${label}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
  await page.screenshot({ path: `${SS_DIR}/${prefix}_${who}_${safe}.png` });
  log(`  ss[${prefix}] ${who}: ${label}`);
}

/** 両方の画面をスクショ */
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

// デバッグコマンド
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

async function getSessionId(page: Page): Promise<string> {
  return await page.evaluate(() => (window as any).__colyseusRoom?.sessionId ?? '');
}

async function getCoins(page: Page, sessionId: string): Promise<number> {
  return await page.evaluate((sid) => {
    const room = (window as any).__colyseusRoom;
    const p = room?.state?.players?.get(sid);
    return p ? p.coins : -1;
  }, sessionId);
}

async function getStars(page: Page, sessionId: string): Promise<number> {
  return await page.evaluate((sid) => {
    const room = (window as any).__colyseusRoom;
    const p = room?.state?.players?.get(sid);
    return p ? p.stars : -1;
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

// ===== ゲームセットアップ共通 =====

interface GameContext {
  alice: Page;
  bob: Page;
  aliceId: string;
  bobId: string;
}

async function startGame(browser: any, roomSuffix: string, testName: string): Promise<GameContext & { ctxAlice: any; ctxBob: any }> {
  const ctxAlice = await browser.newContext();
  const ctxBob = await browser.newContext();
  const alice = await ctxAlice.newPage();
  const bob = await ctxBob.newPage();

  await alice.goto('/');
  await ss(alice, 'alice', testName, '01-lobby');

  await alice.fill('input[placeholder="名前を入力..."]', 'アリス');
  await alice.getByRole('button', { name: /ルームを作成/ }).first().click();
  await alice.fill('input[placeholder="部屋の名前..."]', `効果テスト_${roomSuffix}`);
  await alice.getByRole('button', { name: /作成して入室/ }).first().click();
  await sleep(500);
  await ss(alice, 'alice', testName, '02-room-created');

  await bob.goto('/');
  await bob.fill('input[placeholder="名前を入力..."]', 'ボブ');
  await sleep(2000);
  await ss(bob, 'bob', testName, '03-room-list');

  const targetRoom = bob.locator('div')
    .filter({ hasText: new RegExp(`効果テスト_${roomSuffix}`) })
    .filter({ has: bob.getByRole('button', { name: '入室 →' }) })
    .last();
  await targetRoom.getByRole('button', { name: '入室 →' }).click();
  await sleep(500);
  await ssBoth(alice, bob, testName, '04-both-joined');

  await alice.getByText('ボブ', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  const startBtn = alice.getByRole('button', { name: /ゲーム開始 \(2人で対戦\)/ });
  await startBtn.waitFor({ state: 'visible', timeout: 5000 });
  await startBtn.click();
  await sleep(500);
  await ssBoth(alice, bob, testName, '05-game-started');

  const aliceId = await getSessionId(alice);
  const bobId = await getSessionId(bob);
  log(`  aliceId=${aliceId}, bobId=${bobId}`);

  return { alice, bob, aliceId, bobId, ctxAlice, ctxBob };
}

async function completeSetup(alice: Page, bob: Page, testName: string, placements?: {
  alice?: [string, number][];
  bob?: [string, number][];
}) {
  const alicePlacements = placements?.alice ?? [['レッサーパンダ', 1], ['ペンギン', 2]];
  const bobPlacements = placements?.bob ?? [['レッサーパンダ', 1], ['ペンギン', 2]];

  await alice.locator('.cage-place-btn').first().waitFor({ state: 'visible', timeout: 5000 });
  for (const [animal, cage] of alicePlacements) {
    await placeAnimalInCage(alice, animal, cage);
    await sleep(300);
    await ss(alice, 'alice', testName, `setup-${animal}-cage${cage}`);
  }

  await bob.locator('.cage-place-btn').first().waitFor({ state: 'visible', timeout: 5000 });
  for (const [animal, cage] of bobPlacements) {
    await placeAnimalInCage(bob, animal, cage);
    await sleep(300);
    await ss(bob, 'bob', testName, `setup-${animal}-cage${cage}`);
  }

  await sleep(500);
  await ssBoth(alice, bob, testName, 'setup-complete');
}

/** 動物購入の共通ヘルパー */
async function buyAnimal(page: Page, testName: string, animalName: string, cageNum: number) {
  const card = page.locator('.market-card').filter({ hasText: animalName });
  await card.click();
  await sleep(300);
  await ss(page, 'alice', testName, `buy-${animalName}-select`);

  const cageOpt = page.locator('.market-area .trade-option:not([disabled])').filter({ hasText: `#${cageNum}` });
  if (await cageOpt.count() > 0) {
    await cageOpt.click();
  } else {
    await page.locator('.market-area .trade-option:not([disabled])').first().click();
  }
  await sleep(300);
  await ss(page, 'alice', testName, `buy-${animalName}-placed`);
}

async function advanceToIncome(activePage: Page, testName: string, who: string, dice1: number, dice2: number, diceCount: 1 | 2 = 2) {
  await clickAction(activePage, /うんちを受け取る/);
  await sleep(200);
  await ss(activePage, who, testName, 'poop-received');

  await debugSetDice(activePage, [dice1, dice2]);

  if (diceCount === 1) {
    await clickAction(activePage, /1個振り/);
  } else {
    await clickAction(activePage, /2個振り/);
  }
  await sleep(300);
  await ss(activePage, who, testName, `dice-${dice1}+${dice2}=${dice1 + dice2}`);
}

async function finishTurn(activePage: Page, testName: string, who: string) {
  await clickAction(activePage, /お買い物終了/);
  await sleep(200);
  await ss(activePage, who, testName, 'trade-end');

  const cleanDone = activePage.locator('.action-panel').getByRole('button', { name: /掃除終了/ });
  if (await cleanDone.count() > 0) {
    await cleanDone.click();
    await sleep(200);
  }
  await ss(activePage, who, testName, 'clean-end');

  await clickAction(activePage, /ターン終了/);
  await sleep(200);
  await ss(activePage, who, testName, 'turn-end');
}

/** 購入ターン（空振りサイコロ→購入→ターン終了） */
async function buyTurn(page: Page, testName: string, who: string, animalName: string, cageNum: number) {
  await advanceToIncome(page, testName, who, 1, 2, 2); // 合計3（空振り）
  await buyAnimal(page, testName, animalName, cageNum);
  await clickAction(page, /お買い物終了/);
  await sleep(200);
  const cd = page.locator('.action-panel').getByRole('button', { name: /掃除終了/ });
  if (await cd.count() > 0) await cd.click();
  await sleep(200);
  await clickAction(page, /ターン終了/);
  await sleep(200);
  await ss(page, who, testName, `bought-${animalName}`);
}

/** ボブのターンをスキップ */
async function skipBobTurn(bob: Page, testName: string) {
  await advanceToIncome(bob, testName, 'bob', 1, 2, 2);
  await finishTurn(bob, testName, 'bob');
}

// =============================================================
// テスト
// =============================================================

test.describe('動物効果テスト', () => {

  // ----------------------------------------------------------
  // 1. バンドウイルカ — choice: 銀行7コイン or 5コイン奪取
  // ----------------------------------------------------------
  test('バンドウイルカ: choice効果 — 銀行から7コインを選択', async ({ browser }) => {
    const T = 'dolphin-bank';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'dolphin1', T);
    try {
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 1], ['ペンギン', 7]],
      });

      await debugSetCoins(alice, aliceId, 20);
      await sleep(200);

      // ターン1: 空振り→ターン終了
      await advanceToIncome(alice, T, 'alice', 1, 2, 2);
      await finishTurn(alice, T, 'alice');
      await skipBobTurn(bob, T);

      // ターン2: イルカ購入
      await debugSetCoins(alice, aliceId, 20);
      await sleep(200);
      await buyTurn(alice, T, 'alice', 'バンドウイルカ', 7);
      await skipBobTurn(bob, T);

      // === 本番テスト: イルカ発動 ===
      const coinsBefore = await getCoins(alice, aliceId);
      log(`  イルカ発動前コイン: ${coinsBefore}`);
      await ss(alice, 'alice', T, 'before-effect');

      await advanceToIncome(alice, T, 'alice', 3, 4, 2); // 合計7

      // choice UI表示
      const choiceUI = alice.locator('.trade-submenu').first();
      await expect(choiceUI).toBeVisible({ timeout: 5000 });
      await ss(alice, 'alice', T, 'choice-ui-visible');

      const creationBtn = alice.locator('.trade-option').filter({ hasText: '7コイン獲得' }).first();
      await expect(creationBtn).toBeVisible();
      const stealSection = alice.locator('.trade-submenu').filter({ hasText: '5コイン奪取' }).first();
      await expect(stealSection).toBeVisible();
      await ss(alice, 'alice', T, 'choice-options-verified');

      // 「7コイン獲得」を選択
      await creationBtn.click();
      await sleep(300);
      await ss(alice, 'alice', T, 'after-creation-choice');

      const coinsAfter = await getCoins(alice, aliceId);
      // イルカ+7(choice), ペンギン+1(global, 同エリア7) = +8
      log(`  イルカ発動後コイン: ${coinsAfter} (期待: ${coinsBefore}+8=${coinsBefore + 8})`);
      expect(coinsAfter).toBe(coinsBefore + 8);
      await ss(alice, 'alice', T, 'result-verified');

      log('OK バンドウイルカ: 銀行7コイン選択');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  test('バンドウイルカ: choice効果 — 他プレイヤーから5コイン奪取', async ({ browser }) => {
    const T = 'dolphin-steal';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'dolphin2', T);
    try {
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 1], ['ペンギン', 7]],
      });

      await debugSetCoins(alice, aliceId, 20);
      await sleep(200);
      await buyTurn(alice, T, 'alice', 'バンドウイルカ', 7);
      await skipBobTurn(bob, T);

      await debugSetCoins(alice, bobId, 10);
      await sleep(200);

      const aliceCoinsBefore = await getCoins(alice, aliceId);
      const bobCoinsBefore = await getCoins(alice, bobId);
      log(`  発動前 アリス=${aliceCoinsBefore}, ボブ=${bobCoinsBefore}`);
      await ss(alice, 'alice', T, 'before-effect');

      await advanceToIncome(alice, T, 'alice', 3, 4, 2);

      await expect(alice.locator('.trade-submenu').first()).toBeVisible({ timeout: 5000 });
      await ss(alice, 'alice', T, 'choice-ui');

      // 奪取選択: ボブ
      const stealBtn = alice.locator('.trade-option').filter({ hasText: 'ボブ' }).first();
      await stealBtn.click();
      await sleep(300);
      await ss(alice, 'alice', T, 'after-steal');

      const aliceCoinsAfter = await getCoins(alice, aliceId);
      const bobCoinsAfter = await getCoins(alice, bobId);
      // イルカ+5(steal), ペンギン+1(global, 同エリア7) = +6
      log(`  発動後 アリス=${aliceCoinsAfter}, ボブ=${bobCoinsAfter}`);
      expect(aliceCoinsAfter).toBe(aliceCoinsBefore + 5 + 1);
      expect(bobCoinsAfter).toBe(bobCoinsBefore - 5);
      await ssBoth(alice, bob, T, 'result-verified');

      log('OK バンドウイルカ: 5コイン奪取');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  test('バンドウイルカ: 奪取 — 相手コイン不足時は支払える分だけ', async ({ browser }) => {
    const T = 'dolphin-partial';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'dolphin3', T);
    try {
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 1], ['ペンギン', 7]],
      });

      await debugSetCoins(alice, aliceId, 20);
      await sleep(200);
      await buyTurn(alice, T, 'alice', 'バンドウイルカ', 7);
      await skipBobTurn(bob, T);

      // ボブのコインを2に（5未満）
      await debugSetCoins(alice, bobId, 2);
      await sleep(200);

      const aliceCoinsBefore = await getCoins(alice, aliceId);
      await ss(alice, 'alice', T, 'before-effect-bob2coins');

      await advanceToIncome(alice, T, 'alice', 3, 4, 2);
      await expect(alice.locator('.trade-submenu').first()).toBeVisible({ timeout: 5000 });
      await ss(alice, 'alice', T, 'choice-ui');

      await alice.locator('.trade-option').filter({ hasText: 'ボブ' }).first().click();
      await sleep(300);
      await ss(alice, 'alice', T, 'after-steal-partial');

      const aliceCoinsAfter = await getCoins(alice, aliceId);
      const bobCoinsAfter = await getCoins(alice, bobId);
      // イルカ+2(steal, ボブは2しか持ってない), ペンギン+1(global) = +3
      log(`  コイン不足: アリス ${aliceCoinsBefore}→${aliceCoinsAfter}, ボブ 2→${bobCoinsAfter}`);
      expect(aliceCoinsAfter).toBe(aliceCoinsBefore + 2 + 1);
      expect(bobCoinsAfter).toBe(0);
      await ss(alice, 'alice', T, 'result-verified');

      log('OK バンドウイルカ: コイン不足時は支払える分だけ');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  // ----------------------------------------------------------
  // 2. コンゴウインコ — global, +1コイン
  // ----------------------------------------------------------
  test('コンゴウインコ: 誰のターンでも1コイン獲得', async ({ browser }) => {
    const T = 'lovebird';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'lovebird', T);
    try {
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 5], ['ペンギン', 2]],
      });

      await debugSetCoins(alice, aliceId, 10);
      await sleep(200);
      await buyTurn(alice, T, 'alice', 'コンゴウインコ', 5);
      await skipBobTurn(bob, T);

      // === アリスのターンでエリア5 ===
      const coinsBefore = await getCoins(alice, aliceId);
      await ss(alice, 'alice', T, 'before-alice-turn');
      await advanceToIncome(alice, T, 'alice', 2, 3, 2); // 合計5
      await sleep(300);
      await ss(alice, 'alice', T, 'after-alice-roll');

      const coinsAfter = await getCoins(alice, aliceId);
      log(`  アリスターン: ${coinsBefore} → ${coinsAfter} (期待: +2 = インコ+1, レッサーパンダ+1)`);
      expect(coinsAfter).toBe(coinsBefore + 2);
      await finishTurn(alice, T, 'alice');

      // === ボブのターンでもglobal ===
      const coinsBeforeBob = await getCoins(alice, aliceId);
      await ss(alice, 'alice', T, 'before-bob-turn');
      await advanceToIncome(bob, T, 'bob', 2, 3, 2);
      await sleep(300);
      await ssBoth(alice, bob, T, 'after-bob-roll-global');

      const coinsAfterBob = await getCoins(alice, aliceId);
      log(`  ボブターン: アリスコイン ${coinsBeforeBob} → ${coinsAfterBob} (期待: +1 = インコglobal)`);
      expect(coinsAfterBob).toBe(coinsBeforeBob + 1);

      log('OK コンゴウインコ: global +1コイン');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  // ----------------------------------------------------------
  // 3. レッサーパンダ — self, 頭数×1 + パンダボーナス
  // ----------------------------------------------------------
  test('レッサーパンダ: 頭数×1コイン, self-only', async ({ browser }) => {
    const T = 'ressa';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'ressa', T);
    try {
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 5], ['ペンギン', 2]],
      });

      // レッサーパンダ1匹 → +1
      const coins1Before = await getCoins(alice, aliceId);
      await ss(alice, 'alice', T, 'before-alice-turn');
      await advanceToIncome(alice, T, 'alice', 2, 3, 2);
      await sleep(300);
      await ss(alice, 'alice', T, 'after-roll-ressa1');
      const coins1After = await getCoins(alice, aliceId);
      log(`  レッサーパンダ1匹: ${coins1Before} → ${coins1After} (期待: +1)`);
      expect(coins1After).toBe(coins1Before + 1);
      await finishTurn(alice, T, 'alice');

      // ボブのターン: global:false → 発動しない
      const bobTurnCoins = await getCoins(alice, aliceId);
      await advanceToIncome(bob, T, 'bob', 2, 3, 2);
      await sleep(300);
      await ssBoth(alice, bob, T, 'bob-turn-ressa-no-effect');
      const bobTurnCoinsAfter = await getCoins(alice, aliceId);
      log(`  ボブターン: ${bobTurnCoins} → ${bobTurnCoinsAfter} (期待: +0)`);
      expect(bobTurnCoinsAfter).toBe(bobTurnCoins);
      await finishTurn(bob, T, 'bob');

      log('OK レッサーパンダ: self-only');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  // ----------------------------------------------------------
  // 4. ペンギン — global, 1羽=1, 2羽以上=3
  // ----------------------------------------------------------
  test('ペンギン: 1羽で1コイン / 2羽以上で3コイン', async ({ browser }) => {
    const T = 'penguin';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'penguin', T);
    try {
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 1], ['ペンギン', 5]],
      });

      // 1羽 → +1
      const coins1Before = await getCoins(alice, aliceId);
      await advanceToIncome(alice, T, 'alice', 2, 3, 2);
      await sleep(300);
      await ss(alice, 'alice', T, 'penguin-1-roll');
      const coins1After = await getCoins(alice, aliceId);
      log(`  ペンギン1羽: ${coins1Before} → ${coins1After} (期待: +1)`);
      expect(coins1After).toBe(coins1Before + 1);
      await finishTurn(alice, T, 'alice');

      // ボブターン: global +1
      const aliceCoinsB = await getCoins(alice, aliceId);
      await advanceToIncome(bob, T, 'bob', 2, 3, 2);
      await sleep(300);
      await ss(alice, 'alice', T, 'penguin-global-bob');
      expect(await getCoins(alice, aliceId)).toBe(aliceCoinsB + 1);
      await finishTurn(bob, T, 'bob');

      // 2羽目購入
      await debugSetCoins(alice, aliceId, 10);
      await sleep(200);
      await buyTurn(alice, T, 'alice', 'ペンギン', 4);
      await skipBobTurn(bob, T);

      // 2羽 → +3
      const coins2Before = await getCoins(alice, aliceId);
      await advanceToIncome(alice, T, 'alice', 2, 3, 2);
      await sleep(300);
      await ss(alice, 'alice', T, 'penguin-2-roll');
      const coins2After = await getCoins(alice, aliceId);
      log(`  ペンギン2羽: ${coins2Before} → ${coins2After} (期待: +3)`);
      expect(coins2After).toBe(coins2Before + 3);
      await ss(alice, 'alice', T, 'penguin-2-result');

      log('OK ペンギン: 1羽=1, 2羽=3');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  // ----------------------------------------------------------
  // 5. ライオン — global steal, 1頭=1, 2頭以上=3
  // ----------------------------------------------------------
  test('ライオン: 1頭で1コイン奪取 / global', async ({ browser }) => {
    const T = 'lion';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'lion', T);
    try {
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 5], ['ペンギン', 2]],
      });

      await debugSetCoins(alice, aliceId, 10);
      await sleep(200);
      await buyTurn(alice, T, 'alice', 'ライオン', 5);
      await skipBobTurn(bob, T);

      await debugSetCoins(alice, bobId, 10);
      await sleep(200);
      const aliceBefore = await getCoins(alice, aliceId);
      await ss(alice, 'alice', T, 'before-lion-effect');

      await advanceToIncome(alice, T, 'alice', 2, 3, 2);

      const stealUI = alice.locator('.trade-submenu').filter({ hasText: 'コイン奪取' }).first();
      await expect(stealUI).toBeVisible({ timeout: 5000 });
      await ss(alice, 'alice', T, 'lion-steal-ui');

      await alice.locator('.trade-option').filter({ hasText: 'ボブ' }).first().click();
      await sleep(300);
      await ss(alice, 'alice', T, 'lion-after-steal');

      const aliceAfter = await getCoins(alice, aliceId);
      const bobAfter = await getCoins(alice, bobId);
      log(`  ライオン1頭: アリス ${aliceBefore}→${aliceAfter} (+steal1 +ressa1), ボブ 10→${bobAfter}`);
      expect(aliceAfter).toBe(aliceBefore + 1 + 1);
      expect(bobAfter).toBe(10 - 1);
      await ss(alice, 'alice', T, 'result-verified');

      log('OK ライオン: 1頭=1コイン奪取');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  // ----------------------------------------------------------
  // 6. ジャイアントパンダ — global, 頭数×2
  // ----------------------------------------------------------
  test('ジャイアントパンダ: 頭数×2コイン / global', async ({ browser }) => {
    const T = 'gpanda';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'gpanda', T);
    try {
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 1], ['ペンギン', 2]],
      });

      await debugSetCoins(alice, aliceId, 10);
      await sleep(200);
      await buyTurn(alice, T, 'alice', 'ジャイアントパンダ', 5);
      await skipBobTurn(bob, T);

      // 1頭 → +2
      const coinsBefore = await getCoins(alice, aliceId);
      await advanceToIncome(alice, T, 'alice', 2, 3, 2);
      await sleep(300);
      await ss(alice, 'alice', T, 'gpanda-1-roll');
      const coinsAfter = await getCoins(alice, aliceId);
      log(`  パンダ1頭: ${coinsBefore} → ${coinsAfter} (期待: +2)`);
      expect(coinsAfter).toBe(coinsBefore + 2);
      await finishTurn(alice, T, 'alice');

      // ボブターン global → +2
      const coinsBob = await getCoins(alice, aliceId);
      await advanceToIncome(bob, T, 'bob', 2, 3, 2);
      await sleep(300);
      await ss(alice, 'alice', T, 'gpanda-global-bob');
      const coinsBob2 = await getCoins(alice, aliceId);
      log(`  ボブターン(global): ${coinsBob} → ${coinsBob2} (期待: +2)`);
      expect(coinsBob2).toBe(coinsBob + 2);

      log('OK ジャイアントパンダ: 頭数×2, global');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  // ----------------------------------------------------------
  // 7. カリフォルニアアシカ — self: 3コイン + 2奪取
  // ----------------------------------------------------------
  test('カリフォルニアアシカ: 3コイン + 2コイン奪取', async ({ browser }) => {
    const T = 'sealion';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'sealion', T);
    try {
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 1], ['ペンギン', 5]],
      });

      await debugSetCoins(alice, aliceId, 10);
      await sleep(200);
      await buyTurn(alice, T, 'alice', 'カリフォルニアアシカ', 5);
      await skipBobTurn(bob, T);

      await debugSetCoins(alice, bobId, 10);
      await sleep(200);
      const aliceBefore = await getCoins(alice, aliceId);
      await ss(alice, 'alice', T, 'before-sealion-effect');

      await advanceToIncome(alice, T, 'alice', 2, 3, 2);

      const stealUI = alice.locator('.trade-submenu').filter({ hasText: 'コイン奪取' }).first();
      await expect(stealUI).toBeVisible({ timeout: 5000 });
      await ss(alice, 'alice', T, 'sealion-steal-ui');

      await alice.locator('.trade-option').filter({ hasText: 'ボブ' }).first().click();
      await sleep(300);
      await ss(alice, 'alice', T, 'sealion-after-steal');

      const aliceAfter = await getCoins(alice, aliceId);
      const bobAfter = await getCoins(alice, bobId);
      log(`  アシカ: アリス ${aliceBefore}→${aliceAfter} (期待: +6), ボブ 10→${bobAfter}`);
      expect(aliceAfter).toBe(aliceBefore + 1 + 3 + 2); // penguin+1, sealion+3, steal+2
      expect(bobAfter).toBe(10 - 2);
      await ss(alice, 'alice', T, 'result-verified');

      log('OK カリフォルニアアシカ: 3+2コイン');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  // ----------------------------------------------------------
  // 8. アミメキリン — global: 3コイン + 隣接1コイン
  // ----------------------------------------------------------
  test('アミメキリン: 3コイン + 隣接ボーナス1コイン', async ({ browser }) => {
    const T = 'giraffe';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'giraffe', T);
    try {
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 5], ['ペンギン', 2]],
      });

      await debugSetCoins(alice, aliceId, 10);
      await sleep(200);
      await buyTurn(alice, T, 'alice', 'アミメキリン', 5);
      await skipBobTurn(bob, T);

      // 直撃: エリア5 → キリン+3, レッサーパンダ+1 = +4
      const coins1Before = await getCoins(alice, aliceId);
      await advanceToIncome(alice, T, 'alice', 2, 3, 2);
      await sleep(300);
      await ss(alice, 'alice', T, 'giraffe-direct-hit');
      const coins1After = await getCoins(alice, aliceId);
      log(`  直撃: ${coins1Before} → ${coins1After} (期待: +4)`);
      expect(coins1After).toBe(coins1Before + 3 + 1);
      await finishTurn(alice, T, 'alice');
      await skipBobTurn(bob, T);

      // 隣接: エリア4 → 隣接ボーナス+1のみ
      const coins2Before = await getCoins(alice, aliceId);
      await advanceToIncome(alice, T, 'alice', 1, 3, 2); // 合計4
      await sleep(300);
      await ss(alice, 'alice', T, 'giraffe-adjacent');
      const coins2After = await getCoins(alice, aliceId);
      log(`  隣接: ${coins2Before} → ${coins2After} (期待: +1)`);
      expect(coins2After).toBe(coins2Before + 1);
      await ss(alice, 'alice', T, 'giraffe-result');

      log('OK アミメキリン: 直撃3 + 隣接1');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  // ----------------------------------------------------------
  // 9. チーター — global end: 3コイン
  // ----------------------------------------------------------
  test('チーター: end timing で3コイン', async ({ browser }) => {
    const T = 'cheetah';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'cheetah', T);
    try {
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 5], ['ペンギン', 2]],
      });

      await debugSetCoins(alice, aliceId, 10);
      await sleep(200);
      await buyTurn(alice, T, 'alice', 'チーター', 5);
      await skipBobTurn(bob, T);

      // レッサーパンダ(first)+1, チーター(end)+3 = +4
      const coinsBefore = await getCoins(alice, aliceId);
      await advanceToIncome(alice, T, 'alice', 2, 3, 2);
      await sleep(300);
      await ss(alice, 'alice', T, 'cheetah-effect');
      const coinsAfter = await getCoins(alice, aliceId);
      log(`  チーター: ${coinsBefore} → ${coinsAfter} (期待: +4)`);
      expect(coinsAfter).toBe(coinsBefore + 1 + 3);
      await finishTurn(alice, T, 'alice');

      // ボブターン global → +3のみ
      const coinsB = await getCoins(alice, aliceId);
      await advanceToIncome(bob, T, 'bob', 2, 3, 2);
      await sleep(300);
      await ss(alice, 'alice', T, 'cheetah-global-bob');
      const coinsB2 = await getCoins(alice, aliceId);
      log(`  ボブターン(global): ${coinsB} → ${coinsB2} (期待: +3)`);
      expect(coinsB2).toBe(coinsB + 3);

      log('OK チーター: end timing 3コイン, global');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  // ----------------------------------------------------------
  // 10. ミナミシロサイ — self: 星1つ奪取
  // ----------------------------------------------------------
  test('ミナミシロサイ: 星1つ奪取 / 星なし時は奪取不可', async ({ browser }) => {
    const T = 'rhino';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'rhino', T);
    try {
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 5], ['ペンギン', 2]],
      });

      await debugSetCoins(alice, aliceId, 10);
      await sleep(200);
      await buyTurn(alice, T, 'alice', 'ミナミシロサイ', 5);
      await skipBobTurn(bob, T);

      // ボブに星2を設定
      await debugSetStars(alice, bobId, 2);
      await sleep(200);

      const aliceStarsBefore = await getStars(alice, aliceId);
      await ss(alice, 'alice', T, 'before-rhino-effect');

      await advanceToIncome(alice, T, 'alice', 2, 3, 2);

      const stealUI = alice.locator('.trade-submenu').filter({ hasText: '星奪取' }).first();
      await expect(stealUI).toBeVisible({ timeout: 5000 });
      await ss(alice, 'alice', T, 'rhino-stealstar-ui');

      await alice.locator('.trade-option').filter({ hasText: 'ボブ' }).first().click();
      await sleep(300);
      await ss(alice, 'alice', T, 'rhino-after-steal');

      const aliceStarsAfter = await getStars(alice, aliceId);
      const bobStarsAfter = await getStars(alice, bobId);
      log(`  サイ: アリス星 ${aliceStarsBefore}→${aliceStarsAfter}, ボブ星 2→${bobStarsAfter}`);
      expect(aliceStarsAfter).toBe(aliceStarsBefore + 1);
      expect(bobStarsAfter).toBe(1);
      await finishTurn(alice, T, 'alice');

      // 星0から奪取 → 変化なし
      await debugSetStars(alice, bobId, 0);
      await sleep(200);
      await skipBobTurn(bob, T);

      const aliceStars2Before = await getStars(alice, aliceId);
      await advanceToIncome(alice, T, 'alice', 2, 3, 2);

      const stealUI2 = alice.locator('.trade-submenu').filter({ hasText: '星奪取' }).first();
      await expect(stealUI2).toBeVisible({ timeout: 5000 });
      await ss(alice, 'alice', T, 'rhino-steal-0star');
      await alice.locator('.trade-option').filter({ hasText: 'ボブ' }).first().click();
      await sleep(300);
      await ss(alice, 'alice', T, 'rhino-after-steal-0star');

      const aliceStars2After = await getStars(alice, aliceId);
      log(`  星0から奪取: ${aliceStars2Before}→${aliceStars2After} (変化なし)`);
      expect(aliceStars2After).toBe(aliceStars2Before);

      log('OK ミナミシロサイ: 星奪取 + 星0時変化なし');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

  // ----------------------------------------------------------
  // 11. アフリカゾウ — global: 7コイン
  // ----------------------------------------------------------
  test('アフリカゾウ: 7コイン / global', async ({ browser }) => {
    const T = 'elephant';
    const { alice, bob, aliceId, bobId, ctxAlice, ctxBob } = await startGame(browser, 'elephant', T);
    try {
      await completeSetup(alice, bob, T, {
        alice: [['レッサーパンダ', 5], ['ペンギン', 2]],
      });

      await debugSetCoins(alice, aliceId, 10);
      await sleep(200);
      await buyTurn(alice, T, 'alice', 'アフリカゾウ', 5);
      await skipBobTurn(bob, T);

      // ゾウ+7, レッサーパンダ+1 = +8
      const coinsBefore = await getCoins(alice, aliceId);
      await ss(alice, 'alice', T, 'before-elephant');
      await advanceToIncome(alice, T, 'alice', 2, 3, 2);
      await sleep(300);
      await ss(alice, 'alice', T, 'elephant-effect');
      const coinsAfter = await getCoins(alice, aliceId);
      log(`  ゾウ: ${coinsBefore} → ${coinsAfter} (期待: +8)`);
      expect(coinsAfter).toBe(coinsBefore + 7 + 1);
      await finishTurn(alice, T, 'alice');

      // ボブターン global → +7
      const coinsB = await getCoins(alice, aliceId);
      await advanceToIncome(bob, T, 'bob', 2, 3, 2);
      await sleep(300);
      await ss(alice, 'alice', T, 'elephant-global-bob');
      const coinsB2 = await getCoins(alice, aliceId);
      log(`  ボブターン(global): ${coinsB} → ${coinsB2} (期待: +7)`);
      expect(coinsB2).toBe(coinsB + 7);
      await ssBoth(alice, bob, T, 'result');

      log('OK アフリカゾウ: 7コイン, global');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
    }
  });

});
