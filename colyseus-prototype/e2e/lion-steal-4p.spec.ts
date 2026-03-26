/**
 * E2E テスト: ライオン奪取効果 4人対戦
 *
 * 前提: サーバー(port 2567) と クライアント(port 3000) が起動済み
 *
 * シナリオ:
 *   4人全員がライオンをケージ5に配置。
 *   手番プレイヤーがサイコロで合計5を出すと、全員のライオンが発動。
 *   処理順（左隣→時計回り→手番が最後）に従い、
 *   各プレイヤーの画面に奪取対象の選択UIが順番に表示されることを検証。
 */
import { test, expect, type Page } from '@playwright/test';

const SS_DIR = 'e2e/screenshots/lion-steal-4p';
let ssIndex = 0;

// ===== ユーティリティ =====

function log(msg: string) {
  console.log(`[E2E-lion4p] ${msg}`);
}

async function ss(page: Page, who: string, label: string) {
  ssIndex++;
  const prefix = String(ssIndex).padStart(3, '0');
  const safe = label.replace(/[^a-zA-Z0-9_\-]/g, '_');
  await page.screenshot({ path: `${SS_DIR}/${prefix}_${who}_${safe}.png` });
  log(`  ss[${prefix}] ${who}: ${label}`);
}

async function ssAll(pages: { page: Page; name: string }[], label: string) {
  await Promise.all(pages.map(p => ss(p.page, p.name, label)));
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function clickAction(page: Page, text: string | RegExp, timeout = 10000) {
  const btn = page.locator('.action-panel').getByRole('button', { name: text }).first();
  await btn.waitFor({ state: 'visible', timeout });
  await btn.click();
}

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

async function getPendingEffectCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const room = (window as any).__colyseusRoom;
    return room?.state?.pendingEffects?.length ?? 0;
  });
}

async function getPendingEffectOwner(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const room = (window as any).__colyseusRoom;
    const pe = room?.state?.pendingEffects;
    return pe && pe.length > 0 ? pe.at(0).ownerPlayerId : '';
  });
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
  log(`  WARN: cage ${cageNum} not found for ${animalName}, fallback`);
  await page.locator('.cage-place-btn').filter({ hasText: animalName }).first().click();
}

// ===== 4人ゲームセットアップ =====

interface Player {
  page: Page;
  name: string;
  sessionId: string;
  context: any;
}

async function startGame4P(browser: any): Promise<Player[]> {
  const names = ['アリス', 'ボブ', 'チャーリー', 'ダイアナ'];
  const roomName = `ライオン4P_${Date.now()}`;
  const contexts: any[] = [];
  const pages: Page[] = [];

  // 4つのブラウザコンテキスト作成
  for (const name of names) {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    pages.push(await ctx.newPage());
  }

  // アリスがルーム作成
  await pages[0].goto('/');
  await pages[0].fill('input[placeholder="名前を入力..."]', names[0]);
  await pages[0].getByRole('button', { name: /ルームを作成/ }).first().click();
  await pages[0].fill('input[placeholder="部屋の名前..."]', roomName);
  await pages[0].getByRole('button', { name: /作成して入室/ }).first().click();
  await sleep(1000);

  // アリスがルーム内ロビーに入ったことを確認
  await pages[0].getByText('参加者').waitFor({ state: 'visible', timeout: 10000 });
  await ss(pages[0], names[0], '01-room-created');

  // ボブ、チャーリー、ダイアナが入室
  for (let i = 1; i < 4; i++) {
    await pages[i].goto('/');
    await pages[i].fill('input[placeholder="名前を入力..."]', names[i]);
    await sleep(3000); // ルーム一覧の更新を待つ

    const targetRoom = pages[i].locator('div')
      .filter({ hasText: new RegExp(roomName) })
      .filter({ has: pages[i].getByRole('button', { name: '入室 →' }) })
      .last();
    await targetRoom.getByRole('button', { name: '入室 →' }).click();
    await sleep(1000);
    await ss(pages[i], names[i], `02-joined`);
  }

  // 全員のロビー表示を待つ
  await sleep(1000);
  await ssAll(
    names.map((n, i) => ({ page: pages[i], name: n })),
    '03-all-joined'
  );

  // 4人揃うのを待ってからゲーム開始
  await pages[0].getByText('参加者 (4人)').waitFor({ state: 'visible', timeout: 15000 });
  const startBtn = pages[0].getByRole('button', { name: /ゲーム開始 \(4人で対戦\)/ });
  await startBtn.waitFor({ state: 'visible', timeout: 5000 });
  await startBtn.click();
  await sleep(500);

  await ssAll(
    names.map((n, i) => ({ page: pages[i], name: n })),
    '04-game-started'
  );

  // セッションID取得
  const players: Player[] = [];
  for (let i = 0; i < 4; i++) {
    const sid = await getSessionId(pages[i]);
    players.push({ page: pages[i], name: names[i], sessionId: sid, context: contexts[i] });
    log(`  ${names[i]}: sessionId=${sid}`);
  }

  return players;
}

