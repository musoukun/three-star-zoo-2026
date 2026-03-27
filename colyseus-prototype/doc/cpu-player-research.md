# CPUプレイヤー実装 調査結果

## 1. アーキテクチャパターン

### サーバーサイドBot（推奨）
- **CPUロジックはサーバー側に置く**のがベストプラクティス
- クライアント側に置くとチート・同期問題・切断問題が発生する
- Colyseusの場合、Botは実際のWebSocket接続を持たない「仮想クライアント」として実装

### Colyseusでの2つのアプローチ

| | アプローチA: クライアント接続 | アプローチB: ルーム内直接操作（推奨） |
|---|---|---|
| 方式 | `colyseus.js`でBot用クライアントを接続 | `ZooRoom`内で直接ゲームロジックを呼ぶ |
| メリット | 他プレイヤーと完全に同じ見え方 | 通信オーバーヘッドなし、テストしやすい |
| デメリット | 同一サーバー内でもWS通信発生 | ゲームロジックとの結合度が上がる |

### ゲームロジックとBot戦略の分離（boardgame.ioパターン）

```
ゲーム側: enumerate(state) → 合法手リストを返す（純粋関数）
ボット側: 合法手リストから1つ選ぶ（戦略アルゴリズム）
```

- **ボットはゲームルールを知らない**（合法手リストだけ使う）
- **ゲームはボットアルゴリズムを知らない**（合法手列挙だけ担当）
- この分離により、異なる難易度のBotを差し替え可能

## 2. 段階的な戦略レベル

| レベル | アルゴリズム | 特徴 | 適用場面 |
|--------|------------|------|---------|
| **Lv.1** | RandomBot | 合法手からランダム選択 | プロトタイプ、テスト |
| **Lv.2** | Rule-based (貪欲法) | if/elseの優先度ルール | カジュアル対戦 |
| **Lv.3** | Utility-based | 各行動にスコアをつけて最高を選択 | 中級AI |
| **Lv.4** | MCTS | モンテカルロ木探索 | 強いAI |

**推奨**: まずLv.1（RandomBot）で合法手列挙の仕組みを検証 → Lv.2/3で実用レベルに。

## 3. boardgame.ioの具体的な仕組み

### RandomBot（最小実装）
```typescript
class RandomBot extends Bot {
  play({ G, ctx }, playerID) {
    const moves = this.enumerate(G, ctx, playerID);
    return { action: this.random(moves) };
  }
}
```

### MCTSBot（モンテカルロ木探索）
- **enumerate**: 合法手列挙（ゲーム側が提供）
- **objectives**: 中間評価ヒューリスティック（ゲーム終了前でもスコアリング）
- **iterations**: 探索サイクル数（デフォルト1000、関数で動的調整可能）
- **playoutDepth**: シミュレーションの深さ（デフォルト50手先）

```typescript
objectives: (G, ctx, playerID) => ({
  hasMostStars: {
    checker: (G) => getStars(G, playerID) >= 2,
    weight: 10,
  },
  lowPoop: {
    checker: (G) => getPoop(G, playerID) <= 3,
    weight: 5,
  },
})
```

### MCTSの4フェーズ
1. **Selection**: UCT値が最大の子を再帰的に辿る
2. **Expansion**: 未試行のアクションから子ノードを追加
3. **Playout**: ランダムな手をplayoutDepth回繰り返す
4. **Backpropagation**: 結果を親に向かって伝播

## 4. ターンタイミングのベストプラクティス

- **各アクション間に0.5〜1.5秒の遅延**を入れて自然に見せる
- 思考時間のばらつきを持たせる（常に同じ速度だと不自然）
- Colyseusでは `this.clock.setTimeout` で実装
- UIにCPUの「考え中...」表示があるとUXが良い

### 推奨される遅延時間
| アクション | 遅延 |
|-----------|------|
| サイコロを振る | 1000〜2000ms |
| 動物の購入判断 | 1500〜3000ms |
| 単純操作（うんち受取・掃除等） | 500〜1000ms |
| ターン終了 | 500〜1000ms |

## 5. 三ツ星動物園でCPUが判断する必要があるポイント

| フェーズ | 合法手の種類 |
|---------|------------|
| setup | `placeAnimal(animalId, cageNum)` の全有効組み合わせ |
| poop | 常にreceivePoop（判断不要） |
| roll | `rollDice(1)` or `rollDice(2)` |
| income | `resolveSteal(targetId)`, `resolveChoice(choice)`, `resolveStealStar(targetId)` |
| trade | `buyAnimal(id, cage)`, `buyStar()`, `useHeldCardInTrade()`, `endTrade()` |
| clean | `cleanPoop()`, `endClean()` |
| chance | `keepCard()`, `useDrawnCard()`, `useHeldCard()` |
| flush | `endTurn()`（判断不要） |

## 6. 効用関数の要素（三ツ星動物園特化）

| 要素 | 重み（例） | 説明 |
|------|-----------|------|
| コイン効率 | 高 | 動物の価格対効果比 |
| バーストリスク | 非常に高 | うんち数が6に近い場合の警戒度 |
| 星の進捗 | 高 | 勝利条件（星3つ）への近さ |
| 隣接効果 | 中 | 動物配置による効果の最大化 |
| 他プレイヤーへの妨害 | 低〜中 | steal効果の活用 |
| 掃除タイミング | 中 | うんち管理の最適化 |

