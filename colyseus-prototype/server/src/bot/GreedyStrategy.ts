import type { ZooState, PlayerState } from "../schema/ZooState";
import type { BotAction, BotStrategy } from "./BotStrategy";
import { ANIMALS, STAR_COST, STARS_TO_WIN } from "../game/animals";
import { canPlaceAnimal, checkAdjacentConstraint, POOP_BURST_THRESHOLD } from "../game/gameLogic";

/**
 * 貪欲戦略（強いCPU）
 * - バーストリスクを最重要視
 * - 星を積極的に購入
 * - コスパの良い動物を選ぶ
 * - 掃除を適切なタイミングで行う
 */
export class GreedyStrategy implements BotStrategy {

  decideAction(state: ZooState, playerId: string): BotAction | null {
    const player = state.players.get(playerId);
    if (!player) return null;

    if (state.phase === "setup") {
      return this.decideSetup(state, playerId, player);
    }

    if (state.phase !== "main") return null;

    if (state.chanceCardPhase) {
      return this.decideChanceCard(state, playerId, player);
    }

    if (state.pendingEffects.length > 0) {
      return this.decideEffect(state, playerId, player);
    }

    switch (state.turnStep) {
      case "poop": return { type: "receivePoop" };
      case "roll": return this.decideRoll(player);
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

    // 出やすいダイス目のケージ（6,7,8が中心）を優先
    const preferred = [6, 7, 8, 5, 9, 4, 10, 3, 11, 2, 1];
    for (const c of preferred) {
      if (canPlaceAnimal(player, animalId, c)) {
        return { type: "placeAnimal", animalId, cageNum: c };
      }
    }
    // フォールバック
    for (let c = 1; c <= 12; c++) {
      if (canPlaceAnimal(player, animalId, c)) {
        return { type: "placeAnimal", animalId, cageNum: c };
      }
    }
    return null;
  }

  private decideRoll(player: PlayerState): BotAction {
    // うんちが多い時はリスク回避でサイコロ1個（自分のケージに当てやすい）
    // 少ない時は2個で高い目を狙う（チャンスカード11+を狙える）
    if (player.poopTokens >= 4) {
      return { type: "rollDice", diceCount: 1 };
    }
    return { type: "rollDice", diceCount: 2 };
  }

  private decideEffect(state: ZooState, playerId: string, player: PlayerState): BotAction | null {
    const effect = state.pendingEffects.at(0);
    if (!effect || effect.ownerPlayerId !== playerId) return null;

    const others = this.getOtherPlayers(state, playerId);
    if (others.length === 0) return null;

    switch (effect.effectType) {
      case "steal": {
        // 最もコインが多い相手を狙う
        const target = this.richestOpponent(state, playerId);
        return { type: "resolveSteal", targetPlayerId: target };
      }
      case "stealStar": {
        // 最も星が多い相手を狙う
        const target = this.bestStealStarTarget(state, playerId);
        return { type: "resolveStealStar", targetPlayerId: target };
      }
      case "choice": {
        // 星が2つあって10コイン近いなら creation で安全にコインを集める
        // それ以外は steal の方が効率的なら steal
        const creationAmt = effect.creationAmount;
        const stealAmt = effect.stealAmount;
        const richest = this.richestOpponent(state, playerId);
        const richestCoins = state.players.get(richest)?.coins ?? 0;
        const actualSteal = Math.min(stealAmt, richestCoins);

        if (actualSteal > creationAmt) {
          return { type: "resolveChoice", choice: "steal", targetPlayerId: richest };
        }
        return { type: "resolveChoice", choice: "creation" };
      }
      default:
        return null;
    }
  }

  private decideTrade(state: ZooState, playerId: string, player: PlayerState): BotAction | null {
    // 1. 星を買えるなら最優先（特に勝利に近いとき）
    if (!state.boughtStar && player.coins >= STAR_COST) {
      // バースト圏内でなければ買う
      if (player.poopTokens < POOP_BURST_THRESHOLD - 2) {
        return { type: "buyStar" };
      }
      // うんちが多くても、掃除代を残して星を買えるなら
      const cleanCost = Math.ceil(Math.max(0, player.poopTokens - (POOP_BURST_THRESHOLD - 1)) / 2);
      if (player.coins >= STAR_COST + cleanCost) {
        return { type: "buyStar" };
      }
    }

    // 2. 星が近い場合はコインを温存して動物を買わない
    //    星を1つ以上持っていて、あとSTAR_COSTの6割以上貯まっているなら温存
    const savingForStar = player.stars >= 1 && player.coins >= STAR_COST * 0.6;
    // 星を2つ持っている（あと1つで勝利）なら必ず温存
    const almostWinning = player.stars >= STARS_TO_WIN - 1;

    // 3. 動物購入（コスパ順で検討）— 星を温存中なら買わない
    if (!state.boughtAnimal && !almostWinning && !savingForStar) {
      const purchase = this.findBestPurchase(state, playerId, player);
      if (purchase) return purchase;
    }

    return { type: "endTrade" };
  }

  private findBestPurchase(state: ZooState, playerId: string, player: PlayerState): BotAction | null {
    // うんちリスクが高い場合は掃除代を残す
    const reserveForClean = player.poopTokens >= 4 ? 2 : 0;
    const budget = player.coins - reserveForClean;
    if (budget <= 0) return null;

    // 購入候補にスコアをつける
    const scored: { animalId: string; cageNum: number; score: number }[] = [];

    for (const [animalId, stock] of state.market.entries()) {
      if (stock <= 0) continue;
      const def = ANIMALS[animalId];
      if (!def || budget < def.cost) continue;

      // うんちが多い場合、高うんち動物を避ける
      if (player.poopTokens + def.poops >= POOP_BURST_THRESHOLD - 1 && def.poops >= 2) continue;

      for (let c = 1; c <= 12; c++) {
        if (!canPlaceAnimal(player, animalId, c) || !checkAdjacentConstraint(player, animalId, c)) continue;

        // スコア: コスパ重視
        let score = 0;

        // 基本: コストに対して期待収入が高い動物を好む
        if (def.effect.creation) score += def.effect.creation * 2;
        if (def.effect.creationIf) score += 3;
        if (def.effect.buff) score += 3;
        if (def.effect.steal || def.effect.stealIf) score += 2;
        if (def.effect.global) score += 1; // 他人のケージでも発動

        // うんちペナルティ
        score -= def.poops * 2;

        // コスト効率
        if (def.cost > 0) score = score / def.cost * 3;

        // 中央ケージ（出やすい）にあるとボーナス
        if ([6, 7, 8].includes(c)) score += 1;
        if ([5, 9].includes(c)) score += 0.5;

        scored.push({ animalId, cageNum: c, score });
      }
    }

    if (scored.length === 0) return null;

    // 最高スコアを選択
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    return { type: "buyAnimal", animalId: best.animalId, cageNum: best.cageNum };
  }

  private decideClean(player: PlayerState): BotAction {
    // バースト回避を最優先（7個以上）
    if (player.poopTokens >= POOP_BURST_THRESHOLD && player.coins >= 1) {
      return { type: "cleanPoop" };
    }
    // 危険域（5-6個）：コインがあれば必ず掃除
    if (player.poopTokens >= 5 && player.coins >= 1) {
      return { type: "cleanPoop" };
    }
    // 注意域（3-4個）：次ターンのうんち受取で危険域に入るので余裕があれば掃除
    if (player.poopTokens >= 3 && player.coins >= 1) {
      return { type: "cleanPoop" };
    }
    return { type: "endClean" };
  }

  private decideChanceCard(state: ZooState, playerId: string, player: PlayerState): BotAction | null {
    switch (state.chanceCardPhase) {
      case "useOrKeep":
        // 強カード（productHit, extraTurn）は即使用、それ以外はキープ
        // ※CPUはdrawnCardIdを知らないのでランダム要素あり
        // 基本的には即使用が有利（キープしても使わないリスク）
        return { type: "useDrawnChanceCard" };

      case "forceUse":
        // 保持カードを使う（引いたカードを新しく保持）
        return { type: "useHeldChanceCard" };

      case "using_compost": {
        // 全部コインに変換
        const count = Math.min(5, player.poopTokens);
        return { type: "resolveCompost", count };
      }

      case "using_compostGive": {
        // 最もうんちが少ない（バーストしにくい）相手にうんちを押し付ける
        // → いや、最もバーストに近い相手に押し付けて妨害
        const others = this.getOtherPlayers(state, playerId);
        if (others.length === 0) return null;
        const give = Math.min(6, player.poopTokens);
        if (give === 0) return { type: "resolveCompostGive", distributions: [] };

        // 星が最も多い相手にうんちを集中
        const target = this.leadingOpponent(state, playerId);
        return { type: "resolveCompostGive", distributions: [{ targetId: target, count: give }] };
      }

      case "using_eviction": {
        return this.decideEviction(state, playerId);
      }

      default:
        return null;
    }
  }

  private decideEviction(state: ZooState, playerId: string): BotAction | null {
    // リーダーの最も高価な動物を追い出す
    const leader = this.leadingOpponent(state, playerId);
    const leaderP = state.players.get(leader);
    if (!leaderP) return null;

    let bestAnimal: { animalId: string; cageNum: number; cost: number } | null = null;
    for (const cage of leaderP.cages) {
      for (const slot of cage.slots) {
        if (!slot.animalId) continue;
        const def = ANIMALS[slot.animalId];
        if (!def) continue;
        if (!bestAnimal || def.cost > bestAnimal.cost) {
          bestAnimal = { animalId: slot.animalId, cageNum: cage.num, cost: def.cost };
        }
      }
    }

    if (!bestAnimal) {
      // フォールバック: 任意の相手の動物
      const others = this.getOtherPlayers(state, playerId);
      for (const pid of others) {
        const p = state.players.get(pid);
        if (!p) continue;
        for (const cage of p.cages) {
          for (const slot of cage.slots) {
            if (slot.animalId) {
              return { type: "resolveEviction", targetPlayerId: pid, animalId: slot.animalId, cageNum: cage.num };
            }
          }
        }
      }
      return null;
    }

    return { type: "resolveEviction", targetPlayerId: leader, animalId: bestAnimal.animalId, cageNum: bestAnimal.cageNum };
  }

  // ===== ヘルパー =====

  private getOtherPlayers(state: ZooState, playerId: string): string[] {
    const others: string[] = [];
    state.players.forEach((_p, pid) => { if (pid !== playerId) others.push(pid); });
    return others;
  }

  /** 最もコインが多い対戦相手 */
  private richestOpponent(state: ZooState, playerId: string): string {
    let best = "";
    let maxCoins = -1;
    state.players.forEach((p, pid) => {
      if (pid === playerId) return;
      if (p.coins > maxCoins) { maxCoins = p.coins; best = pid; }
    });
    return best;
  }

  /** 最も星が多い対戦相手（星同数ならコインが多い方） */
  private leadingOpponent(state: ZooState, playerId: string): string {
    let best = "";
    let maxStars = -1;
    let maxCoins = -1;
    state.players.forEach((p, pid) => {
      if (pid === playerId) return;
      if (p.stars > maxStars || (p.stars === maxStars && p.coins > maxCoins)) {
        maxStars = p.stars; maxCoins = p.coins; best = pid;
      }
    });
    return best;
  }

  /** 星が最も多い対戦相手（stealStar用） */
  private bestStealStarTarget(state: ZooState, playerId: string): string {
    let best = "";
    let maxStars = -1;
    state.players.forEach((p, pid) => {
      if (pid === playerId) return;
      if (p.stars > maxStars) { maxStars = p.stars; best = pid; }
    });
    return best || this.getOtherPlayers(state, playerId)[0];
  }
}
