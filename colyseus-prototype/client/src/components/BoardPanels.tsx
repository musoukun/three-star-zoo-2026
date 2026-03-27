import { useState, useEffect, useContext } from 'react';
import { ColyseusContext, PLAYER_COLORS } from '../App';
import { ANIMALS, ANIMAL_ICONS, ANIMAL_CARD_IMAGES, EFFECT_TEXT_FULL, COLOR_CLASS } from '../game/animals';
import { CHANCE_CARD_DATA } from '../game/chanceCards';
import type { CageState } from '../hooks/useColyseus';
import { AnimalIcon, checkPlacement } from './boardUtils';
import { Emoji, COLOR_EMOJI } from './Emoji';
import sameAnimalRuleImg from '../assets/same-animal-rule.png';

// ===== リザルト画面 =====
export function GameResultModal({ onLeave }: { onLeave: () => void }) {
  const { state, sessionId, send } = useContext(ColyseusContext);
  const [copied, setCopied] = useState(false);
  if (!state || state.phase !== 'ended') return null;

  const winner = state.players[state.winnerId];
  if (!winner) return null;

  const winnerColor = winner.color ? PLAYER_COLORS[winner.color] : null;

  const animals: { name: string; animalId: string; cageNum: number }[] = [];
  for (const cage of winner.cages) {
    for (const slot of cage.slots) {
      const a = ANIMALS[slot.animalId];
      if (a) animals.push({ name: a.name, animalId: slot.animalId, cageNum: cage.num });
    }
  }

  // シェア用テキスト生成
  const allPlayers = Object.values(state.players);
  const me = state.players[sessionId];
  const isWinner = sessionId === state.winnerId;

  const buildShareText = () => {
    const lines: string[] = [];
    lines.push(`🏆 三ツ星動物園 ゲーム結果`);
    lines.push('');
    if (isWinner) {
      lines.push(`🎉 勝利しました！`);
    } else {
      lines.push(`${winner.name} の勝利！`);
    }
    lines.push('');
    lines.push(`--- 結果 ---`);
    for (const p of allPlayers) {
      const mark = p.id === state.winnerId ? '👑' : '  ';
      lines.push(`${mark} ${p.name}: ⭐${p.stars} 💰${p.coins} 💩掃除${p.totalPoopCleaned}`);
    }
    lines.push('');
    lines.push(`#三ツ星動物園`);
    return lines.join('\n');
  };

  const shareText = buildShareText();

  const handleShareX = () => {
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // フォールバック
      const ta = document.createElement('textarea');
      ta.value = shareText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="result-overlay">
      <div className="result-modal" style={winnerColor ? { borderColor: winnerColor.bg } : {}}>
        <div className="result-header" style={winnerColor ? { background: winnerColor.bg } : {}}>
          <Emoji name="trophy" size={20} /> ゲーム終了
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
              <span className="result-stat-icon"><Emoji name="star" size={18} /></span>
              <span>星 {winner.stars}つ</span>
            </div>
            <div className="result-stat">
              <span className="result-stat-icon"><Emoji name="coin" size={18} /></span>
              <span>残りコイン {winner.coins}枚</span>
            </div>
            <div className="result-stat">
              <span className="result-stat-icon"><Emoji name="poop" size={18} /></span>
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

          <div className="result-section">
            <div className="result-section-title">全プレイヤー</div>
            {Object.values(state.players).map((p) => {
              const pc = p.color ? PLAYER_COLORS[p.color] : null;
              return (
                <div key={p.id} className="result-player-row" style={pc ? { borderLeft: `3px solid ${pc.bg}` } : {}}>
                  <span>{p.name} {p.id === state.winnerId && <Emoji name="trophy" size={14} />}</span>
                  <span><Emoji name="star" size={12} />{p.stars} <Emoji name="coin" size={12} />{p.coins} <Emoji name="poop" size={12} />掃除{p.totalPoopCleaned}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="result-actions">
          <button className="result-btn share-x" onClick={handleShareX}>
            𝕏 にシェア
          </button>
          <button className="result-btn share-copy" onClick={handleCopy}>
            {copied ? '✓ コピーしました' : 'テキストをコピー'}
          </button>
          <button className="result-btn restart" onClick={() => send('restartGame')}>
            <Emoji name="refresh" size={14} /> もう1試合
          </button>
          <button className="result-btn leave" onClick={onLeave}>
            <Emoji name="door" size={14} /> 退室する
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== バーストアニメーション =====
export function BurstAnimation() {
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
        <span className="burst-icon"><Emoji name="poop" size={28} /><Emoji name="explosion" size={28} /></span>
        <span className="burst-text">うんちバースト！</span>
        <span className="burst-name">{playerName}</span>
      </div>
    </div>
  );
}

// ===== ルール早見表 =====
export function RuleTooltip() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rule-tooltip-container">
      <div className="rule-tooltip-trigger" onClick={() => setOpen(!open)}><Emoji name="book" size={20} /></div>
      {open && <><div className="rule-tooltip-overlay" onClick={() => setOpen(false)} />
      <div className="rule-tooltip-content">
        <button className="rule-close-btn" onClick={() => setOpen(false)}>✕</button>
        <h4 style={{ margin: '0 0 6px' }}>ルール早見表</h4>
        <div className="rule-section">
          <strong>ターンの流れ</strong>
          <ol>
            <li><Emoji name="poop" size={14} /> うんちコマを受け取る</li>
            <li><Emoji name="dice" size={14} /> サイコロを振る（1個 or 2個）</li>
            <li><Emoji name="coin" size={14} /> 対応する檻の効果が発動</li>
            <li><Emoji name="cart" size={14} /> お買い物（動物1匹 + 星1つまで）</li>
            <li><Emoji name="broom" size={14} /> 掃除（1コインで2個除去）</li>
            <li><Emoji name="check" size={14} /> ターン終了</li>
          </ol>
        </div>
        <div className="rule-section">
          <strong>勝利条件</strong>
          <p><Emoji name="star" size={14} />星3つ + 💩6個以下でターン終了</p>
        </div>
        <div className="rule-section">
          <strong>バースト</strong>
          <p>ターン終了時に💩7個以上 →<br/>
          星あり: 星-1 / 星なし: 最高コスト動物を返却<br/>
          その後、全コイン＆全うんちを返却</p>
        </div>
        <div className="rule-section">
          <strong>配置ルール</strong>
          <p>1エリアに同じ動物を配置できない<br/>
          1エリアに異なる色の動物は置けない（色が1つでも一致すればOK）<br/>
          同じ動物の2匹目を配置するときは、上下左右に隣接するエリアに置く<br/>
          1檻に2匹まで配置できる</p>
          <img src={sameAnimalRuleImg} alt="同じ動物を置く時のルール" className="rule-image" />
        </div>
        <div className="rule-section">
          <strong>効果処理順</strong>
          <p>手番の左隣から時計回り→手番が最後</p>
        </div>
      </div></>}
    </div>
  );
}

// ===== マーケットパネル =====
export function MarketPanel() {
  const { state, sessionId, send } = useContext(ColyseusContext);
  if (!state) return null;

  const isMyTurn = state.currentTurn === sessionId;
  const isTrade = state.turnStep === 'trade' && isMyTurn && !state.boughtAnimal;
  const [buying, setBuying] = useState<string | null>(null);

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
            {cage.slots.length > 0 && ` (${cage.slots.map(s => ANIMALS[s.animalId]?.name).join(', ')})`}
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
            {cage.slots.length > 0 && ` (${cage.slots.map(s => ANIMALS[s.animalId]?.name).join(', ')})`}
            <span style={{ fontSize: 11, marginLeft: 8, color: '#e57373' }}>
              {(result as { reason: string }).reason}
            </span>
          </button>
        ))}
        {placeable.length === 0 && <p style={{ color: '#999', fontSize: 12 }}>配置可能なケージがありません</p>}
      </div>
    );
  }

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
            <div className={`market-card-header ${colorClass}`}>
              <span>{a.effect.global ? '範囲：全員' : '範囲：自分のみ'}</span>
            </div>
            <div className="market-card-body">
              <div className="market-card-icon">
                <span className="market-card-badge badge-coin"><Emoji name="coin" size={14} />{a.cost}</span>
                <span className="market-card-badge badge-poop"><Emoji name="poop" size={14} />{a.poops}</span>
                {ANIMAL_CARD_IMAGES[a.id]
                  ? <img src={ANIMAL_CARD_IMAGES[a.id]} alt={a.name} className="market-card-img" />
                  : ANIMAL_ICONS[a.id]}
              </div>
              <div className="market-card-name">{a.name}</div>
              <div className="market-card-effect">{EFFECT_TEXT_FULL[a.id]}</div>
            </div>
            <div className="market-card-footer">
              <span>残 {stock}枚</span>
              <span>{a.colors.map(c => {
                const key = COLOR_EMOJI[c];
                return key ? <Emoji key={c} name={key} size={16} /> : c;
              })}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== チャンスカード: 引いた直後の選択UI =====
