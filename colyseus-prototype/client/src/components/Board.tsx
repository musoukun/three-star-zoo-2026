import { useState, useEffect, useContext, useMemo, useRef, lazy, Suspense, createContext } from 'react';
import { ColyseusContext, PLAYER_COLORS } from '../App';
import { ANIMALS, ANIMAL_ICONS, EFFECT_TEXT_FULL, EFFECT_TEXT_SHORT, STAR_COST } from '../game/animals';
import { CHANCE_CARD_DATA } from '../game/chanceCards';
import type { CageState } from '../hooks/useColyseus';
import {
  TURN_STEPS, TOP_ROW, BOTTOM_ROW,
  AnimalIcon, canPlaceOnCage, getCageStyle, StepIcon,
} from './boardUtils';
import {
  GameResultModal, BurstAnimation, RuleTooltip,
  MarketPanel, ChanceCardDrawUI, ChanceCardInteractionUI,
} from './BoardPanels';
import { Emoji } from './Emoji';
import { TutorialGuide, isTutorialDone } from './TutorialGuide';


const DiceAnimation = lazy(() => import('./Dice/DiceAnimation'));

// ===== モバイル判定フック =====
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

// ===== 試験的: 動物パラメータオーバーライド =====
interface AnimalOverrides {
  poop: Record<string, number>;
  cost: Record<string, number>;
}
export const PoopOverrideContext = createContext<AnimalOverrides>({ poop: {}, cost: {} });
const ANIMAL_LIST = Object.values(ANIMALS);

const BTN_STYLE = { width: 22, height: 22, padding: 0, lineHeight: '20px', cursor: 'pointer', fontSize: '0.85em' } as const;

