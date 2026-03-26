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

### サーバー側の重要な構造

- **`server/src/index.ts`** — Colyseusサーバー起動、`zoo_room`ルーム定義
- **`server/src/rooms/ZooRoom.ts`** — ルームのライフサイクル・ゲームロジック全体（1000行超）。メッセージハンドラ、効果処理、バリデーションを含む
- **`server/src/schema/ZooState.ts`** — Colyseusスキーマ定義。`@type`デコレータで状態を同期
- **`server/src/game/animals.ts`** — 11種の動物データ（コスト、うんち、効果、在庫）
- **`server/src/game/types.ts`** — Effect型などの型定義

### クライアント側の重要な構造

- **`client/src/App.tsx`** — 3画面を管理：メインロビー → ルーム内ロビー → ゲーム画面
- **`client/src/components/Board.tsx`** — ゲームボードUI（650行、CSSグリッド3列レイアウト）
- **`client/src/hooks/useColyseus.ts`** — Colyseus接続フック。ルーム一覧取得・作成・入室・状態同期
- **`client/src/game/`** — 動物データ（アイコン・効果テキスト）と型定義

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

## 技術スタック

- サーバー: Colyseus 0.15, @colyseus/schema 2.0, TypeScript 5.7, tsx
- クライアント: React 19, colyseus.js 0.15, Vite 6, TypeScript 5.7
- リンター/フォーマッター/テストフレームワーク: 未設定
