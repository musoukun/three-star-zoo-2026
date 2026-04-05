import { Room } from "colyseus";
import { ZooState, PlayerState, Cage, CageSlot, PendingEffect } from "../schema/ZooState";
import { ANIMALS, STARTING_ANIMALS, STARTING_COINS, STAR_COST, STARS_TO_WIN, getInventoryForPlayerCount } from "../game/animals";
import { CHANCE_CARDS, createChanceDeck, shuffle } from "../game/chanceCards";
import type { Effect } from "../game/types";
import {
  ADJACENCY, normalizeCageNum, POOP_BURST_THRESHOLD,
  countPlayerAnimal, canPlaceAnimal,
  checkAdjacentConstraint, evaluateCondition, calculatePoopCost,
  getEffectProcessingOrder, findMostExpensiveAnimal,
} from "../game/gameLogic";

/** Room本体から渡されるユーティリティ */
interface RoomContext {
  readonly state: ZooState;
  readonly room: Room<{ state: ZooState }>;
  addGameLog(message: string): void;
  logEffect(message: string): void;
  getPlayerName(sessionId: string): string;
  getPlayerCage(playerId: string, cageNum: number): Cage;
  onTurnEnd(): void;
}

/**
 * ゲーム進行ロジック
 * フェーズ管理・効果処理・チャンスカード・ターン進行・メッセージハンドラの実処理
 */
export class RoomGameplay {
  // ===== 秘匿状態（スキーマ外で管理） =====
  chanceDeck: string[] = [];
  chanceDiscard: string[] = [];
  heldCards: Map<string, string> = new Map();  // sessionId → cardId
  shouldDrawChance: boolean = false;
  extraTurnFlag: boolean = false;
  drawnCardId: string = "";  // 引いたカードID（サーバー内部保持）

  // デバッグ用
  _debugForcedDice: number[] | null = null;
  // poopOverrides/costOverrides はスキーマ（ZooState）に移動済み

  constructor(private ctx: RoomContext) {}

  private get state() { return this.ctx.state; }

  // ===== フェーズ管理 =====

  startSetupPhase() {
    this.state.phase = "setup";

    // プレイヤー人数に応じてマーケット在庫を調整
    const playerCount = this.state.turnOrder.length;
    for (const [id, animal] of Object.entries(ANIMALS)) {
      this.state.market.set(id, getInventoryForPlayerCount(animal, playerCount));
    }

    this.state.turnOrder.forEach((sessionId) => {
      this.state.setupInventory.set(sessionId, STARTING_ANIMALS.join(","));
    });
    this.state.currentTurn = this.state.turnOrder.at(0)!;
    console.log(`Setup phase started (${playerCount} players)`);
  }

  startMainPhase() {
    this.state.phase = "main";
    this.state.currentTurn = this.state.turnOrder.at(0)!;
    this.chanceDeck = createChanceDeck();
    this.chanceDiscard = [];
    this.heldCards.clear();
    this.state.chanceDeckCount = this.chanceDeck.length;
    this.extraTurnFlag = false;
    this.resetTurnState();
    console.log("Main phase started");
  }

  resetTurnState() {
    this.state.turnStep = "poop";
    this.state.dice1 = 0;
    this.state.dice2 = 0;
    this.state.diceSum = 0;
    this.state.diceCount = 2;
    this.state.diceRolled = false;
    this.state.pendingEffects.clear();
    this.state.effectLog.clear();
    this.state.boughtAnimal = false;
    this.state.boughtStar = false;
    this.state.chanceCardPhase = "";
    this.state.activeChanceCard = "";
    this.shouldDrawChance = false;
    this.drawnCardId = "";
  }

