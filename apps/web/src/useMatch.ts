// The socket, and nothing else.
//
// Everything about what the messages MEAN is in `match-client.ts`, which is a
// reducer and is tested as one. This is the part that cannot be: a WebSocket,
// a reconnect with backoff, and a small outbox so that pressing something the
// moment the wifi drops is not silently thrown away.
//
// Reconnecting is the normal case, not the exceptional one. Phones sleep, tabs
// are backgrounded, trains go into tunnels. The room is built for it — the
// same token on a new socket is the same player coming back, and `hello`
// carries what this client already has so it is sent only what it missed
// (docs/ONLINE.md) — so the work here is to keep trying, and to say so while
// it does.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage } from '@sps/referee';
import { applyServerMessage, initialMatch } from './match-client.js';
import type { MatchState } from './match-client.js';
import { socketUrl } from './referee-api.js';

/** Backoff, doubling. Kept short at the start: most drops are a second long. */
const RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

/**
 * How many messages to hold while the socket is down.
 *
 * Small on purpose. A move is worth replaying — the room rejects a stale ply
 * rather than playing it twice, so resending is safe — but a queue deep
 * enough to hold a minute of impatient clicking would just deliver a minute
 * of impatient clicking all at once.
 */
const OUTBOX_LIMIT = 8;

export interface MatchActions {
  move: (ply: number, move: string) => void;
  resign: () => void;
  abort: () => void;
  offerDraw: () => void;
  acceptDraw: () => void;
  declineDraw: () => void;
  claimWin: () => void;
  claimDraw: () => void;
  gift: () => void;
}

export interface MatchConnection {
  state: MatchState;
  /** Whether the socket is open right now — what the "reconnecting" line reads. */
  connected: boolean;
  actions: MatchActions;
}

export function useMatch(
  matchId: string | null,
  token: string | null,
  name?: string,
): MatchConnection {
  const [state, setState] = useState<MatchState>(() => initialMatch(matchId ?? ''));
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const outboxRef = useRef<ClientMessage[]>([]);
  // Read at reconnect time to fill in `hello.lastPly`, so a returning socket
  // is sent the moves it missed and not the whole game again.
  const stateRef = useRef(state);
  stateRef.current = state;

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }
    if (outboxRef.current.length < OUTBOX_LIMIT) outboxRef.current.push(message);
  }, []);

  useEffect(() => {
    if (!matchId) return;

    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;

      const socket = new WebSocket(socketUrl(matchId));
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        if (closed) return;
        attempt = 0;
        setConnected(true);
        socket.send(
          JSON.stringify({
            t: 'hello',
            matchId,
            token,
            lastPly: stateRef.current.moves.length,
            ...(name ? { name } : {}),
          }),
        );
        const waiting = outboxRef.current;
        outboxRef.current = [];
        for (const message of waiting) socket.send(JSON.stringify(message));
      });

      socket.addEventListener('message', (event) => {
        if (closed || typeof event.data !== 'string') return;
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return; // the room does not send junk; if something else did, ignore it
        }
        setState((current) => applyServerMessage(current, message, Date.now()));
      });

      socket.addEventListener('close', () => {
        if (closed) return;
        setConnected(false);
        socketRef.current = null;
        // A link that opens nothing, or a seat another tab has taken: trying
        // again would be a loop, and the screen already says why.
        if (stateRef.current.fatal) return;
        const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 15_000;
        attempt += 1;
        retry = setTimeout(connect, wait);
      });

      // `error` is always followed by `close`, which is where the retry is.
      socket.addEventListener('error', () => setConnected(false));
    };

    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      const socket = socketRef.current;
      socketRef.current = null;
      // 1000: a deliberate goodbye. The room marks the seat away and tells the
      // opponent, which is exactly right — this player really has gone.
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, 'leaving');
      setConnected(false);
    };
  }, [matchId, token, name]);

  const actions = useMemo<MatchActions>(
    () => ({
      move: (ply, move) => send({ t: 'move', ply, move }),
      resign: () => send({ t: 'resign' }),
      abort: () => send({ t: 'abort' }),
      offerDraw: () => send({ t: 'draw-offer' }),
      acceptDraw: () => send({ t: 'draw-accept' }),
      declineDraw: () => send({ t: 'draw-decline' }),
      claimWin: () => send({ t: 'claim' }),
      claimDraw: () => send({ t: 'claim-draw' }),
      gift: () => send({ t: 'gift' }),
    }),
    [send],
  );

  return { state, connected, actions };
}