export function ChanceCardDrawUI() {
  const { state, sessionId, send, myDrawnCardId, myHeldCardId } = useContext(ColyseusContext);
  if (!state) return null;

  const drawnCard = CHANCE_CARD_DATA[myDrawnCardId];
  const heldCard = myHeldCardId ? CHANCE_CARD_DATA[myHeldCardId] : null;
  const isForceUse = state.chanceCardPhase === 'forceUse';

  return (
    <div className="trade-submenu">
      <p style={{ fontWeight: 'bold', marginBottom: 6 }}><Emoji name="card" size={16} /> チャンスカードを引いた!</p>
      {drawnCard && (
        <div style={{ padding: '6px 10px', background: '#fff8e1', borderRadius: 6, marginBottom: 8, border: '1px solid #ffd54f' }}>
          <Emoji name={drawnCard.emojiKey} size={18} />{' '}
          <strong>{drawnCard.name}</strong>
          <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{drawnCard.description}</div>
        </div>
      )}

      {isForceUse && heldCard && (
        <>
          <p style={{ fontSize: 11, color: '#888', margin: '4px 0' }}>伏せカード:</p>
          <div style={{ padding: '4px 10px', background: '#e8eaf6', borderRadius: 6, marginBottom: 8, border: '1px solid #9fa8da' }}>
            <Emoji name={heldCard.emojiKey} size={16} />{' '}
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
            <Emoji name="inbox" size={14} /> 伏せる
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
export function ChanceCardInteractionUI() {
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
        <p>{cardData && <Emoji name={cardData.emojiKey} size={16} />} {cardData?.name}: 💩を金に変換</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
          <button className="action-btn secondary" style={{ padding: '2px 8px' }}
            onClick={() => setCompostCount(Math.max(0, compostCount - 1))} disabled={compostCount <= 0}>−</button>
          <span style={{ fontWeight: 'bold', minWidth: 30, textAlign: 'center' }}>💩 {compostCount}個 → {compostCount}<Emoji name="coin" size={14} /></span>
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
        <p>{cardData && <Emoji name={cardData.emojiKey} size={16} />} {cardData?.name}: 💩を他プレイヤーに分配 (最大{maxGive}個)</p>
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
          <p>{cardData && <Emoji name={cardData.emojiKey} size={16} />} {cardData?.name}: 対象プレイヤーを選択</p>
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
        <p>{cardData && <Emoji name={cardData.emojiKey} size={16} />} {cardData?.name}: {getPlayerName(evictionTarget)}の動物を選択</p>
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