  nextTurn() {
    if (this.extraTurnFlag) {
      this.extraTurnFlag = false;
      this.resetTurnState();
      this.ctx.logEffect(`🃏 再入園! ${this.ctx.getPlayerName(this.state.currentTurn)} のもう1ターン`);
      return;
    }
    const prev = this.state.currentTurn;
    const idx = this.state.turnOrder.indexOf(this.state.currentTurn);
    const nextIdx = (idx + 1) % this.state.turnOrder.length;
    this.state.currentTurn = this.state.turnOrder.at(nextIdx)!;
    const prevName = this.state.players.get(prev)?.name ?? '???';
    const nextName = this.state.players.get(this.state.currentTurn)?.name ?? '???';
    console.log(`[nextTurn] ${prevName}(idx=${idx}) → ${nextName}(idx=${nextIdx}) turnOrder=[${this.state.turnOrder.toArray().map(id => this.state.players.get(id)?.name ?? id.slice(0,6)).join(',')}]`);
    this.resetTurnState();
  }

  advanceSetupTurn() {
    const currentIdx = this.state.turnOrder.indexOf(this.state.currentTurn);
    const nextIdx = currentIdx + 1;

    if (nextIdx >= this.state.turnOrder.length) {
      let allDone = true;
      this.state.turnOrder.forEach((sessionId) => {
        const inv = this.state.setupInventory.get(sessionId);
        if (inv && inv.length > 0) allDone = false;
      });

      if (allDone) {
        this.startMainPhase();
      } else {
        this.state.currentTurn = this.state.turnOrder.at(0)!;
      }
    } else {
      this.state.currentTurn = this.state.turnOrder.at(nextIdx)!;
    }
  }

  // ===== チャンスカード処理 =====

  advanceAfterIncome() {
    if (this.shouldDrawChance) {
      this.drawChanceCard();
    } else {
      this.state.turnStep = "trade";
    }
  }

  drawChanceCard() {
    if (this.chanceDeck.length === 0) {
      if (this.chanceDiscard.length === 0) {
        this.shouldDrawChance = false;
        this.state.turnStep = "trade";
        return;
      }
      this.chanceDeck = shuffle(this.chanceDiscard);
      this.chanceDiscard = [];
    }

    const cardId = this.chanceDeck.pop()!;
    this.state.chanceDeckCount = this.chanceDeck.length;
    this.drawnCardId = cardId;
    this.shouldDrawChance = false;

    const playerId = this.state.currentTurn;

    const currentClient = this.ctx.room.clients.find(c => c.sessionId === playerId);
    if (currentClient) {
      currentClient.send("chanceCardDrawn", { cardId });
    }

    const hasHeld = this.heldCards.has(playerId);
    if (hasHeld) {
      this.state.chanceCardPhase = "forceUse";
      if (currentClient) {
        currentClient.send("heldCardInfo", { cardId: this.heldCards.get(playerId)! });
      }
    } else {
      this.state.chanceCardPhase = "useOrKeep";
    }

    this.ctx.logEffect(`🃏 ${this.ctx.getPlayerName(playerId)} がチャンスカードを引いた！`);
  }

  executeChanceCard(playerId: string, cardId: string) {
    const player = this.state.players.get(playerId)!;
    const cardDef = CHANCE_CARDS[cardId];
    this.state.activeChanceCard = cardId;

    switch (cardId) {
      case 'menuHit':
        player.coins += 3;
        player.totalCoinsEarned += 3;
        this.finishChanceCard(playerId, cardId,
          `${this.ctx.getPlayerName(playerId)}: ${cardDef.name} → +3金`);
        break;

      case 'productHit':
        player.coins += 5;
        player.totalCoinsEarned += 5;
        this.finishChanceCard(playerId, cardId,
          `${this.ctx.getPlayerName(playerId)}: ${cardDef.name} → +5金`);
        break;

      case 'compost':
        this.state.chanceCardPhase = "using_compost";
        break;

      case 'compostGive':
        this.state.chanceCardPhase = "using_compostGive";
        break;

      case 'extraTurn':
        this.extraTurnFlag = true;
        this.finishChanceCard(playerId, cardId,
          `${this.ctx.getPlayerName(playerId)}: ${cardDef.name} → もう1ターン!`);
        break;

      case 'eviction':
        this.state.chanceCardPhase = "using_eviction";
        break;
    }
  }

