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
  @type("number") coins: number = 0;
  @type("number") stars: number = 0;
  @type("boolean") connected: boolean = true;
  @type("number") poopTokens: number = 0;
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

  @type("string") phase: string = "waiting";      // waiting | setup | main | ended
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

  // チャット+ゲームログ（全員に表示）
  @type(["string"]) gameLog = new ArraySchema<string>();
}
