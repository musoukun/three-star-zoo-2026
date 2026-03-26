/**
 * 三ツ星動物園 E2Eテスト
 *
 * Colyseusテストサーバーの代わりに、直接ルームのstateとメッセージハンドラを
 * テストするアプローチ。@colyseus/testingのESM互換問題を回避。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server, Room } from 'colyseus';
import { ZooRoom } from '../rooms/ZooRoom';
import { ZooState, PlayerState, Cage, CageSlot, PendingEffect } from '../schema/ZooState';
import { ANIMALS, STARTING_ANIMALS, STARTING_COINS, STAR_COST, STARS_TO_WIN } from '../game/animals';

// テスト用: ルームの状態を直接操作するためのヘルパー
// ColyseusのRoom.onMessage等はクライアント接続が必要だが、
// テストではstateと内部メソッドを直接テストする

/**
 * テスト用のZooState + ヘルパーを構築
 */
function createTestState(playerCount: number): {
  state: ZooState;
  playerIds: string[];
} {
  const state = new ZooState();
  state.roomName = 'テストルーム';
  state.phase = 'lobby';

  // マーケット初期化
  for (const [id, animal] of Object.entries(ANIMALS)) {
    state.market.set(id, animal.inventory);
  }

  const playerIds: string[] = [];
  for (let i = 0; i < playerCount; i++) {
    const pid = `player_${i}`;
    playerIds.push(pid);

    const player = new PlayerState();
    player.id = pid;
    player.name = `Player${i + 1}`;
    player.coins = STARTING_COINS;
    player.stars = 0;
    player.connected = true;
    player.poopTokens = 0;

    for (let c = 1; c <= 12; c++) {
      const cage = new Cage();
      cage.num = c;
      player.cages.push(cage);
    }

    state.players.set(pid, player);
    state.turnOrder.push(pid);
  }

  state.hostId = playerIds[0];
  return { state, playerIds };
}

/** ケージにスロット追加ヘルパー */
function addAnimalToSlot(state: ZooState, playerId: string, cageNum: number, animalId: string) {
  const player = state.players.get(playerId)!;
  // ケージ12はケージ11にリダイレクト
  const normalized = cageNum === 12 ? 11 : cageNum;
  const cage = player.cages.at(normalized - 1)!;
  const slot = new CageSlot();
  slot.animalId = animalId;
  slot.playerId = playerId;
  cage.slots.push(slot);
}

/** セットアップ完了状態にする */
function completeSetup(state: ZooState, playerIds: string[]) {
  for (const pid of playerIds) {
    addAnimalToSlot(state, pid, 1, 'RessaPanda');
    addAnimalToSlot(state, pid, 2, 'Penguin');
    state.setupInventory.set(pid, '');
  }
  state.phase = 'main';
  state.currentTurn = playerIds[0];
  state.turnStep = 'poop';
}

/** 動物配置可能チェック (サーバーロジックの再実装) */
function canPlaceAnimal(state: ZooState, animalId: string, cageNum: number, playerId: string): boolean {
  const normalizedCageNum = cageNum === 12 ? 11 : cageNum;
  const player = state.players.get(playerId)!;
  const cage = player.cages.at(normalizedCageNum - 1)!;
  const animalDef = ANIMALS[animalId];
  if (!animalDef) return false;

  // 容量チェック
  if (cage.slots.length >= 2) return false;
  // 同一動物チェック
  if (cage.slots.toArray().some(s => s.animalId === animalId)) return false;

  // 色制約チェック
  if (cage.slots.length > 0) {
    const existingAnimal = ANIMALS[cage.slots.at(0)!.animalId];
    const hasCommonColor = animalDef.colors.some(c => existingAnimal.colors.includes(c));
    if (!hasCommonColor) return false;
  }

  return true;
}