  finishChanceCard(playerId: string, cardId: string, logMessage: string) {
    this.chanceDiscard.push(cardId);
    this.state.chanceDiscardCount = this.chanceDiscard.length;
    this.state.activeChanceCard = "";
    this.state.chanceCardPhase = "";
    this.drawnCardId = "";
    this.ctx.logEffect(`🃏 ${logMessage}`);

    if (this.state.turnStep !== "trade") {
      this.state.turnStep = "trade";
    }
  }

  // ===== 勝敗判定 =====

  checkWin(): boolean {
    const playerId = this.state.currentTurn;
    const player = this.state.players.get(playerId);
    if (!player) return false;

    if (player.stars >= STARS_TO_WIN && player.poopTokens < POOP_BURST_THRESHOLD) {
      this.state.winnerId = playerId;
      this.state.phase = "ended";
      this.ctx.room.broadcast("gameOver", { winnerId: playerId, winnerName: player.name });
      console.log(`${player.name} wins!`);
      return true;
    }
    return false;
  }

  returnMostExpensiveAnimal(playerId: string) {
    const player = this.state.players.get(playerId)!;
    const target = findMostExpensiveAnimal(player);
    if (!target) return;

    const cage = player.cages.at(target.cageIndex)!;
    cage.slots.splice(target.slotIndex, 1);
    const stock = this.state.market.get(target.animalId) ?? 0;
    this.state.market.set(target.animalId, stock + 1);
    this.ctx.logEffect(
      `${this.ctx.getPlayerName(playerId)}: ${ANIMALS[target.animalId].name}を市場に返却 (ペナルティ)`
    );
  }

  // ===== 効果処理 =====

  processEffects() {
    const rawCageNum = this.state.diceSum;
    if (rawCageNum < 1 || rawCageNum > 12) return;

    const cageNum = normalizeCageNum(rawCageNum);
    const currentPlayer = this.state.currentTurn;
    this.state.effectLog.clear();

    const adjacentCages = ADJACENCY[rawCageNum] || [];
    const playerOrder = getEffectProcessingOrder(this.state.turnOrder.toArray(), currentPlayer);

    for (const timing of ['first', 'end'] as const) {
      for (const playerId of playerOrder) {
        const player = this.state.players.get(playerId);
        if (!player) continue;

        const cage = player.cages.at(cageNum - 1);
        if (!cage) continue;

        for (const slot of cage.slots) {
          const animalDef = ANIMALS[slot.animalId];
          if (animalDef.effect.timing !== timing) continue;
          if (!animalDef.effect.global && playerId !== currentPlayer) continue;
          this.processAnimalEffect(slot, animalDef.effect, currentPlayer, playerId);
        }
      }

      if (timing === 'first') {
        for (const adjCageNum of adjacentCages) {
          for (const playerId of playerOrder) {
            const player = this.state.players.get(playerId);
            if (!player) continue;

            const adjCage = player.cages.at(adjCageNum - 1);
            if (!adjCage) continue;

            for (const slot of adjCage.slots) {
              const animalDef = ANIMALS[slot.animalId];
              if (!animalDef.effect.adjacent) continue;
              if (!animalDef.effect.global && playerId !== currentPlayer) continue;

              const [coins, targetAnimalId] = animalDef.effect.adjacent;
              if (countPlayerAnimal(player, targetAnimalId) > 0) {
                const playerState = this.state.players.get(playerId)!;
                playerState.coins += coins;
                this.ctx.logEffect(
                  `${this.ctx.getPlayerName(playerId)}: ${animalDef.name}の隣接ボーナス +${coins}コイン`
                );
              }
            }
          }
        }
      }
    }
  }

