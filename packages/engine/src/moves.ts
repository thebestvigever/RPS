// Move generation — spec 7.4.
//
// legalMoves(state):
//   if state.result: return []
//   me = state.turn; opp = other(me)
//   for each square i with piece P:
//     if P.owner == me:                                  mover is own piece
//     else if P.owner == neutral and variant.neutrals:   mover is a neutral (capture-only)
//     else: continue
//     for each neighbour j of i:
//       T = board[j]
//       if T is empty:
//         if P is neutral: continue                      neutrals never walk (4.2.2)
//         emit move i->j
//       else if T.owner == P.owner: continue             own piece, or neutral onto neutral
//       else if P is neutral and T.owner == me: continue a neutral you use can't take your own
//       else if beats(P.type) == T.type: emit capture i->j
//       // anything else is illegal: same type, or T beats P
//
// Order moves by origin square, then destination square, whenever order matters
// (tests and replays). The reference engine produced exactly 36 moves for Blue
// from the Original start and 35 in Neutrals -- spec 11.3.

import { NotImplementedError } from './errors.js';
import type { GameState, Move, MoveInput } from './types.js';

export function legalMoves(_state: GameState): Move[] {
  throw new NotImplementedError('legalMoves', '7.4');
}

export function isLegal(_state: GameState, _move: MoveInput): boolean {
  throw new NotImplementedError('isLegal', '7.4');
}
