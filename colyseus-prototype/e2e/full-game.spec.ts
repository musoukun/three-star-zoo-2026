/**
 * E2E テスト: 2プレイヤーで勝利までのフルゲーム
 *
 * 前提: サーバー(port 2567) と クライアント(port 3000) が起動済み
 *
 * ルール概要:
 *   - エリア1-12はサイコロ出目に対応。2個振りで最も出やすいのは7、次に6,8
 *   - 動物を出やすいエリアに配置 → サイコロ出目が一致 → 効果発動でコイン獲得
 *   - 10コインで星1つ購入。星3つ＋うんち6以下でターン終了すれば勝利
 *   - 毎ターン動物のうんちコスト分のうんちコマが溜まる。7個以上でバースト（星or動物を失う）
 *
 * 戦略:
 *   アリス → 出やすいエリア(5-8)に動物を配置、収入を増やして星3つを目指す
 *   ボブ   → 最低限の行動のみ（噛ませ役）
 *
 * 各フェーズでスクリーンショットを撮って記録する。
 */
import { test, expect, type Page } from '@playwright/test';

const SS_DIR = 'e2e/screenshots';
let ssIndex = 0;

// ===== スクリーンショット =====

async function ss(alice: Page, bob: Page, label: string) {
  ssIndex++;
  const prefix = String(ssIndex).padStart(3, '0');
  const safe = label.replace(/[^a-zA-Z0-9_\-]/g, '_');
  await Promise.all([
    alice.screenshot({ path: `${SS_DIR}/${prefix}_alice_${safe}.png` }),
    bob.screenshot({ path: `${SS_DIR}/${prefix}_bob_${safe}.png` }),
  ]);
  log(`ss[${prefix}] ${label}`);
}

async function ssOne(page: Page, who: string, label: string) {
  ssIndex++;
  const prefix = String(ssIndex).padStart(3, '0');
  const safe = label.replace(/[^a-zA-Z0-9_\-]/g, '_');
  await page.screenshot({ path: `${SS_DIR}/${prefix}_${who}_${safe}.png` });
  log(`ss[${prefix}] ${who}: ${label}`);
}

function log(msg: string) {
  console.log(`[E2E] ${msg}`);
}

// ===== UI操作ヘルパー =====

async function clickButton(page: Page, text: string | RegExp, timeout = 5000) {
  await page.getByRole('button', { name: text }).first().click({ timeout });
}

