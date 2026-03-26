/** チャンスカード定義 */

export interface ChanceCardDef {
  id: string;
  name: string;
  description: string;
  needsInteraction: boolean;
}

export const CHANCE_CARDS: Record<string, ChanceCardDef> = {
  menuHit: {
    id: 'menuHit',
    name: '新メニューがヒット',
    description: '銀行から3金もらう',
    needsInteraction: false,
  },
  productHit: {
    id: 'productHit',
    name: '新商品が大ヒット',
    description: '銀行から5金もらう',
    needsInteraction: false,
  },
  compost: {
    id: 'compost',
    name: 'うんちの堆肥化',
    description: '自分の💩を最大5個まで1つあたり1金に変える',
    needsInteraction: true,
  },
  compostGive: {
    id: 'compostGive',
    name: '堆肥の提供',
    description: '自分の💩を最大6個まで他のプレイヤーに分配する',
    needsInteraction: true,
  },
  extraTurn: {
    id: 'extraTurn',
    name: '再入園',
    description: 'このターンが終わったら自分のターンをもう1度行う',
    needsInteraction: false,
  },
  eviction: {
    id: 'eviction',
    name: 'お引っ越し',
    description: '任意のプレイヤー1人の動物1頭を指定して市場に戻す',
    needsInteraction: true,
  },
};

/** 配列シャッフル (Fisher-Yates) */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 山札生成: 各カード2枚ずつ = 12枚 */
export function createChanceDeck(): string[] {
  const deck: string[] = [];
  for (const id of Object.keys(CHANCE_CARDS)) {
    deck.push(id, id);
  }
  return shuffle(deck);
}