  private processAnimalEffect(slot: CageSlot, effect: Effect, currentPlayer: string, owner: string) {
    const animalDef = ANIMALS[slot.animalId];
    const ownerState = this.state.players.get(owner)!;

    // Choice効果
    if (effect.choice) {
      const pe = new PendingEffect();
      pe.effectType = "choice";
      pe.ownerPlayerId = owner;
      pe.animalId = slot.animalId;
      pe.creationAmount = effect.creation ?? 0;
      pe.stealAmount = effect.steal ? (effect.steal[0] as number) : 0;
      effect.choice.forEach(c => pe.choices.push(c));
      this.state.pendingEffects.push(pe);
      this.ctx.logEffect(`${this.ctx.getPlayerName(owner)}: ${animalDef.name} → 効果を選択してください`);
      return;
    }

    // Creation
    if (effect.creation && effect.creation > 0) {
      ownerState.coins += effect.creation;
      this.ctx.logEffect(`${this.ctx.getPlayerName(owner)}: ${animalDef.name} +${effect.creation}コイン`);
    }

    // CreationIf
    if (effect.creationIf) {
      const coins = evaluateCondition(effect.creationIf, ownerState);
      if (coins > 0) {
        ownerState.coins += coins;
        this.ctx.logEffect(`${this.ctx.getPlayerName(owner)}: ${animalDef.name} (条件) +${coins}コイン`);
      }
    }

    // Buff
    if (effect.buff) {
      const [coinsPerUnit, targetAnimalId, mode] = effect.buff;
      const count = countPlayerAnimal(ownerState, targetAnimalId);
      const coins = mode === 'each' ? coinsPerUnit * count : (count > 0 ? coinsPerUnit : 0);
      if (coins > 0) {
        ownerState.coins += coins;
        this.ctx.logEffect(`${this.ctx.getPlayerName(owner)}: ${animalDef.name} Buff +${coins}コイン`);
      }
    }

    // BonusBuff
    if (effect.bonusbuff) {
      const [coins, targetAnimalId] = effect.bonusbuff;
      const count = countPlayerAnimal(ownerState, targetAnimalId);
      if (count > 0) {
        ownerState.coins += coins;
        this.ctx.logEffect(`${this.ctx.getPlayerName(owner)}: ${animalDef.name} ボーナス +${coins}コイン`);
      }
    }

    // StealIf (ライオン等)
    if (effect.stealIf) {
      const condAnimalId = effect.stealIf[0];
      const condCount = countPlayerAnimal(ownerState, condAnimalId);
      console.log(`[StealIf] ${this.ctx.getPlayerName(owner)}: ${animalDef.name}, ${condAnimalId}数=${condCount} (ownerCages=${ownerState.cages.length})`);
      const amount = evaluateCondition(effect.stealIf, ownerState);
      if (amount > 0) {
        const pe = new PendingEffect();
        pe.effectType = "steal";
        pe.ownerPlayerId = owner;
        pe.animalId = slot.animalId;
        pe.stealAmount = amount;
        this.state.pendingEffects.push(pe);
        this.ctx.logEffect(`${this.ctx.getPlayerName(owner)}: ${animalDef.name} → 奪取対象を選択してください`);
      }
    }

    // Steal (no choice, no stealIf)
    if (effect.steal && !effect.choice && !effect.stealIf) {
      if (effect.steal.length >= 4 && effect.steal[3] === 'star') {
        const pe = new PendingEffect();
        pe.effectType = "stealStar";
        pe.ownerPlayerId = owner;
        pe.animalId = slot.animalId;
        pe.starAmount = effect.steal[0] as number;
        this.state.pendingEffects.push(pe);
        this.ctx.logEffect(`${this.ctx.getPlayerName(owner)}: ${animalDef.name} → 星奪取対象を選択してください`);
      } else if (effect.steal[1] === 'target') {
        const pe = new PendingEffect();
        pe.effectType = "steal";
        pe.ownerPlayerId = owner;
        pe.animalId = slot.animalId;
        pe.stealAmount = effect.steal[0] as number;
        this.state.pendingEffects.push(pe);
        this.ctx.logEffect(`${this.ctx.getPlayerName(owner)}: ${animalDef.name} → 奪取対象を選択してください`);
      }
    }
  }

  // ===== メッセージハンドラの実処理 =====

