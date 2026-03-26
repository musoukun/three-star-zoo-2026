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

サーバーを先に起動してからクライアントを起動する。クライアントはViteプロキシ(`/colyseus` → `ws://localhost:2567`)でサーバーと通信。

## アーキテクチャ

### ディレクトリ構成
```
colyseus-prototype/
├── server/   # Colyseusゲームサーバー (Node.js + TypeScript)
└── client/   # React + Vite Webクライアント
```

サーバーとクライアントは独立したnpmプロジェクト（ワークスペース設定なし）。

### サーバー側の構造と機能マップ

- **`server/src/index.ts`** — Colyseusサーバー起動、`zoo_room`ルーム定義、CORS設定、`/health`エンドポイント
- **`server/src/rooms/ZooRoom.ts`** (~1600行) — ゲームロジックの中枢。以下の機能を実装：
  - **ルームライフサイクル**: `onCreate`(初期化・メッセージハンドラ登録), `onJoin`(パスワード認証・再接続), `onLeave`(切断処理・ホスト引き継ぎ)
  - **ケージ配置システム**: 2行×6列グリッド（ケージ11&12は結合スロット）、`ADJACENCY`マップで隣接判定、色互換性チェック(`canPlaceAnimal`)、隣接制約(`checkAdjacentConstraint`)
  - **ターンフロー制御**: `resetTurnState`, `nextTurn`（`extraTurnFlag`による再入園対応）
  - **サイコロ＆効果処理**: `processEffects`が全プレイヤーのケージを走査。処理順序は左隣→時計回り→自分の順(`getEffectProcessingOrder`)。`processAnimalEffect`で7種の効果タイプ(creation, creationIf, buff, bonusbuff, steal, stealIf, choice, adjacent)を実行
  - **チャンスカード**: `drawChanceCard`(デッキから引く), `executeChanceCard`(6種のカード効果実行), `finishChanceCard`(捨て札処理)。保持カード(`heldCards`)と強制使用(`forceUse`)の仕組みあり
  - **勝敗判定**: `checkWin`(星3＋うんち6以下), `returnMostExpensiveAnimal`(うんちバースト時のペナルティ)
  - **Undo/Redo**: `pushSnapshot`で全状態(ZooState+チャンスカードデッキ+保持カード+フラグ)をJSON保存、`restoreFromJSON`/`restoreSnapshot`で復元。最大200スナップショット
  - **デバッグ用メッセージ**: `__debugSetDice`, `__debugSetCoins`, `__debugSetStars`
- **`server/src/schema/ZooState.ts`** — Colyseusスキーマ定義。主要クラス：
  - `ZooState`(ルート): phase, currentTurn, turnStep, dice系, market, pendingEffects, chanceCardPhase, activeChanceCard, gameLog等
  - `PlayerState`: coins, stars, poopTokens, hasHeldCard, cages(12個のCage)
  - `Cage` / `CageSlot`: ケージ番号とスロット（最大2匹）
  - `PendingEffect`: effectType(steal/choice/stealStar), 対象プレイヤー、金額等
- **`server/src/game/animals.ts`** — 11種の動物データ定義（コスト0-6、うんち0-3、色、在庫数、効果）。`STARTING_ANIMALS`, `STARTING_COINS`, `STAR_COST`, `STARS_TO_WIN`等の定数
- **`server/src/game/chanceCards.ts`** — 6種のチャンスカード定義(menuHit, productHit, compost, compostGive, extraTurn, eviction)。`createChanceDeck`でシャッフル済み12枚デッキ生成
- **`server/src/game/types.ts`** — `AnimalColor`, `Effect`, `AnimalDef`の型定義
- **`server/src/__tests__/zoo-room.test.ts`** — Vitestによるユニットテスト

### クライアント側の構造と機能マップ

- **`client/src/App.tsx`** — 3画面を管理。以下の機能を実装：
  - **メインロビー**: ルーム作成フォーム(パスワード対応)、ルーム一覧検索・フィルタ、入室ダイアログ
  - **ルーム内ロビー**: プレイヤー一覧＆色選択、ゲーム開始ボタン(ホスト専用)、ゲームログ表示
  - **ColyseusContext**: `state`, `sessionId`, `historyInfo`, `myDrawnCardId`, `myHeldCardId`, `send`をBoard以下に提供
