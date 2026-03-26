import { Room, Client } from "colyseus";
import { ZooState, PlayerState, Cage, CageSlot, PendingEffect } from "../schema/ZooState";
import { ANIMALS, STARTING_ANIMALS, STARTING_COINS, STAR_COST, STARS_TO_WIN } from "../game/animals";
import type { AnimalColor, Effect } from "../game/types";
import { ArraySchema } from "@colyseus/schema";

/** 2行グリッドの隣接マップ (上下左右、斜めなし)
 *  上段:  1    2    3    4    5    6
 *  下段: [11&12]  10    9    8    7
 *
 *  11と12は結合された1つの大きな檻
 *  11&12は上段の1,2の下に位置する（2列幅）
 */
const ADJACENCY: Record<number, number[]> = {
  // 上段
  1:  [2, 11, 12],        // 右=2, 下=11&12
  2:  [1, 3, 11, 12, 10], // 左=1, 右=3, 下=11&12と10
  3:  [2, 4, 10, 9],      // 左=2, 右=4, 下=10と9
  4:  [3, 5, 9, 8],       // 左=3, 右=5, 下=9と8
  5:  [4, 6, 8, 7],       // 左=4, 右=6, 下=8と7
  6:  [5, 7],             // 左=5, 下=7
  // 下段 (右から左: 7,8,9,10,11&12)
  7:  [8, 5, 6],          // 左=8, 上=5,6
  8:  [7, 9, 4, 5],       // 左隣=9, 右隣=7, 上=4,5
  9:  [8, 10, 3, 4],      // 左隣=10, 右隣=8, 上=3,4
  10: [9, 11, 12, 2, 3],  // 左隣=11&12, 右隣=9, 上=2,3
  11: [12, 10, 1, 2],     // 結合相手=12, 右隣=10, 上=1,2
  12: [11, 10, 1, 2],     // 結合相手=11, 右隣=10, 上=1,2
};

/** 結合ケージ: 11と12は1つの檻 → 内部的にケージ11に統一 */
function normalizeCageNum(cageNum: number): number {
  return cageNum === 12 ? 11 : cageNum;
}

/** うんちバーストの閾値 */
const POOP_BURST_THRESHOLD = 7;

export class ZooRoom extends Room<ZooState> {
  maxClients = 4;
  private minClients = 2;
  private password: string = "";
  private emptyTimeout: ReturnType<typeof setTimeout> | null = null;
  private static EMPTY_ROOM_TTL = 15 * 60 * 1000; // 15分

  // ===== 履歴管理（スナップショット方式） =====
  private undoStack: any[] = [];
  private redoStack: any[] = [];
  private static MAX_HISTORY = 200;

  /** 現在のstateのスナップショットを保存 */
  private pushSnapshot() {
    this.undoStack.push(this.state.toJSON());
    if (this.undoStack.length > ZooRoom.MAX_HISTORY) {
      this.undoStack.shift();
    }
    // 新しいアクションが行われたらredo履歴はクリア
    this.redoStack = [];
    console.log(`[History] push (undo=${this.undoStack.length}, redo=${this.redoStack.length})`);
    this.broadcastHistoryInfo();
  }