async function clickAction(page: Page, text: string | RegExp, timeout = 10000) {
  const btn = page.locator('.action-panel').getByRole('button', { name: text }).first();
  await btn.waitFor({ state: 'visible', timeout });
  await btn.click();
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ===== テスト本体 =====

test('2P full game', async ({ browser }) => {
  const ctxAlice = await browser.newContext();
  const ctxBob = await browser.newContext();
  const alice = await ctxAlice.newPage();
  const bob = await ctxBob.newPage();

  try {
    // ==========================================
    // 1. ロビー → ルーム作成 → 入室
    // ==========================================
    log('=== PHASE: Lobby ===');

    await alice.goto('/');
    await ssOne(alice, 'alice', '01-lobby-top');

    // アリスがルーム作成
    await alice.fill('input[placeholder="名前を入力..."]', 'アリス');
    await clickButton(alice, /ルームを作成/);
    await alice.fill('input[placeholder="部屋の名前..."]', 'E2Eテスト部屋');
    await clickButton(alice, /作成して入室/);
    await sleep(500);
    await ssOne(alice, 'alice', '02-room-lobby-1p');

    // ボブがルーム入室
    await bob.goto('/');
    await bob.fill('input[placeholder="名前を入力..."]', 'ボブ');
    // LobbyRoom経由のリアルタイム一覧更新を待つ
    await bob.getByRole('button', { name: '入室 →' }).first().waitFor({ state: 'visible', timeout: 15000 });
    await ssOne(bob, 'bob', '03-room-list');

    const targetRoom = bob.locator('div')
      .filter({ hasText: /E2Eテスト部屋/ })
      .filter({ has: bob.getByRole('button', { name: '入室 →' }) })
      .last();
    await targetRoom.getByRole('button', { name: '入室 →' }).click();
    await sleep(500);
    await ss(alice, bob, '04-room-lobby-2p');

    // ゲーム開始
    log('=== PHASE: Start Game ===');
    await alice.getByText('ボブ', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    const startBtn = alice.getByRole('button', { name: /ゲーム開始 \(2人で対戦\)/ });
    await startBtn.waitFor({ state: 'visible', timeout: 5000 });
    await startBtn.click();
    await sleep(500);
    await ss(alice, bob, '05-game-started');

    // ==========================================
    // 2. セットアップ: 出やすいエリアに動物を配置
    // ==========================================
    log('=== PHASE: Setup ===');

    // サイコロ2個の出目確率:
    //   7=16.7%, 6,8=13.9%, 5,9=11.1%, 4,10=8.3%, 3,11=5.6%, 2,12=2.8%
    // → エリア5-8に置くのが最善

    // アリスの番: レッサーパンダ→エリア6、ペンギン→エリア7
    await alice.locator('.cage-place-btn').first().waitFor({ state: 'visible', timeout: 5000 });
    await ssOne(alice, 'alice', '06-setup-before');

    // レッサーパンダをエリア6に配置（エリア6のケージ内の配置ボタンを探す）
    await placeAnimalInCage(alice, 'レッサーパンダ', 6);
    await sleep(300);
    await ssOne(alice, 'alice', '07-setup-ressa-placed');
    log('アリス: レッサーパンダ → エリア6');

    // ペンギンをエリア7に配置
    await placeAnimalInCage(alice, 'ペンギン', 7);
    await sleep(300);
    await ssOne(alice, 'alice', '08-setup-penguin-placed');
    log('アリス: ペンギン → エリア7');

    // ボブの番: レッサーパンダ→エリア5、ペンギン→エリア8
    await bob.locator('.cage-place-btn').first().waitFor({ state: 'visible', timeout: 5000 });
    await ssOne(bob, 'bob', '09-setup-bob-before');

    await placeAnimalInCage(bob, 'レッサーパンダ', 5);
    await sleep(300);
    log('ボブ: レッサーパンダ → エリア5');

    await placeAnimalInCage(bob, 'ペンギン', 8);
    await sleep(300);
    await ss(alice, bob, '10-setup-complete');
    log('ボブ: ペンギン → エリア8');

    // メインフェーズ移行を待つ
    await sleep(500);
    await ss(alice, bob, '11-main-phase-start');
    log('=== PHASE: Main ===');

    // ==========================================
    // 3. メインフェーズ: ターンループ
    // ==========================================
    const MAX_TURNS = 80;
    let turnCount = 0;

    for (let t = 0; t < MAX_TURNS; t++) {
      turnCount++;

      // 誰のターンか判定
      const aliceIsActive = await alice.locator('.my-turn').count() > 0;
      const active = aliceIsActive ? alice : bob;
      const name = aliceIsActive ? 'alice' : 'bob';
      const nameJa = aliceIsActive ? 'アリス' : 'ボブ';

      log(`--- Turn ${turnCount}: ${nameJa} ---`);

      // ---- Step 1: うんちを受け取る ----
      await clickAction(active, /うんちを受け取る/);
      await sleep(200);

      // ---- Step 2: サイコロを振る ----
      // 戦略: 動物がエリア5-8にいるので序盤は2個振り（5-8が出やすい）
      await clickAction(active, /2個振り/);
      await sleep(300);
      await ssOne(active, name, `turn${turnCount}-after-roll`);

      // ---- Step 3: 効果解決（pendingEffectsがあれば） ----
      await resolveAllEffects(alice, bob);

      // ---- Step 4: お買い物 ----
      if (aliceIsActive) {
        await aliceShopPhase(alice, turnCount);
      }
      // お買い物終了
      await clickAction(active, /お買い物終了/);
      await sleep(200);

      // ---- Step 5: うんち掃除 ----
      await doCleanPhase(active, name, turnCount);

      // ゲーム終了チェック
      if (await isGameOver(alice, bob)) {
        await ss(alice, bob, `gameover-turn${turnCount}`);
        log(`*** GAME OVER at turn ${turnCount} ***`);
        break;
      }

      // ---- Step 6: ターン終了 ----
      await clickAction(active, /ターン終了/);
      await sleep(200);

      // 定期スクリーンショット（5ターンごと）
      if (turnCount % 5 === 0) {
        await ss(alice, bob, `checkpoint-turn${turnCount}`);
      }
    }

    // ==========================================
    // 4. 結果画面
    // ==========================================
    log('=== PHASE: Result ===');
    const modal = alice.locator('.result-modal').or(bob.locator('.result-modal'));
    await expect(modal.first()).toBeVisible({ timeout: 5000 });
    await ss(alice, bob, 'result-modal');
    log(`Test done: ${turnCount} turns`);

  } finally {
    await ctxAlice.close();
    await ctxBob.close();
  }
});

// =============================================================
// セットアップ: 指定エリアに動物を配置
// =============================================================

/** 指定エリア番号のケージ内にある配置ボタンをクリック */
async function placeAnimalInCage(page: Page, animalName: string, cageNum: number) {
  // ケージはクラス .cage で、中にケージ番号が .cage-num で表示されている
  // ケージ番号の表示テキストで特定する
  const cageLabel = cageNum === 11 ? '11&12' : String(cageNum);

  // すべてのケージを取得して、番号が一致するものを探す
  const cages = page.locator('.my-board-area .cage');
  const count = await cages.count();

  for (let i = 0; i < count; i++) {
    const cage = cages.nth(i);
    const numText = await cage.locator('.cage-num').textContent() || '';
    if (numText.trim() === cageLabel) {
      // このケージ内の配置ボタンをクリック
      const placeBtn = cage.locator('.cage-place-btn').filter({ hasText: animalName });
      if (await placeBtn.count() > 0) {
        await placeBtn.first().click();
        return;
      }
    }
  }

  // フォールバック: どのケージでもいいから配置ボタンをクリック
  log(`  WARN: cage ${cageNum} not found for ${animalName}, using fallback`);
  await page.locator('.cage-place-btn').filter({ hasText: animalName }).first().click();
}

// =============================================================
// 効果解決
// =============================================================

async function resolveAllEffects(alice: Page, bob: Page) {
  let guard = 0;
  while (guard < 20) {
    guard++;
    await sleep(200);

    // どちらかに効果解決UIが出ているか
    const aliceEffects = await alice.locator('.trade-submenu .trade-option').count();
    const bobEffects = await bob.locator('.trade-submenu .trade-option').count();
    if (aliceEffects === 0 && bobEffects === 0) break;

    const effectPage = aliceEffects > 0 ? alice : bob;
    const who = aliceEffects > 0 ? 'alice' : 'bob';

    await ssOne(effectPage, who, 'effect-resolve');

    // 「コイン獲得」があれば優先（choice効果: 銀行からもらう方が安全）
    const creation = effectPage.locator('.trade-option').filter({ hasText: 'コイン獲得' });
    if (await creation.count() > 0) {
      await creation.first().click();
      log(`  Effect: ${who} → coins from bank`);
    } else {
      // steal/stealStar等: 最初の選択肢（相手プレイヤー）
      const first = effectPage.locator('.trade-option').first();
      if (await first.isVisible()) {
        await first.click();
        log(`  Effect: ${who} → first option`);
      }
    }
    await sleep(200);
  }
}

// =============================================================
// アリスのお買い物戦略
// =============================================================

/**
 * 戦略:
 *   1. 星を買えるなら最優先（10コイン）
 *   2. 動物を買って収入源を増やす（出やすいエリアに配置）
 *   3. 動物購入後にまだ星を買えるなら買う
 */
async function aliceShopPhase(page: Page, turnCount: number) {
  await sleep(200);

  // 星購入チェック
  const boughtStar1 = await tryBuyStar(page, turnCount);

  // 動物購入
  await tryBuyAnimal(page, turnCount);

  // 星購入（2回目チャンス: 動物を買わずにコインが余った場合）
  if (!boughtStar1) {
    await tryBuyStar(page, turnCount);
  }
}

async function tryBuyStar(page: Page, turnCount: number): Promise<boolean> {
  const starBtn = page.locator('.action-panel').getByRole('button', { name: /星を買う/ });
  if (await starBtn.count() > 0 && await starBtn.isEnabled()) {
    await starBtn.click();
    await sleep(200);
    await ssOne(page, 'alice', `turn${turnCount}-star-bought`);
    log(`  Alice: ★ STAR BOUGHT!`);
    return true;
  }
  return false;
}

async function tryBuyAnimal(page: Page, turnCount: number) {
  // 購入可能なカード（.market-card.buyable）
  const buyable = page.locator('.market-card.buyable');
  const count = await buyable.count();
  if (count === 0) return;

  // 購入優先度: 高コスト→低コスト（高コストの動物ほど効果が大きい）
  // カードは市場にコスト順で並んでいるので、後ろから試す
  for (let i = count - 1; i >= 0; i--) {
    const card = buyable.nth(i);
    await card.click();
    await sleep(300);

    // 配置可能なケージ選択UI（market-area 内の有効な .trade-option）
    const cageOptions = page.locator('.market-area .trade-option:not([disabled])');
    const optionCount = await cageOptions.count();

    if (optionCount > 0) {
      // なるべく出やすいエリア(5-9)に配置する
      const bestOption = await pickBestCageOption(cageOptions);
      const animalName = await card.locator('.market-card-body').textContent() || '?';
      await ssOne(page, 'alice', `turn${turnCount}-buy-${i}`);
      await bestOption.click();
      log(`  Alice: BUY ${animalName.trim()}`);
      return;
    }

    // 配置不可 → 戻る
    const backBtn = page.locator('.market-area button').filter({ hasText: '戻る' });
    if (await backBtn.count() > 0) {
      await backBtn.first().click();
      await sleep(100);
    }
  }
}

/**
 * ケージ選択肢の中から最も出やすいエリアを選ぶ
 * エリア番号の出やすさ（2個振り）: 7>6=8>5=9>4=10>3=11>2=12>1
 */
async function pickBestCageOption(options: ReturnType<Page['locator']>) {
  const count = await options.count();
  if (count <= 1) return options.first();

  // 各選択肢のテキストからケージ番号を抽出してスコアリング
  const scores: Record<number, number> = {
    7: 100, 6: 90, 8: 90, 5: 80, 9: 80,
    4: 70, 10: 70, 3: 60, 11: 50, 12: 50, 2: 40, 1: 30,
  };

  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < count; i++) {
    const text = await options.nth(i).textContent() || '';
    // "ケージ #7" や "#7" からエリア番号を抽出
    const match = text.match(/#(\d+)/);
    if (match) {
      const num = parseInt(match[1]);
      const score = scores[num] ?? 0;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
  }

  return options.nth(bestIdx);
}

// =============================================================
// うんち掃除フェーズ
// =============================================================

/**
 * 掃除戦略: 1コインで2個除去。うんち7個以上でバースト。
 * → うんち5個以上でコインがあるなら掃除してバースト回避
 */
async function doCleanPhase(page: Page, who: string, turnCount: number) {
  let cleaned = 0;
  let guard = 0;

  while (guard < 15) {
    guard++;
    const cleanBtn = page.locator('.action-panel button').filter({ hasText: /掃除.*💰|🧹/ }).first();
    // 掃除ボタンが表示されていてクリック可能なら掃除する
    if (await cleanBtn.count() > 0 && await cleanBtn.isEnabled()) {
      // 掃除終了ボタンと区別: 「掃除終了」は含まない
      const btnText = await cleanBtn.textContent() || '';
      if (btnText.includes('終了')) break;
      await cleanBtn.click();
      await sleep(150);
      cleaned++;
    } else {
      break;
    }
  }

  if (cleaned > 0) {
    await ssOne(page, who, `turn${turnCount}-cleaned-${cleaned}`);
    log(`  Clean: ${cleaned} times`);
  }

  // 掃除終了
  await clickAction(page, /掃除終了/);
  await sleep(300);
}

// =============================================================
// ゲーム終了チェック
// =============================================================

async function isGameOver(alice: Page, bob: Page): Promise<boolean> {
  const a = await alice.locator('.result-modal').count();
  const b = await bob.locator('.result-modal').count();
  return a > 0 || b > 0;
}
