import type { AnimalDef } from './types';

// カード用画像
import imgRessaPanda from '../assets/animals_card/RessaPanda.png';
import imgRosyFacedLovebird from '../assets/animals_card/RosyFacedLovebird.png';
import imgPenguin from '../assets/animals_card/Penguin.png';
import imgLion from '../assets/animals_card/Lion.png';
import imgGiantPanda from '../assets/animals_card/GiantPanda.png';
import imgCaliforniaSeaLion from '../assets/animals_card/CaliforniaSeaLion.png';
import imgReticulatedGiraffe from '../assets/animals_card/ReticulatedGiraffe.png';
import imgCheetah from '../assets/animals_card/Cheetah.png';
import imgAfricanElephant from '../assets/animals_card/AfricanElephant.png';
import imgSouthernWhiteRhino from '../assets/animals_card/SouthernWhiteRhino.png';
import imgBottlenoseDolphin from '../assets/animals_card/BottlenoseDolphin.png';

/** 動物アイコン（絵文字・フォールバック用） */
export const ANIMAL_ICONS: Record<string, string> = {
  RessaPanda: '🐼',
  RosyFacedLovebird: '🦜',
  Penguin: '🐧',
  Lion: '🦁',
  GiantPanda: '🐼',
  CaliforniaSeaLion: '🦭',
  ReticulatedGiraffe: '🦒',
  Cheetah: '🐆',
  AfricanElephant: '🐘',
  SouthernWhiteRhino: '🦏',
  BottlenoseDolphin: '🐬',
};

// 顔アイコン画像
import faceRessaPanda from '../assets/animals/RessaPanda_face.png';
import faceRosyFacedLovebird from '../assets/animals/RosyFacedLovebird_face.png';
import facePenguin from '../assets/animals/Penguin_face.png';
import faceLion from '../assets/animals/Lion_face.png';
import faceGiantPanda from '../assets/animals/GiantPanda_face.png';
import faceCaliforniaSeaLion from '../assets/animals/CaliforniaSeaLion_face.png';
import faceReticulatedGiraffe from '../assets/animals/ReticulatedGiraffe_face.png';
import faceCheetah from '../assets/animals/Cheetah_face.png';
import faceAfricanElephant from '../assets/animals/AfricanElephant_face.png';
import faceSouthernWhiteRhino from '../assets/animals/SouthernWhiteRhino_face.png';
import faceBottlenoseDolphin from '../assets/animals/BottlenoseDolphin_face.png';

/** カード用画像パス */
export const ANIMAL_CARD_IMAGES: Record<string, string> = {
  RessaPanda: imgRessaPanda,
  RosyFacedLovebird: imgRosyFacedLovebird,
  Penguin: imgPenguin,
  Lion: imgLion,
  GiantPanda: imgGiantPanda,
  CaliforniaSeaLion: imgCaliforniaSeaLion,
  ReticulatedGiraffe: imgReticulatedGiraffe,
  Cheetah: imgCheetah,
  AfricanElephant: imgAfricanElephant,
  SouthernWhiteRhino: imgSouthernWhiteRhino,
  BottlenoseDolphin: imgBottlenoseDolphin,
};

/** 顔アイコン画像パス（ケージ用） */
export const ANIMAL_FACE_IMAGES: Record<string, string> = {
  RessaPanda: faceRessaPanda,
  RosyFacedLovebird: faceRosyFacedLovebird,
  Penguin: facePenguin,
  Lion: faceLion,
  GiantPanda: faceGiantPanda,
  CaliforniaSeaLion: faceCaliforniaSeaLion,
  ReticulatedGiraffe: faceReticulatedGiraffe,
  Cheetah: faceCheetah,
  AfricanElephant: faceAfricanElephant,
  SouthernWhiteRhino: faceSouthernWhiteRhino,
  BottlenoseDolphin: faceBottlenoseDolphin,
};

/** 動物の効果テキスト（マーケットカード用、普通の文量） */
export const EFFECT_TEXT_FULL: Record<string, string> = {
  RessaPanda: '自分のレッサーパンダの数×1コイン獲得。パンダがいれば+2コイン',
  RosyFacedLovebird: '銀行から1コイン獲得',
  Penguin: '1羽なら1コイン、2羽以上なら3コイン獲得',
  Lion: '1頭なら1コイン奪取、2頭以上なら3コイン奪取',
  GiantPanda: '自分のパンダの数×2コイン獲得',
  CaliforniaSeaLion: '銀行から3コイン獲得。さらに1人から2コイン奪取',
  ReticulatedGiraffe: '3コイン獲得。隣接エリアの出目でも+1コイン',
  Cheetah: '3コイン獲得（全員の処理後に発動）',
  AfricanElephant: '銀行から7コイン獲得',
  SouthernWhiteRhino: '1人を選び、星を1つ奪取',
  BottlenoseDolphin: '7コイン獲得 または 1人から5コイン奪取（選択）',
};

