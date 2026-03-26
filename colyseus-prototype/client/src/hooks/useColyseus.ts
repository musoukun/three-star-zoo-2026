import { useState, useEffect, useCallback, useRef } from 'react';
import * as Colyseus from 'colyseus.js';

// 本番: wss://your-railway-app.up.railway.app  開発: ws://localhost:2567
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:2567';

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
  coins: number;
  stars: number;
  connected: boolean;
  poopTokens: number;
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
  const [room, setRoom] = useState<Colyseus.Room | null>(null);
  const [state, setState] = useState<ZooRoomState | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [historyInfo, setHistoryInfo] = useState<HistoryInfo>({ undoCount: 0, redoCount: 0 });
  const [rooms, setRooms] = useState<RoomListing[]>([]);

  useEffect(() => {
    clientRef.current = new Colyseus.Client(SERVER_URL);
    return () => {
      roomRef.current?.leave();
    };
  }, []);

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
  const setupRoom = useCallback((r: Colyseus.Room) => {
    roomRef.current = r;
    setRoom(r);
    setSessionId(r.sessionId);
    setError('');

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

    r.onError((code: number, message?: string) => {
      setError(`Error ${code}: ${message}`);
    });

    r.onLeave((code: number) => {
      console.log('Left room', code);
      setRoom(null);
      setState(null);
    });
  }, []);

  // ルーム作成
  const createRoom = useCallback(async (name: string, roomName: string, password?: string) => {
    if (!clientRef.current) return;
    try {
      const options: any = { name, roomName };
      if (password) options.password = password;
      const r = await clientRef.current.create('zoo_room', options);
      setupRoom(r);
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
      setupRoom(r);
    } catch (e: any) {
      setError(e.message || 'ルーム参加に失敗しました');
    }
  }, [setupRoom]);

  // 後方互換: joinOrCreate（テスト用）
  const joinRoom = useCallback(async (name: string, minClients?: number) => {
    if (!clientRef.current) return;
    try {
      const r = await clientRef.current.joinOrCreate('zoo_room', { name, roomName: '三ツ星動物園', minClients });
      setupRoom(r);
    } catch (e: any) {
      setError(e.message || 'Failed to join room');
    }
  }, [setupRoom]);

  const send = useCallback((type: string, data?: any) => {
    roomRef.current?.send(type, data);
  }, []);

  const leave = useCallback(() => {
    roomRef.current?.leave();
    roomRef.current = null;
    setRoom(null);
    setState(null);
  }, []);

  return {
    room, state, sessionId, error, historyInfo, rooms,
    fetchRooms, createRoom, joinRoomById, joinRoom, send, leave,
  };
}
