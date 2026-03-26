import { useState, useEffect, createContext } from 'react';
import { useColyseus } from './hooks/useColyseus';
import type { ZooRoomState, HistoryInfo, RoomListing } from './hooks/useColyseus';
import { Board } from './components/Board';

// プレイヤーカラー定義（ロビー＆ゲーム中共通）
export const PLAYER_COLORS: Record<string, { bg: string; light: string; label: string }> = {
  red:    { bg: '#e53935', light: '#ffcdd2', label: '赤' },
  blue:   { bg: '#1e88e5', light: '#bbdefb', label: '青' },
  green:  { bg: '#43a047', light: '#c8e6c9', label: '緑' },
  orange: { bg: '#fb8c00', light: '#ffe0b2', label: 'オレンジ' },
  purple: { bg: '#8e24aa', light: '#e1bee7', label: '紫' },
  pink:   { bg: '#d81b60', light: '#f8bbd0', label: 'ピンク' },
};

// Context
interface ColyseusContextValue {
  state: ZooRoomState | null;
  sessionId: string;
  historyInfo: HistoryInfo;
  myDrawnCardId: string;
  myHeldCardId: string;
  send: (type: string, data?: any) => void;
}

export const ColyseusContext = createContext<ColyseusContextValue>({
  state: null,
  sessionId: '',
  historyInfo: { undoCount: 0, redoCount: 0 },
  myDrawnCardId: '',
  myHeldCardId: '',
  send: () => {},
});

