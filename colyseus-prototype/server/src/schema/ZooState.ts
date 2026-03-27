import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class CageSlot extends Schema {
  @type("string") animalId: string = "";
  @type("string") playerId: string = "";
}

export class Cage extends Schema {
  @type("number") num: number = 0;
  @type([CageSlot]) slots = new ArraySchema<CageSlot>();
}

export class PlayerState extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("string") color: string = "";  // プレイヤーカラー (red/blue/green/orange)
  @type("number") coins: number = 0;
  @type("number") stars: number = 0;
  @type("boolean") connected: boolean = true;
  @type("number") poopTokens: number = 0;
  @type("number") totalPoopCleaned: number = 0;   // 累計うんち掃除量
  @type("number") totalCoinsEarned: number = 0;   // 累計コイン獲得量
  @type("boolean") hasHeldCard: boolean = false;  // チャンスカード伏せカード保持
  @type("boolean") isCpu: boolean = false;        // CPUプレイヤーか
  @type([Cage]) cages = new ArraySchema<Cage>();
}

export class PendingEffect extends Schema {
  @type("string") effectType: string = "";     // "steal" | "choice" | "stealStar"
  @type("string") ownerPlayerId: string = "";
  @type("string") animalId: string = "";
  @type("number") stealAmount: number = 0;
  @type("number") creationAmount: number = 0;
  @type("number") starAmount: number = 0;
  @type(["string"]) choices = new ArraySchema<string>();
}

export class ZooState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: "number" }) market = new MapSchema<number>();

  // ルームメタデータ
  @type("string") roomName: string = "";
  @type("string") hostId: string = "";             // ルーム作成者（ゲーム開始権限）
  @type("boolean") isPrivate: boolean = false;

  @type("string") phase: string = "lobby";         // lobby | setup | main | ended
  @type("string") currentTurn: string = "";        // sessionId
  @type("string") turnStep: string = "poop";       // poop | roll | income | trade | clean | flush

  @type("number") dice1: number = 0;
  @type("number") dice2: number = 0;
  @type("number") diceSum: number = 0;
  @type("number") diceCount: number = 2;           // 1 or 2 (サイコロの個数)
  @type("boolean") diceRolled: boolean = false;

  @type([PendingEffect]) pendingEffects = new ArraySchema<PendingEffect>();
  @type(["string"]) effectLog = new ArraySchema<string>();
  @type(["string"]) turnOrder = new ArraySchema<string>();

  // セットアップ用: sessionId -> "RessaPanda,Penguin" (カンマ区切り)
  @type({ map: "string" }) setupInventory = new MapSchema<string>();

  // 取引フェーズ用フラグ
  @type("boolean") boughtAnimal: boolean = false;
  @type("boolean") boughtStar: boolean = false;

  @type("string") winnerId: string = "";
  @type("string") burstPlayerId: string = "";      // バースト発生プレイヤー（アニメ用、一時的）

  // チャンスカード
  @type("number") chanceDeckCount: number = 0;      // 山札残数
  @type("number") chanceDiscardCount: number = 0;  // 捨て札枚数
  @type("string") chanceCardPhase: string = "";     // "" | "useOrKeep" | "forceUse" | "using_compost" | "using_compostGive" | "using_eviction"
  @type("string") activeChanceCard: string = "";    // 使用中カードID（使用時に全員に公開）

  // チャット+ゲームログ（全員に表示）
  @type(["string"]) gameLog = new ArraySchema<string>();
}
