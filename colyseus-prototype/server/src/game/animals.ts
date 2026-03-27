import type { AnimalDef } from './types';

export const ANIMALS: Record<string, AnimalDef> = {
  RessaPanda: {
    id: 'RessaPanda',
    name: 'レッサーパンダ',
    cost: 0,
    poops: 0,
    colors: ['RED', 'GREEN', 'ORANGE'],
    inventory: 8,
    inventory2p: 6,
    effect: {
      global: false,
      timing: 'first',
      creation: 0,
      buff: [1, 'RessaPanda', 'each'],
      bonusbuff: [2, 'GiantPanda', 'once'],
    },
  },
  RosyFacedLovebird: {
    id: 'RosyFacedLovebird',
    name: 'コンゴウインコ',
    cost: 0,
    poops: 0,
    colors: ['RED', 'GREEN', 'ORANGE'],
    inventory: 8,
    inventory2p: 6,
    effect: {
      global: true,
      timing: 'first',
      creation: 1,
    },
  },
  Penguin: {
    id: 'Penguin',
    name: 'ペンギン',
    cost: 2,
    poops: 1,
    colors: ['BLUE'],
    inventory: 8,
    inventory2p: 6,
    effect: {
      global: true,
      timing: 'first',
      creation: 0,
      creationIf: ['Penguin', '>=', '2', '?', '3', ':', '1'],
    },
  },
  Lion: {
    id: 'Lion',
    name: 'ライオン',
    cost: 3,
    poops: 0,
    colors: ['RED'],
    inventory: 6,
    effect: {
      global: true,
      timing: 'first',
      creation: 0,
      stealIf: ['Lion', '>=', '2', '?', '3', ':', '1'],
    },
  },
  GiantPanda: {
    id: 'GiantPanda',
    name: 'ジャイアントパンダ',
    cost: 3,
    poops: 2,
    colors: ['PURPLE'],
    inventory: 4,
    effect: {
      global: true,
      timing: 'first',
      creation: 0,
      buff: [2, 'GiantPanda', 'each'],
    },
  },
  CaliforniaSeaLion: {
    id: 'CaliforniaSeaLion',
    name: 'カリフォルニアアシカ',
    cost: 3,
    poops: 0,
    colors: ['BLUE'],
    inventory: 4,
    effect: {
      global: false,
      timing: 'first',
      creation: 3,
      steal: [2, 'target'],
    },
  },
  ReticulatedGiraffe: {
    id: 'ReticulatedGiraffe',
    name: 'アミメキリン',
    cost: 4,
    poops: 1,
    colors: ['GREEN'],
    inventory: 4,
    effect: {
      global: true,
      timing: 'first',
      creation: 3,
      adjacent: [1, 'ReticulatedGiraffe', 'once'],
    },
  },
  Cheetah: {
    id: 'Cheetah',
    name: 'チーター',
    cost: 5,
    poops: 0,
    colors: ['RED'],
    inventory: 4,
    effect: {
      global: true,
      timing: 'end',
      creation: 3,
    },
  },
  AfricanElephant: {
    id: 'AfricanElephant',
    name: 'アフリカゾウ',
    cost: 6,
    poops: 3,
    colors: ['GREEN'],
    inventory: 2,
    effect: {
      global: true,
      timing: 'first',
      creation: 7,
    },
  },
  SouthernWhiteRhino: {
    id: 'SouthernWhiteRhino',
    name: 'ミナミシロサイ',
    cost: 6,
    poops: 2,
    colors: ['GREEN'],
    inventory: 2,
    effect: {
      global: false,
      timing: 'first',
      creation: 0,
      steal: [1, 'target', 1, 'star'],
    },
  },
  BottlenoseDolphin: {
    id: 'BottlenoseDolphin',
    name: 'バンドウイルカ',
    cost: 6,
    poops: 0,
    colors: ['BLUE'],
    inventory: 2,
    effect: {
      global: false,
      timing: 'first',
      creation: 7,
      steal: [5, 'target', 1],
      choice: ['creation', 'steal'],
    },
  },
};

/** プレイヤー人数に応じた在庫数を返す */
export function getInventoryForPlayerCount(animal: AnimalDef, playerCount: number): number {
  if (playerCount <= 2 && animal.inventory2p !== undefined) {
    return animal.inventory2p;
  }
  return animal.inventory;
}

/** 初期動物（全プレイヤー共通） */
export const STARTING_ANIMALS = ['RessaPanda', 'Penguin'];

/** 初期コイン */
export const STARTING_COINS = 4;

/** 星の購入コスト */
export const STAR_COST = 10;

/** 勝利に必要な星の数 */
export const STARS_TO_WIN = 3;
