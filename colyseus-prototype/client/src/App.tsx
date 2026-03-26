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
  send: (type: string, data?: any) => void;
}

export const ColyseusContext = createContext<ColyseusContextValue>({
  state: null,
  sessionId: '',
  historyInfo: { undoCount: 0, redoCount: 0 },
  send: () => {},
});

export function App() {
  const {
    state, sessionId, error, historyInfo, rooms,
    fetchRooms, createRoom, joinRoomById, send, leave,
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

  // ルーム一覧の自動更新
  useEffect(() => {
    if (!state) {
      fetchRooms();
      const interval = setInterval(fetchRooms, 3000);
      return () => clearInterval(interval);
    }
  }, [state, fetchRooms]);

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
      <div style={styles.container}>
        <h1 style={styles.title}>🦁 三ツ星動物園</h1>

        {error && <div style={styles.error}>{error}</div>}

        {/* プレイヤー名入力 */}
        <div style={styles.nameRow}>
          <label>
            プレイヤー名:
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="名前を入力"
              style={styles.input}
            />
          </label>
        </div>

        {/* ルーム作成トグル */}
        <div style={styles.section}>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            style={styles.createToggle}
          >
            {showCreateForm ? '▼ ルーム作成を閉じる' : '＋ ルームを作成'}
          </button>

          {showCreateForm && (
            <div style={styles.createForm}>
              <input
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="ルーム名"
                style={styles.input}
              />
              <label style={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                プライベートルーム
              </label>
              {isPrivate && (
                <input
                  type="password"
                  value={newRoomPassword}
                  onChange={(e) => setNewRoomPassword(e.target.value)}
                  placeholder="パスワード"
                  style={styles.input}
                />
              )}
              <button
                onClick={() => {
                  const pName = name || 'ゲスト';
                  const rName = newRoomName || `${pName}の部屋`;
                  createRoom(pName, rName, isPrivate ? newRoomPassword : undefined);
                }}
                style={styles.primaryBtn}
                disabled={isPrivate && !newRoomPassword}
              >
                作成して入室
              </button>
            </div>
          )}
        </div>

        {/* ルーム一覧 */}
        <div style={styles.section}>
          <div style={styles.listHeader}>
            <h2 style={{ margin: 0 }}>ルーム一覧</h2>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ルーム名で検索..."
              style={{ ...styles.input, width: 200 }}
            />
            <button onClick={fetchRooms} style={styles.refreshBtn}>更新</button>
          </div>

          {filteredRooms.length === 0 ? (
            <p style={styles.empty}>
              {rooms.length === 0
                ? 'ルームがありません。新しいルームを作成してください。'
                : '検索結果がありません。'}
            </p>
          ) : (
            <div style={styles.roomList}>
              {filteredRooms.map((r) => (
                <div key={r.roomId} style={styles.roomCard}>
                  <div style={styles.roomInfo}>
                    <span style={styles.roomName}>
                      {r.metadata?.isPrivate ? '🔒 ' : ''}
                      {r.metadata?.roomName || r.roomId}
                    </span>
                    <span style={styles.roomMeta}>
                      {r.metadata?.playerCount ?? r.clients}人
                      {r.locked ? ' | ゲーム中' : ' | 待機中'}
                    </span>
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
                    style={r.locked ? styles.disabledBtn : styles.joinBtn}
                    disabled={r.locked}
                  >
                    {r.locked ? '入室不可' : '入室'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* パスワード入力ダイアログ */}
        {passwordTarget && (
          <div style={styles.overlay}>
            <div style={styles.dialog}>
              <h3>🔒 パスワードを入力</h3>
              <p>{passwordTarget.metadata?.roomName || passwordTarget.roomId}</p>
              <input
                type="password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                placeholder="パスワード"
                style={styles.input}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && joinPassword) {
                    joinRoomById(passwordTarget.roomId, name || 'ゲスト', joinPassword);
                    setPasswordTarget(null);
                  }
                }}
              />
              <div style={styles.dialogBtns}>
                <button
                  onClick={() => setPasswordTarget(null)}
                  style={styles.cancelBtn}
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    joinRoomById(passwordTarget.roomId, name || 'ゲスト', joinPassword);
                    setPasswordTarget(null);
                  }}
                  style={styles.primaryBtn}
                  disabled={!joinPassword}
                >
                  入室
                </button>
              </div>
            </div>
          </div>
        )}

        <p style={styles.hint}>
          サーバー (colyseus-prototype/server) を起動してから接続してください。
        </p>
      </div>
    );
  }

  // ===== ゲーム画面（setup / main / ended のみ）=====
  if (state.phase === 'setup' || state.phase === 'main' || state.phase === 'ended') {
    return (
      <ColyseusContext.Provider value={{ state, sessionId, historyInfo, send }}>
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

// ===== スタイル =====
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    fontFamily: "'Segoe UI', 'Hiragino Sans', sans-serif",
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
    background: '#ff9800',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontWeight: 'bold',
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
