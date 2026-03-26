import { Room, Client } from "colyseus";
import { ZooState, PlayerState, Cage, CageSlot } from "../schema/ZooState";
import { ANIMALS, STARTING_COINS } from "../game/animals";
import { normalizeCageNum } from "../game/gameLogic";
import { RoomHistory } from "./RoomHistory";
import { RoomGameplay } from "./RoomGameplay";

export class ZooRoom extends Room<ZooState> {
  maxClients = 4;
  private minClients = 2;
  private password: string = "";
  private emptyTimeout: ReturnType<typeof setTimeout> | null = null;
  private static EMPTY_ROOM_TTL = 15 * 60 * 1000; // 15分

  gameplay!: RoomGameplay;
  history!: RoomHistory;

  // ===== ライフサイクル =====

  onCreate(options: { roomName?: string; password?: string }) {
    // autoDisposeを無効化: 自前のemptyTimerで管理する
    // デフォルトのautoDisposeは接続者0人で即dispose → allowReconnectionと競合する
    this.autoDispose = false;

    this.setState(new ZooState());

    this.state.roomName = options.roomName || "三ツ星動物園の部屋";
    if (options.password) {
      this.password = options.password;
      this.state.isPrivate = true;
    }

    for (const [id, animal] of Object.entries(ANIMALS)) {
      this.state.market.set(id, animal.inventory);
    }

    this.setMetadata({
      roomName: this.state.roomName,
      isPrivate: this.state.isPrivate,
      playerCount: 0,
      phase: "lobby",
    });

    // コンテキストオブジェクトを作成し、gameplay / history を初期化
    const ctx = {
      state: this.state,
      room: this as Room<ZooState>,
      addGameLog: (msg: string) => this.addGameLog(msg),
      logEffect: (msg: string) => this.logEffect(msg),
      getPlayerName: (sid: string) => this.getPlayerName(sid),
      getPlayerCage: (pid: string, cn: number) => this.getPlayerCage(pid, cn),
    };
    this.gameplay = new RoomGameplay(ctx);
    this.history = new RoomHistory(this, () => this.gameplay);

    this.registerMessages();
    this.startEmptyTimer();

    console.log(`ZooRoom "${this.state.roomName}" created (private=${this.state.isPrivate})`);
  }

  onJoin(client: Client, options: { name?: string; password?: string }) {
    if (this.state.isPrivate && this.password) {
      if (options.password !== this.password) {
        throw new Error("パスワードが間違っています");
      }
    }

    if (this.state.phase !== "lobby") {
      const existingPlayer = this.state.players.get(client.sessionId);
      if (existingPlayer) {
        existingPlayer.connected = true;
        this.addGameLog(`${existingPlayer.name} が再接続しました`);
        this.clearEmptyTimer();
        this.updateMetadata();
        return;
      }
      throw new Error("ゲームが進行中のため参加できません");
    }

    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = options.name || `Player ${this.state.players.size + 1}`;
    player.coins = STARTING_COINS;
    player.stars = 0;
    player.connected = true;
    player.poopTokens = 0;

    for (let i = 1; i <= 12; i++) {
      const cage = new Cage();
      cage.num = i;
      player.cages.push(cage);
    }

    this.state.players.set(client.sessionId, player);
    this.state.turnOrder.push(client.sessionId);

    if (this.state.hostId === "") {
      this.state.hostId = client.sessionId;
    }

    this.clearEmptyTimer();
    this.updateMetadata();
    this.addGameLog(`${player.name} が入室しました`);

    // 履歴情報を送信（途中参加対応）
    client.send("historyInfo", {
      undoCount: this.history.undoCount,
      redoCount: this.history.redoCount,
    });

    console.log(`${player.name} (${client.sessionId}) joined. ${this.state.players.size} players in lobby`);
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.connected = false;
    this.updateMetadata();

    if (!consented) {
      // ロビーでは30秒、ゲーム中は15分の再接続猶予
      const ttlSeconds = this.state.phase === "lobby" ? 30 : ZooRoom.EMPTY_ROOM_TTL / 1000;
      try {
        await this.allowReconnection(client, ttlSeconds);
        player.connected = true;
        this.addGameLog(`${player.name} が再接続しました`);
        this.clearEmptyTimer();
        this.updateMetadata();
        // 再接続したクライアントに履歴情報を送信
        client.send("historyInfo", {
          undoCount: this.history.undoCount,
          redoCount: this.history.redoCount,
        });
        console.log(`${player.name} reconnected`);
        return;
      } catch {
        // 再接続タイムアウト
      }
    }

    this.addGameLog(`${player.name} が退室しました`);
    console.log(`${player.name} left permanently`);

    if (this.state.phase === "lobby") {
      const idx = this.state.turnOrder.indexOf(client.sessionId);
      if (idx !== -1) this.state.turnOrder.splice(idx, 1);
      this.state.players.delete(client.sessionId);
    }

    if (this.state.hostId === client.sessionId) {
      this.reassignHost();
    }

    this.updateMetadata();

    let anyConnected = false;
    this.state.players.forEach((p) => {
      if (p.connected) anyConnected = true;
    });
    if (!anyConnected) {
      this.startEmptyTimer();
    }
  }

