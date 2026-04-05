import { Room } from "colyseus";
import { ZooState, PlayerState, Cage, CageSlot, PendingEffect } from "../schema/ZooState";
import type { RoomGameplay } from "./RoomGameplay";

/**
 * Undo/Redo スナップショット管理
 * Room参照を通じてstate・broadcast・clientsにアクセスする
 */
export class RoomHistory {
  private undoStack: any[] = [];
  private redoStack: any[] = [];
  private static MAX_HISTORY = 200;

  constructor(
    private room: Room<{ state: ZooState }>,
    private getGameplay: () => RoomGameplay,
  ) {}

  get undoCount() { return this.undoStack.length; }
  get redoCount() { return this.redoStack.length; }

  /** 現在のstateのスナップショットを保存（秘匿データ含む） */
  push() {
    this.undoStack.push(this.createSnapshotObj());
    if (this.undoStack.length > RoomHistory.MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    console.log(`[History] push (undo=${this.undoStack.length}, redo=${this.redoStack.length})`);
    this.broadcastInfo();
  }

  /** Undo: 1つ前の状態に巻き戻す */
  undo(): boolean {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(this.createSnapshotObj());
    const snapshot = this.undoStack.pop()!;
    this.restoreSnapshot(snapshot);
    this.broadcastInfo();
    this.notifyHeldCards();
    console.log(`Undo (残り${this.undoStack.length})`);
    return true;
  }

  /** Redo: Undoした状態をやり直す */
  redo(): boolean {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(this.createSnapshotObj());
    const snapshot = this.redoStack.pop()!;
    this.restoreSnapshot(snapshot);
    this.broadcastInfo();
    this.notifyHeldCards();
    console.log(`Redo (残り${this.redoStack.length})`);
    return true;
  }

  /** 最初のスナップショットに戻す（ゲームリセット） */
  resetToFirst(): boolean {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(this.createSnapshotObj());
    const firstSnapshot = this.undoStack[0];
    this.undoStack = [];
    this.restoreSnapshot(firstSnapshot);
    this.broadcastInfo();
    this.notifyHeldCards();
    console.log("Reset to initial state");
    return true;
  }

  /** スタックを全クリア（restartGame用） */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** 履歴情報をクライアントにブロードキャスト */
  broadcastInfo() {
    this.room.broadcast("historyInfo", {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    });
  }

  // ===== スナップショット作成・復元 =====

  private createSnapshotObj() {
    const gp = this.getGameplay();
    return {
      state: this.room.state.toJSON(),
      chanceDeck: [...gp.chanceDeck],
      chanceDiscard: [...gp.chanceDiscard],
      heldCards: Object.fromEntries(gp.heldCards),
      shouldDrawChance: gp.shouldDrawChance,
      extraTurnFlag: gp.extraTurnFlag,
      drawnCardId: gp.drawnCardId,
      poopOverrides: { ...gp.poopOverrides },
      costOverrides: { ...gp.costOverrides },
    };
  }

  private restoreSnapshot(snapshot: any) {
    this.restoreFromJSON(snapshot.state);
    const gp = this.getGameplay();
    gp.chanceDeck = snapshot.chanceDeck ?? [];
    gp.chanceDiscard = snapshot.chanceDiscard ?? [];
    gp.heldCards = new Map(Object.entries(snapshot.heldCards ?? {}));
    gp.shouldDrawChance = snapshot.shouldDrawChance ?? false;
    gp.extraTurnFlag = snapshot.extraTurnFlag ?? false;
    gp.drawnCardId = snapshot.drawnCardId ?? "";
    gp.poopOverrides = snapshot.poopOverrides ?? {};
    gp.costOverrides = snapshot.costOverrides ?? {};
  }

  /** JSONからstateを完全復元 */
  private restoreFromJSON(json: any) {
    const state = this.room.state;

    // players
    state.players.clear();
    if (json.players) {
      for (const [pid, pj] of Object.entries(json.players) as [string, any][]) {
        const p = new PlayerState();
        p.id = pj.id; p.name = pj.name; p.color = pj.color ?? ""; p.coins = pj.coins;
        p.stars = pj.stars; p.connected = pj.connected;
        p.poopTokens = pj.poopTokens ?? 0;
        p.totalPoopCleaned = pj.totalPoopCleaned ?? 0;
        p.totalCoinsEarned = pj.totalCoinsEarned ?? 0;
        p.hasHeldCard = pj.hasHeldCard ?? false;
        p.isCpu = pj.isCpu ?? false;
        p.cages.clear();
        if (pj.cages) {
          for (const cj of pj.cages) {
            const cage = new Cage();
            cage.num = cj.num;
            if (cj.slots) {
              for (const sj of cj.slots) {
                const slot = new CageSlot();
                slot.animalId = sj.animalId;
                slot.playerId = sj.playerId;
                cage.slots.push(slot);
              }
            }
            p.cages.push(cage);
          }
        }
        state.players.set(pid, p);
      }
    }

    // market
    state.market.clear();
    if (json.market) {
      for (const [k, v] of Object.entries(json.market)) {
        state.market.set(k, v as number);
      }
    }

    // scalars
    state.roomName = json.roomName ?? state.roomName;
    state.hostId = json.hostId ?? state.hostId;
    state.isPrivate = json.isPrivate ?? state.isPrivate;
    state.phase = json.phase ?? "lobby";
    state.currentTurn = json.currentTurn ?? "";
    state.turnStep = json.turnStep ?? "poop";
    state.dice1 = json.dice1 ?? 0;
    state.dice2 = json.dice2 ?? 0;
    state.diceSum = json.diceSum ?? 0;
    state.diceCount = json.diceCount ?? 2;
    state.diceRolled = json.diceRolled ?? false;
    state.boughtAnimal = json.boughtAnimal ?? false;
    state.boughtStar = json.boughtStar ?? false;
    state.winnerId = json.winnerId ?? "";
    state.burstPlayerId = json.burstPlayerId ?? "";
    state.chanceDeckCount = json.chanceDeckCount ?? 0;
    state.chanceDiscardCount = json.chanceDiscardCount ?? 0;
    state.chanceCardPhase = json.chanceCardPhase ?? "";
    state.activeChanceCard = json.activeChanceCard ?? "";

    // pendingEffects
    state.pendingEffects.clear();
    if (json.pendingEffects) {
      for (const ej of json.pendingEffects) {
        const pe = new PendingEffect();
        pe.effectType = ej.effectType;
        pe.ownerPlayerId = ej.ownerPlayerId;
        pe.animalId = ej.animalId;
        pe.stealAmount = ej.stealAmount ?? 0;
        pe.creationAmount = ej.creationAmount ?? 0;
        pe.starAmount = ej.starAmount ?? 0;
        if (ej.choices) ej.choices.forEach((c: string) => pe.choices.push(c));
        state.pendingEffects.push(pe);
      }
    }

    // effectLog
    state.effectLog.clear();
    if (json.effectLog) {
      for (const log of json.effectLog) state.effectLog.push(log);
    }

    // gameLog
    state.gameLog.clear();
    if (json.gameLog) {
      for (const log of json.gameLog) state.gameLog.push(log);
    }

    // turnOrder
    state.turnOrder.clear();
    if (json.turnOrder) {
      for (const id of json.turnOrder) state.turnOrder.push(id);
    }

    // setupInventory
    state.setupInventory.clear();
    if (json.setupInventory) {
      for (const [k, v] of Object.entries(json.setupInventory)) {
        state.setupInventory.set(k, v as string);
      }
    }
  }

  /** 伏せカード情報を各プレイヤーに個別通知 */
  notifyHeldCards() {
    const gp = this.getGameplay();
    for (const client of this.room.clients) {
      if (gp.heldCards.has(client.sessionId)) {
        client.send("heldCardInfo", { cardId: gp.heldCards.get(client.sessionId)! });
      } else {
        client.send("heldCardCleared", {});
      }
    }
    if (gp.drawnCardId && this.room.state.chanceCardPhase) {
      const currentClient = this.room.clients.find(c => c.sessionId === this.room.state.currentTurn);
      if (currentClient) {
        currentClient.send("chanceCardDrawn", { cardId: gp.drawnCardId });
      }
    }
  }
}
