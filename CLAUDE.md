# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

「三ツ星動物園」ボードゲームのWeb版。Colyseus（リアルタイムマルチプレイヤーフレームワーク）で実装。
UIやコメントは日本語で記述する。

## 開発コマンド

### サーバー (colyseus-prototype/server)
```bash
npm run dev    # tsx watch で起動（ポート2567）
npm run start  # tsx で起動
npx tsc --noEmit  # 型チェック
```

### クライアント (colyseus-prototype/client)
```bash
npm run dev    # Vite開発サーバー（ポート3000）
npm run build  # 本番ビルド
npx tsc --noEmit  # 型チェック
```

### テスト
```bash
# サーバーユニットテスト (colyseus-prototype/server)
npx vitest run                     # 全テスト実行
npx vitest run --watch             # ウォッチモード
npx vitest run -t "テスト名"       # 特定テスト実行

# E2Eテスト (colyseus-prototype)
# 事前にサーバーとクライアントを手動起動しておく
npx playwright test                         # 全E2Eテスト
npx playwright test e2e/full-game           # 特定ファイル
npx playwright test -g "テスト名"           # 特定テスト
```

サーバーを先に起動してからクライアントを起動する。クライアントはViteプロキシ(`/colyseus` → `ws://localhost:2567`)でサーバーと通信。

## アーキテクチャ

### ディレクトリ構成
```
colyseus-prototype/
├── server/   # Colyseusゲームサーバー (Node.js + TypeScript)
├── client/   # React + Vite Webクライアント
└── e2e/      # Playwright E2Eテスト
```

サーバーとクライアントは独立したnpmプロジェクト（ワークスペース設定なし）。

### サーバー側の構造

```
server/src/
├── index.ts              # Colyseusサーバー起動、zoo_roomルーム定義、/healthエンドポイント
├── rooms/
│   ├── ZooRoom.ts        # ルームライフサイクル（onCreate, onJoin, onLeave）、メッセージハンドラ登録
│   ├── RoomGameplay.ts   # ゲームメカニクス（フェーズ進行、効果処理、チャンスカード、勝敗判定）
│   └── RoomHistory.ts    # Undo/Redoスナップショット管理（最大200件）
├── schema/
│   └── ZooState.ts       # Colyseusスキーマ定義（ZooState, PlayerState, Cage, CageSlot, PendingEffect）
└── game/
    ├── animals.ts        # 11種の動物データ定義、ゲーム定数（STAR_COST, STARS_TO_WIN等）
    ├── chanceCards.ts    # 6種のチャンスカード定義、デッキ生成（12枚）
    ├── types.ts          # AnimalColor, Effect, AnimalDef型定義
    └── gameLogic.ts      # 純粋関数群（配置検証、隣接制約、効果処理順、バースト計算）
```

**ZooRoom** — ルームの入退室・再接続・ホスト引き継ぎ・空室タイマーを管理。`onCreate`でRoomGameplayとRoomHistoryのインスタンスを生成し、全メッセージハンドラを登録。

**RoomGameplay** — ゲームロジックの中枢。ターンフロー制御、サイコロ＆効果処理（`processEffects`）、チャンスカード（draw/execute/finish）、勝敗判定（`checkWin`/`returnMostExpensiveAnimal`）。隠し状態として`chanceDeck`、`heldCards`、`extraTurnFlag`、`_debugForcedDice`を保持。

**RoomHistory** — `push()`でZooState＋隠し状態をJSON保存、`undo()`/`redo()`でスキーマ手動再構築。新フィールドをスキーマに追加した場合は`restoreFromJSON()`にも反映が必要。

**gameLogic.ts** — 純粋関数のみ。ケージ配置（2行グリッド、ケージ11&12は結合スロット）、`ADJACENCY`マップ、色互換性、効果処理順序（左隣→時計回り→自分）、バースト判定。

### クライアント側の構造

```
client/src/
├── App.tsx               # 画面管理（メインロビー/ルーム内ロビー/ゲーム）、ColyseusContext提供
├── components/
│   ├── Board.tsx         # ゲームUI（CageGrid、ActionPanel、PendingEffectUI、ChatPanel）
│   ├── BoardPanels.tsx   # MarketPanel、ChanceCardUI、GameResultModal、BurstAnimation、RuleTooltip
│   └── boardUtils.tsx    # 定数（TURN_STEPS, TOP_ROW, BOTTOM_ROW, ADJACENCY, PLAYER_COLORS）
├── hooks/
│   └── useColyseus.ts    # Colyseus接続管理、LocalStorage再接続、schemaToPlain変換
├── game/
│   ├── animals.ts        # サーバー版＋画像import、効果テキスト、COLOR_CLASS
│   ├── chanceCards.ts    # カード名・アイコン・説明文のUI表示用データ
│   └── types.ts          # サーバーと同じ型定義（手動同期）
├── assets/animals/       # 顔画像 (JPG) ×11
├── assets/animals_card/  # カード画像 (PNG) ×11
└── index.css             # 全スタイル（CSSグリッド、ケージ色5色、プレイヤー色6色、アニメーション）
```

**ColyseusContext** — `state`, `sessionId`, `historyInfo`, `myDrawnCardId`, `myHeldCardId`, `send`をBoard以下に提供。