  onDispose() {
    this.clearEmptyTimer();
    console.log(`ZooRoom "${this.state.roomName}" disposed`);
  }

  // ===== ユーティリティ =====

  private startEmptyTimer() {
    this.clearEmptyTimer();
    this.emptyTimeout = setTimeout(() => {
      console.log(`ZooRoom "${this.state.roomName}" empty for 15 min, disposing`);
      this.disconnect();
    }, ZooRoom.EMPTY_ROOM_TTL);
  }

  private clearEmptyTimer() {
    if (this.emptyTimeout) {
      clearTimeout(this.emptyTimeout);
      this.emptyTimeout = null;
    }
  }

  private updateMetadata() {
    let connectedCount = 0;
    this.state.players.forEach((p) => {
      if (p.connected) connectedCount++;
    });
    this.setMetadata({
      roomName: this.state.roomName,
      isPrivate: this.state.isPrivate,
      playerCount: connectedCount,
      phase: this.state.phase,
    });
  }

  private reassignHost() {
    for (const id of this.state.turnOrder) {
      const p = this.state.players.get(id);
      if (p && p.connected) {
        this.state.hostId = id;
        this.addGameLog(`${p.name} がホストになりました`);
        return;
      }
    }
    this.state.hostId = "";
  }

  private addGameLog(message: string) {
    const timestamp = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.state.gameLog.push(`[${timestamp}] ${message}`);
    if (this.state.gameLog.length > 500) {
      this.state.gameLog.shift();
    }
  }

  private getPlayerName(sessionId: string): string {
    return this.state.players.get(sessionId)?.name ?? sessionId;
  }

  private logEffect(message: string) {
    this.state.effectLog.push(message);
    this.addGameLog(message);
  }

  private getPlayerCage(playerId: string, cageNum: number): Cage {
    const player = this.state.players.get(playerId)!;
    const normalized = normalizeCageNum(cageNum);
    return player.cages.at(normalized - 1)!;
  }

  // ===== メッセージハンドラ（薄いdispatch層） =====