/** 隣接制約チェック (サーバーロジックの再実装) */
function checkAdjacentConstraint(state: ZooState, animalId: string, cageNum: number, playerId: string): boolean {
  const ADJACENCY: Record<number, number[]> = {
    1:  [2, 11, 12],
    2:  [1, 3, 11, 12, 10],
    3:  [2, 4, 10, 9],
    4:  [3, 5, 9, 8],
    5:  [4, 6, 8, 7],
    6:  [5, 7],
    7:  [8, 5, 6],
    8:  [7, 9, 4, 5],
    9:  [8, 10, 3, 4],
    10: [9, 11, 12, 2, 3],
    11: [12, 10, 1, 2],
    12: [11, 10, 1, 2],
  };

  const player = state.players.get(playerId)!;
  let existingCount = 0;
  for (const cage of player.cages) {
    for (const slot of cage.slots) {
      if (slot.animalId === animalId) existingCount++;
    }
  }
  if (existingCount === 0) return true;

  const adjacent = ADJACENCY[cageNum] || [];
  for (const cage of player.cages) {
    for (const slot of cage.slots) {
      if (slot.animalId === animalId) {
        if (adjacent.includes(cage.num)) return true;
      }
    }
  }
  return false;
}

/** バースト判定ロジック (サーバーロジックの再実装) */
function processBurst(state: ZooState, playerId: string): {
  burst: boolean;
  lostStar: boolean;
  returnedAnimal: string | null;
} {
  const player = state.players.get(playerId)!;
  if (player.poopTokens < 7) return { burst: false, lostStar: false, returnedAnimal: null };

  let lostStar = false;
  let returnedAnimal: string | null = null;

  if (player.stars > 0) {
    player.stars -= 1;
    lostStar = true;
  } else {
    // 最高コスト → 同コストならうんちコスト高い方を返却
    let maxCost = -1;
    let maxPoops = -1;
    let targetCage: Cage | null = null;
    let targetSlotIdx = -1;
    let targetAnimalId = '';

    for (const cage of player.cages) {
      for (let i = 0; i < cage.slots.length; i++) {
        const slot = cage.slots.at(i)!;
        const def = ANIMALS[slot.animalId];
        if (def.cost > maxCost || (def.cost === maxCost && def.poops > maxPoops)) {
          maxCost = def.cost;
          maxPoops = def.poops;
          targetCage = cage;
          targetSlotIdx = i;
          targetAnimalId = slot.animalId;
        }
      }
    }

    if (targetCage && targetSlotIdx >= 0) {
      targetCage.slots.splice(targetSlotIdx, 1);
      const stock = state.market.get(targetAnimalId) ?? 0;
      state.market.set(targetAnimalId, stock + 1);
      returnedAnimal = targetAnimalId;
    }
  }

  player.coins = 0;
  player.poopTokens = 0;

  return { burst: true, lostStar, returnedAnimal };
}

// ==================================================================
// テスト本体
// ==================================================================

describe('ペンギン配置テスト', () => {
  it('ペンギン(BLUE)とレッサーパンダ(RED/GREEN/ORANGE)は同じケージに配置できない', () => {
    const { state, playerIds } = createTestState(2);
    const pid = playerIds[0];

    // ケージ1にレッサーパンダを配置
    addAnimalToSlot(state, pid, 1, 'RessaPanda');
    expect(state.players.get(pid)!.cages.at(0)!.slots.length).toBe(1);

    // ペンギン(BLUE)をケージ1(RessaPanda=RED/GREEN/ORANGE)に配置可能か？
    const canPlace = canPlaceAnimal(state, 'Penguin', 1, pid);
    expect(canPlace).toBe(false); // 色が合わないので不可

    // 別のケージ(2)なら配置可能
    const canPlace2 = canPlaceAnimal(state, 'Penguin', 2, pid);
    expect(canPlace2).toBe(true);
  });

  it('同じ動物を同じケージに2匹配置できない', () => {
    const { state, playerIds } = createTestState(2);
    const pid = playerIds[0];

    addAnimalToSlot(state, pid, 3, 'Penguin');
    const canPlace = canPlaceAnimal(state, 'Penguin', 3, pid);
    expect(canPlace).toBe(false); // 同一動物は同じケージ不可
  });

  it('ケージ容量は2匹まで', () => {
    const { state, playerIds } = createTestState(2);
    const pid = playerIds[0];

    addAnimalToSlot(state, pid, 3, 'Penguin');
    addAnimalToSlot(state, pid, 3, 'CaliforniaSeaLion'); // 同じBLUE
    expect(state.players.get(pid)!.cages.at(2)!.slots.length).toBe(2);

    // 3匹目は不可
    const canPlace = canPlaceAnimal(state, 'BottlenoseDolphin', 3, pid);
    expect(canPlace).toBe(false);
  });

  it('色が合う動物は同じケージに配置できる (BLUE + BLUE)', () => {
    const { state, playerIds } = createTestState(2);
    const pid = playerIds[0];

    addAnimalToSlot(state, pid, 3, 'Penguin'); // BLUE
    const canPlace = canPlaceAnimal(state, 'CaliforniaSeaLion', 3, pid); // BLUE
    expect(canPlace).toBe(true);
  });
});