### ゲームフロー

1. **lobby** — ルーム作成/入室（2-4人）。ホストが「ゲーム開始」
2. **setup** — 初期動物（レッサーパンダ、ペンギン）を12ケージに配置
3. **main** — ターン制：うんち(poop) → サイコロ(roll) → 収入(income) → 売買(trade) → 掃除(clean) → 終了(flush)
4. **ended** — 星3つ＋うんち6個以下で勝利。うんち7個以上でバースト（最高額の動物を返却）

### 状態同期

サーバーの`ZooState`スキーマが権威的な状態。クライアントは`onStateChange`で自動同期された状態を`schemaToPlain()`でプレーンオブジェクトに変換して使用。ゲームアクションは`room.send(type, data)`でサーバーに送信し、サーバー側で検証後に状態更新。

### 共有コード（手動同期が必要）

`server/src/game/` と `client/src/game/` に `types.ts`, `animals.ts`, `chanceCards.ts` が重複。クライアント版はUI用の追加データ（画像import、効果テキスト等）を含む。型定義やゲームデータを変更する場合は両方を更新すること。

### サーバー⇔クライアント メッセージ一覧

クライアントから`room.send(type, data)`で送信し、サーバーの`onMessage`ハンドラで処理。

| フェーズ | メッセージ | データ | 用途 |
|---------|-----------|--------|------|
| lobby | `setColor` | `{color}` | プレイヤー色変更 |
| lobby | `startGame` | — | ゲーム開始（ホスト専用） |
| setup | `placeAnimal` | `{animalId, cageNum}` | 初期動物配置 |
| main | `receivePoop` | — | うんちトークン受取 |
| main | `rollDice` | `{diceCount: 1\|2}` | サイコロ振り |
| main | `resolveSteal` | `{targetPlayerId}` | コイン盗み対象選択 |
| main | `resolveStealStar` | `{targetPlayerId}` | 星盗み対象選択 |
| main | `resolveChoice` | `{choice, targetPlayerId?}` | creation/steal選択 |
| main | `buyAnimal` | `{animalId, cageNum}` | 動物購入 |
| main | `buyStar` | — | 星購入（10コイン） |
| main | `returnAnimal` | `{returns: [...]}` | 動物返却 |
| main | `endTrade` | — | 売買フェーズ終了 |
| main | `cleanPoop` | — | うんち掃除（1コイン→2個除去） |
| main | `endClean` | — | 掃除フェーズ終了 |
| main | `endTurn` | — | ターン終了 |
| chance | `keepChanceCard` | — | カードを保持 |
| chance | `useDrawnChanceCard` | — | 引いたカードを即使用 |
| chance | `useHeldChanceCard` | — | 保持カード使用（強制） |
| chance | `useHeldCardInTrade` | — | 売買中に保持カード使用 |
| chance | `cancelChanceCard` | — | カード効果キャンセル |
| chance | `resolveCompost` | `{count}` | 堆肥化：うんち→コイン変換 |
| chance | `resolveCompostGive` | `{distributions}` | 堆肥提供：うんち分配 |
| chance | `resolveEviction` | `{targetPlayerId, animalId, cageNum}` | 引越し：動物返却 |
| any | `undo` / `redo` | — | 状態巻き戻し/やり直し |
| any | `chat` | `{text}` | チャット送信 |
| ended | `restartGame` | — | ロビーに戻る |
| ended | `resetGame` | — | ゲームリセット |
| debug | `__debugSetDice` | `{dice1, dice2}` | サイコロ値を固定 |
| debug | `__debugSetCoins` | `{coins}` | コイン数を設定 |
| debug | `__debugSetStars` | `{stars}` | 星数を設定 |
| debug | `__debugSetPoop` | `{poopTokens}` | うんちトークン数を設定 |

### ルーム管理

- 空室15分で自動削除（`startEmptyTimer`/`clearEmptyTimer`）
- ゲーム中の切断は15分間再接続猶予（`allowReconnection`）
- ロビーでホスト退出時は次のプレイヤーに引き継ぎ
- プライベートルームはパスワード認証（`onJoin`でチェック）
- クライアントはLocalStorageでセッション保存（15分TTL）、起動時に自動再接続試行

### E2Eテスト

`colyseus-prototype/e2e/`に3ファイル:
- `full-game.spec.ts` — フルゲームフロー
- `animal-effects.spec.ts` — 動物効果テスト
- `win-and-burst.spec.ts` — 勝利・バーストテスト

Playwrightのタイムアウトは180秒。デバッグメッセージ（`__debugSetDice`等）を活用してゲーム状態を制御。

### デプロイ

- サーバー: Dockerfile（Node.js 20-slim）、Railway。`PORT`環境変数でポート指定、`/health`でヘルスチェック
- クライアント: Vercel（`client/vercel.json`）。`VITE_SERVER_URL`環境変数でサーバーURLを指定

## 技術スタック

- サーバー: Colyseus 0.15, @colyseus/schema 2.0, TypeScript 5.7, tsx, Vitest
- クライアント: React 19, colyseus.js 0.15, Vite 6, TypeScript 5.7
- E2E: Playwright 1.58
- デプロイ: Docker+Railway(サーバー), Vercel(クライアント)