  handlePlaceAnimal(sessionId: string, animalId: string, cageNum: number) {
    const inventoryStr = this.state.setupInventory.get(sessionId);
    if (!inventoryStr) return;

    const inventory = inventoryStr.split(",").filter(s => s.length > 0);
    const idx = inventory.indexOf(animalId);
    if (idx === -1) return;

    const player = this.state.players.get(sessionId)!;
    if (!canPlaceAnimal(player, animalId, cageNum)) return;

    const slot = new CageSlot();
    slot.animalId = animalId;
    slot.playerId = sessionId;
    this.ctx.getPlayerCage(sessionId, cageNum).slots.push(slot);

    // マーケット在庫を減らす
    const currentStock = this.state.market.get(animalId) ?? 0;
    if (currentStock > 0) {
      this.state.market.set(animalId, currentStock - 1);
    }

    inventory.splice(idx, 1);
    this.state.setupInventory.set(sessionId, inventory.join(","));

    if (inventory.length === 0) {
      this.advanceSetupTurn();
    }
  }

  handleReceivePoop(sessionId: string) {
    const player = this.state.players.get(sessionId)!;
    let cost = calculatePoopCost(player);

    // 試験的機能: 動物ごとのうんちオーバーライド
    for (const [animalId, overridePoop] of this.state.poopOverrides.entries()) {
      const count = countPlayerAnimal(player, animalId);
      if (count > 0) {
        const basePoop = ANIMALS[animalId]?.poops ?? 0;
        cost += count * (overridePoop - basePoop);
      }
    }

    player.poopTokens += cost;

    this.state.effectLog.clear();
    if (cost > 0) {
      this.ctx.logEffect(`${this.ctx.getPlayerName(sessionId)}: うんち +${cost}個 (合計${player.poopTokens}個)`);
    }
    this.state.turnStep = "roll";
  }

  handleRollDice(sessionId: string, diceCount: number) {
    this.state.diceCount = diceCount;

    if (this._debugForcedDice && this._debugForcedDice.length >= diceCount) {
      this.state.dice1 = this._debugForcedDice[0];
      this.state.dice2 = diceCount === 2 ? this._debugForcedDice[1] : 0;
      this._debugForcedDice = null;
    } else {
      this.state.dice1 = Math.floor(Math.random() * 6) + 1;
      this.state.dice2 = diceCount === 2 ? Math.floor(Math.random() * 6) + 1 : 0;
    }
    if (diceCount === 2) {
      this.state.diceSum = this.state.dice1 + this.state.dice2;
    } else {
      this.state.diceSum = this.state.dice1;
    }
    this.state.diceRolled = true;
    this.state.turnStep = "income";
    this.ctx.addGameLog(`🎲 ${this.ctx.getPlayerName(sessionId)} がサイコロ ${diceCount}個 → ${this.state.diceSum}`);

    if (this.state.diceSum >= 11) {
      this.shouldDrawChance = true;
    }

    this.processEffects();

    if (this.state.pendingEffects.length === 0) {
      this.advanceAfterIncome();
    }
  }

  handleResolveSteal(sessionId: string, targetPlayerId: string) {
    const effect = this.state.pendingEffects.at(0);
    if (!effect) return;
    if (effect.effectType !== "steal" || effect.ownerPlayerId !== sessionId) return;

    const targetPlayer = this.state.players.get(targetPlayerId);
    if (!targetPlayer || targetPlayerId === sessionId) return;

    const amount = effect.stealAmount;
    const stolen = Math.min(amount, targetPlayer.coins);
    targetPlayer.coins -= stolen;
    this.state.players.get(effect.ownerPlayerId)!.coins += stolen;

    const animalName = ANIMALS[effect.animalId].name;
    this.ctx.logEffect(
      `${this.ctx.getPlayerName(effect.ownerPlayerId)}: ${animalName} → ${this.ctx.getPlayerName(targetPlayerId)}から${stolen}コイン奪取`
    );

    this.state.pendingEffects.shift();
    if (this.state.pendingEffects.length === 0) {
      this.advanceAfterIncome();
    }
  }