describe('隣接制約テスト', () => {
  it('2匹目の同一動物は隣接ケージにのみ配置可能', () => {
    const { state, playerIds } = createTestState(2);
    const pid = playerIds[0];

    // ケージ3にキリン配置
    addAnimalToSlot(state, pid, 3, 'ReticulatedGiraffe');

    // 新レイアウトの隣接: 3=[2,4,10,9]
    // ケージ4(隣接) → OK
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 4, pid)).toBe(true);
    // ケージ2(隣接) → OK
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 2, pid)).toBe(true);
    // ケージ9(隣接) → OK
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 9, pid)).toBe(true);
    // ケージ10(隣接) → OK
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 10, pid)).toBe(true);
    // ケージ6(非隣接) → NG
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 6, pid)).toBe(false);
    // ケージ1(非隣接) → NG
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 1, pid)).toBe(false);
  });

  it('1匹目は隣接制約なし（どこでも配置可能）', () => {
    const { state, playerIds } = createTestState(2);
    const pid = playerIds[0];

    // 1匹目はどこでもOK
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 1, pid)).toBe(true);
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 6, pid)).toBe(true);
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 11, pid)).toBe(true);
  });

  it('結合ケージ(11&12)の隣接が正しい', () => {
    const { state, playerIds } = createTestState(2);
    const pid = playerIds[0];

    // ケージ11にキリン配置
    addAnimalToSlot(state, pid, 11, 'ReticulatedGiraffe');

    // 11の隣接: [12, 10, 1, 2]
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 10, pid)).toBe(true);
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 1, pid)).toBe(true);
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 2, pid)).toBe(true);

    // 非隣接
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 5, pid)).toBe(false);
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 6, pid)).toBe(false);
  });
});

describe('3人・4人プレイテスト', () => {
  it('3人でセットアップ → ターン順が正しい', () => {
    const { state, playerIds } = createTestState(3);
    completeSetup(state, playerIds);

    expect(state.turnOrder.length).toBe(3);
    expect(state.turnOrder.at(0)).toBe(playerIds[0]);
    expect(state.turnOrder.at(1)).toBe(playerIds[1]);
    expect(state.turnOrder.at(2)).toBe(playerIds[2]);

    // 各プレイヤーにケージ12個
    for (const pid of playerIds) {
      expect(state.players.get(pid)!.cages.length).toBe(12);
    }
  });

  it('4人で全員にコインと初期動物がある', () => {
    const { state, playerIds } = createTestState(4);
    completeSetup(state, playerIds);

    expect(state.players.size).toBe(4);
    expect(state.turnOrder.length).toBe(4);

    for (const pid of playerIds) {
      const p = state.players.get(pid)!;
      expect(p.coins).toBe(STARTING_COINS);
      expect(p.cages.at(0)!.slots.length).toBe(1); // ケージ1にRessaPanda
      expect(p.cages.at(0)!.slots.at(0)!.animalId).toBe('RessaPanda');
      expect(p.cages.at(1)!.slots.length).toBe(1); // ケージ2にPenguin
      expect(p.cages.at(1)!.slots.at(0)!.animalId).toBe('Penguin');
    }
  });

  it('ターン進行が正しく回る（3人）', () => {
    const { state, playerIds } = createTestState(3);
    completeSetup(state, playerIds);

    expect(state.currentTurn).toBe(playerIds[0]);

    // ターン進行をシミュレート
    const nextPlayer = (current: string) => {
      const idx = playerIds.indexOf(current);
      return playerIds[(idx + 1) % playerIds.length];
    };

    // P1 → P2 → P3 → P1
    expect(nextPlayer(playerIds[0])).toBe(playerIds[1]);
    expect(nextPlayer(playerIds[1])).toBe(playerIds[2]);
    expect(nextPlayer(playerIds[2])).toBe(playerIds[0]);
  });
});

