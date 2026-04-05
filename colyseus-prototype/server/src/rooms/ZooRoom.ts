import { Room, Client, Deferred } from "colyseus";
import { ZooState, PlayerState, Cage, CageSlot } from "../schema/ZooState";
import { ANIMALS, STARTING_COINS } from "../game/animals";
import { normalizeCageNum } from "../game/gameLogic";
import { RoomHistory } from "./RoomHistory";
import { RoomGameplay } from "./RoomGameplay";
import { BotManager } from "../bot/BotManager";

/** 不在プレイヤーの再接続管理 */
interface ReconnectionEntry {
  deferred: Deferred<Client>;
  /** 切断時点のターンインデックス */
  disconnectedAtTurn: number;
  /** 1時間フォールバックタイマー */
  timeout: ReturnType<typeof setTimeout>;
}

/** 何ターン不在で追放するか */
const MISSED_TURNS_LIMIT = 3;
/** 最大再接続猶予（ミリ秒） */
const MAX_RECONNECT_MS = 60 * 60 * 1000; // 1時間
/** フェーズ別の空室タイマー（ミリ秒） */
const EMPTY_ROOM_MS: Record<string, number> = {
  lobby:   10 * 60 * 1000, // 10分
  setup:   30 * 60 * 1000, // 30分
  main:    30 * 60 * 1000, // 30分
  ended:   15 * 60 * 1000, // 15分
};

export class ZooRoom extends Room<{ state: ZooState }> {
  maxClients = 4;
  private minClients = 2;
  private password: string = "";

  /** 再接続待ちプレイヤー (sessionId → entry) */
  private reconnections = new Map<string, ReconnectionEntry>();
  /** ゲーム全体のターン経過カウンター（endTurn ごとに +1） */
  turnCounter: number = 0;
  /** 人間プレイヤー0人時の空室タイマー */
  private emptyRoomTimeout: ReturnType<typeof setTimeout> | null = null;

  gameplay!: RoomGameplay;
  history!: RoomHistory;
  botManager!: BotManager;

  // ===== ライフサイクル =====

  onCreate(options: { roomName?: string; password?: string }) {
    this.setState(new ZooState());
    this.autoDispose = false;

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

    const ctx = {
      state: this.state,
      room: this as Room<{ state: ZooState }>,
      addGameLog: (msg: string) => this.addGameLog(msg),
      logEffect: (msg: string) => this.logEffect(msg),
      getPlayerName: (sid: string) => this.getPlayerName(sid),
      getPlayerCage: (pid: string, cn: number) => this.getPlayerCage(pid, cn),
      onTurnEnd: () => { this.turnCounter++; this.checkDisconnectedPlayers(); },
    };
    this.gameplay = new RoomGameplay(ctx);
    this.history = new RoomHistory(this, () => this.gameplay);
    this.botManager = new BotManager(
      this.state,
      (pid, action) => { const { type, ...data } = action; this.dispatch(pid, type, data); },
    );

    this.registerMessages();

    console.log(`ZooRoom "${this.state.roomName}" created (private=${this.state.isPrivate})`);
  }