  handleResolveStealStar(sessionId: string, targetPlayerId: string) {
    const effect = this.state.pendingEffects.at(0);
    if (!effect) return;
    if (effect.effectType !== "stealStar" || effect.ownerPlayerId !== sessionId) return;

    const targetPlayer = this.state.players.get(targetPlayerId);
    if (!targetPlayer || targetPlayerId === sessionId) return;

    const amount = effect.starAmount;
    const stolen = Math.min(amount, targetPlayer.stars);
    targetPlayer.stars -= stolen;
    this.state.players.get(effect.ownerPlayerId)!.stars += stolen;

    const animalName = ANIMALS[effect.animalId].name;
    this.ctx.logEffect(
      `${this.ctx.getPlayerName(effect.ownerPlayerId)}: ${animalName} → ${this.ctx.getPlayerName(targetPlayerId)}から星${stolen}個奪取`
    );

    this.state.pendingEffects.shift();
    if (this.state.pendingEffects.length === 0) {
      this.advanceAfterIncome();
    }
  }

  handleResolveChoice(sessionId: string, choice: string, targetPlayerId?: string) {
    const effect = this.state.pendingEffects.at(0);
    if (!effect) return;
    if (effect.effectType !== "choice" || effect.ownerPlayerId !== sessionId) return;

    const animalName = ANIMALS[effect.animalId].name;
    const ownerState = this.state.players.get(effect.ownerPlayerId)!;

    if (choice === "creation") {
      const coins = effect.creationAmount;
      ownerState.coins += coins;
      this.ctx.logEffect(`${this.ctx.getPlayerName(effect.ownerPlayerId)}: ${animalName} → ${coins}コイン獲得を選択`);
    } else if (choice === "steal") {
      if (!targetPlayerId) return;
      const targetPlayer = this.state.players.get(targetPlayerId);
      if (!targetPlayer || targetPlayerId === sessionId) return;

      const amount = effect.stealAmount;
      const stolen = Math.min(amount, targetPlayer.coins);
      targetPlayer.coins -= stolen;
      ownerState.coins += stolen;
      this.ctx.logEffect(
        `${this.ctx.getPlayerName(effect.ownerPlayerId)}: ${animalName} → ${this.ctx.getPlayerName(targetPlayerId)}から${stolen}コイン奪取を選択`
      );
    } else {
      return;
    }

    this.state.pendingEffects.shift();
    if (this.state.pendingEffects.length === 0) {
      this.advanceAfterIncome();
    }
  }

  handleBuyAnimal(sessionId: string, animalId: string, cageNum: number) {
    const animalDef = ANIMALS[animalId];
    if (!animalDef) return;

    const player = this.state.players.get(sessionId)!;
    const stock = this.state.market.get(animalId) ?? 0;
    const cost = this.state.costOverrides.get(animalId) ?? animalDef.cost;

    if (stock <= 0) return;
    if (player.coins < cost) return;
    if (!canPlaceAnimal(player, animalId, cageNum)) return;
    if (!checkAdjacentConstraint(player, animalId, cageNum)) return;

    player.coins -= cost;
    this.state.market.set(animalId, stock - 1);

    const slot = new CageSlot();
    slot.animalId = animalId;
    slot.playerId = sessionId;
    this.ctx.getPlayerCage(sessionId, cageNum).slots.push(slot);

    this.state.boughtAnimal = true;
    this.state.effectLog.clear();
    this.ctx.logEffect(`${this.ctx.getPlayerName(sessionId)}: ${animalDef.name}を購入 (ケージ${cageNum})`);
  }

  handleBuyStar(sessionId: string) {
    const player = this.state.players.get(sessionId)!;
    if (player.coins < STAR_COST) return;

    player.coins -= STAR_COST;
    player.stars += 1;

    this.state.boughtStar = true;
    this.state.effectLog.clear();
    this.ctx.logEffect(`${this.ctx.getPlayerName(sessionId)}: 星を購入! (★${player.stars})`);
  }