  /** JSONからstateを完全復元 */
  private restoreFromJSON(json: any) {
    // players
    this.state.players.clear();
    if (json.players) {
      for (const [pid, pj] of Object.entries(json.players) as [string, any][]) {
        const p = new PlayerState();
        p.id = pj.id; p.name = pj.name; p.color = pj.color ?? ""; p.coins = pj.coins;
        p.stars = pj.stars; p.connected = pj.connected;
        p.poopTokens = pj.poopTokens ?? 0;
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
        this.state.players.set(pid, p);
      }
    }

    // market
    this.state.market.clear();
    if (json.market) {
      for (const [k, v] of Object.entries(json.market)) {
        this.state.market.set(k, v as number);
      }
    }

    // scalars
    this.state.roomName = json.roomName ?? this.state.roomName;
    this.state.hostId = json.hostId ?? this.state.hostId;
    this.state.isPrivate = json.isPrivate ?? this.state.isPrivate;
    this.state.phase = json.phase ?? "lobby";
    this.state.currentTurn = json.currentTurn ?? "";
    this.state.turnStep = json.turnStep ?? "poop";
    this.state.dice1 = json.dice1 ?? 0;
    this.state.dice2 = json.dice2 ?? 0;
    this.state.diceSum = json.diceSum ?? 0;
    this.state.diceCount = json.diceCount ?? 2;
    this.state.diceRolled = json.diceRolled ?? false;
    this.state.boughtAnimal = json.boughtAnimal ?? false;
    this.state.boughtStar = json.boughtStar ?? false;
    this.state.winnerId = json.winnerId ?? "";

    // pendingEffects
    this.state.pendingEffects.clear();
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
        this.state.pendingEffects.push(pe);
      }
    }

    // effectLog
    this.state.effectLog.clear();
    if (json.effectLog) {
      for (const log of json.effectLog) this.state.effectLog.push(log);
    }

    // gameLog
    this.state.gameLog.clear();
    if (json.gameLog) {
      for (const log of json.gameLog) this.state.gameLog.push(log);
    }

    // turnOrder
    this.state.turnOrder.clear();
    if (json.turnOrder) {
      for (const id of json.turnOrder) this.state.turnOrder.push(id);
    }

    // setupInventory
    this.state.setupInventory.clear();
    if (json.setupInventory) {
      for (const [k, v] of Object.entries(json.setupInventory)) {
        this.state.setupInventory.set(k, v as string);
      }
    }
  }

  /** 履歴情報をクライアントにブロードキャスト */
  private broadcastHistoryInfo() {
    this.broadcast("historyInfo", {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    });
  }

  // ===== ライフサイクル =====

  onCreate(options: { roomName?: string; password?: string }) {
    this.setState(new ZooState());

    // ルームメタデータ
    this.state.roomName = options.roomName || "三ツ星動物園の部屋";
    if (options.password) {
      this.password = options.password;
      this.state.isPrivate = true;
    }

    // マーケット初期化
    for (const [id, animal] of Object.entries(ANIMALS)) {
      this.state.market.set(id, animal.inventory);
    }

    // メタデータ設定（ルーム一覧で表示）
    this.setMetadata({
      roomName: this.state.roomName,
      isPrivate: this.state.isPrivate,
      playerCount: 0,
      phase: "lobby",
    });

    this.registerMessages();

    // 空室タイマー開始（作成直後は誰もいないので）
    this.startEmptyTimer();

    console.log(`ZooRoom "${this.state.roomName}" created (private=${this.state.isPrivate})`);
  }

  onJoin(client: Client, options: { name?: string; password?: string }) {
    // パスワード認証
    if (this.state.isPrivate && this.password) {
      if (options.password !== this.password) {
        throw new Error("パスワードが間違っています");
      }
    }

    // ゲーム中の再入室チェック
    if (this.state.phase !== "lobby") {
      const existingPlayer = this.state.players.get(client.sessionId);
      if (existingPlayer) {
        existingPlayer.connected = true;
        this.addGameLog(`${existingPlayer.name} が再接続しました`);
        this.clearEmptyTimer();
        this.updateMetadata();
        return;
      }
      // ゲーム進行中に新規参加は不可
      throw new Error("ゲームが進行中のため参加できません");
    }

    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = options.name || `Player ${this.state.players.size + 1}`;
    player.coins = STARTING_COINS;
    player.stars = 0;
    player.connected = true;
    player.poopTokens = 0;

    // プレイヤー個別のエリアボード (ケージ1-12) を初期化
    for (let i = 1; i <= 12; i++) {
      const cage = new Cage();
      cage.num = i;
      player.cages.push(cage);
    }

    this.state.players.set(client.sessionId, player);
    this.state.turnOrder.push(client.sessionId);

    // 最初に入った人がホスト
    if (this.state.hostId === "") {
      this.state.hostId = client.sessionId;
    }

    this.clearEmptyTimer();
    this.updateMetadata();
    this.addGameLog(`${player.name} が入室しました`);

    console.log(`${player.name} (${client.sessionId}) joined. ${this.state.players.size} players in lobby`);
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.connected = false;
    this.updateMetadata();

    // ゲーム進行中の切断 → 長めの再接続猶予（15分）
    if (!consented && this.state.phase !== "lobby") {
      try {
        await this.allowReconnection(client, ZooRoom.EMPTY_ROOM_TTL / 1000);
        player.connected = true;
        this.addGameLog(`${player.name} が再接続しました`);
        this.clearEmptyTimer();
        this.updateMetadata();
        console.log(`${player.name} reconnected`);
        return;
      } catch {
        // 再接続タイムアウト
      }
    }

    this.addGameLog(`${player.name} が退室しました`);
    console.log(`${player.name} left permanently`);

    // ロビー中ならプレイヤーを完全削除
    if (this.state.phase === "lobby") {
      const idx = this.state.turnOrder.indexOf(client.sessionId);
      if (idx !== -1) this.state.turnOrder.splice(idx, 1);
      this.state.players.delete(client.sessionId);

      // ホスト引き継ぎ
      if (this.state.hostId === client.sessionId) {
        this.state.hostId = this.state.turnOrder.length > 0
          ? this.state.turnOrder.at(0)!
          : "";
      }
    }

    this.updateMetadata();

    // 全員disconnected/退室なら空室タイマー開始
    let anyConnected = false;
    this.state.players.forEach((p) => {
      if (p.connected) anyConnected = true;
    });
    if (!anyConnected) {
      if (this.state.phase === "lobby" && this.state.players.size === 0) {
        // ロビーで誰もいない → 即座にタイマー開始
        this.startEmptyTimer();
      } else {
        // ゲーム中に全員切断 → タイマー開始
        this.startEmptyTimer();
      }
    }
  }

  onDispose() {
    this.clearEmptyTimer();
    console.log(`ZooRoom "${this.state.roomName}" disposed`);
  }

  // ===== 空室タイマー =====

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

  /** ゲームログに追記（チャット+システムログ共用、最大500件） */
  private addGameLog(message: string) {
    const timestamp = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.state.gameLog.push(`[${timestamp}] ${message}`);
    if (this.state.gameLog.length > 500) {
      this.state.gameLog.shift();
    }
  }

  // ===== フェーズ管理 =====

  private startSetupPhase() {
    this.state.phase = "setup";

    // 各プレイヤーにセットアップ用インベントリを設定
    this.state.turnOrder.forEach((sessionId) => {
      this.state.setupInventory.set(sessionId, STARTING_ANIMALS.join(","));
    });

    // 最初のプレイヤーのターン
    this.state.currentTurn = this.state.turnOrder.at(0)!;
    console.log("Setup phase started");
  }

  private startMainPhase() {
    this.state.phase = "main";
    this.state.currentTurn = this.state.turnOrder.at(0)!;
    this.resetTurnState();
    console.log("Main phase started");
  }

  private resetTurnState() {
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
  }

  private nextTurn() {
    const idx = this.state.turnOrder.indexOf(this.state.currentTurn);
    const nextIdx = (idx + 1) % this.state.turnOrder.length;
    this.state.currentTurn = this.state.turnOrder.at(nextIdx)!;
    this.resetTurnState();
  }

  private checkWin(): boolean {
    const playerId = this.state.currentTurn;
    const player = this.state.players.get(playerId);
    if (!player) return false;

    // 星3つ かつ うんちコマ6個以下でターンを終えたら勝利
    if (player.stars >= STARS_TO_WIN && player.poopTokens < POOP_BURST_THRESHOLD) {
      this.state.winnerId = playerId;
      this.state.phase = "ended";
      this.broadcast("gameOver", { winnerId: playerId, winnerName: player.name });
      console.log(`${player.name} wins!`);
      return true;
    }
    return false;
  }

  // ===== ヘルパー関数 =====

  /** プレイヤーのケージを取得（11&12は結合→11に正規化） */
  private getPlayerCage(playerId: string, cageNum: number): Cage {
    const player = this.state.players.get(playerId)!;
    const normalized = normalizeCageNum(cageNum);
    return player.cages.at(normalized - 1)!; // 0-indexed array, 1-indexed cage
  }

  /** プレイヤーが持つ特定動物の数をカウント */
  private countPlayerAnimal(playerId: string, animalId: string): number {
    const player = this.state.players.get(playerId);
    if (!player) return 0;
    let count = 0;
    for (const cage of player.cages) {
      for (const slot of cage.slots) {
        if (slot.animalId === animalId) {
          count++;
        }
      }
    }
    return count;
  }

  /** ケージの既存動物の色を取得 */
  private getCageColors(playerId: string, cageNum: number): AnimalColor[] | null {
    const cage = this.getPlayerCage(playerId, cageNum);
    if (cage.slots.length === 0) return null;
    return ANIMALS[cage.slots.at(0)!.animalId].colors;
  }

  /** 動物を配置可能かチェック（色・種類・容量） */
  private canPlaceAnimal(animalId: string, cageNum: number, playerId: string): boolean {
    const cage = this.getPlayerCage(playerId, cageNum);
    const animalDef = ANIMALS[animalId];
    if (!animalDef) return false;

    if (cage.slots.length >= 2) return false;
    if (cage.slots.some((s: CageSlot) => s.animalId === animalId)) return false;

    if (cage.slots.length > 0) {
      const cageColors = this.getCageColors(playerId, cageNum);
      if (cageColors) {
        const hasCommonColor = animalDef.colors.some(c => cageColors.includes(c));
        if (!hasCommonColor) return false;
      }
    }

    return true;
  }

  /** 同一動物の2匹目配置時、隣接制約チェック（4x3グリッド） */
  private checkAdjacentConstraint(animalId: string, cageNum: number, playerId: string): boolean {
    const existingCount = this.countPlayerAnimal(playerId, animalId);
    if (existingCount === 0) return true;

    const player = this.state.players.get(playerId)!;
    const adjacent = ADJACENCY[cageNum] || [];
    for (const cage of player.cages) {
      for (const slot of cage.slots) {
        if (slot.animalId === animalId) {
          if (adjacent.includes(cage.num)) return true;
        }
      }
    }
    return false;
  }

  /** 条件式を評価 (creationIf, stealIf) */
  private evaluateCondition(
    condition: [string, string, string, '?', string, ':', string],
    playerId: string,
  ): number {
    const [animalId, op, threshold, , trueVal, , falseVal] = condition;
    const count = this.countPlayerAnimal(playerId, animalId);
    const thresholdNum = parseInt(threshold);
    let result = false;
    switch (op) {
      case '>=': result = count >= thresholdNum; break;
      case '>': result = count > thresholdNum; break;
      case '<=': result = count <= thresholdNum; break;
      case '<': result = count < thresholdNum; break;
      case '==': result = count === thresholdNum; break;
    }
    return parseInt(result ? trueVal : falseVal);
  }

  /** プレイヤーの全動物のうんちコスト合計 */
  private calculatePoopCost(playerId: string): number {
    const player = this.state.players.get(playerId);
    if (!player) return 0;
    let total = 0;
    for (const cage of player.cages) {
      for (const slot of cage.slots) {
        total += ANIMALS[slot.animalId].poops;
      }
    }
    return total;
  }

  // ===== 効果処理 =====

  private processEffects(): void {
    const rawCageNum = this.state.diceSum;
    if (rawCageNum < 1 || rawCageNum > 12) return;

    // 11&12結合: ダイス12はケージ11として処理
    const cageNum = normalizeCageNum(rawCageNum);

    const currentPlayer = this.state.currentTurn;
    this.state.effectLog.clear();

    const adjacentCages = ADJACENCY[rawCageNum] || [];

    // 効果処理順: 手番プレイヤーの左隣から時計回り、手番プレイヤーが最後
    const playerOrder = this.getEffectProcessingOrder(currentPlayer);

    for (const timing of ['first', 'end'] as const) {
      // 各プレイヤーのケージの効果を処理
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

      // 隣接ボーナス（firstタイミングのみ）
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
              if (this.countPlayerAnimal(playerId, targetAnimalId) > 0) {
                const playerState = this.state.players.get(playerId)!;
                playerState.coins += coins;
                this.logEffect(
                  `${this.getPlayerName(playerId)}: ${animalDef.name}の隣接ボーナス +${coins}コイン`
                );
              }
            }
          }
        }
      }
    }
  }

  /** 効果処理順を返す（手番プレイヤーの左隣から時計回り、手番が最後） */
  private getEffectProcessingOrder(currentPlayer: string): string[] {
    const order = this.state.turnOrder.toArray();
    const idx = order.indexOf(currentPlayer);
    const result: string[] = [];
    for (let i = 1; i <= order.length; i++) {
      result.push(order[(idx + i) % order.length]);
    }
    return result;
  }

  private processAnimalEffect(slot: CageSlot, effect: Effect, currentPlayer: string, owner: string): void {
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
      this.logEffect(`${this.getPlayerName(owner)}: ${animalDef.name} → 効果を選択してください`);
      return;
    }

    // Creation
    if (effect.creation && effect.creation > 0) {
      ownerState.coins += effect.creation;
      this.logEffect(`${this.getPlayerName(owner)}: ${animalDef.name} +${effect.creation}コイン`);
    }

    // CreationIf
    if (effect.creationIf) {
      const coins = this.evaluateCondition(effect.creationIf, owner);
      if (coins > 0) {
        ownerState.coins += coins;
        this.logEffect(`${this.getPlayerName(owner)}: ${animalDef.name} (条件) +${coins}コイン`);
      }
    }

    // Buff
    if (effect.buff) {
      const [coinsPerUnit, targetAnimalId, mode] = effect.buff;
      const count = this.countPlayerAnimal(owner, targetAnimalId);
      const coins = mode === 'each' ? coinsPerUnit * count : (count > 0 ? coinsPerUnit : 0);
      if (coins > 0) {
        ownerState.coins += coins;
        this.logEffect(`${this.getPlayerName(owner)}: ${animalDef.name} Buff +${coins}コイン`);
      }
    }

    // BonusBuff
    if (effect.bonusbuff) {
      const [coins, targetAnimalId] = effect.bonusbuff;
      const count = this.countPlayerAnimal(owner, targetAnimalId);
      if (count > 0) {
        ownerState.coins += coins;
        this.logEffect(`${this.getPlayerName(owner)}: ${animalDef.name} ボーナス +${coins}コイン`);
      }
    }

    // StealIf (ライオン等)
    if (effect.stealIf) {
      const amount = this.evaluateCondition(effect.stealIf, owner);
      if (amount > 0) {
        // ライオンは全員のターンで発動、対象は1人選択
        const pe = new PendingEffect();
        pe.effectType = "steal";
        pe.ownerPlayerId = owner;
        pe.animalId = slot.animalId;
        pe.stealAmount = amount;
        this.state.pendingEffects.push(pe);
        this.logEffect(`${this.getPlayerName(owner)}: ${animalDef.name} → 奪取対象を選択してください`);
      }
    }

    // Steal (no choice, no stealIf)
    if (effect.steal && !effect.choice && !effect.stealIf) {
      if (effect.steal.length >= 4 && effect.steal[3] === 'star') {
        // 星奪取 (ミナミシロサイ)
        const pe = new PendingEffect();
        pe.effectType = "stealStar";
        pe.ownerPlayerId = owner;
        pe.animalId = slot.animalId;
        pe.starAmount = effect.steal[0] as number;
        this.state.pendingEffects.push(pe);
        this.logEffect(`${this.getPlayerName(owner)}: ${animalDef.name} → 星奪取対象を選択してください`);
      } else if (effect.steal[1] === 'target') {
        // コイン奪取 (カリフォルニアアシカ等: creation + steal 両方発動)
        const pe = new PendingEffect();
        pe.effectType = "steal";
        pe.ownerPlayerId = owner;
        pe.animalId = slot.animalId;
        pe.stealAmount = effect.steal[0] as number;
        this.state.pendingEffects.push(pe);
        this.logEffect(`${this.getPlayerName(owner)}: ${animalDef.name} → 奪取対象を選択してください`);
      }
    }
  }

  private getPlayerName(sessionId: string): string {
    return this.state.players.get(sessionId)?.name ?? sessionId;
  }

  /** effectLogに追記しつつgameLogにもミラー */
  private logEffect(message: string) {
    this.state.effectLog.push(message);
    this.addGameLog(message);
  }

  // ===== メッセージハンドラ =====

  private registerMessages() {
    // --- ロビー: プレイヤーカラー変更 ---
    this.onMessage("setColor", (client, data: { color: string }) => {
      if (this.state.phase !== "lobby") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const validColors = ["red", "blue", "green", "orange", "purple", "pink"];
      if (!validColors.includes(data.color)) return;
      // 他プレイヤーが使用中の色は選択不可
      let taken = false;
      this.state.players.forEach((p) => {
        if (p.id !== client.sessionId && p.color === data.color) taken = true;
      });
      if (taken) return;
      player.color = data.color;
    });

    // --- ロビー: ゲーム開始 ---
    this.onMessage("startGame", (client) => {
      if (this.state.phase !== "lobby") return;
      if (this.state.hostId !== client.sessionId) return;
      if (this.state.players.size < 2) return;

      // 現在のプレイヤー数でゲーム開始
      this.minClients = this.state.players.size;
      this.lock(); // 新規参加を締め切る
      this.startSetupPhase();
      this.updateMetadata();
      this.addGameLog(`ゲーム開始！ (${this.minClients}人)`);
      console.log(`Game started with ${this.minClients} players`);
    });

    // --- 履歴操作 ---
    this.onMessage("undo", (_client) => {
      if (this.undoStack.length === 0) return;
      this.redoStack.push(this.state.toJSON());
      const snapshot = this.undoStack.pop()!;
      this.restoreFromJSON(snapshot);
      this.broadcastHistoryInfo();
      console.log(`Undo (残り${this.undoStack.length})`);
    });

    this.onMessage("redo", (_client) => {
      if (this.redoStack.length === 0) return;
      this.undoStack.push(this.state.toJSON());
      const snapshot = this.redoStack.pop()!;
      this.restoreFromJSON(snapshot);
      this.broadcastHistoryInfo();
      console.log(`Redo (残り${this.redoStack.length})`);
    });

    this.onMessage("resetGame", (_client) => {
      if (this.undoStack.length === 0) return;
      this.redoStack.push(this.state.toJSON());
      const firstSnapshot = this.undoStack[0];
      this.undoStack = [];
      this.restoreFromJSON(firstSnapshot);
      this.broadcastHistoryInfo();
      console.log("Reset to initial state");
    });

    // --- チャット ---
    this.onMessage("chat", (client, data: { text: string }) => {
      const player = this.state.players.get(client.sessionId);
      const name = player?.name ?? client.sessionId;
      const text = (data.text ?? '').trim().slice(0, 200);
      if (!text) return;
      this.addGameLog(`💬 ${name}: ${text}`);
    });

    // --- セットアップフェーズ ---
    this.onMessage("placeAnimal", (client, data: { animalId: string; cageNum: number }) => {
      if (this.state.phase !== "setup") return;
      if (this.state.currentTurn !== client.sessionId) return;
      this.pushSnapshot();

      const { animalId, cageNum } = data;
      const inventoryStr = this.state.setupInventory.get(client.sessionId);
      if (!inventoryStr) return;

      const inventory = inventoryStr.split(",").filter(s => s.length > 0);
      const idx = inventory.indexOf(animalId);
      if (idx === -1) return;

      if (!this.canPlaceAnimal(animalId, cageNum, client.sessionId)) return;

      // 配置（プレイヤー自身のケージに）
      const slot = new CageSlot();
      slot.animalId = animalId;
      slot.playerId = client.sessionId;
      this.getPlayerCage(client.sessionId, cageNum).slots.push(slot);

      // インベントリ更新
      inventory.splice(idx, 1);
      this.state.setupInventory.set(client.sessionId, inventory.join(","));

      // インベントリが空なら次のプレイヤーへ
      if (inventory.length === 0) {
        this.advanceSetupTurn();
      }
    });

    // --- メインフェーズ ---

    // ステップ1: うんちをもらう（トークン蓄積）
    this.onMessage("receivePoop", (client) => {
      if (!this.validateMainAction(client, "poop")) return;
      this.pushSnapshot();

      const playerId = client.sessionId;
      const cost = this.calculatePoopCost(playerId);
      const player = this.state.players.get(playerId)!;
      player.poopTokens += cost;

      this.state.effectLog.clear();
      if (cost > 0) {
        this.logEffect(`${this.getPlayerName(playerId)}: うんち +${cost}個 (合計${player.poopTokens}個)`);
      }
      this.state.turnStep = "roll";
    });

    // ステップ2: サイコロを振る（1個 or 2個選択）
    this.onMessage("rollDice", (client, data?: { diceCount?: number }) => {
      if (!this.validateMainAction(client, "roll")) return;
      this.pushSnapshot();

      const diceCount = (data?.diceCount === 1) ? 1 : 2;
      this.state.diceCount = diceCount;

      this.state.dice1 = Math.floor(Math.random() * 6) + 1;
      if (diceCount === 2) {
        this.state.dice2 = Math.floor(Math.random() * 6) + 1;
        this.state.diceSum = this.state.dice1 + this.state.dice2;
      } else {
        this.state.dice2 = 0;
        this.state.diceSum = this.state.dice1;
      }
      this.state.diceRolled = true;
      this.state.turnStep = "income";
      this.addGameLog(`🎲 ${this.getPlayerName(client.sessionId)} がサイコロ ${diceCount}個 → ${this.state.diceSum}`);

      this.processEffects();

      if (this.state.pendingEffects.length === 0) {
        this.state.turnStep = "trade";
      }
    });

    // ステップ3: 効果解決（steal対象選択）
    this.onMessage("resolveSteal", (client, data: { targetPlayerId: string }) => {
      if (!this.validateEffectResolve()) return;
      if (this.state.pendingEffects.length === 0) return;

      const effect = this.state.pendingEffects.at(0);
      if (!effect) return;
      if (effect.effectType !== "steal" || effect.ownerPlayerId !== client.sessionId) return;
      this.pushSnapshot();

      const { targetPlayerId } = data;
      const targetPlayer = this.state.players.get(targetPlayerId);
      if (!targetPlayer || targetPlayerId === client.sessionId) return;

      const amount = effect.stealAmount;
      const stolen = Math.min(amount, targetPlayer.coins);
      targetPlayer.coins -= stolen;
      this.state.players.get(effect.ownerPlayerId)!.coins += stolen;

      const animalName = ANIMALS[effect.animalId].name;
      this.logEffect(
        `${this.getPlayerName(effect.ownerPlayerId)}: ${animalName} → ${this.getPlayerName(targetPlayerId)}から${stolen}コイン奪取`
      );

      this.state.pendingEffects.shift();
      if (this.state.pendingEffects.length === 0) {
        this.state.turnStep = "trade";
      }
    });

    this.onMessage("resolveStealStar", (client, data: { targetPlayerId: string }) => {
      if (!this.validateEffectResolve()) return;
      if (this.state.pendingEffects.length === 0) return;

      const effect = this.state.pendingEffects.at(0);
      if (!effect) return;
      if (effect.effectType !== "stealStar" || effect.ownerPlayerId !== client.sessionId) return;
      this.pushSnapshot();

      const { targetPlayerId } = data;
      const targetPlayer = this.state.players.get(targetPlayerId);
      if (!targetPlayer || targetPlayerId === client.sessionId) return;

      const amount = effect.starAmount;
      const stolen = Math.min(amount, targetPlayer.stars);
      targetPlayer.stars -= stolen;
      this.state.players.get(effect.ownerPlayerId)!.stars += stolen;

      const animalName = ANIMALS[effect.animalId].name;
      this.logEffect(
        `${this.getPlayerName(effect.ownerPlayerId)}: ${animalName} → ${this.getPlayerName(targetPlayerId)}から星${stolen}個奪取`
      );

      this.state.pendingEffects.shift();
      if (this.state.pendingEffects.length === 0) {
        this.state.turnStep = "trade";
      }
    });

    this.onMessage("resolveChoice", (client, data: { choice: string; targetPlayerId?: string }) => {
      if (!this.validateEffectResolve()) return;
      if (this.state.pendingEffects.length === 0) return;

      const effect = this.state.pendingEffects.at(0);
      if (!effect) return;
      if (effect.effectType !== "choice" || effect.ownerPlayerId !== client.sessionId) return;
      this.pushSnapshot();

      const { choice, targetPlayerId } = data;
      const animalName = ANIMALS[effect.animalId].name;
      const ownerState = this.state.players.get(effect.ownerPlayerId)!;

      if (choice === "creation") {
        const coins = effect.creationAmount;
        ownerState.coins += coins;
        this.logEffect(`${this.getPlayerName(effect.ownerPlayerId)}: ${animalName} → ${coins}コイン獲得を選択`);
      } else if (choice === "steal") {
        if (!targetPlayerId) return;
        const targetPlayer = this.state.players.get(targetPlayerId);
        if (!targetPlayer || targetPlayerId === client.sessionId) return;

        const amount = effect.stealAmount;
        const stolen = Math.min(amount, targetPlayer.coins);
        targetPlayer.coins -= stolen;
        ownerState.coins += stolen;
        this.logEffect(
          `${this.getPlayerName(effect.ownerPlayerId)}: ${animalName} → ${this.getPlayerName(targetPlayerId)}から${stolen}コイン奪取を選択`
        );
      } else {
        return; // invalid choice
      }

      this.state.pendingEffects.shift();
      if (this.state.pendingEffects.length === 0) {
        this.state.turnStep = "trade";
      }
    });

    // ステップ4: お買い物（動物1匹 + 星1つ + 返却 を好きな順で）
    this.onMessage("buyAnimal", (client, data: { animalId: string; cageNum: number }) => {
      if (!this.validateMainAction(client, "trade")) return;
      if (this.state.boughtAnimal) return;
      this.pushSnapshot();

      const { animalId, cageNum } = data;
      const playerId = client.sessionId;
      const animalDef = ANIMALS[animalId];
      if (!animalDef) return;

      const player = this.state.players.get(playerId)!;
      const stock = this.state.market.get(animalId) ?? 0;

      if (stock <= 0) return;
      if (player.coins < animalDef.cost) return;
      if (!this.canPlaceAnimal(animalId, cageNum, playerId)) return;
      if (!this.checkAdjacentConstraint(animalId, cageNum, playerId)) return;

      player.coins -= animalDef.cost;
      this.state.market.set(animalId, stock - 1);

      const slot = new CageSlot();
      slot.animalId = animalId;
      slot.playerId = playerId;
      this.getPlayerCage(playerId, cageNum).slots.push(slot);

      this.state.boughtAnimal = true;
      this.state.effectLog.clear();
      this.logEffect(`${this.getPlayerName(playerId)}: ${animalDef.name}を購入 (ケージ${cageNum})`);
      // tradeステップに留まる（他のアクションも可能）
    });

    this.onMessage("buyStar", (client) => {
      if (!this.validateMainAction(client, "trade")) return;
      if (this.state.boughtStar) return;
      this.pushSnapshot();

      const player = this.state.players.get(client.sessionId)!;
      if (player.coins < STAR_COST) return;

      player.coins -= STAR_COST;
      player.stars += 1;

      this.state.boughtStar = true;
      this.state.effectLog.clear();
      this.logEffect(`${this.getPlayerName(client.sessionId)}: 星を購入! (★${player.stars})`);
      // tradeステップに留まる
    });

    this.onMessage("returnAnimal", (client, data: { returns: { animalId: string; cageNum: number }[] }) => {
      if (!this.validateMainAction(client, "trade")) return;
      this.pushSnapshot();

      const playerId = client.sessionId;
      this.state.effectLog.clear();

      for (const { animalId, cageNum } of data.returns) {
        const cage = this.getPlayerCage(playerId, cageNum);
        const idx = cage.slots.toArray().findIndex(
          (s: CageSlot) => s.animalId === animalId && s.playerId === playerId
        );
        if (idx === -1) return;

        cage.slots.splice(idx, 1);
        const stock = this.state.market.get(animalId) ?? 0;
        this.state.market.set(animalId, stock + 1);
        this.logEffect(`${this.getPlayerName(playerId)}: ${ANIMALS[animalId].name}を返却 (ケージ${cageNum})`);
      }
      // tradeステップに留まる
    });

    // お買い物終了 → 掃除フェーズへ
    this.onMessage("endTrade", (client) => {
      if (!this.validateMainAction(client, "trade")) return;
      this.pushSnapshot();
      this.state.effectLog.clear();
      this.state.turnStep = "clean";
    });

    // ステップ5: うんち掃除（1コインで2個）
    this.onMessage("cleanPoop", (client) => {
      if (!this.validateMainAction(client, "clean")) return;
      this.pushSnapshot();

      const player = this.state.players.get(client.sessionId)!;
      if (player.coins < 1 || player.poopTokens <= 0) return;

      player.coins -= 1;
      const cleaned = Math.min(2, player.poopTokens);
      player.poopTokens -= cleaned;

      this.state.effectLog.clear();
      this.logEffect(
        `${this.getPlayerName(client.sessionId)}: うんち掃除 ${cleaned}個 (-1コイン, 残り${player.poopTokens}個)`
      );
    });

    // 掃除終了 → バースト判定 → ターン終了
    this.onMessage("endClean", (client) => {
      if (!this.validateMainAction(client, "clean")) return;
      this.pushSnapshot();

      const playerId = client.sessionId;
      const player = this.state.players.get(playerId)!;

      this.state.effectLog.clear();

      // バースト判定: 7個以上でペナルティ
      if (player.poopTokens >= POOP_BURST_THRESHOLD) {
        this.logEffect(`${this.getPlayerName(playerId)}: うんちバースト! (${player.poopTokens}個)`);

        if (player.stars > 0) {
          // 星を1つ失う
          player.stars -= 1;
          this.logEffect(`${this.getPlayerName(playerId)}: 星を1つ失った (★${player.stars})`);
        } else {
          // 星がない場合、最高コスト動物を1匹返却
          this.returnMostExpensiveAnimal(playerId);
        }

        // バースト後: 全コイン + 全うんちコマをリセット
        player.coins = 0;
        player.poopTokens = 0;
        this.logEffect(`${this.getPlayerName(playerId)}: 全コインとうんちコマを銀行に返却`);
      }

      // 勝利判定（掃除後）
      if (this.checkWin()) return;

      this.state.turnStep = "flush";
    });

    // ステップ6: ターン終了
    this.onMessage("endTurn", (client) => {
      if (!this.validateMainAction(client, "flush")) return;
      this.pushSnapshot();
      this.nextTurn();
    });
  }

  // ===== バースト時の動物返却 =====

  private returnMostExpensiveAnimal(playerId: string): void {
    const player = this.state.players.get(playerId)!;
    let maxCost = -1;
    let maxPoops = -1;
    let targetCage: Cage | null = null;
    let targetSlotIdx = -1;
    let targetAnimalId = "";

    for (const cage of player.cages) {
      for (let i = 0; i < cage.slots.length; i++) {
        const slot = cage.slots.at(i)!;
        const animalDef = ANIMALS[slot.animalId];
        // 最高コスト → 同コストならうんちコスト高い方
        if (animalDef.cost > maxCost || (animalDef.cost === maxCost && animalDef.poops > maxPoops)) {
          maxCost = animalDef.cost;
          maxPoops = animalDef.poops;
          targetCage = cage;
          targetSlotIdx = i;
          targetAnimalId = slot.animalId;
        }
      }
    }

    if (targetCage && targetSlotIdx >= 0) {
      targetCage.slots.splice(targetSlotIdx, 1);
      const stock = this.state.market.get(targetAnimalId) ?? 0;
      this.state.market.set(targetAnimalId, stock + 1);
      this.logEffect(
        `${this.getPlayerName(playerId)}: ${ANIMALS[targetAnimalId].name}を市場に返却 (ペナルティ)`
      );
    }
  }

  // ===== バリデーション =====

  /** 効果解決のバリデーション（送信者=手番プレイヤーとは限らない。ownerチェックは呼び出し側で行う） */
  private validateEffectResolve(): boolean {
    if (this.state.phase !== "main") return false;
    if (this.state.turnStep !== "income") return false;
    return true;
  }

  private validateMainAction(client: Client, expectedStep: string): boolean {
    if (this.state.phase !== "main") return false;
    if (this.state.currentTurn !== client.sessionId) return false;
    if (this.state.turnStep !== expectedStep) return false;
    return true;
  }

  // ===== セットアップターン進行 =====

  private advanceSetupTurn() {
    const currentIdx = this.state.turnOrder.indexOf(this.state.currentTurn);
    const nextIdx = currentIdx + 1;

    if (nextIdx >= this.state.turnOrder.length) {
      // 全プレイヤーの配置完了チェック
      let allDone = true;
      this.state.turnOrder.forEach((sessionId) => {
        const inv = this.state.setupInventory.get(sessionId);
        if (inv && inv.length > 0) allDone = false;
      });

      if (allDone) {
        this.startMainPhase();
      } else {
        // 2周目（もしあれば）
        this.state.currentTurn = this.state.turnOrder.at(0)!;
      }
    } else {
      this.state.currentTurn = this.state.turnOrder.at(nextIdx)!;
    }
  }
}