- **`client/src/components/Board.tsx`** (~1170行) — ゲームUI全体。内部コンポーネント：
  - **Board**: 3カラムCSSグリッド（メインエリア | マーケット480px | チャット）＋下部に自分のボード
  - **CageGrid**: 2行ケージグリッド。セットアップ中は配置ボタン表示、サイコロ一致時は赤グロー演出
  - **MarketPanel**: 3カラムの動物カード一覧。購入時にケージ選択サブメニュー表示。売り切れグレーアウト
  - **ActionPanel**: turnStepに応じたUIを切り替え(うんち受取/サイコロ/収入/売買/掃除/ターン終了)
  - **PendingEffectUI**: steal/stealStar/choiceの効果解決UI（対象プレイヤー選択等）
  - **ChanceCardDrawUI**: 引いたカード表示、「使う」「保持する」選択
  - **ChanceCardInteractionUI**: compost(スライダー), compostGive(分配), eviction(対象選択)のインタラクティブUI
  - **GameResultModal**: 勝者情報・全プレイヤーのスコア表示、「もう一度」「退出」
  - **BurstAnimation**: うんちバースト時のスライドイン演出（3秒自動消去）
  - **RuleTooltip**: ルールクイックリファレンス（浮動パネル）
  - **ChatPanel**: ゲームログ＋チャット入力
- **`client/src/hooks/useColyseus.ts`** — Colyseus接続管理フック。`fetchRooms`, `createRoom`, `joinRoomById`, `send`, `leave`。サーバーからの`historyInfo`, `chanceCardDrawn`, `heldCardInfo`メッセージをリスン
- **`client/src/game/animals.ts`** — サーバー版にUI情報を追加：`ANIMAL_ICONS`(絵文字), `ANIMAL_CARD_IMAGES`/`ANIMAL_FACE_IMAGES`(画像import), `EFFECT_TEXT_FULL`/`EFFECT_TEXT_SHORT`(効果テキスト), `COLOR_CLASS`
- **`client/src/game/chanceCards.ts`** — `CHANCE_CARD_DATA`: カード名・アイコン・説明文のUI表示用データ
- **`client/src/game/types.ts`** — サーバーと同じ型定義（手動同期）
- **`client/src/index.css`** (~1020行) — 全ゲームスタイル。CSSグリッドレイアウト、ケージ色(5色)、プレイヤー色(6色)、アニメーション(fadeIn, scaleIn, burstSlideIn)

### ゲームフロー

1. **lobby** — ルーム作成/入室。ホストが「ゲーム開始」でプレイヤー数確定
2. **setup** — 初期動物（レッサーパンダ、ペンギン）を配置
3. **main** — ターン制：うんち(poop) → サイコロ(roll) → 収入(income) → 売買(trade) → 掃除(clean) → 終了(flush)
4. **ended** — 星3つ＋うんち6個以下で勝利

### 状態同期

サーバーの`ZooState`スキーマが権威的な状態。クライアントは`onStateChange`で自動同期された状態を`schemaToPlain()`でプレーンオブジェクトに変換して使用。ゲームアクションは`room.send(type, data)`でサーバーに送信し、サーバー側で検証後に状態更新。

### ルーム管理

- 空室15分で自動削除（`startEmptyTimer`/`clearEmptyTimer`）
- ゲーム中の切断は15分間再接続猶予（`allowReconnection`）
- ロビーでホスト退出時は次のプレイヤーに引き継ぎ
- プライベートルームはパスワード認証（`onJoin`でチェック）
- `setMetadata`でルーム一覧に情報公開、クライアントは`getAvailableRooms`で取得

### スナップショット式Undo/Redo

`ZooRoom`は`pushSnapshot()`で状態のJSON全体を`undoStack`に保存。Undo時は`restoreFromJSON()`でスキーマオブジェクトを手動再構築する。新フィールドをスキーマに追加した場合は`restoreFromJSON()`にも反映が必要。

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

### 共有コード（手動同期が必要）

`server/src/game/` と `client/src/game/` に `types.ts`, `animals.ts`, `chanceCards.ts` が重複。クライアント版はUI用の追加データ（画像import、効果テキスト等）を含む。型定義やゲームデータを変更する場合は両方を更新すること。

### テスト

```bash
# サーバーユニットテスト (colyseus-prototype/server)
npx vitest run          # 全テスト実行
npx vitest run --watch  # ウォッチモード

# E2Eテスト (colyseus-prototype)
# 事前にサーバーとクライアントを手動起動しておく
npx playwright test                    # 全E2Eテスト
npx playwright test e2e/full-game      # 特定ファイル
```

E2Eテストは`colyseus-prototype/e2e/`にあり、`full-game.spec.ts`(フルゲームフロー)と`animal-effects.spec.ts`(動物効果テスト)が存在。Playwrightのタイムアウトは180秒。

### デプロイ

- サーバー: Dockerfile あり（Node.js 20-slim、ポート2567）
- クライアント: Vercel設定あり（`client/vercel.json`）。`VITE_SERVER_URL`環境変数でサーバーURLを指定

## 技術スタック

- サーバー: Colyseus 0.15, @colyseus/schema 2.0, TypeScript 5.7, tsx, Vitest
- クライアント: React 19, colyseus.js 0.15, Vite 6, TypeScript 5.7
- E2E: Playwright 1.58
- デプロイ: Docker(サーバー), Vercel(クライアント)