function PoopOverridePanel({ overrides, setOverrides }: {
  overrides: AnimalOverrides;
  setOverrides: (v: AnimalOverrides) => void;
}) {
  const { send } = useContext(ColyseusContext);

  const getVal = (animalId: string, field: 'poop' | 'cost') =>
    overrides[field][animalId] ?? (field === 'poop' ? ANIMALS[animalId].poops : ANIMALS[animalId].cost);

  const setVal = (animalId: string, field: 'poop' | 'cost', value: number) => {
    const clamped = Math.max(0, Math.min(99, value));
    const base = field === 'poop' ? ANIMALS[animalId].poops : ANIMALS[animalId].cost;
    const next = { ...overrides, [field]: { ...overrides[field] } };
    if (clamped === base) {
      delete next[field][animalId];
    } else {
      next[field][animalId] = clamped;
    }
    setOverrides(next);
    if (field === 'poop') {
      send('__debugSetAnimalPoop', { animalId, poops: clamped });
    } else {
      send('__debugSetAnimalCost', { animalId, cost: clamped });
    }
  };

  return (
    <div style={{ marginTop: 8, fontSize: '0.8em', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 6 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 6 }}>試験的: パラメータ調整</div>
      <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ANIMAL_LIST.map(a => {
          const poopVal = getVal(a.id, 'poop');
          const costVal = getVal(a.id, 'cost');
          const poopChanged = a.id in overrides.poop;
          const costChanged = a.id in overrides.cost;
          const anyChanged = poopChanged || costChanged;
          return (
            <div key={a.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4 }}>
              <div style={{ fontWeight: anyChanged ? 'bold' : 'normal', color: anyChanged ? '#ffd700' : 'inherit', marginBottom: 2 }}>
                {a.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
                <span style={{ fontSize: '0.85em', color: 'rgba(255,255,255,0.6)', minWidth: 36 }}>コイン</span>
                <button style={BTN_STYLE} onClick={() => setVal(a.id, 'cost', costVal - 1)}>-</button>
                <span style={{ width: 20, textAlign: 'center', fontWeight: costChanged ? 'bold' : 'normal',
                  color: costChanged ? '#ffd700' : 'inherit' }}>{costVal}</span>
                <button style={BTN_STYLE} onClick={() => setVal(a.id, 'cost', costVal + 1)}>+</button>
                <span style={{ fontSize: '0.85em', color: 'rgba(255,255,255,0.6)', minWidth: 36, marginLeft: 8 }}>うんち</span>
                <button style={BTN_STYLE} onClick={() => setVal(a.id, 'poop', poopVal - 1)}>-</button>
                <span style={{ width: 20, textAlign: 'center', fontWeight: poopChanged ? 'bold' : 'normal',
                  color: poopChanged ? '#ffd700' : 'inherit' }}>{poopVal}</span>
                <button style={BTN_STYLE} onClick={() => setVal(a.id, 'poop', poopVal + 1)}>+</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== メインBoard =====
export function Board({ onLeave }: { onLeave: () => void }) {
  const { state, sessionId, historyInfo, send } = useContext(ColyseusContext);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [animalOverrides, setAnimalOverrides] = useState<AnimalOverrides>({ poop: {}, cost: {} });
  const isMobile = useIsMobile();
  const [marketOpen, setMarketOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [diceAnimResults, setDiceAnimResults] = useState<number[] | null>(null);
  const prevDiceRolledRef = useRef(false);
  const [showTutorial, setShowTutorial] = useState(() => !isTutorialDone());

  // サイコロが振られたらアニメーションを開始
  useEffect(() => {
    if (!state) return;
    if (state.diceRolled && !prevDiceRolledRef.current) {
      const results = state.diceCount === 1
        ? [state.dice1]
        : [state.dice1, state.dice2];
      setDiceAnimResults(results);
    }
    prevDiceRolledRef.current = state.diceRolled;
  }, [state?.diceRolled, state?.dice1, state?.dice2]);

  if (!state) return null;

  const isSetup = state.phase === 'setup';
  const isMyTurn = state.currentTurn === sessionId;
  const isEnded = state.phase === 'ended';
  const me = state.players[sessionId];
  const marketBlink = state.turnStep === 'trade' && isMyTurn;

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

  // ===== モバイルレイアウト =====
  if (isMobile) return (
    <PoopOverrideContext.Provider value={animalOverrides}>
    <div className="game-layout-mobile">

      {/* ステータスバー */}
      <div className="mobile-status-bar">
        <strong>
          {isSetup ? `${getPlayerName(state.currentTurn)} 配置中` : getPlayerName(state.currentTurn)}
        </strong>
        {state.diceRolled && (
          <span><Emoji name="dice" size={14} />{state.diceCount === 1 ? `${state.dice1}` : `${state.dice1}+${state.dice2}`}={state.diceSum}</span>
        )}
        {state.phase === 'main' && state.chanceDeckCount > 0 && (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}><Emoji name="card" size={12} />{state.chanceDeckCount}</span>
        )}
        {isMyTurn && <span className="my-turn">あなた</span>}
        <button onClick={onLeave} className="mobile-leave-btn">退出</button>
      </div>

      {/* プレイヤーサマリー横スクロール */}
      <div className="mobile-player-strip">
        {sortedPlayers.map(([pid, p]) => {
          const c = p.color ? PLAYER_COLORS[p.color] : null;
          return (
            <div key={pid} className={`mobile-player-chip ${pid === state.currentTurn ? 'active' : ''}`}
              style={{ background: c?.light, borderColor: pid === state.currentTurn ? (c?.bg || '#e74c3c') : 'transparent' }}>
              {c && <span className="mobile-player-dot" style={{ background: c.bg }} />}
              <span className={pid === sessionId ? 'mobile-player-name me' : 'mobile-player-name'}>{p.name}</span>
              <span className="mobile-player-stats">
                <Emoji name="coin" size={12} />{p.coins} <Emoji name="star" size={12} />{p.stars} <Emoji name="poop" size={12} />{p.poopTokens}
                {p.hasHeldCard && <> <Emoji name="card" size={12} /></>}
              </span>
            </div>
          );
        })}
      </div>

      {/* スクロールコンテンツ */}
      <div className="mobile-content">
        {isEnded && (
          <div className="game-over" style={{ padding: 8, marginBottom: 8 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}><Emoji name="trophy" size={16} /> ゲーム終了!</h2>
          </div>
        )}

        {/* 他プレイヤー ミニ盤面 */}
        {otherPlayers.map(([pid, player]) => {
          const pc = player.color ? PLAYER_COLORS[player.color] : null;
          return (
            <div key={pid} className="mobile-other-player" style={pc ? { borderLeftColor: pc.bg } : undefined}>
              <div className="mobile-other-name" style={pc ? { color: pc.bg } : undefined}>
                {pc && <span className="mobile-player-dot" style={{ background: pc.bg }} />}
                {player.name}
                <span className="mobile-other-stats"><Emoji name="coin" size={12} />{player.coins} <Emoji name="star" size={12} />{player.stars} <Emoji name="poop" size={12} />{player.poopTokens}</span>
              </div>
              <MiniCageGrid cages={player.cages ?? []} diceSum={state.diceRolled && !diceAnimResults ? state.diceSum : 0} />
            </div>
          );
        })}

        {/* 自分の盤面 */}
        <div className="mobile-my-board" style={(() => {
          const mc = me?.color ? PLAYER_COLORS[me.color] : null;
          return mc ? { background: mc.light, borderTopColor: mc.bg } : {};
        })()}>
          <div className="mobile-my-header">
            <span className="mobile-my-label">自分の動物園</span>
            {me && (
              <div className="mobile-my-stats">
                <span><Emoji name="coin" size={14} /> {me.coins}</span>
                <span><Emoji name="star" size={14} /> {'★'.repeat(me.stars)}{'☆'.repeat(3 - me.stars)}</span>
                <span><Emoji name="poop" size={14} /> {me.poopTokens}{me.poopTokens >= 7 ? ' ⚠バースト!' : ''}</span>
              </div>
            )}
          </div>

          {!isSetup && !isEnded && (
            <div className="mobile-progress">
              {TURN_STEPS.map((step, i) => {
                const stepIdx = TURN_STEPS.findIndex(s => s.key === state.turnStep);
                const isActive = step.key === state.turnStep;
                return (
                  <span key={step.key} className="mobile-progress-item">
                    {i > 0 && <span className={`progress-line ${i <= stepIdx ? 'active' : ''}`} />}
                    <span className={`mobile-progress-step ${isActive ? 'active' : ''}`}
                      title={step.label}><StepIcon emoji={step.emoji} size={12} /></span>
                  </span>
                );
              })}
            </div>
          )}

          <CageGrid
            cages={me?.cages ?? []}
            diceSum={state.diceRolled && !diceAnimResults ? state.diceSum : 0}
            isSetup={isSetup}
            isMyTurn={isMyTurn}
            setupInventory={state.setupInventory[sessionId] ?? ''}
            send={send}
            tutorialId="my-cage-grid"
          />

          {!isSetup && isMyTurn && !isEnded && <ActionPanel />}

          {/* 他プレイヤーのターンでも自分宛の効果解決UIを表示 */}
          {!isMyTurn && state.turnStep === 'income' && state.pendingEffects.length > 0 &&
            state.pendingEffects[0].ownerPlayerId === sessionId && (
            <div className="action-panel">
              <PendingEffectUI />
            </div>
          )}
        </div>

        {state.effectLog.length > 0 && (
          <div className="effect-log">
            <h4><Emoji name="memo" size={14} /> ログ</h4>
            {state.effectLog.map((log: string, i: number) => <div key={i}>{log}</div>)}
          </div>
        )}

        <RuleTooltip />
      </div>

      {/* マーケットFAB + ドロワー */}
      <button className="mobile-fab market-fab" data-tutorial="market-fab" onClick={() => setMarketOpen(true)}><Emoji name="store" size={20} /></button>
      {marketOpen && <div className="drawer-overlay" onClick={() => setMarketOpen(false)} />}
      <div className={`market-drawer ${marketOpen ? 'open' : ''}`}>
        <div className="market-drawer-header">
          <span><Emoji name="store" size={16} /> 動物マーケット</span>
          <span className="market-header-coins">所持金：<Emoji name="coin" size={14} />{me?.coins ?? 0}</span>
          <button onClick={() => setMarketOpen(false)} className="drawer-close-btn">✕</button>
        </div>
        <div className="market-drawer-body">
          <MarketPanel />
        </div>
      </div>

      {/* チャットFAB + ボトムシート */}
      <button className="mobile-fab chat-fab" onClick={() => setChatOpen(!chatOpen)}>
        <Emoji name="chat" size={20} />
      </button>
      {chatOpen && (
        <>
          <div className="drawer-overlay" onClick={() => setChatOpen(false)} />
          <div className="chat-bottom-sheet">
            <div className="chat-sheet-handle" onClick={() => setChatOpen(false)}>
              <div className="handle-bar" />
            </div>
            <ChatPanel />
          </div>
        </>
      )}

      {/* 履歴 */}
      <button className="history-toggle-btn" onClick={() => setHistoryOpen(!historyOpen)} title="履歴">
        {historyOpen ? '▶' : '◀'}
      </button>
      {historyOpen && (
        <div className="history-overlay">
          <h3><Emoji name="scroll" size={16} /> 履歴操作</h3>
          <div className="history-info">Undo: {historyInfo.undoCount} / Redo: {historyInfo.redoCount}</div>
          <div className="history-buttons">
            <button className="history-btn" disabled={historyInfo.undoCount === 0} onClick={() => send('undo')}>↩ Undo</button>
            <button className="history-btn" disabled={historyInfo.redoCount === 0} onClick={() => send('redo')}>↪ Redo</button>
            <button className="history-btn danger" disabled={historyInfo.undoCount === 0}
              onClick={() => { if (confirm('ゲームを初期状態に戻しますか？')) send('resetGame'); }}><Emoji name="refresh" size={12} /> Reset</button>
          </div>
          <PoopOverridePanel overrides={animalOverrides} setOverrides={setAnimalOverrides} />
        </div>
      )}

      {isEnded && <GameResultModal onLeave={onLeave} />}
      <BurstAnimation />
      {diceAnimResults && (
        <Suspense fallback={null}>
          <DiceAnimation
            diceResults={diceAnimResults}
            onComplete={() => setDiceAnimResults(null)}
          />
        </Suspense>
      )}
      {showTutorial && (
        <TutorialGuide
          currentPhase={state.phase}
          turnStep={state.turnStep}
          isMyTurn={isMyTurn}
          isMobile={isMobile}
          onDone={() => setShowTutorial(false)}
        />
      )}
    </div>
    </PoopOverrideContext.Provider>
  );

  // ===== デスクトップレイアウト =====
  return (
    <PoopOverrideContext.Provider value={animalOverrides}>
    <div className="game-layout">

      {/* ===== 左上: メインエリア ===== */}
      <div className="main-area">
        {isEnded && (
          <div className="game-over">
            <h2><Emoji name="trophy" size={20} /> ゲーム終了!</h2>
          </div>
        )}

        <div className="status-bar">
          <strong>
            {isSetup
              ? (isMyTurn ? 'セットアップ中 - あなたが配置' : `セットアップ中 - ${getPlayerName(state.currentTurn)} が配置`)
              : (isMyTurn ? <span className="my-turn">あなたのターン</span> : `${getPlayerName(state.currentTurn)} のターン`)}
          </strong>
          {state.diceRolled && (
            <span>
              <Emoji name="dice" size={17} /> {state.diceCount === 1
                ? `${state.dice1}`
                : `${state.dice1}+${state.dice2}`}
              = <strong>{state.diceSum}</strong>
              {state.diceCount === 1 && ' (1個)'}
            </span>
          )}
          {state.phase === 'main' && state.chanceDeckCount > 0 && (
            <span style={{ fontSize: 14, color: '#fff' }}><Emoji name="card" size={15} />{state.chanceDeckCount}</span>
          )}
          <button onClick={onLeave} style={{ marginLeft: 'auto', padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>
            退出
          </button>
        </div>

        <div className="player-and-log-row">
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
                    {pid === state.currentTurn && <span style={{ fontSize: 10 }}><Emoji name="target" size={12} /></span>}
                  </div>
                  <div>
                    <Emoji name="coin" size={12} />{p.coins} <span style={{ marginLeft: '0.8em' }}>{'★'.repeat(p.stars)}{'☆'.repeat(3 - p.stars)}</span> <Emoji name="poop" size={12} />{p.poopTokens}
                    {p.hasHeldCard && <span title="伏せカード保持中"> <Emoji name="card" size={12} /></span>}
                  </div>
                </div>
              );
            })}
          </div>

          {state.effectLog.length > 0 && (
            <div className="effect-log">
              <h4><Emoji name="memo" size={14} /> ログ</h4>
              {state.effectLog.map((log: string, i: number) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          )}
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
                {player.name}の動物園 (<Emoji name="coin" size={12} />{player.coins} <Emoji name="star" size={12} />{player.stars} <Emoji name="poop" size={12} />{player.poopTokens})
              </div>
              <CageGrid
                cages={player.cages ?? []}
                diceSum={state.diceRolled && !diceAnimResults ? state.diceSum : 0}
                isSetup={false}
                isMyTurn={false}
                setupInventory=""
                send={send}
              />
            </div>
          );
        })}

      </div>

      {/* ===== 中央右: マーケット ===== */}
      <div className={`market-area ${marketBlink ? 'blink-trade' : ''}`} data-tutorial="market-area">
        <div className="market-title"><Emoji name="store" size={16} /> 動物マーケット <span className="market-header-coins">所持金：<Emoji name="coin" size={14} />{me?.coins ?? 0}</span></div>
        <MarketPanel />
      </div>

      {/* ===== 右端: チャット/ゲームログ ===== */}
      <ChatPanel />

      {/* ===== 下部固定: 自分の盤面 + 操作 ===== */}
      <div className="my-board-area" style={(() => {
        const mc = me?.color ? PLAYER_COLORS[me.color] : null;
        return mc ? { background: mc.light, borderTopColor: mc.bg } : {};
      })()}>
        <div className="progress-stats-bar" data-tutorial="progress-bar">
          {me && (
            <div className="my-stats">
              <span><Emoji name="coin" size={14} /> {me.coins}コイン</span>
              <span style={{ marginLeft: '1em' }}>{'★'.repeat(me.stars)}{'☆'.repeat(3 - me.stars)}</span>
              <span><Emoji name="poop" size={14} /> {me.poopTokens}個{me.poopTokens >= 7 ? ' ⚠バースト!' : ''}</span>
            </div>
          )}
          {!isSetup && !isEnded && (
            <div className="progress-steps-wrapper">
              <div className="progress-steps">
                {TURN_STEPS.map((step, i) => {
                  const stepIdx = TURN_STEPS.findIndex(s => s.key === state.turnStep);
                  const isActive = step.key === state.turnStep;
                  return (
                    <span key={step.key}>
                      {i > 0 && <span className={`progress-line ${i <= stepIdx ? 'active' : ''}`} />}
                      <span className={`progress-step ${isActive ? 'active' : ''}`}>
                        <StepIcon emoji={step.emoji} size={14} /> {step.label}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <CageGrid
          cages={me?.cages ?? []}
          diceSum={state.diceRolled && !diceAnimResults ? state.diceSum : 0}
          isSetup={isSetup}
          isMyTurn={isMyTurn}
          setupInventory={state.setupInventory[sessionId] ?? ''}
          send={send}
          tutorialId="my-cage-grid"
        />

        {!isSetup && isMyTurn && !isEnded && (
          <ActionPanel />
        )}

        {/* 他プレイヤーのターンでも自分宛の効果解決UIを表示 */}
        {!isMyTurn && state.turnStep === 'income' && state.pendingEffects.length > 0 &&
          state.pendingEffects[0].ownerPlayerId === sessionId && (
          <div className="action-panel">
            <PendingEffectUI />
          </div>
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
          <h3><Emoji name="scroll" size={16} /> 履歴操作</h3>
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
              <Emoji name="refresh" size={12} /> Reset
            </button>
          </div>
          <PoopOverridePanel overrides={animalOverrides} setOverrides={setAnimalOverrides} />
        </div>
      )}

      {isEnded && <GameResultModal onLeave={onLeave} />}
      <BurstAnimation />
      {diceAnimResults && (
        <Suspense fallback={null}>
          <DiceAnimation
            diceResults={diceAnimResults}
            onComplete={() => setDiceAnimResults(null)}
          />
        </Suspense>
      )}
      {showTutorial && (
        <TutorialGuide
          currentPhase={state.phase}
          turnStep={state.turnStep}
          isMyTurn={isMyTurn}
          isMobile={isMobile}
          onDone={() => setShowTutorial(false)}
        />
      )}
    </div>
    </PoopOverrideContext.Provider>
  );
}

// ===== ケージグリッド =====
function CageGrid({
  cages, diceSum, isSetup, isMyTurn, setupInventory, send, tutorialId,
}: {
  cages: CageState[];
  diceSum: number;
  isSetup: boolean;
  isMyTurn: boolean;
  setupInventory: string;
  send: (type: string, data?: any) => void;
  tutorialId?: string;
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
    <div className="cage-grid-2row" {...(tutorialId ? { 'data-tutorial': tutorialId } : {})}>
      <div className="cage-row top-row">
        {TOP_ROW.map(n => renderCage(n))}
      </div>
      <div className="cage-row bottom-row">
        {BOTTOM_ROW.map(n => renderCage(n, n === 11))}
      </div>
    </div>
  );
}

// ===== ミニケージグリッド（モバイル他プレイヤー用） =====
function MiniCageGrid({ cages, diceSum }: { cages: CageState[]; diceSum: number }) {
  const renderMiniCage = (cageNum: number, isMerged = false) => {
    const cage = cages.find(c => c.num === cageNum);
    if (!cage) return null;
    const isRolled = diceSum === cageNum || (isMerged && (diceSum === 11 || diceSum === 12));
    const cageStyle = getCageStyle(cage);
    return (
      <div key={cageNum}
        className={`mini-cage ${isRolled ? 'rolled' : ''} ${isMerged ? 'mini-cage-merged' : ''}`}
        style={cageStyle}>
        {cage.slots.map((slot, si) => (
          <AnimalIcon key={si} id={slot.animalId} size={16} />
        ))}
      </div>
    );
  };
  return (
    <div className="mini-cage-grid">
      <div className="mini-cage-row mini-top">{TOP_ROW.map(n => renderMiniCage(n))}</div>
      <div className="mini-cage-row mini-bottom">{BOTTOM_ROW.map(n => renderMiniCage(n, n === 11))}</div>
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
        <button className="action-btn" data-tutorial="btn-poop" onClick={() => send('receivePoop')}>
          <Emoji name="poop" size={14} /> うんちを受け取る
        </button>
      )}

      {state.turnStep === 'roll' && (
        <span data-tutorial="btn-roll" style={{ display: 'flex', gap: 6 }}>
          <button className="action-btn" onClick={() => send('rollDice', { diceCount: 1 })}>
            <Emoji name="dice" size={14} /> 1個振り (1-6)
          </button>
          <button className="action-btn" onClick={() => send('rollDice', { diceCount: 2 })}>
            <Emoji name="dice" size={14} /><Emoji name="dice" size={14} /> 2個振り (2-12)
          </button>
        </span>
      )}

      {/* 手番プレイヤー自身の保留効果解決UI */}
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
          {CHANCE_CARD_DATA[state.activeChanceCard] && <Emoji name={CHANCE_CARD_DATA[state.activeChanceCard].emojiKey} size={20} />}
          {' '}{CHANCE_CARD_DATA[state.activeChanceCard]?.name}
        </div>
      )}

      {state.turnStep === 'trade' && !state.chanceCardPhase && (
        <span data-tutorial="btn-trade" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
          <TradeActions />
        </span>
      )}

      {state.turnStep === 'clean' && (
        <span data-tutorial="btn-clean" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: '#555', fontSize: 12, alignSelf: 'center' }}>
            <Emoji name="poop" size={12} /> {me.poopTokens}個 {me.poopTokens >= 7 && '⚠ 7個以上でバースト!'}
          </span>
          {me.poopTokens > 0 && me.coins >= 1 && (
            <button className="action-btn" onClick={() => send('cleanPoop')}>
              <Emoji name="broom" size={14} /> 掃除 (1<Emoji name="coin" size={12} />→2個除去)
            </button>
          )}
          <div style={{ minWidth: 40 }} />
          <button className="action-btn secondary" onClick={() => send('endClean')}>
            <Emoji name="check" size={14} /> 掃除終了
          </button>
        </span>
      )}

      {/* flushステップは自動でターン終了するため、UIは不要 */}
    </div>
  );
}

// ===== 取引アクション =====
function TradeActions() {
  const { state, sessionId, send } = useContext(ColyseusContext);
  const [returning, setReturning] = useState(false);
  const isMobile = useIsMobile();

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
      {!state.boughtStar && me.coins >= STAR_COST && (
        <button className="action-btn trade" onClick={() => send('buyStar')}>
          <Emoji name="star" size={14} /> 星を買う ({STAR_COST}<Emoji name="coin" size={12} />)
        </button>
      )}
      {state.boughtStar && <span className="trade-done">✓ 星購入済み</span>}

      {me.hasHeldCard && (
        <button className="action-btn trade" onClick={() => send('useHeldCardInTrade')}>
          <Emoji name="card" size={14} /> 伏せカードを使う
        </button>
      )}

      <button className="action-btn secondary" onClick={() => setReturning(true)}>
        <Emoji name="refresh" size={14} /> 動物を返す
      </button>
      <div style={{ minWidth: 50 }} />
      <button className="action-btn" onClick={() => send('endTrade')}>
        <Emoji name="skip" size={14} /> お買い物終了
      </button>

      {!state.boughtAnimal && (
        <span className="trade-guide">
          {isMobile
            ? <><Emoji name="store" size={16} /> ショップボタンから動物をクリックで購入</>
            : <><Emoji name="cart" size={16} /> 右のマーケットから動物をクリックで購入<span className="blink-pointer">👉</span></>
          }
        </span>
      )}
      {state.boughtAnimal && <span className="trade-done">✓ 動物購入済み</span>}
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
            {getPlayerName(pid)} (<Emoji name="coin" size={12} />{state.players[pid].coins})
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
            {getPlayerName(pid)} (<Emoji name="star" size={12} />{state.players[pid].stars})
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
          <Emoji name="coin" size={14} /> {effect.creationAmount}コイン獲得
        </button>
        <div style={{ marginTop: 4 }}>
          <span style={{ color: '#555', fontSize: 11 }}><Emoji name="sword" size={12} /> {effect.stealAmount}コイン奪取: </span>
          {otherPlayers.map(pid => (
            <button key={pid} className="trade-option" onClick={() => send('resolveChoice', { choice: 'steal', targetPlayerId: pid })}>
              {getPlayerName(pid)} (<Emoji name="coin" size={12} />{state.players[pid].coins})
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
      <div className="chat-header"><Emoji name="chat" size={14} /> ログ / チャット</div>
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
