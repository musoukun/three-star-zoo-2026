import { useState, useEffect, useCallback, useRef } from 'react';
import * as Colyseus from 'colyseus.js';

const SERVER_URL = 'ws://localhost:2567';

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
  phase: string;
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

export function useColyseus() {
  const clientRef = useRef<Colyseus.Client | null>(null);
  const roomRef = useRef<Colyseus.Room | null>(null);
  const [room, setRoom] = useState<Colyseus.Room | null>(null);
  const [state, setState] = useState<ZooRoomState | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [historyInfo, setHistoryInfo] = useState<HistoryInfo>({ undoCount: 0, redoCount: 0 });

  useEffect(() => {
    clientRef.current = new Colyseus.Client(SERVER_URL);
    return () => {
      roomRef.current?.leave();
    };
  }, []);

  const joinRoom = useCallback(async (name: string, minClients?: number) => {
    if (!clientRef.current) return;

    try {
      const r = await clientRef.current.joinOrCreate('zoo_room', { name, minClients });
      roomRef.current = r;
      setRoom(r);
      setSessionId(r.sessionId);
      setError('');

      // State変更を監視
      r.onStateChange((newState: any) => {
        setState(schemaToPlain(newState));
      });

      // 履歴情報を受信
      r.onMessage("historyInfo", (info: HistoryInfo) => {
        console.log("[History] received:", info);
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
    } catch (e: any) {
      setError(e.message || 'Failed to join room');
    }
  }, []);

  const send = useCallback((type: string, data?: any) => {
    roomRef.current?.send(type, data);
  }, []);

  const leave = useCallback(() => {
    roomRef.current?.leave();
    roomRef.current = null;
    setRoom(null);
    setState(null);
  }, []);

  return { room, state, sessionId, error, historyInfo, joinRoom, send, leave };
}