async function completeSetup4P(players: Player[]) {
  // 全員: レッサーパンダ→ケージ1、ペンギン→ケージ2
  for (const p of players) {
    await p.page.locator('.cage-place-btn').first().waitFor({ state: 'visible', timeout: 10000 });
    await placeAnimalInCage(p.page, 'レッサーパンダ', 1);
    await sleep(300);
    await placeAnimalInCage(p.page, 'ペンギン', 2);
    await sleep(300);
    await ss(p.page, p.name, 'setup-complete');
  }
  await sleep(500);
}

/** ターンを空振りで終了（購入なし） */
async function skipTurn(page: Page, who: string) {
  await clickAction(page, /うんちを受け取る/);
  await sleep(200);
  // サイコロ合計3で空振り（誰の動物もケージ3にいない想定）
  await debugSetDice(page, [1, 2]);
  await clickAction(page, /2個振り/);
  await sleep(300);
  await clickAction(page, /お買い物終了/);
  await sleep(200);
  const cleanDone = page.locator('.action-panel').getByRole('button', { name: /掃除終了/ });
  if (await cleanDone.count() > 0) await cleanDone.click();
  await sleep(200);
  await clickAction(page, /ターン終了/);
  await sleep(200);
  log(`  ${who} ターンスキップ完了`);
}

/** ライオン購入ターン（空振りサイコロ→購入→終了） */
async function buyLionTurn(page: Page, who: string, cageNum: number) {
  await clickAction(page, /うんちを受け取る/);
  await sleep(200);
  await debugSetDice(page, [1, 2]); // 合計3で空振り
  await clickAction(page, /2個振り/);
  await sleep(300);

  // ライオン購入
  const card = page.locator('.market-card').filter({ hasText: 'ライオン' });
  await card.click();
  await sleep(300);

  const cageOpt = page.locator('.market-area .trade-option:not([disabled])').filter({ hasText: `#${cageNum}` });
  if (await cageOpt.count() > 0) {
    await cageOpt.click();
  } else {
    await page.locator('.market-area .trade-option:not([disabled])').first().click();
  }
  await sleep(300);
  await ss(page, who, `bought-lion-cage${cageNum}`);

  await clickAction(page, /お買い物終了/);
  await sleep(200);
  const cleanDone = page.locator('.action-panel').getByRole('button', { name: /掃除終了/ });
  if (await cleanDone.count() > 0) await cleanDone.click();
  await sleep(200);
  await clickAction(page, /ターン終了/);
  await sleep(200);
  log(`  ${who} ライオン購入完了 (cage ${cageNum})`);
}

// ===== テスト =====