/** 檻の中の省略表示（アイコン横に表示） */
export const EFFECT_TEXT_SHORT: Record<string, string> = {
  RessaPanda: '自 ×1💰+🐼',
  RosyFacedLovebird: '全 +1💰',
  Penguin: '全 1~3💰',
  Lion: '全 1~3奪取',
  GiantPanda: '全 ×2💰',
  CaliforniaSeaLion: '自 3💰&2奪取',
  ReticulatedGiraffe: '全 3💰+隣接',
  Cheetah: '全 3💰(後)',
  AfricanElephant: '全 7💰',
  SouthernWhiteRhino: '自 ⭐奪取',
  BottlenoseDolphin: '自 7or5奪取',
};

/** 動物の色→CSSクラスマッピング */
export const COLOR_CLASS: Record<string, string> = {
  RED: 'animal-red',
  BLUE: 'animal-blue',
  GREEN: 'animal-green',
  PURPLE: 'animal-purple',
  ORANGE: 'animal-orange',
};

export const ANIMALS: Record<string, AnimalDef> = {
  RessaPanda: {
    id: 'RessaPanda',
    name: 'レッサーパンダ',
    cost: 0,
    poops: 0,
    colors: ['ORANGE'],
    inventory: 8,
    inventory2p: 6,
    effect: { global: false, timing: 'first', creation: 0, buff: [1, 'RessaPanda', 'each'], bonusbuff: [2, 'GiantPanda', 'once'] },
  },
  RosyFacedLovebird: {
    id: 'RosyFacedLovebird',
    name: 'コンゴウインコ',
    cost: 0,
    poops: 0,
    colors: ['RED', 'GREEN', 'ORANGE'],
    inventory: 8,
    inventory2p: 6,
    effect: { global: true, timing: 'first', creation: 1 },
  },
  Penguin: {
    id: 'Penguin',
    name: 'ペンギン',
    cost: 2,
    poops: 1,
    colors: ['BLUE'],
    inventory: 8,
    inventory2p: 6,
    effect: { global: true, timing: 'first', creation: 0, creationIf: ['Penguin', '>=', '2', '?', '3', ':', '1'] },
  },
  Lion: {
    id: 'Lion',
    name: 'ライオン',
    cost: 3,
    poops: 0,
    colors: ['RED'],
    inventory: 6,
    effect: { global: true, timing: 'first', creation: 0, stealIf: ['Lion', '>=', '2', '?', '3', ':', '1'] },
  },
  GiantPanda: {
    id: 'GiantPanda',
    name: 'ジャイアントパンダ',
    cost: 3,
    poops: 2,
    colors: ['PURPLE'],
    inventory: 4,
    effect: { global: true, timing: 'first', creation: 0, buff: [2, 'GiantPanda', 'each'] },
  },
  CaliforniaSeaLion: {
    id: 'CaliforniaSeaLion',
    name: 'カリフォルニアアシカ',
    cost: 3,
    poops: 0,
    colors: ['BLUE'],
    inventory: 4,
    effect: { global: false, timing: 'first', creation: 3, steal: [2, 'target'] },
  },
  ReticulatedGiraffe: {
    id: 'ReticulatedGiraffe',
    name: 'アミメキリン',
    cost: 4,
    poops: 1,
    colors: ['GREEN'],
    inventory: 4,
    effect: { global: true, timing: 'first', creation: 3, adjacent: [1, 'ReticulatedGiraffe', 'once'] },
  },
  Cheetah: {
    id: 'Cheetah',
    name: 'チーター',
    cost: 5,
    poops: 0,
    colors: ['RED'],
    inventory: 4,
    effect: { global: true, timing: 'end', creation: 3 },
  },
  AfricanElephant: {
    id: 'AfricanElephant',
    name: 'アフリカゾウ',
    cost: 6,
    poops: 3,
    colors: ['GREEN'],
    inventory: 2,
    effect: { global: true, timing: 'first', creation: 7 },
  },
  SouthernWhiteRhino: {
    id: 'SouthernWhiteRhino',
    name: 'ミナミシロサイ',
    cost: 6,
    poops: 2,
    colors: ['GREEN'],
    inventory: 2,
    effect: { global: false, timing: 'first', creation: 0, steal: [1, 'target', 1, 'star'] },
  },
  BottlenoseDolphin: {
    id: 'BottlenoseDolphin',
    name: 'バンドウイルカ',
    cost: 6,
    poops: 0,
    colors: ['BLUE'],
    inventory: 2,
    effect: { global: false, timing: 'first', creation: 7, steal: [5, 'target', 1], choice: ['creation', 'steal'] },
  },
};

export const STAR_COST = 10;
