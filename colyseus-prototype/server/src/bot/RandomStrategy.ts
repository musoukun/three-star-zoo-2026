import type { ZooState, PlayerState } from "../schema/ZooState";
import type { BotAction, BotStrategy } from "./BotStrategy";
import { ANIMALS, STAR_COST } from "../game/animals";
import { canPlaceAnimal, checkAdjacentConstraint } from "../game/gameLogic";

/** ランダム戦略: 合法手からランダムに選択する */
export class RandomStrategy implements BotStrategy {

  decideAction(state: ZooState, playerId: string): BotAction | null {
    const player = state.players.get(playerId);
    if (!player) return null;

    // セットアップフェーズ
    if (state.phase === "setup") {
      return this.decideSetup(state, playerId, player);
    }

    if (state.phase !== "main") return null;

    // チャンスカード処理中
    if (state.chanceCardPhase) {
      return this.decideChanceCard(state, playerId, player);
    }

    // ペンディングエフェクト処理
    if (state.pendingEffects.length > 0) {
      return this.decideEffect(state, playerId);
    }

    // 通常のターンステップ
    switch (state.turnStep) {
      case "poop": return { type: "receivePoop" };
      case "roll": return this.decideRoll();
      case "trade": return this.decideTrade(state, playerId, player);
      case "clean": return this.decideClean(player);
      case "flush": return { type: "endTurn" };
      default: return null;
    }
  }

  private decideSetup(state: ZooState, playerId: string, player: PlayerState): BotAction | null {
    const invStr = state.setupInventory.get(playerId);
    if (!invStr || invStr.length === 0) return null;

    const inventory = invStr.split(",").filter(s => s.length > 0);
    if (inventory.length === 0) return null;

    const animalId = inventory[0];

    // 配置可能なケージをランダムに探す
    const validCages: number[] = [];
    for (let i = 1; i <= 12; i++) {
      if (canPlaceAnimal(player, animalId, i)) {
        validCages.push(i);
      }
    }

    if (validCages.length === 0) return null;
    const cageNum = validCages[Math.floor(Math.random() * validCages.length)];
    return { type: "placeAnimal", animalId, cageNum };
  }

  private decideRoll(): BotAction {
    // ランダムに1個か2個
    const diceCount = Math.random() < 0.5 ? 1 : 2;
    return { type: "rollDice", diceCount: diceCount as 1 | 2 };
  }

  private decideEffect(state: ZooState, playerId: string): BotAction | null {
    const effect = state.pendingEffects.at(0);
    if (!effect) return null;

    // 自分のエフェクトでなければ何もしない（手番プレイヤーが処理する）
    if (effect.ownerPlayerId !== playerId) return null;

    const otherPlayers = this.getOtherPlayers(state, playerId);
    if (otherPlayers.length === 0) return null;

    const target = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];

    switch (effect.effectType) {
      case "steal":
        return { type: "resolveSteal", targetPlayerId: target };
      case "stealStar":
        return { type: "resolveStealStar", targetPlayerId: target };
      case "choice": {
        const choices = effect.choices.toArray();
        const choice = choices[Math.floor(Math.random() * choices.length)] as "creation" | "steal";
        if (choice === "steal") {
          return { type: "resolveChoice", choice, targetPlayerId: target };
        }
        return { type: "resolveChoice", choice };
      }
      default:
        return null;
    }
  }

  private decideTrade(state: ZooState, playerId: string, player: PlayerState): BotAction | null {
    // 50%の確率で星を買う（買えるなら）
    if (!state.boughtStar && player.coins >= STAR_COST && Math.random() < 0.5) {
      return { type: "buyStar" };
    }

    // 30%の確率で動物を買う（買えるなら）
    if (!state.boughtAnimal && Math.random() < 0.3) {
      const purchase = this.findRandomPurchase(state, playerId, player);
      if (purchase) return purchase;
    }

    return { type: "endTrade" };
  }

  private findRandomPurchase(state: ZooState, playerId: string, player: PlayerState): BotAction | null {
    // 購入可能な動物リスト
    const candidates: { animalId: string; cageNum: number }[] = [];
    for (const [animalId, stock] of state.market.entries()) {
      if (stock <= 0) continue;
      const def = ANIMALS[animalId];
      if (!def || player.coins < def.cost) continue;

      for (let c = 1; c <= 12; c++) {
        if (canPlaceAnimal(player, animalId, c) && checkAdjacentConstraint(player, animalId, c)) {
          candidates.push({ animalId, cageNum: c });
        }
      }
    }

    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return { type: "buyAnimal", animalId: pick.animalId, cageNum: pick.cageNum };
  }

  private decideClean(player: PlayerState): BotAction {
    // うんちが5個以上でコインがあれば掃除する
    if (player.poopTokens >= 5 && player.coins >= 1) {
      return { type: "cleanPoop" };
    }
    return { type: "endClean" };
  }

  private decideChanceCard(state: ZooState, playerId: string, player: PlayerState): BotAction | null {
    switch (state.chanceCardPhase) {
      case "useOrKeep":
        // 50%でキープ、50%で即使用
        return Math.random() < 0.5
          ? { type: "keepChanceCard" }
          : { type: "useDrawnChanceCard" };

      case "forceUse":
        // ランダムに引いたカードか保持カードを使用
        return Math.random() < 0.5
          ? { type: "useDrawnChanceCard" }
          : { type: "useHeldChanceCard" };

      case "using_compost": {
        const count = Math.min(5, player.poopTokens);
        return { type: "resolveCompost", count };
      }

      case "using_compostGive": {
        const others = this.getOtherPlayers(state, playerId);
        if (others.length === 0) return null;
        const give = Math.min(6, player.poopTokens);
        // 全部を最初の相手に渡す（シンプル）
        const target = others[Math.floor(Math.random() * others.length)];
        return { type: "resolveCompostGive", distributions: [{ targetId: target, count: give }] };
      }

      case "using_eviction": {
        // 他プレイヤーの動物からランダムに選ぶ
        return this.decideEviction(state, playerId);
      }

      default:
        return null;
    }
  }

  private decideEviction(state: ZooState, playerId: string): BotAction | null {
    const candidates: { targetPlayerId: string; animalId: string; cageNum: number }[] = [];
    state.players.forEach((p, pid) => {
      if (pid === playerId) return;
      for (const cage of p.cages) {
        for (const slot of cage.slots) {
          if (slot.animalId) {
            candidates.push({ targetPlayerId: pid, animalId: slot.animalId, cageNum: cage.num });
          }
        }
      }
    });

    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return { type: "resolveEviction", ...pick };
  }

  private getOtherPlayers(state: ZooState, playerId: string): string[] {
    const others: string[] = [];
    state.players.forEach((_p, pid) => {
      if (pid !== playerId) others.push(pid);
    });
    return others;
  }
}