  handleReturnAnimal(sessionId: string, returns: { animalId: string; cageNum: number }[]) {
    this.state.effectLog.clear();

    for (const { animalId, cageNum } of returns) {
      const cage = this.ctx.getPlayerCage(sessionId, cageNum);
      const idx = cage.slots.toArray().findIndex(
        (s: CageSlot) => s.animalId === animalId && s.playerId === sessionId
      );
      if (idx === -1) return;

      cage.slots.splice(idx, 1);
      const stock = this.state.market.get(animalId) ?? 0;
      this.state.market.set(animalId, stock + 1);
      this.ctx.logEffect(`${this.ctx.getPlayerName(sessionId)}: ${ANIMALS[animalId].name}を返却 (ケージ${cageNum})`);
    }
  }

  handleKeepChanceCard(sessionId: string) {
    this.heldCards.set(sessionId, this.drawnCardId);
    this.state.players.get(sessionId)!.hasHeldCard = true;
    this.drawnCardId = "";
    this.state.chanceCardPhase = "";
    this.state.turnStep = "trade";
    this.ctx.logEffect(`🃏 ${this.ctx.getPlayerName(sessionId)} がチャンスカードを伏せた`);
  }

  handleUseDrawnChanceCard(sessionId: string) {
    const cardId = this.drawnCardId;
    this.drawnCardId = "";
    this.executeChanceCard(sessionId, cardId);
  }

  handleUseHeldChanceCard(sessionId: string) {
    const heldCardId = this.heldCards.get(sessionId)!;
    this.heldCards.set(sessionId, this.drawnCardId);
    this.drawnCardId = "";
    this.executeChanceCard(sessionId, heldCardId);
  }

  handleUseHeldCardInTrade(sessionId: string) {
    if (!this.heldCards.has(sessionId)) return;
    const cardId = this.heldCards.get(sessionId)!;
    this.heldCards.delete(sessionId);
    this.state.players.get(sessionId)!.hasHeldCard = false;
    this.executeChanceCard(sessionId, cardId);
  }

  handleResolveCompost(sessionId: string, count: number) {
    const player = this.state.players.get(sessionId)!;
    const actual = Math.min(count, 5, player.poopTokens);
    if (actual < 0) return;
    player.poopTokens -= actual;
    player.coins += actual;
    player.totalCoinsEarned += actual;
    this.finishChanceCard(sessionId, 'compost',
      `${this.ctx.getPlayerName(sessionId)}: うんちの堆肥化 → 💩${actual}個 → +${actual}金`);
  }

  handleResolveCompostGive(sessionId: string, distributions: { targetId: string; count: number }[]) {
    const player = this.state.players.get(sessionId)!;
    const maxGive = Math.min(6, player.poopTokens);
    let totalGiven = 0;

    for (const { targetId, count } of distributions) {
      if (targetId === sessionId) continue;
      const target = this.state.players.get(targetId);
      if (!target || count <= 0) continue;
      const give = Math.min(count, maxGive - totalGiven);
      if (give <= 0) break;
      player.poopTokens -= give;
      target.poopTokens += give;
      totalGiven += give;
    }

    this.finishChanceCard(sessionId, 'compostGive',
      `${this.ctx.getPlayerName(sessionId)}: 堆肥の提供 → 💩${totalGiven}個を分配`);
  }

  handleResolveEviction(sessionId: string, targetPlayerId: string, animalId: string, cageNum: number) {
    const target = this.state.players.get(targetPlayerId);
    if (!target || targetPlayerId === sessionId) return;

    const normalizedCage = normalizeCageNum(cageNum);
    const cage = target.cages.at(normalizedCage - 1);
    if (!cage) return;

    const idx = cage.slots.toArray().findIndex(s => s.animalId === animalId && s.playerId === targetPlayerId);
    if (idx === -1) return;

    cage.slots.splice(idx, 1);
    const stock = this.state.market.get(animalId) ?? 0;
    this.state.market.set(animalId, stock + 1);

    this.finishChanceCard(sessionId, 'eviction',
      `${this.ctx.getPlayerName(sessionId)}: お引っ越し → ${this.ctx.getPlayerName(targetPlayerId)}の${ANIMALS[animalId].name}を市場へ`);
  }

