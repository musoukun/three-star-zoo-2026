import { useState, useEffect, useCallback, useRef } from 'react';
import * as Colyseus from 'colyseus.js';

// 本番: wss://your-railway-app.up.railway.app  開発: ws://localhost:2567
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:2567';

// localStorage キー
const LS_KEY = 'zoo_room_session';

interface SavedSession {
  roomId: string;
  reconnectionToken: string;
  playerName: string;
  savedAt: number;
}

function saveSession(roomId: string, reconnectionToken: string, playerName: string) {
  const data: SavedSession = { roomId, reconnectionToken, playerName, savedAt: Date.now() };
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const data: SavedSession = JSON.parse(raw);
    // 15分以上前のセッションは無効
    if (Date.now() - data.savedAt > 15 * 60 * 1000) {
      localStorage.removeItem(LS_KEY);
      return null;
    }
    return data;
  } catch {
    localStorage.removeItem(LS_KEY);
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(LS_KEY);
}

// Colyseus Schema state をプレーンオブジェクトに変換するヘルパー
function schemaToPlain(state: any): any {
  if (!state) return state;
  if (typeof state.toJSON === 'function') return state.toJSON();
  return state;
}

export interface CageState {
  num: number;
  slots: Array<{ animalId: string; playerId: string }>;
}

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  coins: number;
  stars: number;
  connected: boolean;
  poopTokens: number;
  totalPoopCleaned: number;
  totalCoinsEarned: number;
  hasHeldCard: boolean;
  cages: CageState[];
}

export interface ZooRoomState {
  players: Record<string, PlayerInfo>;
  market: Record<string, number>;
  roomName: string;
  hostId: string;
  isPrivate: boolean;
  phase: string;          // lobby | setup | main | ended
  currentTurn: string;
  turnStep: string;       // poop | roll | income | trade | clean | flush
  dice1: number;
  dice2: number;
  diceSum: number;
  diceCount: number;      // 1 or 2
  diceRolled: boolean;
  boughtAnimal: boolean;
  boughtStar: boolean;
  pendingEffects: Array<{
    effectType: string;
    ownerPlayerId: string;
    animalId: string;
    stealAmount: number;
    creationAmount: number;
    starAmount: number;
    choices: string[];
  }>;
  effectLog: string[];
  turnOrder: string[];
  setupInventory: Record<string, string>;
  winnerId: string;
  burstPlayerId: string;
  chanceDeckCount: number;
  chanceDiscardCount: number;
  chanceCardPhase: string;
  activeChanceCard: string;
  gameLog: string[];
}

export interface HistoryInfo {
  undoCount: number;
  redoCount: number;
}

export interface RoomListing {
  roomId: string;
  metadata: {
    roomName: string;
    isPrivate: boolean;
    playerCount: number;
    phase: string;
  };
  clients: number;
  maxClients: number;
  locked: boolean;
}