export function App() {
  const {
    state, sessionId, error, historyInfo, rooms,
    myDrawnCardId, myHeldCardId, isReconnecting,
    fetchRooms, createRoom, joinRoomById, send, leave, tryReconnect,
  } = useColyseus();

  const [name, setName] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // パスワード入力ダイアログ用
  const [passwordTarget, setPasswordTarget] = useState<RoomListing | null>(null);
  const [joinPassword, setJoinPassword] = useState('');

  // 起動時に前回のセッションへ自動再接続を試行
  useEffect(() => {
    if (isReconnecting) {
      tryReconnect();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ルーム一覧の自動更新
  useEffect(() => {
    if (!state && !isReconnecting) {
      fetchRooms();
      const interval = setInterval(fetchRooms, 3000);
      return () => clearInterval(interval);
    }
  }, [state, isReconnecting, fetchRooms]);

  // ===== 再接続中 =====
  if (isReconnecting) {
    return (
      <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔄</div>
          <h2 style={{ margin: '0 0 8px' }}>再接続中...</h2>
          <p style={{ color: '#aaa', margin: 0 }}>前回のセッションに復帰しています</p>
        </div>
      </div>
    );
  }

  // ===== メインロビー画面（ルーム未参加）=====
  if (!state) {
    const filteredRooms = rooms.filter((r) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.metadata?.roomName?.toLowerCase().includes(q) ||
        r.roomId.toLowerCase().includes(q)
      );
    });

    return (
      <div style={S.page}>
        {/* ヘッダー */}
        <div style={S.header}>
          <div style={S.headerInner}>
            <div style={S.titleGroup}>
              <span style={S.stars}>★★★</span>
              <h1 style={S.title}>三ツ星動物園</h1>
              <span style={S.subtitle}>Three Star Zoo - Online</span>
            </div>
            <div style={S.animals}>🐼 🦁 🐧 🦒 🐘</div>
          </div>
        </div>

        <div style={S.body}>
          {error && <div style={S.error}>{error}</div>}

          {/* プレイヤー名 + ルーム作成 */}
          <div style={S.card}>
            <div style={S.cardHeader}>プレイヤー設定</div>
            <div style={S.cardBody}>
              <div style={S.field}>
                <label style={S.label}>名前</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="名前を入力..."
                  style={S.textInput}
                />
              </div>

              <div style={{ borderTop: '1px solid #e0e0e0', margin: '12px 0' }} />

              <button
                onClick={() => setShowCreateForm(!showCreateForm)}
                style={S.toggleBtn}
              >
                {showCreateForm ? '▲ 閉じる' : '＋ ルームを作成'}
              </button>

              {showCreateForm && (
                <div style={S.createArea}>
                  <div style={S.field}>
                    <label style={S.label}>ルーム名</label>
                    <input
                      value={newRoomName}
                      onChange={(e) => setNewRoomName(e.target.value)}
                      placeholder="部屋の名前..."
                      style={S.textInput}
                    />
                  </div>
                  <label style={S.checkRow}>
                    <input
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                    />
                    <span>🔒 プライベートルーム</span>
                  </label>
                  {isPrivate && (
                    <input
                      type="password"
                      value={newRoomPassword}
                      onChange={(e) => setNewRoomPassword(e.target.value)}
                      placeholder="パスワード"
                      style={S.textInput}
                    />
                  )}
                  <button
                    onClick={() => {
                      const pName = name || 'ゲスト';
                      const rName = newRoomName || `${pName}の部屋`;
                      createRoom(pName, rName, isPrivate ? newRoomPassword : undefined);
                    }}
                    style={S.goldBtn}
                    disabled={isPrivate && !newRoomPassword}
                  >
                    🎲 作成して入室
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ルーム一覧 */}
          <div style={S.card}>
            <div style={S.cardHeader}>
              <span>ルーム一覧</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="検索..."
                  style={{ ...S.textInput, width: 160, padding: '4px 8px', fontSize: 12 }}
                />
                <button onClick={fetchRooms} style={S.refreshBtn}>↻</button>
              </div>
            </div>
            <div style={S.cardBody}>
              {filteredRooms.length === 0 ? (
                <p style={S.empty}>
                  {rooms.length === 0
                    ? '🏠 ルームがありません。新しいルームを作成しましょう！'
                    : '検索結果がありません。'}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {filteredRooms.map((r) => (
                    <div key={r.roomId} style={S.roomRow}>
                      <div>
                        <div style={S.roomName}>
                          {r.metadata?.isPrivate ? '🔒 ' : '🏠 '}
                          {r.metadata?.roomName || r.roomId}
                        </div>
                        <div style={S.roomMeta}>
                          👥 {r.metadata?.playerCount ?? r.clients}人
                          {r.locked ? ' ・ 🎮 ゲーム中' : ' ・ ⏳ 待機中'}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (r.locked) return;
                          if (r.metadata?.isPrivate) {
                            setPasswordTarget(r);
                            setJoinPassword('');
                          } else {
                            joinRoomById(r.roomId, name || 'ゲスト');
                          }
                        }}
                        style={r.locked ? S.disabledBtn : S.joinBtn}
                        disabled={r.locked}
                      >
                        {r.locked ? '入室不可' : '入室 →'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* パスワード入力ダイアログ */}
        {passwordTarget && (
          <div style={S.overlay}>
            <div style={S.dialog}>
              <h3 style={{ margin: '0 0 8px' }}>🔒 パスワードを入力</h3>
              <p style={{ margin: '0 0 12px', color: '#666' }}>
                {passwordTarget.metadata?.roomName || passwordTarget.roomId}
              </p>
              <input
                type="password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                placeholder="パスワード"
                style={S.textInput}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && joinPassword) {
                    joinRoomById(passwordTarget.roomId, name || 'ゲスト', joinPassword);
                    setPasswordTarget(null);
                  }
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <button onClick={() => setPasswordTarget(null)} style={S.cancelBtn}>キャンセル</button>
                <button
                  onClick={() => {
                    joinRoomById(passwordTarget.roomId, name || 'ゲスト', joinPassword);
                    setPasswordTarget(null);
                  }}
                  style={S.goldBtn}
                  disabled={!joinPassword}
                >
                  入室
                </button>
              </div>
            </div>
          </div>
        )}

        {/* フッター */}
        <div style={S.footer}>
          <span>🐾 Three Star Zoo Online &copy; 2026</span>
        </div>
      </div>
    );
  }

  // ===== ゲーム画面（setup / main / ended のみ）=====
  if (state.phase === 'setup' || state.phase === 'main' || state.phase === 'ended') {
    return (
      <ColyseusContext.Provider value={{ state, sessionId, historyInfo, myDrawnCardId, myHeldCardId, send }}>
        <Board onLeave={leave} />
      </ColyseusContext.Provider>
    );
  }

  // ===== ルーム内ロビー画面（lobby、またはそれ以外の未知のフェーズ）=====
  const players = Object.values(state.players);
  const isHost = sessionId === state.hostId;
  const canStart = players.length >= 2;

  return (
    <div style={styles.container}>
      <h2>🏠 {state.roomName || '三ツ星動物園'}</h2>
      {state.isPrivate && <span style={styles.privateBadge}>🔒 プライベート</span>}

      <div style={styles.lobbyPlayers}>
        <h3>参加者 ({players.length}人)</h3>
        <ul style={styles.playerList}>
          {players.map((p) => (
            <li key={p.id} style={{
              ...styles.playerItem,
              borderLeft: p.color ? `4px solid ${PLAYER_COLORS[p.color]?.bg || '#ccc'}` : '4px solid transparent',
            }}>
              <div>
                <span style={{
                  display: 'inline-block',
                  width: 12, height: 12, borderRadius: '50%',
                  background: p.color ? PLAYER_COLORS[p.color]?.bg : '#ddd',
                  marginRight: 6, verticalAlign: 'middle',
                }} />
                <span>
                  {p.name}
                  {p.id === sessionId && ' (あなた)'}
                  {p.id === state.hostId && ' ⭐ホスト'}
                </span>
              </div>
              {p.connected
                ? <span style={{ color: '#4caf50' }}>●</span>
                : <span style={{ color: '#f44336' }}>○ 切断中</span>
              }
            </li>
          ))}
        </ul>

        {/* カラー選択（自分用） */}
        <div style={{ marginTop: 8 }}>
          <span style={{ fontSize: 13, color: '#666' }}>あなたの色: </span>
          {Object.entries(PLAYER_COLORS).map(([key, c]) => {
            const taken = players.some(p => p.id !== sessionId && p.color === key);
            const isSelected = state.players[sessionId]?.color === key;
            return (
              <button
                key={key}
                onClick={() => !taken && send('setColor', { color: key })}
                disabled={taken}
                title={taken ? '使用中' : c.label}
                style={{
                  width: 28, height: 28, borderRadius: '50%', margin: '0 3px',
                  background: c.bg,
                  border: isSelected ? '3px solid #333' : '2px solid #ccc',
                  cursor: taken ? 'not-allowed' : 'pointer',
                  opacity: taken ? 0.3 : 1,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* ログ */}
      {state.gameLog && state.gameLog.length > 0 && (
        <div style={styles.lobbyLog}>
          {state.gameLog.slice(-5).map((log, i) => (
            <div key={i} style={{ fontSize: 12, color: '#888' }}>{log}</div>
          ))}
        </div>
      )}

      <div style={styles.lobbyActions}>
        {isHost ? (
          <>
            <button
              onClick={() => send('startGame')}
              style={canStart ? styles.startBtn : styles.disabledStartBtn}
              disabled={!canStart}
            >
              {canStart
                ? `ゲーム開始 (${players.length}人で対戦)`
                : 'ゲーム開始（2人以上必要）'}
            </button>
            {!canStart && (
              <p style={{ color: '#ff9800', fontSize: 13, margin: '4px 0' }}>
                他のプレイヤーの参加を待っています...
              </p>
            )}
          </>
        ) : (
          <p style={{ color: '#888' }}>
            ホスト ({state.players[state.hostId]?.name}) のゲーム開始を待っています...
          </p>
        )}
        <button onClick={leave} style={styles.leaveBtn}>退出</button>
      </div>
    </div>
  );
}

// ===== トップページ用スタイル（ボードゲーム風） =====
const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #b2dfdb 0%, #e0f2f1 40%, #fff8e1 100%)',
    fontFamily: "'Zen Kaku Gothic New', 'Segoe UI', 'Hiragino Sans', sans-serif",
  },
  header: {
    background: 'linear-gradient(90deg, #00695c, #00897b)',
    padding: '20px 0',
    textAlign: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  },
  headerInner: {
    maxWidth: 700,
    margin: '0 auto',
    padding: '0 16px',
  },
  titleGroup: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  stars: {
    color: '#fdd835',
    fontSize: 22,
    letterSpacing: 4,
    textShadow: '0 2px 4px rgba(0,0,0,0.3)',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    margin: 0,
    textShadow: '0 2px 8px rgba(0,0,0,0.25)',
    letterSpacing: 3,
  },
  subtitle: {
    color: '#b2dfdb',
    fontSize: 12,
    letterSpacing: 2,
  },
  animals: {
    marginTop: 8,
    fontSize: 24,
    letterSpacing: 8,
    filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.2))',
  },
  body: {
    maxWidth: 600,
    margin: '0 auto',
    padding: '20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  error: {
    color: '#fff',
    background: '#c62828',
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 14,
    boxShadow: '0 2px 8px rgba(198,40,40,0.3)',
  },
  card: {
    background: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    border: '1px solid #e0e0e0',
  },
  cardHeader: {
    background: '#f5f5f5',
    padding: '10px 16px',
    fontWeight: 'bold',
    fontSize: 14,
    color: '#333',
    borderBottom: '1px solid #e0e0e0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardBody: {
    padding: 16,
  },
  field: {
    marginBottom: 10,
  },
  label: {
    display: 'block',
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
    fontWeight: 600,
  },
  textInput: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 6,
    border: '1.5px solid #ccc',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  },
  toggleBtn: {
    width: '100%',
    padding: '8px',
    background: 'transparent',
    border: '1.5px dashed #80cbc4',
    borderRadius: 8,
    color: '#00796b',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  createArea: {
    marginTop: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    cursor: 'pointer',
  },
  goldBtn: {
    padding: '10px 20px',
    background: 'linear-gradient(135deg, #f9a825, #fdd835)',
    color: '#5d4037',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 'bold',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(249,168,37,0.3)',
    transition: 'transform 0.1s',
  },
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: '1px solid #ccc',
    background: '#fff',
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    textAlign: 'center',
    color: '#999',
    padding: '20px 0',
    fontSize: 14,
  },
  roomRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    background: '#fafafa',
    borderRadius: 8,
    border: '1px solid #e8e8e8',
    transition: 'background 0.15s',
  },
  roomName: {
    fontWeight: 600,
    fontSize: 14,
    color: '#333',
  },
  roomMeta: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  joinBtn: {
    padding: '6px 16px',
    background: '#00897b',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  disabledBtn: {
    padding: '6px 16px',
    background: '#e0e0e0',
    color: '#999',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'not-allowed',
  },
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: '#fff',
    padding: 24,
    borderRadius: 12,
    minWidth: 320,
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  },
  cancelBtn: {
    padding: '8px 16px',
    background: '#fff',
    border: '1px solid #ccc',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
  },
  footer: {
    textAlign: 'center',
    padding: '16px 0',
    color: '#80cbc4',
    fontSize: 12,
  },
};

// ===== ロビー/その他のスタイル =====
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    fontFamily: "'Zen Kaku Gothic New', 'Segoe UI', 'Hiragino Sans', sans-serif",
    maxWidth: 700,
    margin: '0 auto',
  },
  title: {
    fontSize: 28,
    marginBottom: 8,
  },
  error: {
    color: '#fff',
    background: '#d32f2f',
    padding: '8px 12px',
    borderRadius: 6,
    marginBottom: 12,
  },
  nameRow: {
    marginBottom: 16,
  },
  input: {
    marginLeft: 8,
    padding: '6px 10px',
    borderRadius: 4,
    border: '1px solid #ccc',
    fontSize: 14,
  },
  section: {
    marginBottom: 20,
  },
  createToggle: {
    padding: '8px 16px',
    fontSize: 14,
    cursor: 'pointer',
    background: '#e3f2fd',
    border: '1px solid #90caf9',
    borderRadius: 6,
    marginBottom: 8,
  },
  createForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 12,
    background: '#f5f5f5',
    borderRadius: 6,
    border: '1px solid #ddd',
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 14,
  },
  primaryBtn: {
    padding: '8px 20px',
    fontSize: 14,
    cursor: 'pointer',
    background: '#1976d2',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  refreshBtn: {
    padding: '4px 12px',
    fontSize: 13,
    cursor: 'pointer',
    background: '#fff',
    border: '1px solid #ccc',
    borderRadius: 4,
  },
  empty: {
    color: '#999',
    fontStyle: 'italic',
  },
  roomList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  roomCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    background: '#fafafa',
    border: '1px solid #e0e0e0',
    borderRadius: 6,
  },
  roomInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  roomName: {
    fontWeight: 600,
    fontSize: 15,
  },
  roomMeta: {
    fontSize: 12,
    color: '#888',
  },
  joinBtn: {
    padding: '6px 16px',
    fontSize: 13,
    cursor: 'pointer',
    background: '#4caf50',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
  },
  disabledBtn: {
    padding: '6px 16px',
    fontSize: 13,
    background: '#e0e0e0',
    color: '#999',
    border: 'none',
    borderRadius: 4,
    cursor: 'not-allowed',
  },
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: '#fff',
    padding: 24,
    borderRadius: 8,
    minWidth: 320,
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
  },
  dialogBtns: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    padding: '6px 16px',
    cursor: 'pointer',
    background: '#fff',
    border: '1px solid #ccc',
    borderRadius: 4,
  },
  hint: {
    marginTop: 16,
    color: '#999',
    fontSize: 12,
  },
  privateBadge: {
    fontSize: 13,
    color: '#ff9800',
    marginBottom: 8,
    display: 'inline-block',
  },
  lobbyPlayers: {
    marginBottom: 16,
  },
  playerList: {
    listStyle: 'none',
    padding: 0,
  },
  playerItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0',
    borderBottom: '1px solid #eee',
    fontSize: 15,
  },
  lobbyLog: {
    padding: 8,
    background: '#f9f9f9',
    borderRadius: 4,
    marginBottom: 12,
  },
  lobbyActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: 'flex-start',
  },
  startBtn: {
    padding: '12px 32px',
    fontSize: 16,
    cursor: 'pointer',
    background: 'linear-gradient(135deg, #f9a825, #fdd835)',
    color: '#5d4037',
    border: 'none',
    borderRadius: 8,
    fontWeight: 'bold',
    boxShadow: '0 2px 8px rgba(249,168,37,0.3)',
  },
  disabledStartBtn: {
    padding: '12px 32px',
    fontSize: 16,
    background: '#e0e0e0',
    color: '#999',
    border: 'none',
    borderRadius: 6,
    fontWeight: 'bold',
    cursor: 'not-allowed',
  },
  leaveBtn: {
    padding: '6px 16px',
    fontSize: 13,
    cursor: 'pointer',
    background: '#fff',
    border: '1px solid #f44336',
    color: '#f44336',
    borderRadius: 4,
  },
};