  private registerMessages() {
    const gp = this.gameplay;

    // --- ロビー ---
    this.onMessage("setColor", (client, data: { color: string }) => {
      if (this.state.phase !== "lobby") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const validColors = ["red", "blue", "green", "orange", "purple", "pink"];
      if (!validColors.includes(data.color)) return;
      let taken = false;
      this.state.players.forEach((p) => {
        if (p.id !== client.sessionId && p.color === data.color) taken = true;
      });
      if (taken) return;
      player.color = data.color;
    });

    this.onMessage("startGame", (client) => {
      if (this.state.phase !== "lobby") return;
      if (this.state.hostId !== client.sessionId) return;
      if (this.state.players.size < 2) return;

      this.minClients = this.state.players.size;
      this.lock();
      gp.startSetupPhase();
      this.updateMetadata();
      this.addGameLog(`ゲーム開始！ (${this.minClients}人)`);
      console.log(`Game started with ${this.minClients} players`);
    });

    // --- 履歴操作 ---
    this.onMessage("undo", () => { this.history.undo(); });
    this.onMessage("redo", () => { this.history.redo(); });
    this.onMessage("resetGame", () => { this.history.resetToFirst(); });

    // --- ゲーム終了後 ---
    this.onMessage("restartGame", () => {
      if (this.state.phase !== "ended") return;
      gp.handleRestartGame();
      this.history.clear();
      this.unlock();
      this.updateMetadata();
      this.addGameLog("ゲームがリスタートされました");
      console.log("Game restarted to lobby");
    });

    // --- チャット ---
    this.onMessage("chat", (client, data: { text: string }) => {
      const player = this.state.players.get(client.sessionId);
      const name = player?.name ?? client.sessionId;
      const text = (data.text ?? '').trim().slice(0, 200);
      if (!text) return;
      this.addGameLog(`💬 ${name}: ${text}`);
    });

    // --- セットアップ ---
    this.onMessage("placeAnimal", (client, data: { animalId: string; cageNum: number }) => {
      if (this.state.phase !== "setup") return;
      if (this.state.currentTurn !== client.sessionId) return;
      this.history.push();
      gp.handlePlaceAnimal(client.sessionId, data.animalId, data.cageNum);
    });

    // --- メインフェーズ ---
    this.onMessage("receivePoop", (client) => {
      if (!gp.validateMainAction(client.sessionId, "poop")) return;
      this.history.push();
      gp.handleReceivePoop(client.sessionId);
    });

    this.onMessage("rollDice", (client, data?: { diceCount?: number }) => {
      if (!gp.validateMainAction(client.sessionId, "roll")) return;
      this.history.push();
      const diceCount = (data?.diceCount === 1) ? 1 : 2;
      gp.handleRollDice(client.sessionId, diceCount);
    });

    this.onMessage("resolveSteal", (client, data: { targetPlayerId: string }) => {
      if (!gp.validateEffectResolve()) return;
      if (this.state.pendingEffects.length === 0) return;
      this.history.push();
      gp.handleResolveSteal(client.sessionId, data.targetPlayerId);
    });

    this.onMessage("resolveStealStar", (client, data: { targetPlayerId: string }) => {
      if (!gp.validateEffectResolve()) return;
      if (this.state.pendingEffects.length === 0) return;
      this.history.push();
      gp.handleResolveStealStar(client.sessionId, data.targetPlayerId);
    });

    this.onMessage("resolveChoice", (client, data: { choice: string; targetPlayerId?: string }) => {
      if (!gp.validateEffectResolve()) return;
      if (this.state.pendingEffects.length === 0) return;
      this.history.push();
      gp.handleResolveChoice(client.sessionId, data.choice, data.targetPlayerId);
    });

    this.onMessage("buyAnimal", (client, data: { animalId: string; cageNum: number }) => {
      if (!gp.validateMainAction(client.sessionId, "trade")) return;
      if (this.state.boughtAnimal) return;
      this.history.push();
      gp.handleBuyAnimal(client.sessionId, data.animalId, data.cageNum);
    });

    this.onMessage("buyStar", (client) => {
      if (!gp.validateMainAction(client.sessionId, "trade")) return;
      if (this.state.boughtStar) return;
      this.history.push();
      gp.handleBuyStar(client.sessionId);
    });

    this.onMessage("returnAnimal", (client, data: { returns: { animalId: string; cageNum: number }[] }) => {
      if (!gp.validateMainAction(client.sessionId, "trade")) return;
      this.history.push();
      gp.handleReturnAnimal(client.sessionId, data.returns);
    });

    this.onMessage("endTrade", (client) => {
      if (!gp.validateMainAction(client.sessionId, "trade")) return;
      if (this.state.chanceCardPhase) return;
      this.history.push();
      this.state.effectLog.clear();
      this.state.turnStep = "clean";
    });

    // --- チャンスカード ---
    this.onMessage("keepChanceCard", (client) => {
      if (this.state.currentTurn !== client.sessionId) return;
      if (this.state.chanceCardPhase !== "useOrKeep") return;
      this.history.push();
      gp.handleKeepChanceCard(client.sessionId);
    });

    this.onMessage("useDrawnChanceCard", (client) => {
      if (this.state.currentTurn !== client.sessionId) return;
      if (this.state.chanceCardPhase !== "useOrKeep" && this.state.chanceCardPhase !== "forceUse") return;
      this.history.push();
      gp.handleUseDrawnChanceCard(client.sessionId);
    });

    this.onMessage("useHeldChanceCard", (client) => {
      if (this.state.currentTurn !== client.sessionId) return;
      if (this.state.chanceCardPhase !== "forceUse") return;
      this.history.push();
      gp.handleUseHeldChanceCard(client.sessionId);
    });

    this.onMessage("useHeldCardInTrade", (client) => {
      if (!gp.validateMainAction(client.sessionId, "trade")) return;
      this.history.push();
      gp.handleUseHeldCardInTrade(client.sessionId);
    });

    this.onMessage("cancelChanceCard", (client) => {
      if (this.state.currentTurn !== client.sessionId) return;
      if (!this.state.chanceCardPhase?.startsWith('using_')) return;
      // Undo と同じ処理
      this.history.undo();
    });

    this.onMessage("resolveCompost", (client, data: { count: number }) => {
      if (this.state.currentTurn !== client.sessionId) return;
      if (this.state.chanceCardPhase !== "using_compost") return;
      this.history.push();
      gp.handleResolveCompost(client.sessionId, data.count);
    });

    this.onMessage("resolveCompostGive", (client, data: { distributions: { targetId: string; count: number }[] }) => {
      if (this.state.currentTurn !== client.sessionId) return;
      if (this.state.chanceCardPhase !== "using_compostGive") return;
      this.history.push();
      gp.handleResolveCompostGive(client.sessionId, data.distributions);
    });

    this.onMessage("resolveEviction", (client, data: { targetPlayerId: string; animalId: string; cageNum: number }) => {
      if (this.state.currentTurn !== client.sessionId) return;
      if (this.state.chanceCardPhase !== "using_eviction") return;
      this.history.push();
      gp.handleResolveEviction(client.sessionId, data.targetPlayerId, data.animalId, data.cageNum);
    });

    this.onMessage("cleanPoop", (client) => {
      if (!gp.validateMainAction(client.sessionId, "clean")) return;
      this.history.push();
      gp.handleCleanPoop(client.sessionId);
    });

    this.onMessage("endClean", (client) => {
      if (!gp.validateMainAction(client.sessionId, "clean")) return;
      this.history.push();
      gp.handleEndClean(client.sessionId);
    });

    this.onMessage("endTurn", (client) => {
      if (!gp.validateMainAction(client.sessionId, "flush")) return;
      this.history.push();
      gp.handleEndTurn();
    });

    // --- デバッグ ---
    this.onMessage("__debugSetDice", (_client, data: { dice: number[] }) => {
      if (data?.dice && Array.isArray(data.dice)) {
        gp._debugForcedDice = data.dice;
      }
    });

    this.onMessage("__debugSetCoins", (_client, data: { playerId: string; coins: number }) => {
      const player = this.state.players.get(data.playerId);
      if (player) player.coins = data.coins;
    });

    this.onMessage("__debugSetStars", (_client, data: { playerId: string; stars: number }) => {
      const player = this.state.players.get(data.playerId);
      if (player) player.stars = data.stars;
    });

    this.onMessage("__debugSetPoop", (_client, data: { playerId: string; poop: number }) => {
      const player = this.state.players.get(data.playerId);
      if (player) player.poopTokens = data.poop;
    });
  }
}
