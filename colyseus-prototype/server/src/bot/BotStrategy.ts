import type { ZooState, PlayerState } from "../schema/ZooState";

/** Botが各フェーズで返すアクション */
export type BotAction =
  | { type: "receivePoop" }
  | { type: "rollDice"; diceCount: 1 | 2 }
  | { type: "resolveSteal"; targetPlayerId: string }
  | { type: "resolveStealStar"; targetPlayerId: string }
  | { type: "resolveChoice"; choice: "creation" | "steal"; targetPlayerId?: string }
  | { type: "buyAnimal"; animalId: string; cageNum: number }
  | { type: "buyStar" }
  | { type: "endTrade" }
  | { type: "cleanPoop" }
  | { type: "endClean" }
  | { type: "endTurn" }
  | { type: "placeAnimal"; animalId: string; cageNum: number }
  // チャンスカード
  | { type: "keepChanceCard" }
  | { type: "useDrawnChanceCard" }
  | { type: "useHeldChanceCard" }
  | { type: "resolveCompost"; count: number }
  | { type: "resolveCompostGive"; distributions: { targetId: string; count: number }[] }
  | { type: "resolveEviction"; targetPlayerId: string; animalId: string; cageNum: number };

/** Bot戦略インターフェース */
export interface BotStrategy {
  /** 現在の状態から次のアクションを決定 */
  decideAction(state: ZooState, playerId: string): BotAction | null;
}