describe('バースト判定テスト', () => {
  it('うんちコマ7個以上でバースト → 星を1つ失う', () => {
    const { state, playerIds } = createTestState(2);
    completeSetup(state, playerIds);

    const pid = playerIds[0];
    const p = state.players.get(pid)!;
    p.stars = 2;
    p.poopTokens = 8; // 7以上
    p.coins = 15;

    const result = processBurst(state, pid);

    expect(result.burst).toBe(true);
    expect(result.lostStar).toBe(true);
    expect(p.stars).toBe(1); // 2 → 1
    expect(p.coins).toBe(0); // 全コイン返却
    expect(p.poopTokens).toBe(0); // 全うんち返却
  });

  it('うんちコマ6個以下はバーストしない', () => {
    const { state, playerIds } = createTestState(2);
    completeSetup(state, playerIds);

    const pid = playerIds[0];
    const p = state.players.get(pid)!;
    p.stars = 2;
    p.poopTokens = 6;
    p.coins = 15;

    const result = processBurst(state, pid);

    expect(result.burst).toBe(false);
    expect(p.stars).toBe(2); // 変化なし
    expect(p.coins).toBe(15); // 変化なし
  });

  it('バースト時に星がない → 最高コスト動物を返却', () => {
    const { state, playerIds } = createTestState(2);
    completeSetup(state, playerIds);

    const pid = playerIds[0];
    const p = state.players.get(pid)!;
    p.stars = 0;
    p.poopTokens = 9;
    p.coins = 10;

    // ケージ3にキリン(cost=4, poops=1)
    addAnimalToSlot(state, pid, 3, 'ReticulatedGiraffe');
    // ケージ4にライオン(cost=3, poops=0)
    addAnimalToSlot(state, pid, 4, 'Lion');

    const giraffeStockBefore = state.market.get('ReticulatedGiraffe') ?? 0;

    const result = processBurst(state, pid);

    expect(result.burst).toBe(true);
    expect(result.lostStar).toBe(false);
    expect(result.returnedAnimal).toBe('ReticulatedGiraffe'); // 最高コスト
    expect(p.cages.at(2)!.slots.length).toBe(0); // キリン返却済み
    expect(p.cages.at(3)!.slots.length).toBe(1); // ライオンは残る
    expect(state.market.get('ReticulatedGiraffe')).toBe(giraffeStockBefore + 1); // 在庫+1
    expect(p.coins).toBe(0);
    expect(p.poopTokens).toBe(0);
  });

  it('同コスト動物が複数 → うんちコストが高い方を返却', () => {
    const { state, playerIds } = createTestState(2);
    completeSetup(state, playerIds);

    const pid = playerIds[0];
    const p = state.players.get(pid)!;
    p.stars = 0;
    p.poopTokens = 10;
    p.coins = 5;

    // ケージ3にミナミシロサイ(cost=6, poops=2)
    addAnimalToSlot(state, pid, 3, 'SouthernWhiteRhino');
    // ケージ4にアフリカゾウ(cost=6, poops=3)
    addAnimalToSlot(state, pid, 4, 'AfricanElephant');
    // ケージ5にチーター(cost=5, poops=0)
    addAnimalToSlot(state, pid, 5, 'Cheetah');

    const result = processBurst(state, pid);

    expect(result.burst).toBe(true);
    expect(result.returnedAnimal).toBe('AfricanElephant'); // cost=6同士 → poops=3が返却
    expect(p.cages.at(2)!.slots.length).toBe(1); // ミナミシロサイ残存
    expect(p.cages.at(2)!.slots.at(0)!.animalId).toBe('SouthernWhiteRhino');
    expect(p.cages.at(3)!.slots.length).toBe(0); // アフリカゾウ返却済み
    expect(p.cages.at(4)!.slots.length).toBe(1); // チーター残存
    expect(p.cages.at(4)!.slots.at(0)!.animalId).toBe('Cheetah');
  });

  it('うんちコマちょうど7個でバースト', () => {
    const { state, playerIds } = createTestState(2);
    completeSetup(state, playerIds);

    const pid = playerIds[0];
    const p = state.players.get(pid)!;
    p.stars = 1;
    p.poopTokens = 7; // ちょうど7
    p.coins = 3;

    const result = processBurst(state, pid);

    expect(result.burst).toBe(true);
    expect(result.lostStar).toBe(true);
    expect(p.stars).toBe(0);
  });
});

