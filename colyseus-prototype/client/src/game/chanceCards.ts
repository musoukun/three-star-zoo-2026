/** チャンスカード表示データ（クライアント側） */

export interface ChanceCardDisplay {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export const CHANCE_CARD_DATA: Record<string, ChanceCardDisplay> = {
  menuHit: {
    id: 'menuHit',
    name: '新メニューがヒット',
    icon: '🍽️',
    description: '銀行から3金もらう',
  },
  productHit: {
    id: 'productHit',
    name: '新商品が大ヒット',
    icon: '🎁',
    description: '銀行から5金もらう',
  },
  compost: {
    id: 'compost',
    name: 'うんちの堆肥化',
    icon: '🌱',
    description: '自分の💩を最大5個まで1つ1金に変える',
  },
  compostGive: {
    id: 'compostGive',
    name: '堆肥の提供',
    icon: '🚛',
    description: '自分の💩を最大6個まで他プレイヤーに分配',
  },
  extraTurn: {
    id: 'extraTurn',
    name: '再入園',
    icon: '🔄',
    description: 'ターン終了後もう1ターン',
  },
  eviction: {
    id: 'eviction',
    name: 'お引っ越し',
    icon: '📦',
    description: '他プレイヤーの動物1頭を市場に戻す',
  },
};