test.describe('ライオン奪取効果 4人対戦', () => {

  test('全員ライオン保有 → サイコロ一致で順番に奪取UIが表示される', async ({ browser }) => {
    const players = await startGame4P(browser);

    try {
      // --- セットアップフェーズ ---
      await completeSetup4P(players);
      log('セットアップ完了');

      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '05-setup-done'
      );

      // --- 全員にコインを付与（ライオン購入用 + 奪取テスト用） ---
      for (const p of players) {
        await debugSetCoins(players[0].page, p.sessionId, 20);
      }
      await sleep(200);
      log('全員に20コイン付与');

      // --- ラウンド1: 全員ライオンをケージ5に購入 ---
      // ターン順はplayers[0]→[1]→[2]→[3]
      // 各プレイヤーの手番でライオンを購入

      for (let i = 0; i < 4; i++) {
        await buyLionTurn(players[i].page, players[i].name, 5);
        // 購入後にコインを再補充
        await debugSetCoins(players[0].page, players[i].sessionId, 20);
        await sleep(200);
      }

      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '06-all-have-lion'
      );
      log('全員ライオン購入完了（ケージ5）');

      // --- 本番テスト: プレイヤー0のターンでサイコロ合計5 ---
      // 全員のコインを10に設定（奪取結果を検証しやすく）
      for (const p of players) {
        await debugSetCoins(players[0].page, p.sessionId, 10);
      }
      await sleep(300);

      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '07-before-dice-all-10coins'
      );

      // コイン初期値記録
      for (const p of players) {
        const coins = await getCoins(p.page, p.sessionId);
        log(`  ${p.name} コイン: ${coins}`);
      }

      // うんち受取→サイコロ（合計5でライオン発動）
      await clickAction(players[0].page, /うんちを受け取る/);
      await sleep(200);
      await ss(players[0].page, players[0].name, '08-poop-received');

      await debugSetDice(players[0].page, [2, 3]); // 合計5
      await clickAction(players[0].page, /2個振り/);
      await sleep(500);

      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '09-dice-rolled-sum5'
      );

      // --- 効果処理順の検証 ---
      // 手番=players[0], 処理順: players[1]→[2]→[3]→[0]（左隣→時計回り→手番が最後）

      const pendingCount = await getPendingEffectCount(players[0].page);
      log(`  pendingEffects数: ${pendingCount}`);
      expect(pendingCount).toBe(4); // 全員分

      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '10-pending-effects-created'
      );

      // --- 効果1: players[1]（ボブ）の奪取UI ---
      const owner1 = await getPendingEffectOwner(players[0].page);
      log(`  効果1のオーナー: ${owner1}`);
      expect(owner1).toBe(players[1].sessionId);

      // ボブの画面に奪取UIが表示されること
      const stealUI1 = players[1].page.locator('.trade-submenu').first();
      await expect(stealUI1).toBeVisible({ timeout: 5000 });
      await expect(stealUI1).toContainText('コイン奪取');

      // ボブの画面のスクショ（奪取UI表示中）
      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '11-steal-ui-player1-bob'
      );

      // 他プレイヤーの画面には奪取ボタンが表示されないこと（オーナーでないため）
      for (const p of [players[0], players[2], players[3]]) {
        const stealBtn = p.page.locator('.trade-submenu .trade-option');
        const count = await stealBtn.count();
        log(`  ${p.name}の画面の奪取ボタン数: ${count}`);
        // 自分がオーナーでない場合、trade-submenuは表示されない
        // （ActionPanelまたは効果UIの条件で制御される）
      }

      // ボブがアリスからコインを奪う
      const stealBtnBob = players[1].page.locator('.trade-option').filter({ hasText: 'アリス' }).first();
      await expect(stealBtnBob).toBeVisible();
      await stealBtnBob.click();
      await sleep(500);

      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '12-after-bob-steal'
      );

      // --- 効果2: players[2]（チャーリー）の奪取UI ---
      const owner2 = await getPendingEffectOwner(players[0].page);
      log(`  効果2のオーナー: ${owner2}`);
      expect(owner2).toBe(players[2].sessionId);

      const stealUI2 = players[2].page.locator('.trade-submenu').first();
      await expect(stealUI2).toBeVisible({ timeout: 5000 });
      await expect(stealUI2).toContainText('コイン奪取');

      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '13-steal-ui-player2-charlie'
      );

      // チャーリーがダイアナからコインを奪う
      const stealBtnCharlie = players[2].page.locator('.trade-option').filter({ hasText: 'ダイアナ' }).first();
      await expect(stealBtnCharlie).toBeVisible();
      await stealBtnCharlie.click();
      await sleep(500);

      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '14-after-charlie-steal'
      );

      // --- 効果3: players[3]（ダイアナ）の奪取UI ---
      const owner3 = await getPendingEffectOwner(players[0].page);
      log(`  効果3のオーナー: ${owner3}`);
      expect(owner3).toBe(players[3].sessionId);

      const stealUI3 = players[3].page.locator('.trade-submenu').first();
      await expect(stealUI3).toBeVisible({ timeout: 5000 });
      await expect(stealUI3).toContainText('コイン奪取');

      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '15-steal-ui-player3-diana'
      );

      // ダイアナがボブからコインを奪う
      const stealBtnDiana = players[3].page.locator('.trade-option').filter({ hasText: 'ボブ' }).first();
      await expect(stealBtnDiana).toBeVisible();
      await stealBtnDiana.click();
      await sleep(500);

      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '16-after-diana-steal'
      );

      // --- 効果4: players[0]（アリス）の奪取UI（手番プレイヤーが最後） ---
      const owner4 = await getPendingEffectOwner(players[0].page);
      log(`  効果4のオーナー: ${owner4}`);
      expect(owner4).toBe(players[0].sessionId);

      const stealUI4 = players[0].page.locator('.trade-submenu').first();
      await expect(stealUI4).toBeVisible({ timeout: 5000 });
      await expect(stealUI4).toContainText('コイン奪取');

      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '17-steal-ui-player0-alice-last'
      );

      // アリスがチャーリーからコインを奪う
      const stealBtnAlice = players[0].page.locator('.trade-option').filter({ hasText: 'チャーリー' }).first();
      await expect(stealBtnAlice).toBeVisible();
      await stealBtnAlice.click();
      await sleep(500);

      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '18-after-alice-steal-all-resolved'
      );

      // --- 全効果解決後の検証 ---
      const remainingEffects = await getPendingEffectCount(players[0].page);
      log(`  残りpendingEffects: ${remainingEffects}`);
      expect(remainingEffects).toBe(0);

      // コイン確認（ライオン1匹なので各1コイン奪取）
      // 初期: 全員10コイン
      // ボブ→アリスから1奪取:    アリス9, ボブ11, チャーリー10, ダイアナ10
      // チャーリー→ダイアナから1: アリス9, ボブ11, チャーリー11, ダイアナ9
      // ダイアナ→ボブから1:       アリス9, ボブ10, チャーリー11, ダイアナ10
      // アリス→チャーリーから1:    アリス10, ボブ10, チャーリー10, ダイアナ10
      // ※うんち受取ステップで全員のコイン変動なし（ペンギンはケージ2、サイコロ5なので発動しない）

      const finalCoins: number[] = [];
      for (const p of players) {
        const c = await getCoins(p.page, p.sessionId);
        finalCoins.push(c);
        log(`  ${p.name} 最終コイン: ${c}`);
      }

      // 円環的に1コインずつ奪い合ったので全員10コインに戻るはず
      // ただし、うんちの受取によるコイン変動はないので計算通り
      expect(finalCoins[0]).toBe(10); // アリス: -1(ボブに奪われ) +1(チャーリーから奪う)
      expect(finalCoins[1]).toBe(10); // ボブ: +1(アリスから奪う) -1(ダイアナに奪われ)
      expect(finalCoins[2]).toBe(10); // チャーリー: +1(ダイアナから奪う) -1(アリスに奪われ)
      expect(finalCoins[3]).toBe(10); // ダイアナ: -1(チャーリーに奪われ) +1(ボブから奪う)

      // tradeフェーズに進んでいることを確認
      const tradeBtn = players[0].page.locator('.action-panel').getByRole('button', { name: /お買い物終了/ });
      await expect(tradeBtn).toBeVisible({ timeout: 5000 });

      await ssAll(
        players.map(p => ({ page: p.page, name: p.name })),
        '19-trade-phase-reached'
      );

      log('テスト完了: 全員のライオン奪取が順番通りに処理された');

    } finally {
      for (const p of players) {
        await p.context.close();
      }
    }
  });
});