  onJoin(client: Client, options: { name?: string; password?: string }) {
    if (this.state.isPrivate && this.password) {
      if (options.password !== this.password) {
        throw new Error("パスワードが間違っています");
      }
    }

    if (this.state.phase !== "lobby") {
      // 同じsessionIdでの再接続
      const existingPlayer = this.state.players.get(client.sessionId);
      if (existingPlayer) {
        existingPlayer.connected = true;
        this.addGameLog(`${existingPlayer.name} が再接続しました`);
        this.updateMetadata();
        return;
      }

      // 名前一致で切断中プレイヤーに乗り移り（退室後の再入室）
      const joinName = options.name || '';
      if (joinName) {
        for (const [oldSessionId, player] of this.state.players.entries()) {
          if (!player.connected && player.name === joinName) {
            // 再接続エントリがあればキャンセル
            this.cancelReconnection(oldSessionId);

            // turnOrderとplayersのキーを新sessionIdに差し替え
            const idx = this.state.turnOrder.indexOf(oldSessionId);
            if (idx !== -1) {
              this.state.turnOrder.splice(idx, 1);
              this.state.turnOrder.splice(idx, 0, client.sessionId);
            }
            if (this.state.currentTurn === oldSessionId) this.state.currentTurn = client.sessionId;
            if (this.state.hostId === oldSessionId) this.state.hostId = client.sessionId;

            // プレイヤー情報を新sessionIdで再登録
            this.state.players.delete(oldSessionId);
            player.id = client.sessionId;
            player.connected = true;
            this.state.players.set(client.sessionId, player);

            // ケージ内のスロットのplayerIdも更新
            for (const cage of player.cages) {
              for (const slot of cage.slots) {
                if (slot.playerId === oldSessionId) slot.playerId = client.sessionId;
              }
            }

            // pendingEffectsのownerPlayerIdも更新
            for (const pe of this.state.pendingEffects) {
              if (pe.ownerPlayerId === oldSessionId) pe.ownerPlayerId = client.sessionId;
            }

            // setupInventoryのキーも移行
            if (this.state.setupInventory.has(oldSessionId)) {
              const inv = this.state.setupInventory.get(oldSessionId)!;
              this.state.setupInventory.delete(oldSessionId);
              this.state.setupInventory.set(client.sessionId, inv);
            }

            // heldCardsのキーも移行
            if (this.gameplay.heldCards.has(oldSessionId)) {
              const card = this.gameplay.heldCards.get(oldSessionId)!;
              this.gameplay.heldCards.delete(oldSessionId);
              this.gameplay.heldCards.set(client.sessionId, card);
            }

            this.updateMetadata();
            this.cancelEmptyTimer();
            this.addGameLog(`${player.name} が再入室しました`);

            client.send("historyInfo", {
              undoCount: this.history.undoCount,
              redoCount: this.history.redoCount,
            });

            console.log(`${player.name} rejoined as ${client.sessionId} (was ${oldSessionId})`);
            return;
          }
        }
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

    this.updateMetadata();
    this.cancelEmptyTimer();
    this.addGameLog(`${player.name} が入室しました`);

    client.send("historyInfo", {
      undoCount: this.history.undoCount,
      redoCount: this.history.redoCount,
    });

    console.log(`${player.name} (${client.sessionId}) joined. ${this.state.players.size} players in lobby`);
  }

  async onLeave(client: Client, code: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // 再接続エントリがあればクリーンアップ
    this.cancelReconnection(client.sessionId);

    player.connected = false;
    this.addGameLog(`${player.name} が退室しました`);
    console.log(`${player.name} left permanently (code: ${code})`);

    if (this.state.phase === "lobby") {
      const idx = this.state.turnOrder.indexOf(client.sessionId);
      if (idx !== -1) this.state.turnOrder.splice(idx, 1);
      this.state.players.delete(client.sessionId);
    }

    if (this.state.hostId === client.sessionId) {
      this.reassignHost();
    }

    this.updateMetadata();
    this.checkAndStartEmptyTimer();
  }

  /** 異常切断時: 再接続を許可 */
  onDrop(client: Client, code: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.connected = false;
    this.updateMetadata();

    if (this.state.phase === "lobby") {
      // ロビーは30秒固定
      this.allowReconnection(client, 30);
      this.addGameLog(`${player.name} が切断しました（30秒以内に再接続可能）`);
      console.log(`${player.name} dropped in lobby (30s reconnect window)`);
      return;
    }

    // ゲーム中: manual モード（Nターン不在 or 1時間で追放）
    const deferred = this.allowReconnection(client, "manual");
    const timeout = setTimeout(() => {
      console.log(`${player.name}: 1時間経過、再接続を拒否`);
      deferred.reject();
    }, MAX_RECONNECT_MS);

    this.reconnections.set(client.sessionId, {
      deferred,
      disconnectedAtTurn: this.turnCounter,
      timeout,
    });

    this.addGameLog(`${player.name} が切断しました（${MISSED_TURNS_LIMIT}ターン以内に再接続可能）`);
    console.log(`${player.name} dropped in-game (manual reconnect, turn=${this.turnCounter})`);

    if (this.state.hostId === client.sessionId) {
      this.reassignHost();
    }

    this.checkAndStartEmptyTimer();
  }

  /** 再接続成功時 */
  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    this.cancelReconnection(client.sessionId);
    player.connected = true;
    this.addGameLog(`${player.name} が再接続しました`);
    this.updateMetadata();
    this.cancelEmptyTimer();

    client.send("historyInfo", {
      undoCount: this.history.undoCount,
      redoCount: this.history.redoCount,
    });

    // ホストが不在だった場合は復帰
    if (this.state.hostId === "" || !this.state.players.get(this.state.hostId)?.connected) {
      this.state.hostId = client.sessionId;
    }

    console.log(`${player.name} reconnected`);
  }

  onDispose() {
    // 残っている再接続タイマーを全クリア
    for (const entry of this.reconnections.values()) {
      clearTimeout(entry.timeout);
    }
    this.reconnections.clear();
    this.cancelEmptyTimer();
    console.log(`ZooRoom "${this.state.roomName}" disposed`);
  }

  // ===== 再接続管理 =====

  // ===== 空室タイマー =====

  /** 人間プレイヤーが接続中かどうかを判定 */
  private hasConnectedHumanPlayer(): boolean {
    let found = false;
    this.state.players.forEach((p) => {
      if (p.connected && !p.isCpu) found = true;
    });
    return found;
  }

  /** 人間プレイヤーが0人ならタイマー開始 */
  private checkAndStartEmptyTimer() {
    if (this.hasConnectedHumanPlayer()) return;
    if (this.emptyRoomTimeout) return; // 既にタイマー起動中

    const ms = EMPTY_ROOM_MS[this.state.phase] ?? EMPTY_ROOM_MS.lobby;
    console.log(`ZooRoom "${this.state.roomName}": 人間プレイヤー0人、${ms / 1000 / 60}分後にルーム破棄予定 (phase=${this.state.phase})`);
    this.emptyRoomTimeout = setTimeout(() => {
      console.log(`ZooRoom "${this.state.roomName}": 空室タイマー満了、ルームを破棄します`);
      this.disconnect();
    }, ms);
  }

  /** 空室タイマーをキャンセル */
  private cancelEmptyTimer() {
    if (this.emptyRoomTimeout) {
      clearTimeout(this.emptyRoomTimeout);
      this.emptyRoomTimeout = null;
      console.log(`ZooRoom "${this.state.roomName}": 空室タイマーをキャンセル`);
    }
  }

  private cancelReconnection(sessionId: string) {
    const entry = this.reconnections.get(sessionId);
    if (entry) {
      clearTimeout(entry.timeout);
      this.reconnections.delete(sessionId);
    }
  }

  /** ターン終了時に呼び出し: 不在プレイヤーのターン経過チェック */
  checkDisconnectedPlayers() {
    for (const [sessionId, entry] of this.reconnections) {
      const missedTurns = this.turnCounter - entry.disconnectedAtTurn;
      if (missedTurns >= MISSED_TURNS_LIMIT) {
        const name = this.state.players.get(sessionId)?.name ?? sessionId;
        console.log(`${name}: ${missedTurns}ターン不在、再接続を拒否`);
        this.addGameLog(`${name} は${MISSED_TURNS_LIMIT}ターン不在のため退出しました`);
        entry.deferred.reject();
        clearTimeout(entry.timeout);
        this.reconnections.delete(sessionId);
      }
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
    const timestamp = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Tokyo' });
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

  // ===== 統一アクション実行（メッセージハンドラ・Bot共通） =====

  dispatch(playerId: string, type: string, data?: any): boolean {
    const gp = this.gameplay;
    const s = this.state;

    switch (type) {
      // --- セットアップ ---
      case "placeAnimal":
        if (s.phase !== "setup" || s.currentTurn !== playerId) return false;
        this.history.push();
        gp.handlePlaceAnimal(playerId, data.animalId, data.cageNum);
        break;

      // --- メインフェーズ ---
      case "receivePoop":
        if (!gp.validateMainAction(playerId, "poop")) return false;
        this.history.push();
        gp.handleReceivePoop(playerId);
        break;

      case "rollDice": {
        if (!gp.validateMainAction(playerId, "roll")) return false;
        this.history.push();
        const diceCount = (data?.diceCount === 1) ? 1 : 2;
        gp.handleRollDice(playerId, diceCount);
        break;
      }

      case "resolveSteal":
        if (!gp.validateEffectResolve() || s.pendingEffects.length === 0) return false;
        this.history.push();
        gp.handleResolveSteal(playerId, data.targetPlayerId);
        break;

      case "resolveStealStar":
        if (!gp.validateEffectResolve() || s.pendingEffects.length === 0) return false;
        this.history.push();
        gp.handleResolveStealStar(playerId, data.targetPlayerId);
        break;

      case "resolveChoice":
        if (!gp.validateEffectResolve() || s.pendingEffects.length === 0) return false;
        this.history.push();
        gp.handleResolveChoice(playerId, data.choice, data.targetPlayerId);
        break;

      case "buyAnimal":
        if (!gp.validateMainAction(playerId, "trade") || s.boughtAnimal) return false;
        this.history.push();
        gp.handleBuyAnimal(playerId, data.animalId, data.cageNum);
        break;

      case "buyStar":
        if (!gp.validateMainAction(playerId, "trade") || s.boughtStar) return false;
        this.history.push();
        gp.handleBuyStar(playerId);
        break;

      case "returnAnimal":
        if (!gp.validateMainAction(playerId, "trade")) return false;
        this.history.push();
        gp.handleReturnAnimal(playerId, data.returns);
        break;

      case "endTrade":
        if (!gp.validateMainAction(playerId, "trade")) return false;
        this.history.push();
        gp.handleEndTrade();
        break;

      case "cleanPoop":
        if (!gp.validateMainAction(playerId, "clean")) return false;
        this.history.push();
        gp.handleCleanPoop(playerId);
        break;

      case "endClean":
        if (!gp.validateMainAction(playerId, "clean")) return false;
        this.history.push();
        gp.handleEndClean(playerId);
        break;

      case "endTurn":
        if (!gp.validateMainAction(playerId, "flush")) return false;
        this.history.push();
        gp.handleEndTurn();
        break;

      // --- チャンスカード ---
      case "keepChanceCard":
        if (s.currentTurn !== playerId || s.chanceCardPhase !== "useOrKeep") return false;
        this.history.push();
        gp.handleKeepChanceCard(playerId);
        break;

      case "useDrawnChanceCard":
        if (s.currentTurn !== playerId) return false;
        if (s.chanceCardPhase !== "useOrKeep" && s.chanceCardPhase !== "forceUse") return false;
        this.history.push();
        gp.handleUseDrawnChanceCard(playerId);
        break;

      case "useHeldChanceCard":
        if (s.currentTurn !== playerId || s.chanceCardPhase !== "forceUse") return false;
        this.history.push();
        gp.handleUseHeldChanceCard(playerId);
        break;

      case "useHeldCardInTrade":
        if (!gp.validateMainAction(playerId, "trade")) return false;
        this.history.push();
        gp.handleUseHeldCardInTrade(playerId);
        break;

      case "resolveCompost":
        if (s.currentTurn !== playerId || s.chanceCardPhase !== "using_compost") return false;
        this.history.push();
        gp.handleResolveCompost(playerId, data.count);
        break;

      case "resolveCompostGive":
        if (s.currentTurn !== playerId || s.chanceCardPhase !== "using_compostGive") return false;
        this.history.push();
        gp.handleResolveCompostGive(playerId, data.distributions);
        break;

      case "resolveEviction":
        if (s.currentTurn !== playerId || s.chanceCardPhase !== "using_eviction") return false;
        this.history.push();
        gp.handleResolveEviction(playerId, data.targetPlayerId, data.animalId, data.cageNum);
        break;

      default:
        return false;
    }

    this.tickBot();
    return true;
  }

  // ===== メッセージハンドラ =====

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
      this.tickBot();
    });

    // --- CPU追加/削除 ---
    this.onMessage("addCpu", (client, data?: { difficulty?: string }) => {
      if (this.state.phase !== "lobby") return;
      if (this.state.hostId !== client.sessionId) return;
      if (this.state.players.size >= 4) return;

      const difficulty = (data?.difficulty === "normal" || data?.difficulty === "hard")
        ? data.difficulty : "normal";
      const cpuId = this.botManager.addCpu(difficulty as "normal" | "hard");
      if (!cpuId) return;

      const player = new PlayerState();
      player.id = cpuId;
      player.name = this.botManager.getCpuName(cpuId);
      player.coins = STARTING_COINS;
      player.connected = true;
      player.isCpu = true;

      for (let i = 1; i <= 12; i++) {
        const cage = new Cage();
        cage.num = i;
        player.cages.push(cage);
      }

      const usedColors = new Set<string>();
      this.state.players.forEach((p) => { if (p.color) usedColors.add(p.color); });
      const availColors = ["red", "blue", "green", "orange", "purple", "pink"].filter(c => !usedColors.has(c));
      if (availColors.length > 0) player.color = availColors[0];

      this.state.players.set(cpuId, player);
      this.state.turnOrder.push(cpuId);
      this.updateMetadata();
      this.addGameLog(`${player.name} が参加しました (CPU)`);
      console.log(`CPU ${player.name} (${cpuId}) added [${difficulty}]`);
    });

    this.onMessage("removeCpu", (client) => {
      if (this.state.phase !== "lobby") return;
      if (this.state.hostId !== client.sessionId) return;

      let lastCpuId: string | null = null;
      for (let i = this.state.turnOrder.length - 1; i >= 0; i--) {
        const id = this.state.turnOrder.at(i)!;
        if (this.botManager.isCpu(id)) { lastCpuId = id; break; }
      }
      if (!lastCpuId) return;

      const cpuName = this.state.players.get(lastCpuId)?.name ?? "CPU";
      this.botManager.removeCpu(lastCpuId);
      const idx = this.state.turnOrder.indexOf(lastCpuId);
      if (idx !== -1) this.state.turnOrder.splice(idx, 1);
      this.state.players.delete(lastCpuId);
      this.updateMetadata();
      this.addGameLog(`${cpuName} が退出しました`);
    });

    // --- 履歴操作 ---
    this.onMessage("undo", () => { this.botManager.cancelPending(); this.history.undo(); this.tickBot(); });
    this.onMessage("redo", () => { this.botManager.cancelPending(); this.history.redo(); this.tickBot(); });
    this.onMessage("resetGame", () => { this.history.resetToFirst(); });

    // --- ゲーム終了後 ---
    this.onMessage("restartGame", () => {
      if (this.state.phase !== "ended") return;
      this.botManager.cancelPending();
      for (const cpuId of this.botManager.cpuIds) {
        const idx = this.state.turnOrder.indexOf(cpuId);
        if (idx !== -1) this.state.turnOrder.splice(idx, 1);
        this.state.players.delete(cpuId);
      }
      this.botManager.removeAllCpus();
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

    // --- ゲームアクション（dispatch経由） ---
    this.onMessage("placeAnimal", (c, d) => this.dispatch(c.sessionId, "placeAnimal", d));
    this.onMessage("receivePoop", (c) => this.dispatch(c.sessionId, "receivePoop"));
    this.onMessage("rollDice", (c, d) => this.dispatch(c.sessionId, "rollDice", d));
    this.onMessage("resolveSteal", (c, d) => this.dispatch(c.sessionId, "resolveSteal", d));
    this.onMessage("resolveStealStar", (c, d) => this.dispatch(c.sessionId, "resolveStealStar", d));
    this.onMessage("resolveChoice", (c, d) => this.dispatch(c.sessionId, "resolveChoice", d));
    this.onMessage("buyAnimal", (c, d) => this.dispatch(c.sessionId, "buyAnimal", d));
    this.onMessage("buyStar", (c) => this.dispatch(c.sessionId, "buyStar"));
    this.onMessage("returnAnimal", (c, d) => this.dispatch(c.sessionId, "returnAnimal", d));
    this.onMessage("endTrade", (c) => this.dispatch(c.sessionId, "endTrade"));
    this.onMessage("keepChanceCard", (c) => this.dispatch(c.sessionId, "keepChanceCard"));
    this.onMessage("useDrawnChanceCard", (c) => this.dispatch(c.sessionId, "useDrawnChanceCard"));
    this.onMessage("useHeldChanceCard", (c) => this.dispatch(c.sessionId, "useHeldChanceCard"));
    this.onMessage("useHeldCardInTrade", (c) => this.dispatch(c.sessionId, "useHeldCardInTrade"));
    this.onMessage("resolveCompost", (c, d) => this.dispatch(c.sessionId, "resolveCompost", d));
    this.onMessage("resolveCompostGive", (c, d) => this.dispatch(c.sessionId, "resolveCompostGive", d));
    this.onMessage("resolveEviction", (c, d) => this.dispatch(c.sessionId, "resolveEviction", d));
    this.onMessage("cleanPoop", (c) => this.dispatch(c.sessionId, "cleanPoop"));
    this.onMessage("endClean", (c) => this.dispatch(c.sessionId, "endClean"));
    this.onMessage("endTurn", (c) => this.dispatch(c.sessionId, "endTurn"));

    this.onMessage("cancelChanceCard", (client) => {
      if (this.state.currentTurn !== client.sessionId) return;
      if (!this.state.chanceCardPhase?.startsWith('using_')) return;
      this.history.undo();
    });

    // --- デバッグ ---
    this.onMessage("__debugSetDice", (_c, d: { dice: number[] }) => {
      if (d?.dice && Array.isArray(d.dice)) gp._debugForcedDice = d.dice;
    });
    this.onMessage("__debugSetCoins", (_c, d: { playerId: string; coins: number }) => {
      const p = this.state.players.get(d.playerId); if (p) p.coins = d.coins;
    });
    this.onMessage("__debugSetStars", (_c, d: { playerId: string; stars: number }) => {
      const p = this.state.players.get(d.playerId); if (p) p.stars = d.stars;
    });
    this.onMessage("__debugSetPoop", (_c, d: { playerId: string; poop: number }) => {
      const p = this.state.players.get(d.playerId); if (p) p.poopTokens = d.poop;
    });
    this.onMessage("__debugSetAnimalPoop", (_c, d: { animalId: string; poops: number }) => {
      const basePoop = ANIMALS[d.animalId]?.poops;
      if (basePoop === undefined) return;
      if (d.poops === basePoop) {
        delete gp.poopOverrides[d.animalId];
      } else {
        gp.poopOverrides[d.animalId] = d.poops;
      }
      console.log(`[Debug] poopOverrides =`, gp.poopOverrides);
    });
  }

  // ===== Bot =====

  private tickBot() {
    this.botManager.cancelPending();
    this.botManager.tick();
  }
}