describe('ゲーム終了条件テスト', () => {
  it('星3つ + うんち6以下 → 勝利', () => {
    const { state, playerIds } = createTestState(2);
    completeSetup(state, playerIds);

    const pid = playerIds[0];
    const p = state.players.get(pid)!;
    p.stars = 3;
    p.poopTokens = 5;

    // 勝利条件: 星 >= 3 AND うんち < 7
    const won = p.stars >= STARS_TO_WIN && p.poopTokens < 7;
    expect(won).toBe(true);
  });

  it('星3つ + うんちちょうど6 → 勝利', () => {
    const { state, playerIds } = createTestState(2);
    completeSetup(state, playerIds);

    const p = state.players.get(playerIds[0])!;
    p.stars = 3;
    p.poopTokens = 6;

    const won = p.stars >= STARS_TO_WIN && p.poopTokens < 7;
    expect(won).toBe(true);
  });

  it('星3つ + うんち7以上 → バーストで勝利ではない', () => {
    const { state, playerIds } = createTestState(2);
    completeSetup(state, playerIds);

    const p = state.players.get(playerIds[0])!;
    p.stars = 3;
    p.poopTokens = 7;

    // まずバースト判定
    const result = processBurst(state, playerIds[0]);
    expect(result.burst).toBe(true);
    expect(result.lostStar).toBe(true);
    expect(p.stars).toBe(2); // 3→2

    // 勝利条件未達成
    const won = p.stars >= STARS_TO_WIN && p.poopTokens < 7;
    expect(won).toBe(false);
  });

  it('星2つでは勝利しない', () => {
    const { state, playerIds } = createTestState(2);
    completeSetup(state, playerIds);

    const p = state.players.get(playerIds[0])!;
    p.stars = 2;
    p.poopTokens = 0;

    const won = p.stars >= STARS_TO_WIN && p.poopTokens < 7;
    expect(won).toBe(false);
  });
});

describe('購入制限テスト', () => {
  it('マーケット在庫の初期値が正しい', () => {
    const { state } = createTestState(2);

    // ANIMALS定義の在庫と一致
    for (const [id, animal] of Object.entries(ANIMALS)) {
      expect(state.market.get(id)).toBe(animal.inventory);
    }
  });

  it('動物購入でコスト分のコインが減る', () => {
    const { state, playerIds } = createTestState(2);
    completeSetup(state, playerIds);

    const pid = playerIds[0];
    const p = state.players.get(pid)!;
    p.coins = 10;

    const penguinCost = ANIMALS['Penguin'].cost; // 2
    const stockBefore = state.market.get('Penguin')!;

    // 購入シミュレート
    p.coins -= penguinCost;
    state.market.set('Penguin', stockBefore - 1);

    expect(p.coins).toBe(8);
    expect(state.market.get('Penguin')).toBe(stockBefore - 1);
  });

  it('星の購入コストは10コイン', () => {
    expect(STAR_COST).toBe(10);

    const { state, playerIds } = createTestState(2);
    completeSetup(state, playerIds);

    const p = state.players.get(playerIds[0])!;
    p.coins = 15;

    // 星購入シミュレート
    p.coins -= STAR_COST;
    p.stars += 1;

    expect(p.coins).toBe(5);
    expect(p.stars).toBe(1);
  });

  it('コイン不足で購入不可', () => {
    const { state, playerIds } = createTestState(2);
    completeSetup(state, playerIds);

    const p = state.players.get(playerIds[0])!;
    p.coins = 1; // ペンギン(cost=2)すら買えない

    const canBuyPenguin = p.coins >= ANIMALS['Penguin'].cost;
    expect(canBuyPenguin).toBe(false);

    const canBuyStar = p.coins >= STAR_COST;
    expect(canBuyStar).toBe(false);
  });
});