  handleCleanPoop(sessionId: string) {
    const player = this.state.players.get(sessionId)!;
    if (player.coins < 1 || player.poopTokens <= 0) return;

    player.coins -= 1;
    const cleaned = Math.min(2, player.poopTokens);
    player.poopTokens -= cleaned;
    player.totalPoopCleaned += cleaned;

    this.state.effectLog.clear();
    this.ctx.logEffect(
      `${this.ctx.getPlayerName(sessionId)}: うんち掃除 ${cleaned}個 (-1コイン, 残り${player.poopTokens}個)`
    );
  }

  handleEndClean(sessionId: string) {
    const player = this.state.players.get(sessionId)!;
    this.state.effectLog.clear();

    if (player.poopTokens >= POOP_BURST_THRESHOLD) {
      this.state.burstPlayerId = sessionId;
      this.ctx.logEffect(`${this.ctx.getPlayerName(sessionId)}: うんちバースト! (${player.poopTokens}個)`);

      if (player.stars > 0) {
        player.stars -= 1;
        this.ctx.logEffect(`${this.ctx.getPlayerName(sessionId)}: 星を1つ失った (★${player.stars})`);
      } else {
        this.returnMostExpensiveAnimal(sessionId);
      }

      player.coins = 0;
      player.poopTokens = 0;
      this.ctx.logEffect(`${this.ctx.getPlayerName(sessionId)}: 全コインとうんちコマを銀行に返却`);
    }

    if (this.checkWin()) return;

    // 自動でターン終了
    this.handleEndTurn();
  }

  handleEndTrade() {
    if (this.state.chanceCardPhase) return;
    this.state.effectLog.clear();
    this.state.turnStep = "clean";
  }

  handleEndTurn() {
    this.state.burstPlayerId = "";
    this.ctx.onTurnEnd();
    this.nextTurn();
  }

  handleRestartGame() {
    this.state.players.forEach((p) => {
      p.coins = STARTING_COINS;
      p.stars = 0;
      p.poopTokens = 0;
      p.totalPoopCleaned = 0;
      p.totalCoinsEarned = 0;
      p.hasHeldCard = false;
      p.cages.clear();
      for (let i = 1; i <= 12; i++) {
        const cage = new Cage();
        cage.num = i;
        p.cages.push(cage);
      }
    });

    for (const [id, animal] of Object.entries(ANIMALS)) {
      this.state.market.set(id, animal.inventory);
    }

    this.state.phase = "lobby";
    this.state.currentTurn = "";
    this.state.winnerId = "";
    this.state.burstPlayerId = "";
    this.state.turnStep = "poop";
    this.state.dice1 = 0; this.state.dice2 = 0;
    this.state.diceSum = 0; this.state.diceRolled = false;
    this.state.boughtAnimal = false; this.state.boughtStar = false;
    this.state.pendingEffects.clear();
    this.state.effectLog.clear();
    this.state.setupInventory.clear();
    this.state.gameLog.clear();
    this.state.chanceDeckCount = 0;
    this.state.chanceDiscardCount = 0;
    this.state.chanceCardPhase = "";
    this.state.activeChanceCard = "";
    this.chanceDeck = [];
    this.chanceDiscard = [];
    this.heldCards.clear();
    this.shouldDrawChance = false;
    this.extraTurnFlag = false;
    this.drawnCardId = "";
  }

  // ===== バリデーション =====

  validateEffectResolve(): boolean {
    if (this.state.phase !== "main") return false;
    if (this.state.turnStep !== "income") return false;
    return true;
  }

  validateMainAction(sessionId: string, expectedStep: string): boolean {
    if (this.state.phase !== "main") return false;
    if (this.state.currentTurn !== sessionId) return false;
    if (this.state.turnStep !== expectedStep) return false;
    return true;
  }
}
