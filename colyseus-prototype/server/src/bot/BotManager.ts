import type { ZooState } from "../schema/ZooState";
import type { BotStrategy, BotAction } from "./BotStrategy";
import { RandomStrategy } from "./RandomStrategy";
import { GreedyStrategy } from "./GreedyStrategy";

export type CpuDifficulty = "normal" | "hard";

const CPU_NAMES: Record<CpuDifficulty, string[]> = {
  normal: ["CPU-パンダ", "CPU-ペンギン", "CPU-ライオン", "CPU-キリン"],
  hard:   ["CPU-チーター", "CPU-ゾウ", "CPU-イルカ", "CPU-サイ"],
};

/** 遅延時間の範囲（ミリ秒） */
const DELAY: Record<string, [number, number]> = {
  receivePoop:        [500, 1000],
  rollDice:           [1000, 2000],
  resolveSteal:       [1000, 1500],
  resolveStealStar:   [1000, 1500],
  resolveChoice:      [1500, 2500],
  buyAnimal:          [1500, 2500],
  buyStar:            [1500, 2500],
  endTrade:           [500, 1000],
  cleanPoop:          [500, 1000],
  endClean:           [500, 1000],
  endTurn:            [500, 800],
  placeAnimal:        [800, 1500],
  keepChanceCard:     [1000, 2000],
  useDrawnChanceCard: [1000, 2000],
  useHeldChanceCard:  [1000, 2000],
  resolveCompost:     [1000, 1500],
  resolveCompostGive: [1000, 1500],
  resolveEviction:    [1500, 2500],
};

const STRATEGIES: Record<CpuDifficulty, BotStrategy> = {
  normal: new RandomStrategy(),
  hard:   new GreedyStrategy(),
};

function randomDelay(actionType: string): number {
  const [min, max] = DELAY[actionType] ?? [500, 1000];
  return min + Math.floor(Math.random() * (max - min));
}

interface CpuEntry {
  difficulty: CpuDifficulty;
  name: string;
}

/**
 * CPUプレイヤーの管理
 * - CPU追加/削除（難易度別）
 * - ターン監視 → 遅延付きアクション実行
 */
export class BotManager {
  readonly cpuIds = new Set<string>();
  private cpuEntries = new Map<string, CpuEntry>();
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  private cpuCounter = 0;

  constructor(
    private state: ZooState,
    private executeAction: (playerId: string, action: BotAction) => void,
  ) {}

  addCpu(difficulty: CpuDifficulty = "normal"): string | null {
    if (this.state.players.size >= 4) return null;

    const cpuId = `cpu_${Date.now()}_${this.cpuCounter++}`;
    const names = CPU_NAMES[difficulty];
    // 同じ難易度で使用済みの名前を避ける
    const usedNames = new Set<string>();
    this.cpuEntries.forEach(e => usedNames.add(e.name));
    const name = names.find(n => !usedNames.has(n)) ?? `${names[0]}${this.cpuCounter}`;

    this.cpuIds.add(cpuId);
    this.cpuEntries.set(cpuId, { difficulty, name });
    return cpuId;
  }

  getCpuName(cpuId: string): string {
    return this.cpuEntries.get(cpuId)?.name ?? "CPU";
  }

  isCpu(sessionId: string): boolean {
    return this.cpuIds.has(sessionId);
  }

  removeCpu(cpuId: string): boolean {
    this.cpuEntries.delete(cpuId);
    return this.cpuIds.delete(cpuId);
  }

  removeAllCpus() {
    this.cancelPending();
    this.cpuIds.clear();
    this.cpuEntries.clear();
  }

  tick() {
    if (this.state.phase === "ended") {
      this.cancelPending();
      return;
    }

    const currentId = this.state.currentTurn;
    if (currentId && this.cpuIds.has(currentId)) {
      this.scheduleAction(currentId);
      return;
    }

    // ペンディングエフェクトの処理者がCPUかもしれない
    if (this.state.pendingEffects.length > 0) {
      const effect = this.state.pendingEffects.at(0);
      if (effect && this.cpuIds.has(effect.ownerPlayerId)) {
        this.scheduleAction(effect.ownerPlayerId);
      }
    }
  }

  private scheduleAction(playerId: string) {
    if (this.pendingTimeout) return;

    const entry = this.cpuEntries.get(playerId);
    const strategy = STRATEGIES[entry?.difficulty ?? "normal"];
    const action = strategy.decideAction(this.state, playerId);
    if (!action) return;

    const delay = randomDelay(action.type);
    this.pendingTimeout = setTimeout(() => {
      this.pendingTimeout = null;
      if (this.state.phase === "ended") return;
      this.executeAction(playerId, action);
      // 次のアクションは dispatch → tickBot で再スケジュールされる
    }, delay);
  }

  cancelPending() {
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }
}