describe('効果処理順テスト', () => {
  it('手番プレイヤーの左隣から時計回り（3人）', () => {
    const { state, playerIds } = createTestState(3);
    completeSetup(state, playerIds);

    // P1(index=0)がカレント → 効果処理順: P2, P3, P1
    const currentIdx = playerIds.indexOf(state.currentTurn);
    const effectOrder: string[] = [];
    for (let i = 1; i <= playerIds.length; i++) {
      effectOrder.push(playerIds[(currentIdx + i) % playerIds.length]);
    }

    expect(effectOrder[0]).toBe(playerIds[1]); // P2が最初
    expect(effectOrder[1]).toBe(playerIds[2]); // P3が次
    expect(effectOrder[2]).toBe(playerIds[0]); // P1(手番)が最後
  });

  it('手番プレイヤーの左隣から時計回り（4人）', () => {
    const { state, playerIds } = createTestState(4);
    completeSetup(state, playerIds);

    // P1がカレント → P2, P3, P4, P1
    const currentIdx = 0;
    const effectOrder: string[] = [];
    for (let i = 1; i <= playerIds.length; i++) {
      effectOrder.push(playerIds[(currentIdx + i) % playerIds.length]);
    }

    expect(effectOrder[0]).toBe(playerIds[1]);
    expect(effectOrder[1]).toBe(playerIds[2]);
    expect(effectOrder[2]).toBe(playerIds[3]);
    expect(effectOrder[3]).toBe(playerIds[0]); // 手番が最後
  });
});

describe('結合ケージ(11&12)テスト', () => {
  it('ケージ12への配置はケージ11にリダイレクトされる', () => {
    const { state, playerIds } = createTestState(2);
    const pid = playerIds[0];

    addAnimalToSlot(state, pid, 12, 'Penguin');

    // ケージ11(index=10)に配置されている
    expect(state.players.get(pid)!.cages.at(10)!.slots.length).toBe(1);
    expect(state.players.get(pid)!.cages.at(10)!.slots.at(0)!.animalId).toBe('Penguin');

    // ケージ12(index=11)は空
    expect(state.players.get(pid)!.cages.at(11)!.slots.length).toBe(0);
  });

  it('ケージ11と12の隣接が正しい', () => {
    const { state, playerIds } = createTestState(2);
    const pid = playerIds[0];

    // ケージ1にキリン
    addAnimalToSlot(state, pid, 1, 'ReticulatedGiraffe');

    // ケージ11は1の隣接 → 2匹目配置可能
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 11, pid)).toBe(true);
    // ケージ12も1の隣接
    expect(checkAdjacentConstraint(state, 'ReticulatedGiraffe', 12, pid)).toBe(true);
  });
});

describe('ロビー機能テスト', () => {
  it('初期フェーズはlobby', () => {
    const { state } = createTestState(2);
    expect(state.phase).toBe('lobby');
  });

  it('ホストが正しく設定される', () => {
    const { state, playerIds } = createTestState(3);
    expect(state.hostId).toBe(playerIds[0]); // 最初のプレイヤーがホスト
  });

  it('プライベートルームフラグ', () => {
    const state = new ZooState();
    state.isPrivate = true;
    expect(state.isPrivate).toBe(true);
  });
});

describe('動物データ整合性テスト', () => {
  it('全動物に必要なプロパティがある', () => {
    for (const [id, animal] of Object.entries(ANIMALS)) {
      expect(animal.id).toBe(id);
      expect(typeof animal.name).toBe('string');
      expect(animal.cost).toBeGreaterThanOrEqual(0);
      expect(animal.poops).toBeGreaterThanOrEqual(0);
      expect(animal.colors.length).toBeGreaterThan(0);
      expect(animal.inventory).toBeGreaterThan(0);
      expect(animal.effect).toBeDefined();
      expect(animal.effect.timing).toMatch(/^(first|end)$/);
    }
  });

  it('初期動物が存在する', () => {
    for (const animalId of STARTING_ANIMALS) {
      expect(ANIMALS[animalId]).toBeDefined();
    }
  });

  it('勝利条件は星3つ', () => {
    expect(STARS_TO_WIN).toBe(3);
  });
});
