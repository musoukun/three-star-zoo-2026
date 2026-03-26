import { useState, useEffect, useContext, useMemo } from 'react';
import { ColyseusContext } from '../App';
import { PLAYER_COLORS } from '../App';
import { ANIMALS, ANIMAL_ICONS, ANIMAL_CARD_IMAGES, ANIMAL_FACE_IMAGES, EFFECT_TEXT_FULL, EFFECT_TEXT_SHORT, COLOR_CLASS, STAR_COST } from '../game/animals';
import { CHANCE_CARD_DATA } from '../game/chanceCards';
import type { CageState, PlayerInfo } from '../hooks/useColyseus';

// ===== 隣接マップ（サーバーと同一） =====
const ADJACENCY: Record<number, number[]> = {
  1:  [2, 11, 12],
  2:  [1, 3, 11, 12, 10],
  3:  [2, 4, 10, 9],
  4:  [3, 5, 9, 8],
  5:  [4, 6, 8, 7],
  6:  [5, 7],
  7:  [8, 5, 6],
  8:  [7, 9, 4, 5],
  9:  [8, 10, 3, 4],
  10: [9, 11, 12, 2, 3],
  11: [12, 10, 1, 2],
  12: [11, 10, 1, 2],
};

// ===== 定数 =====
const TURN_STEPS = [
  { key: 'poop', icon: '💩', label: 'うんち' },
  { key: 'roll', icon: '🎲', label: 'サイコロ' },
  { key: 'income', icon: '💰', label: '収入' },
  { key: 'trade', icon: '🛒', label: '買物' },
  { key: 'clean', icon: '🧹', label: '掃除' },
  { key: 'flush', icon: '✅', label: '終了' },
];

/** 動物アイコン表示ヘルパー: 顔画像があればimg、なければ絵文字 */
function AnimalIcon({ id, size = 28, className = '' }: { id: string; size?: number; className?: string }) {
  const src = ANIMAL_FACE_IMAGES[id];
  if (src) {
    return <img src={src} alt={id} className={`animal-icon-img ${className}`} style={{ width: size, height: size }} />;
  }
  return <span style={{ fontSize: size * 0.7 }}>{ANIMAL_ICONS[id] || '🐾'}</span>;
}