## 7. 難易度設定パターン

```typescript
interface DifficultyConfig {
  randomnessFactor: number;   // 0.0(完全合理的) ~ 1.0(完全ランダム)
  considerOpponents: boolean; // 他プレイヤーの状態を考慮するか
  mistakeRate: number;        // 0.0 ~ 0.3 程度
  thinkingDelayMs: [number, number]; // [最小, 最大]遅延時間
}

const DIFFICULTIES = {
  easy:   { randomnessFactor: 0.7, considerOpponents: false, mistakeRate: 0.2, thinkingDelayMs: [500, 1500] },
  normal: { randomnessFactor: 0.3, considerOpponents: true,  mistakeRate: 0.05, thinkingDelayMs: [1000, 2500] },
  hard:   { randomnessFactor: 0.1, considerOpponents: true,  mistakeRate: 0.0, thinkingDelayMs: [1500, 3000] },
};
```

## 8. テスタビリティ

### Strategyパターンによる分離
```typescript
interface BotStrategy {
  decideDiceCount(state, playerId): 1 | 2;
  decideAnimalPurchase(state, playerId): { animalId: string; cageNum: number } | null;
  decideBuyStar(state, playerId): boolean;
  decideCleanPoop(state, playerId): boolean;
  decideStealTarget(state, playerId, candidates: string[]): string;
  // ...
}

class RandomStrategy implements BotStrategy { /* ... */ }
class GreedyStrategy implements BotStrategy { /* ... */ }
```

### 既存のテスト基盤を活用
- `@colyseus/testing` の擬似クライアント
- `__debugSetDice` 等のデバッグメッセージでゲーム状態を制御可能

## 9. よくある落とし穴

| 落とし穴 | 対策 |
|---------|------|
| CPUが即座に行動して不自然 | アクション間に遅延を入れる |
| CPUのターンで無限ループ | タイムアウトとフォールバック（最終的にendTurnする） |
| 合法手列挙の漏れ | ユニットテストで全フェーズの列挙を検証 |
| 状態クローンが重い | Colyseusスキーマの直接コピーは避け、プレーンオブジェクトで |
| CPU同士の対戦が瞬時に終わる | 人間がいない場合も遅延を維持 |
| Botが見えない情報を使う | チャンスカードの手札など、公開情報のみで判断させる |
| 状態変更の直接操作 | 必ず既存ゲームロジック関数経由で操作（Colyseus同期が壊れる） |
| 非同期処理の競合 | ボットのターン中のみアクション実行するガード条件が必要 |
| 「強すぎるボット」問題 | 適度なランダム性と「人間らしいミス」が重要 |

## 10. 推奨する実装計画

### ファイル構成案
```
server/src/bot/
├── BotManager.ts        # 生成・管理・ターン制御
├── BotStrategy.ts       # 戦略インターフェース
├── RandomStrategy.ts    # Easy（ランダム）
├── GreedyStrategy.ts    # Normal（貪欲法+効用関数）
└── botActions.ts        # 合法手列挙ユーティリティ
```
まずRandomStrategy + BotManagerの最小構成から始めるのがおすすめ

### 実装ステップ
1. `gameLogic.ts` に `enumerateMoves(state, playerId)` を追加 — 各フェーズの合法手列挙
2. `BotStrategy` インターフェースを定義（各フェーズの判断メソッド）
3. `RandomStrategy` を最初に実装（テスト基盤の構築）
4. `BotManager` で `clock.setTimeout` を使ったターン制御を実装
5. `ZooRoom` に統合 — CPU追加メッセージ、ターン監視、自動アクション発行
6. クライアントにCPU追加UI — ロビーの「CPU追加」ボタン
7. `GreedyStrategy` でゲーム特有の効用関数を実装
8. 切断プレイヤーのホットスワップ対応（将来）

### 将来拡張
- MCTSBot（objectivesベースの評価関数で強いAI）
- 切断プレイヤーのボット代行機能（Asmodee調査: 未完了率12%→4%未満）

## 参考資料
- [Board Game Arena - Bots and AI](https://en.doc.boardgamearena.com/Bots_and_Artificial_Intelligence)
- [boardgame.io - AI Framework (GitHub Issue #7)](https://github.com/google/boardgame.io/issues/7)
- [Colyseus - Bot Template (Gist)](https://gist.github.com/mobyjames/cfd2e9584e8681822fa231a40bb2f2cd)
- [Colyseus - Timing Events](https://docs.colyseus.io/server/room/timing-events)
- [Game AI Pro - Utility Theory](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf)
- [Game AI Pro 2 - Dual-Utility Reasoning](https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter03_Dual-Utility_Reasoning.pdf)
- [Asmodee - Turn-Based Online Gaming](https://doc.asmodee.net/online-gaming)
- [Xebia - Writing Board Game AI Bots](https://xebia.com/blog/writing-board-game-ai-bots-the-good-the-bad-and-the-ugly/)
