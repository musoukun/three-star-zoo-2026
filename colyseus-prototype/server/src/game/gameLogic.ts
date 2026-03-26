import { ANIMALS } from "./animals";
import type { AnimalColor } from "./types";

// ===== ケージグリッド定数 =====

/** 2行グリッドの隣接マップ (上下左右、斜めなし)
 *  上段:  1    2    3    4    5    6
 *  下段: [11&12]  10    9    8    7
 *
 *  11と12は結合された1つの大きな檻
 *  11&12は上段の1,2の下に位置する（2列幅）
 */
export const ADJACENCY: Record<number, number[]> = {
  // 上段
  1:  [2, 11, 12],        // 右=2, 下=11&12
  2:  [1, 3, 11, 12, 10], // 左=1, 右=3, 下=11&12と10
  3:  [2, 4, 10, 9],      // 左=2, 右=4, 下=10と9
  4:  [3, 5, 9, 8],       // 左=3, 右=5, 下=9と8
  5:  [4, 6, 8, 7],       // 左=4, 右=6, 下=8と7
  6:  [5, 7],             // 左=5, 下=7
  // 下段 (右から左: 7,8,9,10,11&12)
  7:  [8, 5, 6],          // 左=8, 上=5,6
  8:  [7, 9, 4, 5],       // 左隣=9, 右隣=7, 上=4,5
  9:  [8, 10, 3, 4],      // 左隣=10, 右隣=8, 上=3,4
  10: [9, 11, 12, 2, 3],  // 左隣=11&12, 右隣=9, 上=2,3
  11: [12, 10, 1, 2],     // 結合相手=12, 右隣=10, 上=1,2
  12: [11, 10, 1, 2],     // 結合相手=11, 右隣=10, 上=1,2
};

/** 結合ケージ: 11と12は1つの檻 → 内部的にケージ11に統一 */
export function normalizeCageNum(cageNum: number): number {
  return cageNum === 12 ? 11 : cageNum;
}

/** うんちバーストの閾値 */
export const POOP_BURST_THRESHOLD = 7;

// ===== ケージ・動物ヘルパー（純粋関数） =====

/** ケージスロットの型（Colyseusスキーマに依存しない） */
interface CageSlotLike {
  animalId: string;
}
interface CageLike {
  num: number;
  slots: { length: number; at(i: number): CageSlotLike | undefined } & Iterable<CageSlotLike>;
}
interface PlayerCagesLike {
  cages: { at(i: number): CageLike | undefined } & Iterable<CageLike>;
}

/** プレイヤーのケージを取得（11&12は結合→11に正規化） */
export function getPlayerCage(player: PlayerCagesLike, cageNum: number): CageLike {
  const normalized = normalizeCageNum(cageNum);
  return player.cages.at(normalized - 1)!;
}

/** プレイヤーが持つ特定動物の数をカウント */
export function countPlayerAnimal(player: PlayerCagesLike, animalId: string): number {
  let count = 0;
  for (const cage of player.cages) {
    for (const slot of cage.slots) {
      if (slot.animalId === animalId) {
        count++;
      }
    }
  }
  return count;
}

/** ケージの既存動物の色を取得 */
export function getCageColors(player: PlayerCagesLike, cageNum: number): AnimalColor[] | null {
  const cage = getPlayerCage(player, cageNum);
  if (cage.slots.length === 0) return null;
  return ANIMALS[cage.slots.at(0)!.animalId].colors;
}

/** 動物を配置可能かチェック（色・種類・容量） */
export function canPlaceAnimal(player: PlayerCagesLike, animalId: string, cageNum: number): boolean {
  const cage = getPlayerCage(player, cageNum);
  const animalDef = ANIMALS[animalId];
  if (!animalDef) return false;

  if (cage.slots.length >= 2) return false;
  if ([...cage.slots].some(s => s.animalId === animalId)) return false;

  if (cage.slots.length > 0) {
    const cageColors = getCageColors(player, cageNum);
    if (cageColors) {
      const hasCommonColor = animalDef.colors.some(c => cageColors.includes(c));
      if (!hasCommonColor) return false;
    }
  }

  return true;
}

/** 同一動物の2匹目配置時、隣接制約チェック（4x3グリッド） */
export function checkAdjacentConstraint(player: PlayerCagesLike, animalId: string, cageNum: number): boolean {
  const existingCount = countPlayerAnimal(player, animalId);
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

/** 条件式を評価 (creationIf, stealIf) */
export function evaluateCondition(
  condition: [string, string, string, '?', string, ':', string],
  player: PlayerCagesLike,
): number {
  const [animalId, op, threshold, , trueVal, , falseVal] = condition;
  const count = countPlayerAnimal(player, animalId);
  const thresholdNum = parseInt(threshold);
  let result = false;
  switch (op) {
    case '>=': result = count >= thresholdNum; break;
    case '>': result = count > thresholdNum; break;
    case '<=': result = count <= thresholdNum; break;
    case '<': result = count < thresholdNum; break;
    case '==': result = count === thresholdNum; break;
  }
  return parseInt(result ? trueVal : falseVal);
}

/** プレイヤーの全動物のうんちコスト合計 */
export function calculatePoopCost(player: PlayerCagesLike): number {
  let total = 0;
  for (const cage of player.cages) {
    for (const slot of cage.slots) {
      total += ANIMALS[slot.animalId].poops;
    }
  }
  return total;
}

/** 効果処理順を返す（手番プレイヤーの左隣から時計回り、手番が最後） */
export function getEffectProcessingOrder(turnOrder: string[], currentPlayer: string): string[] {
  const idx = turnOrder.indexOf(currentPlayer);
  const result: string[] = [];
  for (let i = 1; i <= turnOrder.length; i++) {
    result.push(turnOrder[(idx + i) % turnOrder.length]);
  }
  return result;
}

/** 最高コストの動物を探す（バースト時ペナルティ用） */
export function findMostExpensiveAnimal(player: PlayerCagesLike): {
  cageIndex: number;
  slotIndex: number;
  animalId: string;
} | null {
  let maxCost = -1;
  let maxPoops = -1;
  let result: { cageIndex: number; slotIndex: number; animalId: string } | null = null;

  let cageIdx = 0;
  for (const cage of player.cages) {
    for (let i = 0; i < cage.slots.length; i++) {
      const slot = cage.slots.at(i)!;
      const animalDef = ANIMALS[slot.animalId];
      if (animalDef.cost > maxCost || (animalDef.cost === maxCost && animalDef.poops > maxPoops)) {
        maxCost = animalDef.cost;
        maxPoops = animalDef.poops;
        result = { cageIndex: cageIdx, slotIndex: i, animalId: slot.animalId };
      }
    }
    cageIdx++;
  }

  return result;
}