// ===== メインBoard =====
export function Board({ onLeave }: { onLeave: () => void }) {
  const { state, sessionId, historyInfo, send } = useContext(ColyseusContext);
  const [historyOpen, setHistoryOpen] = useState(false);
  if (!state) return null;

  const isSetup = state.phase === 'setup';
  const isMyTurn = state.currentTurn === sessionId;
  const isEnded = state.phase === 'ended';
  const me = state.players[sessionId];

  const getPlayerName = (id: string) => state.players[id]?.name ?? id;

  // プレイヤーをターン中が先頭にソート
  const sortedPlayers = useMemo(() => {
    const entries = Object.entries(state.players);
    return entries.sort((a, b) => {
      if (a[0] === state.currentTurn) return -1;
      if (b[0] === state.currentTurn) return 1;
      return 0;
    });
  }, [state.players, state.currentTurn]);

  // 他プレイヤー（ターン中が先頭）
  const otherPlayers = useMemo(() => {
    return Object.entries(state.players)
      .filter(([pid]) => pid !== sessionId)
      .sort((a, b) => {
        if (a[0] === state.currentTurn) return -1;
        if (b[0] === state.currentTurn) return 1;
        return 0;
      });
  }, [state.players, state.currentTurn, sessionId]);

  return (
    <div className="game-layout">
      {/* ===== 左上: メインエリア ===== */}
      <div className="main-area">
        {/* ゲームオーバー (小バナー) */}
        {isEnded && (
          <div className="game-over">
            <h2>🏆 ゲーム終了!</h2>
          </div>
        )}

        {/* ステータスバー */}
        <div className="status-bar">
          <strong>
            {isSetup
              ? `セットアップ中 - ${getPlayerName(state.currentTurn)} が配置`
              : `${getPlayerName(state.currentTurn)} のターン`}
          </strong>
          {state.diceRolled && (
            <span>
              🎲 {state.diceCount === 1
                ? `${state.dice1}`
                : `${state.dice1}+${state.dice2}`}
              = <strong>{state.diceSum}</strong>
              {state.diceCount === 1 && ' (1個)'}
            </span>
          )}
          {state.phase === 'main' && state.chanceDeckCount > 0 && (
            <span style={{ fontSize: 11, color: '#777' }}>🃏{state.chanceDeckCount}</span>
          )}
          {isMyTurn && <span className="my-turn">← あなた</span>}
          <button onClick={onLeave} style={{ marginLeft: 'auto', padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>
            退出
          </button>
        </div>

        {/* プレイヤー情報（ターン中が先頭、アニメーション付き） */}
        <div className="player-info-row">
          {sortedPlayers.map(([pid, p]) => {
            const colorDef = p.color ? PLAYER_COLORS[p.color] : null;
            return (
              <div
                key={pid}
                className={`player-card ${pid === state.currentTurn ? 'current' : ''} ${pid === sessionId ? 'me' : ''}`}
                style={{
                  background: colorDef ? colorDef.light : (pid === sessionId ? '#eef6ff' : '#fff'),
                  borderColor: pid === state.currentTurn
                    ? (colorDef ? colorDef.bg : '#e74c3c')
                    : (colorDef ? colorDef.bg + '80' : '#ccc'),
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {colorDef && (
                    <span style={{
                      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                      background: colorDef.bg, flexShrink: 0,
                    }} />
                  )}
                  <strong>{p.name}</strong>
                  {pid === sessionId && <span style={{ fontSize: 10, color: '#666' }}>(自分)</span>}
                  {pid === state.currentTurn && <span style={{ fontSize: 10 }}>🎯</span>}
                </div>
                <div>
                  💰{p.coins} ⭐{'★'.repeat(p.stars)}{'☆'.repeat(3 - p.stars)} 💩{p.poopTokens}
                  {p.hasHeldCard && <span title="伏せカード保持中"> 🃏</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* 他プレイヤーのボード */}
        {otherPlayers.map(([pid, player]) => {
          const pc = player.color ? PLAYER_COLORS[player.color] : null;
          return (
            <div key={pid} className="other-player-section" style={pc ? {
              background: pc.light,
              borderLeft: `4px solid ${pc.bg}`,
            } : undefined}>
              <div className="other-player-name" style={pc ? { color: pc.bg } : undefined}>
                {pc && <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: pc.bg, marginRight: 4, verticalAlign: 'middle' }} />}
                {player.name}の動物園 (💰{player.coins} ⭐{player.stars} 💩{player.poopTokens})
              </div>
              <CageGrid
                cages={player.cages ?? []}
                diceSum={state.diceRolled ? state.diceSum : 0}
                isSetup={false}
                isMyTurn={false}
                setupInventory=""
                send={send}
              />
            </div>
          );
        })}

        {/* 効果ログ */}
        {state.effectLog.length > 0 && (
          <div className="effect-log">
            <h4>📝 ログ</h4>
            {state.effectLog.map((log: string, i: number) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        )}
      </div>

      {/* ===== 中央右: マーケット（常に表示） ===== */}
      <div className="market-area">
        <div className="market-title">🏪 動物マーケット</div>
        <MarketPanel />
      </div>

      {/* ===== 右端: チャット/ゲームログ ===== */}
      <ChatPanel />

      {/* ===== 下部固定: 自分の盤面 + 操作 ===== */}
      <div className="my-board-area" style={(() => {
        const mc = me?.color ? PLAYER_COLORS[me.color] : null;
        return mc ? { background: mc.light, borderTopColor: mc.bg } : {};
      })()}>
        {/* プログレスバー */}
        {!isSetup && !isEnded && (
          <div className="progress-bar">
            {TURN_STEPS.map((step, i) => {
              const stepIdx = TURN_STEPS.findIndex(s => s.key === state.turnStep);
              const isActive = step.key === state.turnStep;
              return (
                <span key={step.key}>
                  {i > 0 && <span className={`progress-line ${i <= stepIdx ? 'active' : ''}`} />}
                  <span className={`progress-step ${isActive ? 'active' : ''}`}>
                    {step.icon} {step.label}
                  </span>
                </span>
              );
            })}
          </div>
        )}

        {/* 自分のステータス */}
        {me && (
          <div className="my-stats">
            <span>💰 {me.coins}コイン</span>
            <span>⭐ {'★'.repeat(me.stars)}{'☆'.repeat(3 - me.stars)}</span>
            <span>💩 {me.poopTokens}個{me.poopTokens >= 7 ? ' ⚠バースト!' : ''}</span>
          </div>
        )}

        {/* 自分のケージ */}
        <CageGrid
          cages={me?.cages ?? []}
          diceSum={state.diceRolled ? state.diceSum : 0}
          isSetup={isSetup}
          isMyTurn={isMyTurn}
          setupInventory={state.setupInventory[sessionId] ?? ''}
          send={send}
        />

        {/* 効果解決UI（自分が効果の所有者なら、手番でなくても表示） */}
        {!isSetup && !isEnded && state.turnStep === 'income' && state.pendingEffects.length > 0 &&
          state.pendingEffects[0].ownerPlayerId === sessionId && (
          <PendingEffectUI />
        )}

        {/* 操作パネル（手番プレイヤーのみ） */}
        {!isSetup && isMyTurn && !isEnded && (
          <ActionPanel />
        )}

        {/* ルール早見表（ホバーで表示） */}
        <RuleTooltip />
      </div>

      {/* ===== 履歴パネル（右端オーバーレイ、トグル式） ===== */}
      <button
        className="history-toggle-btn"
        onClick={() => setHistoryOpen(!historyOpen)}
        title="履歴パネル"
      >
        {historyOpen ? '▶' : '◀'}
      </button>
      {historyOpen && (
        <div className="history-overlay">
          <h3>📜 履歴操作</h3>
          <div className="history-info">
            Undo: {historyInfo.undoCount}件 / Redo: {historyInfo.redoCount}件
          </div>
          <div className="history-buttons">
            <button
              className="history-btn"
              disabled={historyInfo.undoCount === 0}
              onClick={() => send('undo')}
            >
              ↩ Undo
            </button>
            <button
              className="history-btn"
              disabled={historyInfo.redoCount === 0}
              onClick={() => send('redo')}
            >
              ↪ Redo
            </button>
            <button
              className="history-btn danger"
              disabled={historyInfo.undoCount === 0}
              onClick={() => { if (confirm('ゲームを初期状態に戻しますか？')) send('resetGame'); }}
            >
              🔄 Reset
            </button>
          </div>
        </div>
      )}

      {/* ===== リザルトモーダル ===== */}
      {isEnded && <GameResultModal onLeave={onLeave} />}

      {/* ===== バーストアニメーション ===== */}
      <BurstAnimation />
    </div>
  );
}

// ===== リザルト画面 =====
function GameResultModal({ onLeave }: { onLeave: () => void }) {
  const { state, send } = useContext(ColyseusContext);
  if (!state || state.phase !== 'ended') return null;

  const winner = state.players[state.winnerId];
  if (!winner) return null;

  const winnerColor = winner.color ? PLAYER_COLORS[winner.color] : null;

  // 勝者の動物一覧
  const animals: { name: string; animalId: string; cageNum: number }[] = [];
  for (const cage of winner.cages) {
    for (const slot of cage.slots) {
      const a = ANIMALS[slot.animalId];
      if (a) animals.push({ name: a.name, animalId: slot.animalId, cageNum: cage.num });
    }
  }

  return (
    <div className="result-overlay">
      <div className="result-modal" style={winnerColor ? { borderColor: winnerColor.bg } : {}}>
        <div className="result-header" style={winnerColor ? { background: winnerColor.bg } : {}}>
          🏆 ゲーム終了
        </div>
        <div className="result-body">
          <div className="result-winner">
            {winnerColor && (
              <span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: '50%', background: winnerColor.bg, marginRight: 6, verticalAlign: 'middle' }} />
            )}
            <strong>{winner.name}</strong> の勝利！
          </div>

          <div className="result-stats">
            <div className="result-stat">
              <span className="result-stat-icon">⭐</span>
              <span>星 {winner.stars}つ</span>
            </div>
            <div className="result-stat">
              <span className="result-stat-icon">💰</span>
              <span>残りコイン {winner.coins}枚</span>
            </div>
            <div className="result-stat">
              <span className="result-stat-icon">💩</span>
              <span>掃除した💩 {winner.totalPoopCleaned}個</span>
            </div>
          </div>

          <div className="result-section">
            <div className="result-section-title">盤面</div>
            <div className="result-animals">
              {animals.length === 0 ? (
                <span style={{ color: '#999' }}>動物なし</span>
              ) : (
                animals.map((a, i) => (
                  <span key={i} className="result-animal-chip">
                    <AnimalIcon id={a.animalId} size={20} /> {a.name} <span style={{ fontSize: 10, color: '#888' }}>#{a.cageNum}</span>
                  </span>
                ))
              )}
            </div>
          </div>

          {/* 全プレイヤースコア */}
          <div className="result-section">
            <div className="result-section-title">全プレイヤー</div>
            {Object.values(state.players).map((p) => {
              const pc = p.color ? PLAYER_COLORS[p.color] : null;
              return (
                <div key={p.id} className="result-player-row" style={pc ? { borderLeft: `3px solid ${pc.bg}` } : {}}>
                  <span>{p.name} {p.id === state.winnerId && '🏆'}</span>
                  <span>⭐{p.stars} 💰{p.coins} 💩掃除{p.totalPoopCleaned}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="result-actions">
          <button className="result-btn restart" onClick={() => send('restartGame')}>
            🔄 もう1試合
          </button>
          <button className="result-btn leave" onClick={onLeave}>
            🚪 退室する
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== バーストアニメーション =====
function BurstAnimation() {
  const { state } = useContext(ColyseusContext);
  const [visible, setVisible] = useState(false);
  const [playerName, setPlayerName] = useState('');

  useEffect(() => {
    if (state?.burstPlayerId) {
      const p = state.players[state.burstPlayerId];
      setPlayerName(p?.name || '');
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [state?.burstPlayerId]);

  if (!visible) return null;

  return (
    <div className="burst-animation">
      <div className="burst-slide">
        <span className="burst-icon">💩💥</span>
        <span className="burst-text">うんちバースト！</span>
        <span className="burst-name">{playerName}</span>
      </div>
    </div>
  );
}

// ===== クライアント側の配置バリデーション =====
type PlaceResult = { ok: true } | { ok: false; reason: string };

function checkPlacement(animalId: string, cage: CageState, allCages: CageState[]): PlaceResult {
  const animalDef = ANIMALS[animalId];
  if (!animalDef) return { ok: false, reason: '' };
  if (cage.slots.length >= 2) return { ok: false, reason: '満員' };
  if (cage.slots.some(s => s.animalId === animalId)) return { ok: false, reason: '同じ動物は不可' };
  if (cage.slots.length > 0) {
    const firstAnimal = ANIMALS[cage.slots[0].animalId];
    if (!firstAnimal) return { ok: false, reason: '' };
    if (!animalDef.colors.some(c => firstAnimal.colors.includes(c)))
      return { ok: false, reason: '色が合わない' };
  }
  // 隣接制約: 既に同じ動物を持っている場合、隣接ケージにのみ配置可能
  const hasExisting = allCages.some(c => c.slots.some(s => s.animalId === animalId));
  if (hasExisting) {
    const adjacent = ADJACENCY[cage.num] || [];
    const isAdjacentToExisting = allCages.some(c =>
      c.slots.some(s => s.animalId === animalId) && adjacent.includes(c.num)
    );
    if (!isAdjacentToExisting) return { ok: false, reason: '隣接エリアのみ配置可' };
  }
  return { ok: true };
}

function canPlaceOnCage(animalId: string, cage: CageState, allCages?: CageState[]): boolean {
  return checkPlacement(animalId, cage, allCages ?? []).ok;
}

// ===== ケージの色 → 背景・ボーダーのスタイル =====
const CAGE_BG: Record<string, string> = {
  RED: '#fde0e0',
  BLUE: '#dff3f1',
  GREEN: '#e0f2e0',
  PURPLE: '#f0e6f6',
  ORANGE: '#fff3e0',
};
const CAGE_BORDER: Record<string, string> = {
  RED: '#e57373',
  BLUE: '#4db6ac',
  GREEN: '#66bb6a',
  PURPLE: '#ba68c8',
  ORANGE: '#ffa726',
};

function getCageStyle(cage: CageState): React.CSSProperties {
  if (cage.slots.length === 0) return {};
  const firstAnimal = ANIMALS[cage.slots[0].animalId];
  if (!firstAnimal) return {};
  const colors = firstAnimal.colors;

  if (colors.length === 1) {
    return {
      background: CAGE_BG[colors[0]] ?? '#f8f8f8',
      borderColor: CAGE_BORDER[colors[0]] ?? '#ccc',
    };
  }

  // 複数色: 背景はグラデーション、ボーダーもグラデーション
  const bgStops = colors.map((c, i) => {
    const pct1 = (i / colors.length * 100).toFixed(0);
    const pct2 = ((i + 1) / colors.length * 100).toFixed(0);
    return `${CAGE_BG[c] ?? '#f8f8f8'} ${pct1}%, ${CAGE_BG[c] ?? '#f8f8f8'} ${pct2}%`;
  }).join(', ');

  const borderStops = colors.map((c, i) => {
    const pct1 = (i / colors.length * 100).toFixed(0);
    const pct2 = ((i + 1) / colors.length * 100).toFixed(0);
    return `${CAGE_BORDER[c] ?? '#ccc'} ${pct1}%, ${CAGE_BORDER[c] ?? '#ccc'} ${pct2}%`;
  }).join(', ');

  return {
    background: `linear-gradient(to right, ${bgStops})`,
    border: 'none',
    // border-imageでグラデーションボーダー
    borderImage: `linear-gradient(to right, ${borderStops}) 1`,
    borderWidth: '3px',
    borderStyle: 'solid',
  };
}

// ===== ルール早見表（クリックで展開、✖で閉じる） =====
function RuleTooltip() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rule-tooltip-container">
      <div className="rule-tooltip-trigger" onClick={() => setOpen(!open)}>📖</div>
      {open && <><div className="rule-tooltip-overlay" onClick={() => setOpen(false)} />
      <div className="rule-tooltip-content">
        <button className="rule-close-btn" onClick={() => setOpen(false)}>✕</button>
        <h4 style={{ margin: '0 0 6px' }}>ルール早見表</h4>
        <div className="rule-section">
          <strong>ターンの流れ</strong>
          <ol>
            <li>💩 うんちコマを受け取る</li>
            <li>🎲 サイコロを振る（1個 or 2個）</li>
            <li>💰 対応する檻の効果が発動</li>
            <li>🛒 お買い物（動物1匹 + 星1つまで）</li>
            <li>🧹 掃除（1コインで2個除去）</li>
            <li>✅ ターン終了</li>
          </ol>
        </div>
        <div className="rule-section">
          <strong>勝利条件</strong>
          <p>⭐星3つ + 💩6個以下でターン終了</p>
        </div>
        <div className="rule-section">
          <strong>バースト</strong>
          <p>ターン終了時に💩7個以上 →<br/>
          星あり: 星-1 / 星なし: 最高コスト動物を返却<br/>
          その後、全コイン＆全うんちを返却</p>
        </div>
        <div className="rule-section">
          <strong>配置ルール</strong>
          <p>1檻に2匹まで / 同じ動物は不可<br/>
          色が1つ以上一致する必要あり<br/>
          2匹目は隣接檻のみ</p>
        </div>
        <div className="rule-section">
          <strong>効果処理順</strong>
          <p>手番の左隣から時計回り→手番が最後</p>
        </div>
      </div></>}
    </div>
  );
}

// ===== ケージレイアウト定義 =====
// 上段: 1,2,3,4,5,6  下段: [11&12],10,9,8,7
// ケージ12は内部的にケージ11に統合（結合檻）
const TOP_ROW = [1, 2, 3, 4, 5, 6];
const BOTTOM_ROW = [11, 10, 9, 8, 7]; // 11 = 結合ケージ(11&12)

// ===== ケージグリッド =====
function CageGrid({
  cages, diceSum, isSetup, isMyTurn, setupInventory, send,
}: {
  cages: CageState[];
  diceSum: number;
  isSetup: boolean;
  isMyTurn: boolean;
  setupInventory: string;
  send: (type: string, data?: any) => void;
}) {
  const invAnimals = setupInventory ? setupInventory.split(',').filter(s => s.length > 0) : [];

  const renderCage = (cageNum: number, isMerged: boolean = false) => {
    const cage = cages.find(c => c.num === cageNum);
    if (!cage) return null;
    const isRolled = diceSum === cageNum || (isMerged && (diceSum === 11 || diceSum === 12));
    const cageStyle = getCageStyle(cage);
    const label = isMerged ? '11&12' : String(cageNum);

    return (
      <div
        key={cageNum}
        className={`cage ${isRolled ? 'rolled' : ''} ${isMerged ? 'cage-merged' : ''}`}
        style={cageStyle}
      >
        <span className="cage-num">{label}</span>
        <div className="cage-content">
          {cage.slots.length === 0 && <div className="cage-empty">·</div>}
          {cage.slots.map((slot, si) => {
            const a = ANIMALS[slot.animalId];
            if (!a) return null;
            return (
              <div key={si} className="cage-animal" title={EFFECT_TEXT_FULL[slot.animalId] || a.name}>
                <span className="cage-animal-icon">
                  <AnimalIcon id={slot.animalId} size={32} className="cage-animal-img" />
                </span>
                <span className="cage-animal-effect">{EFFECT_TEXT_SHORT[slot.animalId]}</span>
              </div>
            );
          })}
          {/* セットアップ配置ボタン（色・同一動物・隣接制約でフィルタ） */}
          {isSetup && isMyTurn && cage.slots.length < 2 && invAnimals
            .filter(aid => canPlaceOnCage(aid, cage, cages))
            .map(aid => {
              const a = ANIMALS[aid];
              return (
                <button
                  key={aid}
                  className="cage-place-btn"
                  onClick={() => send('placeAnimal', { animalId: aid, cageNum: cage.num })}
                >
                  <span className="place-icon"><AnimalIcon id={aid} size={20} /></span>
                  <span className="place-label">{a?.name ?? aid}を配置</span>
                </button>
              );
            })}
        </div>
      </div>
    );
  };

  return (
    <div className="cage-grid-2row">
      <div className="cage-row top-row">
        {TOP_ROW.map(n => renderCage(n))}
      </div>
      <div className="cage-row bottom-row">
        {BOTTOM_ROW.map(n => renderCage(n, n === 11))}
      </div>
    </div>
  );
}

// ===== マーケットパネル（カード型、常に表示） =====
function MarketPanel() {
  const { state, sessionId, send } = useContext(ColyseusContext);
  if (!state) return null;

  const isMyTurn = state.currentTurn === sessionId;
  const isTrade = state.turnStep === 'trade' && isMyTurn && !state.boughtAnimal;
  const [buying, setBuying] = useState<string | null>(null);

  // 購入する動物のケージ選択
  if (buying) {
    const me = state.players[sessionId];
    const myCages = me?.cages ?? [];
    const animalDef = ANIMALS[buying];

    const cageResults = myCages.map((cage: CageState) => ({
      cage,
      result: checkPlacement(buying, cage, myCages),
    }));
    const placeable = cageResults.filter(r => r.result.ok);
    const notPlaceable = cageResults.filter(r => !r.result.ok && (r.result as { reason: string }).reason);

    return (
      <div>
        <div className="market-title">
          <AnimalIcon id={buying} size={24} /> {animalDef?.name}を配置
        </div>
        <button className="action-btn secondary" style={{ width: '100%', marginBottom: 8 }} onClick={() => setBuying(null)}>
          ← 戻る
        </button>
        {placeable.map(({ cage }) => (
          <button
            key={cage.num}
            className="trade-option"
            style={{ display: 'block', width: '100%', marginBottom: 4, padding: 8, textAlign: 'left', color: '#333', background: '#fff' }}
            onClick={() => {
              send('buyAnimal', { animalId: buying, cageNum: cage.num });
              setBuying(null);
            }}
          >
            ケージ #{cage.num}
            {cage.slots.length > 0 && ` (${cage.slots.map(s => ANIMAL_ICONS[s.animalId] + ANIMALS[s.animalId]?.name).join(', ')})`}
          </button>
        ))}
        {notPlaceable.map(({ cage, result }) => (
          <button
            key={cage.num}
            className="trade-option"
            disabled
            style={{ display: 'block', width: '100%', marginBottom: 4, padding: 8, textAlign: 'left', color: '#aaa', background: '#f5f5f5', cursor: 'not-allowed' }}
          >
            ケージ #{cage.num}
            {cage.slots.length > 0 && ` (${cage.slots.map(s => ANIMAL_ICONS[s.animalId] + ANIMALS[s.animalId]?.name).join(', ')})`}
            <span style={{ fontSize: 11, marginLeft: 8, color: '#e57373' }}>
              {(result as { reason: string }).reason}
            </span>
          </button>
        ))}
        {placeable.length === 0 && <p style={{ color: '#999', fontSize: 12 }}>配置可能なケージがありません</p>}
      </div>
    );
  }

  // カード一覧
  const animalList = Object.values(ANIMALS);
  const me = state.players[sessionId];

  return (
    <div className="market-grid">
      {animalList.map(a => {
        const stock = state.market[a.id] ?? 0;
        const canBuy = isTrade && stock > 0 && (me?.coins ?? 0) >= a.cost;
        const colorClass = COLOR_CLASS[a.colors[0]] || '';

        return (
          <div
            key={a.id}
            className={`market-card ${stock === 0 ? 'sold-out' : ''}`}
            onClick={() => canBuy && setBuying(a.id)}
            style={{ cursor: canBuy ? 'pointer' : 'default' }}
          >
            {/* ヘッダー: コスト(左) ターン(中) うんち(右) — カードデザイン準拠 */}
            <div className={`market-card-header ${colorClass}`}>
              <span>💰{a.cost}</span>
              <span>{a.effect.global ? '範囲：全員' : '範囲：自分のみ'}</span>
              <span>💩{a.poops}</span>
            </div>
            {/* ボディ: アイコン + 名前 */}
            <div className="market-card-body">
              <div className="market-card-icon">
                {ANIMAL_CARD_IMAGES[a.id]
                  ? <img src={ANIMAL_CARD_IMAGES[a.id]} alt={a.name} className="market-card-img" />
                  : ANIMAL_ICONS[a.id]}
              </div>
              <div className="market-card-name">{a.name}</div>
              <div className="market-card-effect">{EFFECT_TEXT_FULL[a.id]}</div>
            </div>
            {/* フッター: 在庫 + 色 */}
            <div className="market-card-footer">
              <span>残 {stock}枚</span>
              <span>{a.colors.map(c => ({ RED: '🔴', BLUE: '🔵', GREEN: '🟢', PURPLE: '🟣', ORANGE: '🟠' }[c] || c)).join('')}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== 操作パネル =====
function ActionPanel() {
  const { state, sessionId, send } = useContext(ColyseusContext);
  if (!state) return null;

  const me = state.players[sessionId];
  if (!me) return null;

  return (
    <div className="action-panel">
      {/* うんち受取 */}
      {state.turnStep === 'poop' && (
        <button className="action-btn" onClick={() => send('receivePoop')}>
          💩 うんちを受け取る
        </button>
      )}

      {/* サイコロ */}
      {state.turnStep === 'roll' && (
        <>
          <button className="action-btn" onClick={() => send('rollDice', { diceCount: 1 })}>
            🎲 1個振り (1-6)
          </button>
          <button className="action-btn" onClick={() => send('rollDice', { diceCount: 2 })}>
            🎲🎲 2個振り (2-12)
          </button>
        </>
      )}

      {/* 効果解決（手番プレイヤーが所有者の場合） */}
      {state.turnStep === 'income' && state.pendingEffects.length > 0 &&
        state.pendingEffects[0].ownerPlayerId === sessionId && (
        <PendingEffectUI />
      )}

      {/* チャンスカード選択UI */}
      {(state.chanceCardPhase === 'useOrKeep' || state.chanceCardPhase === 'forceUse') &&
        state.currentTurn === sessionId && (
        <ChanceCardDrawUI />
      )}

      {/* チャンスカード効果解決UI */}
      {state.chanceCardPhase?.startsWith('using_') && state.currentTurn === sessionId && (
        <ChanceCardInteractionUI />
      )}

      {/* チャンスカード使用中の表示（全員に見える） */}
      {state.activeChanceCard && !state.chanceCardPhase?.startsWith('using_') && (
        <div className="trade-submenu" style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 20 }}>{CHANCE_CARD_DATA[state.activeChanceCard]?.icon}</span>
          {' '}{CHANCE_CARD_DATA[state.activeChanceCard]?.name}
        </div>
      )}

      {/* 取引 */}
      {state.turnStep === 'trade' && !state.chanceCardPhase && (
        <TradeActions />
      )}

      {/* 掃除 */}
      {state.turnStep === 'clean' && (
        <>
          <span style={{ color: '#555', fontSize: 12, alignSelf: 'center' }}>
            💩 {me.poopTokens}個 {me.poopTokens >= 7 && '⚠ 7個以上でバースト!'}
          </span>
          {me.poopTokens > 0 && me.coins >= 1 && (
            <button className="action-btn" onClick={() => send('cleanPoop')}>
              🧹 掃除 (1💰→2個除去)
            </button>
          )}
          <button className="action-btn secondary" onClick={() => send('endClean')}>
            ✅ 掃除終了
          </button>
        </>
      )}

      {/* ターン終了 */}
      {state.turnStep === 'flush' && (
        <button className="action-btn" onClick={() => send('endTurn')}>
          ✅ ターン終了
        </button>
      )}
    </div>
  );
}

// ===== 取引アクション =====
function TradeActions() {
  const { state, sessionId, send } = useContext(ColyseusContext);
  const [returning, setReturning] = useState(false);

  if (!state) return null;
  const me = state.players[sessionId];
  if (!me) return null;

  if (returning) {
    const myAnimals: { animalId: string; cageNum: number }[] = [];
    for (const cage of me.cages ?? []) {
      for (const slot of cage.slots) {
        myAnimals.push({ animalId: slot.animalId, cageNum: cage.num });
      }
    }
    return (
      <div className="trade-submenu">
        <button className="action-btn secondary" onClick={() => setReturning(false)}>← 戻る</button>
        <p>返却する動物:</p>
        {myAnimals.map((a, i) => (
          <button
            key={i}
            className="trade-option"
            onClick={() => {
              send('returnAnimal', { returns: [{ animalId: a.animalId, cageNum: a.cageNum }] });
              setReturning(false);
            }}
          >
            <AnimalIcon id={a.animalId} size={20} /> {ANIMALS[a.animalId]?.name} (#{a.cageNum})
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      {!state.boughtAnimal && (
        <span className="trade-done" style={{ color: '#666' }}>🛒 マーケットから動物をクリックで購入</span>
      )}
      {state.boughtAnimal && <span className="trade-done">✓ 動物購入済み</span>}

      {!state.boughtStar && me.coins >= STAR_COST && (
        <button className="action-btn trade" onClick={() => send('buyStar')}>
          ⭐ 星を買う ({STAR_COST}💰)
        </button>
      )}
      {state.boughtStar && <span className="trade-done">✓ 星購入済み</span>}

      {me.hasHeldCard && (
        <button className="action-btn trade" onClick={() => send('useHeldCardInTrade')}>
          🃏 伏せカードを使う
        </button>
      )}

      <button className="action-btn secondary" onClick={() => setReturning(true)}>
        🔄 動物を返す
      </button>
      <button className="action-btn" onClick={() => send('endTrade')}>
        ⏭️ お買い物終了
      </button>
    </>
  );
}

// ===== 保留効果の解決UI =====
function PendingEffectUI() {
  const { state, sessionId, send } = useContext(ColyseusContext);
  if (!state || state.pendingEffects.length === 0) return null;

  const effect = state.pendingEffects[0];
  const otherPlayers = Object.keys(state.players).filter(p => p !== effect.ownerPlayerId);
  const animalName = ANIMALS[effect.animalId]?.name ?? effect.animalId;
  const animalIconEl = <AnimalIcon id={effect.animalId} size={20} />;
  const getPlayerName = (id: string) => state.players[id]?.name ?? id;

  if (effect.effectType === 'steal') {
    return (
      <div className="trade-submenu">
        <p>{animalIconEl} {animalName}: {effect.stealAmount}コイン奪取 - 対象:</p>
        {otherPlayers.map(pid => (
          <button key={pid} className="trade-option" onClick={() => send('resolveSteal', { targetPlayerId: pid })}>
            {getPlayerName(pid)} (💰{state.players[pid].coins})
          </button>
        ))}
      </div>
    );
  }

  if (effect.effectType === 'stealStar') {
    return (
      <div className="trade-submenu">
        <p>{animalIconEl} {animalName}: 星奪取 - 対象:</p>
        {otherPlayers.map(pid => (
          <button key={pid} className="trade-option" onClick={() => send('resolveStealStar', { targetPlayerId: pid })}>
            {getPlayerName(pid)} (⭐{state.players[pid].stars})
          </button>
        ))}
      </div>
    );
  }

  if (effect.effectType === 'choice') {
    return (
      <div className="trade-submenu">
        <p>{animalIconEl} {animalName}: 効果を選択:</p>
        <button className="trade-option" onClick={() => send('resolveChoice', { choice: 'creation' })}>
          💰 {effect.creationAmount}コイン獲得
        </button>
        <div style={{ marginTop: 4 }}>
          <span style={{ color: '#555', fontSize: 11 }}>🗡️ {effect.stealAmount}コイン奪取: </span>
          {otherPlayers.map(pid => (
            <button key={pid} className="trade-option" onClick={() => send('resolveChoice', { choice: 'steal', targetPlayerId: pid })}>
              {getPlayerName(pid)} (💰{state.players[pid].coins})
            </button>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

// ===== チャンスカード: 引いた直後の選択UI =====
function ChanceCardDrawUI() {
  const { state, sessionId, send, myDrawnCardId, myHeldCardId } = useContext(ColyseusContext);
  if (!state) return null;

  const drawnCard = CHANCE_CARD_DATA[myDrawnCardId];
  const heldCard = myHeldCardId ? CHANCE_CARD_DATA[myHeldCardId] : null;
  const isForceUse = state.chanceCardPhase === 'forceUse';

  return (
    <div className="trade-submenu">
      <p style={{ fontWeight: 'bold', marginBottom: 6 }}>🃏 チャンスカードを引いた!</p>
      {drawnCard && (
        <div style={{ padding: '6px 10px', background: '#fff8e1', borderRadius: 6, marginBottom: 8, border: '1px solid #ffd54f' }}>
          <span style={{ fontSize: 18 }}>{drawnCard.icon}</span>{' '}
          <strong>{drawnCard.name}</strong>
          <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{drawnCard.description}</div>
        </div>
      )}

      {isForceUse && heldCard && (
        <>
          <p style={{ fontSize: 11, color: '#888', margin: '4px 0' }}>伏せカード:</p>
          <div style={{ padding: '4px 10px', background: '#e8eaf6', borderRadius: 6, marginBottom: 8, border: '1px solid #9fa8da' }}>
            <span style={{ fontSize: 16 }}>{heldCard.icon}</span>{' '}
            <strong>{heldCard.name}</strong>
            <span style={{ fontSize: 11, color: '#555', marginLeft: 6 }}>{heldCard.description}</span>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="action-btn trade" onClick={() => send('useDrawnChanceCard')}>
          ▶ 引いたカードを使う
        </button>
        {!isForceUse && (
          <button className="action-btn secondary" onClick={() => send('keepChanceCard')}>
            📥 伏せる
          </button>
        )}
        {isForceUse && (
          <button className="action-btn" onClick={() => send('useHeldChanceCard')}>
            ▶ 伏せカードを使う
          </button>
        )}
      </div>
      {isForceUse && (
        <p style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
          ※ 伏せカードがあるため、どちらか1枚を必ず使ってください
        </p>
      )}
    </div>
  );
}

// ===== チャンスカード: インタラクティブ効果解決UI =====
function ChanceCardInteractionUI() {
  const { state, sessionId, send } = useContext(ColyseusContext);
  const [compostCount, setCompostCount] = useState(0);
  const [distributions, setDistributions] = useState<Record<string, number>>({});
  const [evictionTarget, setEvictionTarget] = useState<string>('');

  if (!state) return null;
  const me = state.players[sessionId];
  if (!me) return null;
  const cardData = CHANCE_CARD_DATA[state.activeChanceCard];
  const getPlayerName = (id: string) => state.players[id]?.name ?? id;
  const otherPlayers = Object.keys(state.players).filter(p => p !== sessionId);

  // 堆肥化
  if (state.chanceCardPhase === 'using_compost') {
    const maxCount = Math.min(5, me.poopTokens);
    return (
      <div className="trade-submenu">
        <p>{cardData?.icon} {cardData?.name}: 💩を金に変換</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
          <button className="action-btn secondary" style={{ padding: '2px 8px' }}
            onClick={() => setCompostCount(Math.max(0, compostCount - 1))} disabled={compostCount <= 0}>−</button>
          <span style={{ fontWeight: 'bold', minWidth: 30, textAlign: 'center' }}>💩 {compostCount}個 → {compostCount}💰</span>
          <button className="action-btn secondary" style={{ padding: '2px 8px' }}
            onClick={() => setCompostCount(Math.min(maxCount, compostCount + 1))} disabled={compostCount >= maxCount}>+</button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="action-btn trade" onClick={() => send('resolveCompost', { count: compostCount })}
            disabled={compostCount <= 0}>
            確定
          </button>
          <button className="action-btn secondary" onClick={() => send('cancelChanceCard')}>
            キャンセル
          </button>
        </div>
      </div>
    );
  }

  // 堆肥提供
  if (state.chanceCardPhase === 'using_compostGive') {
    const maxGive = Math.min(6, me.poopTokens);
    const totalGiven = Object.values(distributions).reduce((a, b) => a + b, 0);
    return (
      <div className="trade-submenu">
        <p>{cardData?.icon} {cardData?.name}: 💩を他プレイヤーに分配 (最大{maxGive}個)</p>
        {otherPlayers.map(pid => (
          <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '3px 0' }}>
            <span style={{ minWidth: 80, fontSize: 12 }}>{getPlayerName(pid)}</span>
            <button className="action-btn secondary" style={{ padding: '1px 6px', fontSize: 11 }}
              onClick={() => setDistributions(d => ({ ...d, [pid]: Math.max(0, (d[pid] ?? 0) - 1) }))}
              disabled={(distributions[pid] ?? 0) <= 0}>−</button>
            <span style={{ minWidth: 20, textAlign: 'center', fontSize: 12 }}>{distributions[pid] ?? 0}</span>
            <button className="action-btn secondary" style={{ padding: '1px 6px', fontSize: 11 }}
              onClick={() => setDistributions(d => ({ ...d, [pid]: (d[pid] ?? 0) + 1 }))}
              disabled={totalGiven >= maxGive}>+</button>
          </div>
        ))}
        <div style={{ fontSize: 11, color: '#555', margin: '4px 0' }}>合計: 💩 {totalGiven}/{maxGive}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="action-btn trade" onClick={() => {
            const dists = Object.entries(distributions)
              .filter(([, c]) => c > 0)
              .map(([targetId, count]) => ({ targetId, count }));
            send('resolveCompostGive', { distributions: dists });
          }} disabled={totalGiven <= 0}>
            確定
          </button>
          <button className="action-btn secondary" onClick={() => send('cancelChanceCard')}>
            キャンセル
          </button>
        </div>
      </div>
    );
  }

  // お引っ越し
  if (state.chanceCardPhase === 'using_eviction') {
    if (!evictionTarget) {
      return (
        <div className="trade-submenu">
          <p>{cardData?.icon} {cardData?.name}: 対象プレイヤーを選択</p>
          {otherPlayers.map(pid => {
            const p = state.players[pid];
            const animalCount = p.cages.reduce((sum, c) => sum + c.slots.length, 0);
            return (
              <button key={pid} className="trade-option" onClick={() => setEvictionTarget(pid)}
                disabled={animalCount === 0}>
                {getPlayerName(pid)} (動物{animalCount}頭)
              </button>
            );
          })}
          <button className="action-btn secondary" style={{ marginTop: 4 }} onClick={() => send('cancelChanceCard')}>
            キャンセル
          </button>
        </div>
      );
    }

    const targetPlayer = state.players[evictionTarget];
    const animals: { animalId: string; cageNum: number }[] = [];
    for (const cage of targetPlayer?.cages ?? []) {
      for (const slot of cage.slots) {
        animals.push({ animalId: slot.animalId, cageNum: cage.num });
      }
    }

    return (
      <div className="trade-submenu">
        <p>{cardData?.icon} {cardData?.name}: {getPlayerName(evictionTarget)}の動物を選択</p>
        <button className="action-btn secondary" style={{ fontSize: 10, padding: '1px 6px', marginBottom: 4 }}
          onClick={() => setEvictionTarget('')}>← 戻る</button>
        {animals.map((a, i) => (
          <button key={i} className="trade-option" onClick={() => {
            send('resolveEviction', { targetPlayerId: evictionTarget, animalId: a.animalId, cageNum: a.cageNum });
            setEvictionTarget('');
          }}>
            <AnimalIcon id={a.animalId} size={18} /> {ANIMALS[a.animalId]?.name ?? a.animalId} (ケージ{a.cageNum})
          </button>
        ))}
        <button className="action-btn secondary" style={{ marginTop: 4 }} onClick={() => { setEvictionTarget(''); send('cancelChanceCard'); }}>
          キャンセル
        </button>
      </div>
    );
  }

  return null;
}

// ===== チャット/ゲームログパネル =====
function ChatPanel() {
  const { state, send } = useContext(ColyseusContext);
  const [text, setText] = useState('');

  if (!state) return null;

  const gameLog = state.gameLog ?? [];

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    send('chat', { text: trimmed });
    setText('');
  };

  return (
    <div className="chat-area">
      <div className="chat-header">💬 ログ / チャット</div>
      <div className="chat-messages" ref={el => { if (el) el.scrollTop = el.scrollHeight; }}>
        {gameLog.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.includes('💬') ? 'chat' : 'system'}`}>
            {msg}
          </div>
        ))}
      </div>
      <div className="chat-input-row">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
          placeholder="メッセージ..."
        />
        <button onClick={handleSend}>送信</button>
      </div>
    </div>
  );
}
