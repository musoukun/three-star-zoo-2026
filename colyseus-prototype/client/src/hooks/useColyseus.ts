import { useState, useEffect, useCallback, useRef } from 'react';
import * as Colyseus from '@colyseus/sdk';

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
    return JSON.parse(raw) as SavedSession;
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
  isCpu: boolean;
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
  const lobbyRef = useRef<Colyseus.Room | null>(null);
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
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    clientRef.current = new Colyseus.Client(SERVER_URL);

    // モバイル: フォアグラウンド復帰時にWebSocket切断を検知して再接続
    const handleVisibilityGlobal = () => {
      if (document.visibilityState !== 'visible') return;
      const r = roomRef.current;
      if (!r) return;
      const ws = (r.connection as any)?.ws ?? (r as any).connection?.transport?.ws;
      if (ws && (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING)) {
        console.log('[Colyseus] visibilitychange: WebSocket切断を検知');
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityGlobal);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityGlobal);
      lobbyRef.current?.leave();
      roomRef.current?.leave();
    };
  }, []);

  /** LobbyRoom に接続してリアルタイムルーム一覧を取得 */
  const joinLobby = useCallback(async () => {
    if (!clientRef.current || lobbyRef.current) return;
    try {
      const lobby = await clientRef.current.joinOrCreate('lobby');
      lobbyRef.current = lobby;

      lobby.onMessage("rooms", (roomList: RoomListing[]) => {
        setRooms(roomList);
      });
      lobby.onMessage("+", ([roomId, roomData]: [string, RoomListing]) => {
        setRooms(prev => {
          const idx = prev.findIndex(r => r.roomId === roomId);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = roomData;
            return updated;
          }
          return [...prev, roomData];
        });
      });
      lobby.onMessage("-", (roomId: string) => {
        setRooms(prev => prev.filter(r => r.roomId !== roomId));
      });
      lobby.onLeave(() => {
        lobbyRef.current = null;
      });
    } catch (e: any) {
      console.error('Failed to join lobby:', e);
    }
  }, []);

  /** LobbyRoom から退出 */
  const leaveLobby = useCallback(() => {
    lobbyRef.current?.leave();
    lobbyRef.current = null;
    setRooms([]);
  }, []);

  // ルーム接続時の共通セットアップ
  const setupRoom = useCallback((r: Colyseus.Room, playerName?: string) => {
    // ゲームルームに入ったらロビーを離脱
    lobbyRef.current?.leave();
    lobbyRef.current = null;

    roomRef.current = r;
    setRoom(r);
    setSessionId(r.sessionId);
    setIsReconnecting(false);
    // E2Eテスト用: roomオブジェクトをwindowに公開
    (window as any).__colyseusRoom = r;
    setError('');

    // 0.17: 初回の r.state はまだ同期されていないため onStateChange を待つ
    let sessionSaved = false;
    r.onStateChange((newState: any) => {
      // 初回のonStateChange時にreconnectionTokenが確定しているので、ここで保存
      if (!sessionSaved) {
        sessionSaved = true;
        saveSession(r.roomId, r.reconnectionToken, playerName || '');
      }
      const plain = schemaToPlain(newState);
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

  // 再接続を試行（reconnectionTokenで最大3回リトライ）
  const tryReconnect = useCallback(async (): Promise<boolean> => {
    const saved = loadSession();
    if (!saved || !clientRef.current) {
      setIsReconnecting(false);
      return false;
    }

    console.log('[Colyseus] 再接続を試行中...', saved.roomId);

    // reconnectionTokenで再接続（抜け殻セッションに復帰する正しい方法）
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const r = await clientRef.current.reconnect(saved.reconnectionToken);
        console.log(`[Colyseus] reconnectionTokenで再接続成功 (試行${i + 1})`);
        setupRoom(r, saved.playerName);
        return true;
      } catch (e) {
        console.log(`[Colyseus] reconnectionToken再接続失敗 (試行${i + 1}/${maxRetries}):`, e);
        if (i < maxRetries - 1) {
          // リトライ前に少し待つ（サーバー側のallowReconnection準備を待つ）
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    // reconnectが全て失敗 → セッション情報をクリアしてトップページへ
    // ※ joinByIdは新規sessionIdで入室し抜け殻が残るため使わない
    console.log('[Colyseus] 再接続失敗。セッションをクリアします。');
    clearSession();
    setIsReconnecting(false);
    return false;
  }, [setupRoom]);

  // tryReconnectをrefに保持（setupRoom内のonLeaveから参照するため）
  tryReconnectRef.current = tryReconnect;

  // ルーム作成
  const createRoom = useCallback(async (name: string, roomName: string, password?: string) => {
    if (!clientRef.current || isLoading) return;
    setIsLoading(true);
    try {
      const options: any = { name, roomName };
      if (password) options.password = password;
      const r = await clientRef.current.create('zoo_room', options);
      setupRoom(r, name);
    } catch (e: any) {
      setError(e.message || 'ルーム作成に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [setupRoom, isLoading]);

  // ルームに参加（IDで）
  const joinRoomById = useCallback(async (roomId: string, name: string, password?: string) => {
    if (!clientRef.current || isLoading) return;
    setIsLoading(true);
    try {
      const options: any = { name };
      if (password) options.password = password;
      const r = await clientRef.current.joinById(roomId, options);
      setupRoom(r, name);
    } catch (e: any) {
      setError(e.message || 'ルーム参加に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [setupRoom, isLoading]);

  // 後方互換: joinOrCreate（テスト用）
  const joinRoom = useCallback(async (name: string, minClients?: number) => {
    if (!clientRef.current || isLoading) return;
    setIsLoading(true);
    try {
      const r = await clientRef.current.joinOrCreate('zoo_room', { name, roomName: '三ツ星動物園', minClients });
      setupRoom(r, name);
    } catch (e: any) {
      setError(e.message || 'Failed to join room');
    } finally {
      setIsLoading(false);
    }
  }, [setupRoom, isLoading]);

  const send = useCallback((type: string, data?: any) => {
    roomRef.current?.send(type, data);
  }, []);

  const leave = useCallback(() => {
    if (isLoading) return;
    setIsLoading(true);
    clearSession();
    roomRef.current?.leave();
    roomRef.current = null;
    setRoom(null);
    setState(null);
    setIsLoading(false);
  }, [isLoading]);

  return {
    room, state, sessionId, error, historyInfo, rooms,
    myDrawnCardId, myHeldCardId, isReconnecting, isLoading,
    joinLobby, leaveLobby, createRoom, joinRoomById, joinRoom, send, leave, tryReconnect,
  };
}
