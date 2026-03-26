import { ANIMALS, ANIMAL_FACE_IMAGES, ANIMAL_ICONS } from '../game/animals';
import type { CageState } from '../hooks/useColyseus';

// ===== 隣接マップ（サーバーと同一） =====
export const ADJACENCY: Record<number, number[]> = {
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

// ===== ターンステップ定数 =====
export const TURN_STEPS = [
  { key: 'poop', icon: '💩', label: 'うんち' },
  { key: 'roll', icon: '🎲', label: 'サイコロ' },
  { key: 'income', icon: '💰', label: '収入' },
  { key: 'trade', icon: '🛒', label: '買物' },
  { key: 'clean', icon: '🧹', label: '掃除' },
  { key: 'flush', icon: '✅', label: '終了' },
];

// ===== ケージレイアウト =====
export const TOP_ROW = [1, 2, 3, 4, 5, 6];
export const BOTTOM_ROW = [11, 10, 9, 8, 7]; // 11 = 結合ケージ(11&12)

// ===== 動物アイコン =====
export function AnimalIcon({ id, size = 28, className = '' }: { id: string; size?: number; className?: string }) {
  const src = ANIMAL_FACE_IMAGES[id];
  if (src) {
    return <img src={src} alt={id} className={`animal-icon-img ${className}`} style={{ width: size, height: size }} />;
  }
  return <span style={{ fontSize: size * 0.7 }}>{ANIMAL_ICONS[id] || '🐾'}</span>;
}

// ===== 配置バリデーション =====
type PlaceResult = { ok: true } | { ok: false; reason: string };

export function checkPlacement(animalId: string, cage: CageState, allCages: CageState[]): PlaceResult {
  const animalDef = ANIMALS[animalId];
  if (!animalDef) return { ok: false, reason: '' };
  if (cage.slots.length >= 2) return { ok: false, reason: '満員' };
  if (cage.slots.some(s => s.animalId === animalId)) return { ok: false, reason: '同じ動物は不可' };
  if (cage.slots.length > 0) {
    const firstAnimal = ANIMALS[cage.slots[0].animalId];
    if (!firstAnimal) return { ok: false, reason: '' };
    if (!animalDef.colors.some(c => firstAnimal.colors.includes(c)))
      return { ok: false, reason: '色が合わない' };
  }
  // 隣接制約: 既に同じ動物を持っている場合、隣接ケージにのみ配置可能
  const hasExisting = allCages.some(c => c.slots.some(s => s.animalId === animalId));
  if (hasExisting) {
    const adjacent = ADJACENCY[cage.num] || [];
    const isAdjacentToExisting = allCages.some(c =>
      c.slots.some(s => s.animalId === animalId) && adjacent.includes(c.num)
    );
    if (!isAdjacentToExisting) return { ok: false, reason: '隣接エリアのみ配置可' };
  }
  return { ok: true };
}

export function canPlaceOnCage(animalId: string, cage: CageState, allCages?: CageState[]): boolean {
  return checkPlacement(animalId, cage, allCages ?? []).ok;
}

// ===== ケージの色 → 背景・ボーダーのスタイル =====
const CAGE_BG: Record<string, string> = {
  RED: '#fde0e0',
  BLUE: '#dff3f1',
  GREEN: '#e0f2e0',
  PURPLE: '#f0e6f6',
  ORANGE: '#fff3e0',
};
const CAGE_BORDER: Record<string, string> = {
  RED: '#e57373',
  BLUE: '#4db6ac',
  GREEN: '#66bb6a',
  PURPLE: '#ba68c8',
  ORANGE: '#ffa726',
};

export function getCageStyle(cage: CageState): React.CSSProperties {
  if (cage.slots.length === 0) return {};
  const firstAnimal = ANIMALS[cage.slots[0].animalId];
  if (!firstAnimal) return {};
  const colors = firstAnimal.colors;

  if (colors.length === 1) {
    return {
      background: CAGE_BG[colors[0]] ?? '#f8f8f8',
      borderColor: CAGE_BORDER[colors[0]] ?? '#ccc',
    };
  }

  const bgStops = colors.map((c, i) => {
    const pct1 = (i / colors.length * 100).toFixed(0);
    const pct2 = ((i + 1) / colors.length * 100).toFixed(0);
    return `${CAGE_BG[c] ?? '#f8f8f8'} ${pct1}%, ${CAGE_BG[c] ?? '#f8f8f8'} ${pct2}%`;
  }).join(', ');

  const borderStops = colors.map((c, i) => {
    const pct1 = (i / colors.length * 100).toFixed(0);
    const pct2 = ((i + 1) / colors.length * 100).toFixed(0);
    return `${CAGE_BORDER[c] ?? '#ccc'} ${pct1}%, ${CAGE_BORDER[c] ?? '#ccc'} ${pct2}%`;
  }).join(', ');

  return {
    background: `linear-gradient(to right, ${bgStops})`,
    border: 'none',
    borderImage: `linear-gradient(to right, ${borderStops}) 1`,
    borderWidth: '3px',
    borderStyle: 'solid',
  };
}
