import { useState, useContext, useMemo } from 'react';
import { ColyseusContext, PLAYER_COLORS } from '../App';
import { ANIMALS, ANIMAL_ICONS, EFFECT_TEXT_FULL, EFFECT_TEXT_SHORT, STAR_COST } from '../game/animals';
import { CHANCE_CARD_DATA } from '../game/chanceCards';
import type { CageState } from '../hooks/useColyseus';
import {
  TURN_STEPS, TOP_ROW, BOTTOM_ROW,
  AnimalIcon, canPlaceOnCage, getCageStyle,
} from './boardUtils';
import {
  GameResultModal, BurstAnimation, RuleTooltip,
  MarketPanel, ChanceCardDrawUI, ChanceCardInteractionUI,
} from './BoardPanels';

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

  const sortedPlayers = useMemo(() => {
    const entries = Object.entries(state.players);
    return entries.sort((a, b) => {
      if (a[0] === state.currentTurn) return -1;
      if (b[0] === state.currentTurn) return 1;
      return 0;
    });
  }, [state.players, state.currentTurn]);

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
        {isEnded && (
          <div className="game-over">
            <h2>🏆 ゲーム終了!</h2>
          </div>
        )}

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

        {state.effectLog.length > 0 && (
          <div className="effect-log">
            <h4>📝 ログ</h4>
            {state.effectLog.map((log: string, i: number) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        )}
      </div>

      {/* ===== 中央右: マーケット ===== */}
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

        {me && (
          <div className="my-stats">
            <span>💰 {me.coins}コイン</span>
            <span>⭐ {'★'.repeat(me.stars)}{'☆'.repeat(3 - me.stars)}</span>
            <span>💩 {me.poopTokens}個{me.poopTokens >= 7 ? ' ⚠バースト!' : ''}</span>
          </div>
        )}

        <CageGrid
          cages={me?.cages ?? []}
          diceSum={state.diceRolled ? state.diceSum : 0}
          isSetup={isSetup}
          isMyTurn={isMyTurn}
          setupInventory={state.setupInventory[sessionId] ?? ''}
          send={send}
        />

        {!isSetup && isMyTurn && !isEnded && (
          <ActionPanel />
        )}

        <RuleTooltip />
      </div>

      {/* ===== 履歴パネル ===== */}
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

      {isEnded && <GameResultModal onLeave={onLeave} />}
      <BurstAnimation />
    </div>
  );
}

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

// ===== 操作パネル =====
function ActionPanel() {
  const { state, sessionId, send } = useContext(ColyseusContext);
  if (!state) return null;

  const me = state.players[sessionId];
  if (!me) return null;

  return (
    <div className="action-panel">
      {state.turnStep === 'poop' && (
        <button className="action-btn" onClick={() => send('receivePoop')}>
          💩 うんちを受け取る
        </button>
      )}

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

      {state.turnStep === 'income' && state.pendingEffects.length > 0 &&
        state.pendingEffects[0].ownerPlayerId === sessionId && (
        <PendingEffectUI />
      )}

      {(state.chanceCardPhase === 'useOrKeep' || state.chanceCardPhase === 'forceUse') &&
        state.currentTurn === sessionId && (
        <ChanceCardDrawUI />
      )}

      {state.chanceCardPhase?.startsWith('using_') && state.currentTurn === sessionId && (
        <ChanceCardInteractionUI />
      )}

      {state.activeChanceCard && !state.chanceCardPhase?.startsWith('using_') && (
        <div className="trade-submenu" style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 20 }}>{CHANCE_CARD_DATA[state.activeChanceCard]?.icon}</span>
          {' '}{CHANCE_CARD_DATA[state.activeChanceCard]?.name}
        </div>
      )}

      {state.turnStep === 'trade' && !state.chanceCardPhase && (
        <TradeActions />
      )}

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
