import { useState, createContext } from 'react';
import { useColyseus } from './hooks/useColyseus';
import type { ZooRoomState, HistoryInfo } from './hooks/useColyseus';
import { Board } from './components/Board';

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
  const { state, sessionId, error, historyInfo, joinRoom, send, leave } = useColyseus();
  const [name, setName] = useState('');
  const [numPlayers, setNumPlayers] = useState(2);

  // ロビー画面
  if (!state) {
    return (
      <div style={{ padding: 24, fontFamily: 'monospace', maxWidth: 500 }}>
        <h1>三ツ星動物園 (Colyseus)</h1>

        {error && (
          <div style={{ color: 'red', marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label>
            プレイヤー名:
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="名前を入力"
              style={{ marginLeft: 8, padding: 4 }}
            />
          </label>
          <label>
            人数:
            <select
              value={numPlayers}
              onChange={(e) => setNumPlayers(Number(e.target.value))}
              style={{ marginLeft: 8 }}
            >
              <option value={2}>2人</option>
              <option value={3}>3人</option>
              <option value={4}>4人</option>
            </select>
          </label>
          <button
            onClick={() => joinRoom(name || 'ゲスト', numPlayers)}
            style={{ padding: '8px 16px', fontSize: 16, cursor: 'pointer' }}
          >
            ルームに参加
          </button>
        </div>

        <p style={{ marginTop: 16, color: '#666', fontSize: 12 }}>
          サーバー (colyseus-prototype/server) を起動してから接続してください。<br />
          別のブラウザタブで同じページを開くと2P目として参加できます。
        </p>
      </div>
    );
  }

  // 待機画面
  if (state.phase === 'waiting') {
    return (
      <div style={{ padding: 24, fontFamily: 'monospace' }}>
        <h2>待機中...</h2>
        <p>プレイヤーの参加を待っています ({Object.keys(state.players).length} 人参加中)</p>
        <ul>
          {Object.values(state.players).map((p) => (
            <li key={p.id}>
              {p.name} {p.id === sessionId && '(あなた)'}
            </li>
          ))}
        </ul>
        <button onClick={leave} style={{ padding: '4px 12px', cursor: 'pointer' }}>
          退出
        </button>
      </div>
    );
  }

  // ゲーム画面
  return (
    <ColyseusContext.Provider value={{ state, sessionId, historyInfo, send }}>
      <Board onLeave={leave} />
    </ColyseusContext.Provider>
  );
}