export function useColyseus() {
  const clientRef = useRef<Colyseus.Client | null>(null);
  const roomRef = useRef<Colyseus.Room | null>(null);
  const tryReconnectRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));
  const [room, setRoom] = useState<Colyseus.Room | null>(null);
  const [state, setState] = useState<ZooRoomState | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [historyInfo, setHistoryInfo] = useState<HistoryInfo>({ undoCount: 0, redoCount: 0 });
  const [rooms, setRooms] = useState<RoomListing[]>([]);
  const [myDrawnCardId, setMyDrawnCardId] = useState<string>('');
  const [myHeldCardId, setMyHeldCardId] = useState<string>('');
  const [isReconnecting, setIsReconnecting] = useState<boolean>(!!loadSession());
  const [isConnected, setIsConnected] = useState<boolean>(false);

  useEffect(() => {
    clientRef.current = new Colyseus.Client(SERVER_URL);
    return () => {
      roomRef.current?.leave();
    };
  }, []);

  // WebSocket接続状態を定期的に監視（サイレント切断検知）
  useEffect(() => {
    const interval = setInterval(() => {
      const r = roomRef.current;
      if (!r) {
        setIsConnected(false);
        return;
      }
      // colyseus.jsのroom.connectionでWebSocket readyState確認
      const ws = (r.connection as any)?.ws as WebSocket | undefined;
      const connected = ws?.readyState === WebSocket.OPEN;
      setIsConnected(connected);
      if (r && !connected && !isReconnecting) {
        console.log('[Colyseus] サイレント切断を検知 (readyState:', ws?.readyState, ')');
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isReconnecting]);

  // ルーム一覧取得
  const fetchRooms = useCallback(async () => {
    if (!clientRef.current) return;
    try {
      const available = await clientRef.current.getAvailableRooms('zoo_room');
      setRooms(available as unknown as RoomListing[]);
    } catch (e: any) {
      console.error('Failed to fetch rooms:', e);
    }
  }, []);

  // ルーム接続時の共通セットアップ
  const setupRoom = useCallback((r: Colyseus.Room, playerName?: string) => {
    roomRef.current = r;
    setRoom(r);
    setSessionId(r.sessionId);
    setIsReconnecting(false);
    setIsConnected(true);
    // E2Eテスト用: roomオブジェクトをwindowに公開
    (window as any).__colyseusRoom = r;
    setError('');

    // localStorageにセッション情報を保存（再接続用）
    saveSession(r.roomId, r.reconnectionToken, playerName || '');

    // 初回の状態を即座に読み取る
    if (r.state) {
      const initial = schemaToPlain(r.state);
      console.log('[Colyseus] initial state phase:', initial?.phase);
      setState(initial);
    }

    r.onStateChange((newState: any) => {
      const plain = schemaToPlain(newState);
      console.log('[Colyseus] state change phase:', plain?.phase);
      setState(plain);
    });

    r.onMessage("historyInfo", (info: HistoryInfo) => {
      setHistoryInfo(info);
    });

    // チャンスカード秘匿情報
    r.onMessage("chanceCardDrawn", (data: { cardId: string }) => {
      setMyDrawnCardId(data.cardId);
    });
    r.onMessage("heldCardInfo", (data: { cardId: string }) => {
      setMyHeldCardId(data.cardId);
    });
    r.onMessage("heldCardCleared", () => {
      setMyHeldCardId('');
    });

    r.onError((code: number, message?: string) => {
      console.error('[Colyseus] onError:', code, message);
      if (code && message) {
        setError(`Error ${code}: ${message}`);
      } else {
        setError('サーバーとの通信でエラーが発生しました');
      }
    });

    r.onLeave((code: number) => {
      console.log('[Colyseus] Left room, code:', code);
      roomRef.current = null;
      setRoom(null);
      setState(null);
      // 正常退出(1000)や意図的退出(4000)の場合のみセッション情報をクリア
      if (code === 1000 || code === 4000) {
        clearSession();
        return;
      }
      // 異常切断（1006等）→ 自動再接続を試行
      console.log('[Colyseus] 異常切断を検出、自動再接続を試行します...');
      setIsReconnecting(true);
      // 少し待ってから再接続（サーバー側の処理完了を待つ）
      setTimeout(async () => {
        const success = await tryReconnectRef.current();
        if (!success) {
          setError('サーバーとの接続が切れました。ページを再読み込みしてください。');
        }
      }, 1000);
    });
  }, []);

  // 再接続を試行
  const tryReconnect = useCallback(async (): Promise<boolean> => {
    const saved = loadSession();
    if (!saved || !clientRef.current) {
      setIsReconnecting(false);
      return false;
    }

    console.log('[Colyseus] 再接続を試行中...', saved.roomId);

    // 1. まずreconnectionTokenで再接続を試みる（ゲーム中の場合に有効）
    try {
      const r = await clientRef.current.reconnect(saved.reconnectionToken);
      console.log('[Colyseus] reconnectionTokenで再接続成功');
      setupRoom(r, saved.playerName);
      return true;
    } catch (e) {
      console.log('[Colyseus] reconnectionToken再接続失敗:', e);
    }

    // 2. reconnectが失敗した場合、joinByIdで同じ部屋に再入室を試みる（ロビーの場合）
    try {
      const r = await clientRef.current.joinById(saved.roomId, { name: saved.playerName });
      console.log('[Colyseus] joinByIdで再入室成功');
      setupRoom(r, saved.playerName);
      return true;
    } catch (e) {
      console.log('[Colyseus] joinById再入室失敗（ルームが存在しない可能性）:', e);
    }

    // 3. すべて失敗 → セッション情報をクリアしてトップページへ
    clearSession();
    setIsReconnecting(false);
    return false;
  }, [setupRoom]);

  // tryReconnectをrefに保持（setupRoom内のonLeaveから参照するため）
  tryReconnectRef.current = tryReconnect;

  // ルーム作成
  const createRoom = useCallback(async (name: string, roomName: string, password?: string) => {
    if (!clientRef.current) return;
    try {
      const options: any = { name, roomName };
      if (password) options.password = password;
      const r = await clientRef.current.create('zoo_room', options);
      setupRoom(r, name);
    } catch (e: any) {
      setError(e.message || 'ルーム作成に失敗しました');
    }
  }, [setupRoom]);

  // ルームに参加（IDで）
  const joinRoomById = useCallback(async (roomId: string, name: string, password?: string) => {
    if (!clientRef.current) return;
    try {
      const options: any = { name };
      if (password) options.password = password;
      const r = await clientRef.current.joinById(roomId, options);
      setupRoom(r, name);
    } catch (e: any) {
      setError(e.message || 'ルーム参加に失敗しました');
    }
  }, [setupRoom]);

  // 後方互換: joinOrCreate（テスト用）
  const joinRoom = useCallback(async (name: string, minClients?: number) => {
    if (!clientRef.current) return;
    try {
      const r = await clientRef.current.joinOrCreate('zoo_room', { name, roomName: '三ツ星動物園', minClients });
      setupRoom(r, name);
    } catch (e: any) {
      setError(e.message || 'Failed to join room');
    }
  }, [setupRoom]);

  const send = useCallback((type: string, data?: any) => {
    roomRef.current?.send(type, data);
  }, []);

  const leave = useCallback(() => {
    clearSession();
    roomRef.current?.leave();
    roomRef.current = null;
    setRoom(null);
    setState(null);
  }, []);

  return {
    room, state, sessionId, error, historyInfo, rooms,
    myDrawnCardId, myHeldCardId, isReconnecting, isConnected,
    fetchRooms, createRoom, joinRoomById, joinRoom, send, leave, tryReconnect,
  };
}
