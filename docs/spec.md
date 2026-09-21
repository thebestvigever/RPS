# Stone Paper Scissors — Build Spec v1

> **Working title.** A two-player abstract strategy game: rock-paper-scissors captures on a 9×9 board, every piece moves like a chess king, and the first player to reach the enemy's corner wins. The base rules come from meaf's *rps2* ([meaf.us/rps2](https://meaf.us/rps2/)). This spec adds two variants that tested well — **2×2 Corner** and **Neutrals** — and everything a coding agent needs to build v1 without asking questions.

| | |
|---|---|
| **Owner** | Vig |
| **Audience** | The coding agent building v1 |
| **Spec version** | 1.0 — 21 Sep 2026 |
| **Rules version** | `1` (stamp this on every saved game) |
| **Scope of v1** | Single device: play against the computer, or pass-and-play. Three variants: Original, 2×2 Corner, Neutrals. |
| **Out of scope for v1** | Online play, accounts, ratings, other modes — see §13. v1 must be built so they're cheap to add. |

---

## 0. How to read this

- **MUST / SHOULD / MAY** carry their RFC 2119 meanings.
- **§2–§5 are the rules and are normative.** If anything else in this doc disagrees with them, §2–§5 win.
- **This game is its own product and its own repository.** It shares no code with the owner's other games, so each can grow on its own schedule.
- **Build the engine first.** §11 has test vectors, move counts (perft) and puzzle positions, all produced by the reference engine that generated the simulation results in §6. The engine MUST pass them before any UI work starts.
- **A deliberate rule, not a bug:** a player MAY move onto their own corner. That makes possible a defensive formation called **the Keep** (§2.10). Do not add a restriction against it.

---

## 1. The game on one screen

```text
   a b c d e f g h i
9  . . . . . . . . ◆   ◆ i9 = Red's corner. Blue wins by reaching it.
8  . . . . P R . . .
7  . . . . S P R . .
6  . . . . . S P R .
5  . p s . . . S P .
4  . r p s . . . . .
3  . . r p s . . . .
2  . . . r p . . . .
1  ◇ . . . . . . . .   ◇ a1 = Blue's corner. Red wins by reaching it.

   lower case = Blue, capitals = Red · r/R Rock · p/P Paper · s/S Scissors
```

1. **Blue moves first**, then turns alternate.
2. **Every piece moves like a chess king**: one square in any of eight directions.
3. **Capture by moving onto an enemy piece your type beats**: Rock takes Scissors, Scissors take Paper, Paper takes Rock. You can't move onto a piece you don't beat.
4. **Win by getting any piece onto the enemy's corner.**
5. **Lose if it's your turn and you have no legal move.** Threefold repetition or 300 total plies is a draw.

---

## 2. Rules — Original (normative)

### 2.1 Board and coordinates

- The board is a 9×9 grid of 81 squares.
- **Files** are `a`–`i` from left to right; **ranks** are `1`–`9` from bottom to top, as seen by Blue. Square names are file then rank: `a1`, `e5`, `i9`.
- **Corners:** `a1` is **Blue's corner**; `i9` is **Red's corner**.
- **Goals:** Blue's goal is Red's corner (`i9`). Red's goal is Blue's corner (`a1`).
- **Index for code:** `row = 9 − rank`, `col = fileIndex` (`a` = 0 … `i` = 8), `index = row × 9 + col`. So `a9` = 0, `i9` = 8, `e5` = 40, `a1` = 72, `i1` = 80. Row 0 is the top rank, which matches the order of the position notation in §8.2.
- **Neighbours:** the up to 8 squares at king distance 1. Corner squares have 3, edge squares 5, interior squares 8.
- **Distance** means king (Chebyshev) distance: `max(|Δrow|, |Δcol|)`. From `a1` to `i9` is 8.

### 2.2 Pieces

- Each side starts with **10 pieces: 4 Paper, 3 Rock, 3 Scissors**.
- The cycle: **Rock beats Scissors, Scissors beat Paper, Paper beats Rock.** Written as a function, `beats(Rock) = Scissors`, `beats(Scissors) = Paper`, `beats(Paper) = Rock`.
- Every piece moves the same way. Type matters only for captures.
- A piece's **predator** is the type that beats it: Paper preys on Rock, Rock on Scissors, Scissors on Paper.

### 2.3 Starting position

| Side | Rock | Paper | Scissors |
|---|---|---|---|
| Blue | b4, c3, d2 | b5, c4, d3, e2 | c5, d4, e3 |
| Red | h6, g7, f8 | h5, g6, f7, e8 | g5, f6, e7 |

- Position notation (§8.2): `9/4PR3/4SPR2/5SPR1/1ps3SP1/1rps5/2rps4/3rp4/9 blue`
- The layout is **180° rotationally symmetric**: the piece on square (file *f*, rank *r*) mirrors the opposite side's piece on (file 8−*f*, rank 10−*r*). For example, Blue's Rock on `b4` mirrors Red's Rock on `h6`.
- **Why it works (keep this layout):** each army is a three-deep diagonal wedge — Scissors in front, Paper in the middle, Rock at the back. Each side's back row of Rock is exactly what eats the enemy's front row of Scissors, so a front-line rush runs straight into its counter. The two fronts are both Scissors, so at the start neither front can capture the other.
- Blue has **36 legal moves** from the start (listed in §11.3).

### 2.4 Turns

- Blue moves first. Turns alternate. Each turn is exactly one move. There is no passing.

### 2.5 Moving

- A move takes one of the mover's pieces one king step to a neighbouring square, subject to §2.6.

### 2.6 What can move where

| The destination holds | Result |
|---|---|
| Nothing | Legal: the piece moves there. |
| One of your own pieces | Illegal. |
| An enemy piece your type beats | Legal: **capture**. The enemy piece is removed and yours takes its square. |
| An enemy piece of the same type | Illegal. |
| An enemy piece that beats your type | Illegal. |
| A neutral piece (Neutrals variant only) | See §4. |

- Captured pieces are gone for the rest of the game.
- Capturing is **never compulsory**.

### 2.7 Winning: reach the enemy's corner

- If, at the end of your move, one of your pieces stands on your goal square, **you win immediately**. Stepping onto an empty goal and capturing onto an occupied goal both count.
- **You MAY move onto your own corner.** A piece standing there has to be captured before the opponent can enter, which makes it a defensive square. This is an explicit design decision by the owner; do not add a rule against it.
- A position in which a side already has a piece on its goal is finished: that side has won. The position loader MUST mark such positions as over rather than letting play continue.

### 2.8 Losing: no legal moves

- If the player to move has no legal move — including because they have no pieces left — **they lose**. The reason code is `no-moves`.

### 2.9 Draws

- **Threefold repetition:** the same board with the same side to move occurs for the third time (the starting position counts) → draw, reason `repetition`.
- **Move limit:** after the 300th ply (150 moves each) with no result → draw, reason `move-limit`.
- These are the two draw rules the simulations in §6 used. They trigger rarely: 2 draws in 260 games of the Original at the shallower search depth.
- Resigning is always allowed. Draw offers exist only in pass-and-play and, later, online.

### 2.10 The Keep — an intended dynamic, not a bug

**Definitions.**

- A piece is **permanent** when the opponent has no pieces of its predator type left (and, in the Neutrals variant, no neutral of its predator type is left on the board). Nothing on the board can ever capture it again. Example: once Red has lost every Paper, all Blue Rocks are permanent.
- A side's corner is **sealed** when the opponent can no longer reach it at all, because the only paths run through squares held by the defender's permanent pieces. The simplest seal is one permanent piece standing on the corner itself. We call a sealed corner **the Keep**.

**Consequences.**

- A player whose corner is sealed can't lose by the corner. They can still lose by having no legal moves, and the game can still end in a draw.
- If both corners are sealed, neither side can win by the corner; the game usually ends by repetition or the move limit.
- In testing (§6.3), a computer player told to hunt for the Keep sealed its corner in about 1 game in 10 of the Original, and the sealing side almost never lost. The Keep makes wiping out an enemy type the central strategic goal — which is the point.

**What to build.**

- The engine MUST NOT special-case the Keep. It emerges from §2.6–§2.7.
- The engine MUST expose `isSealed(state, side)` (algorithm in §7.6) for the interface and the AI.
- The interface SHOULD show when a corner becomes sealed (§10.5), because players won't spot it otherwise and it changes what's worth doing.
- The computer player SHOULD value sealing its own corner (§9.2).

---

## 3. Variant — 2×2 Corner (normative)

Everything in §2 applies, with one change.

- **The goal is a 2×2 block instead of one square.**
  - Blue's goal (Red's corner block): `h8`, `i8`, `h9`, `i9`.
  - Red's goal (Blue's corner block): `a1`, `b1`, `a2`, `b2`.
- A player wins the moment one of their pieces stands on **any** square of their goal block at the end of their move.
- Players MAY stand in their own corner block to defend it, exactly as in §2.7.
- Starting position, move rules, draws: unchanged. The start position has no piece in either block.

**What it changes (§6):** games run about 25% shorter (101–107 plies against 129–138), balance holds, and the Keep becomes practically impossible — sealing needs permanent pieces on all four corner squares or a wall of them around the block. In 60 games with a Keep-hunting computer player, no corner was ever sealed. Players keep the defensive corner play; they lose the unbreakable fortress.

```text
   a b c d e f g h i
9  . . . . . . . ◆ ◆   ◆ Blue's goal block: h8 i8 h9 i9
8  . . . . P R . ◆ ◆
7  . . . . S P R . .
6  . . . . . S P R .
5  . p s . . . S P .
4  . r p s . . . . .
3  . . r p s . . . .
2  ◇ ◇ . r p . . . .
1  ◇ ◇ . . . . . . .   ◇ Red's goal block: a1 b1 a2 b2
```

---

## 4. Variant — Neutrals (normative)

Everything in §2 applies, plus three neutral pieces that belong to nobody.

### 4.1 Placement

| Square | Neutral piece |
|---|---|
| c7 | Paper |
| e5 | Scissors |
| g3 | Paper |

- Position notation: `9/4PR3/2nP1SPR2/5SPR1/1ps1nS1SP1/1rps5/2rps1nP2/3rp4/9 blue`
- The placement is 180° symmetric (`c7` ↔ `g3`, `e5` is the centre) and **touches nothing either side can capture at the start**. The neutral Scissors on `e5` sits between both front lines of Scissors, which it neither beats nor loses to. Both properties matter; see "what failed" in §4.4.

```text
   a b c d e f g h i
9  . . . . . . . . ◆
8  . . . . P R . . .
7  . . ▲ . S P R . .      ▲ neutral Paper      ✕ neutral Scissors
6  . . . . . S P R .
5  . p s . ✕ . S P .
4  . r p s . . . . .
3  . . r p s . ▲ . .
2  . . . r p . . . .
1  ◇ . . . . . . . .
```

### 4.2 Rules for neutral pieces

1. **Using a neutral.** On your turn you MAY, instead of moving one of your own pieces, move a neutral piece — **but only to capture**: one king step onto an adjacent **enemy** piece (a piece of your opponent) that the neutral's type beats.
2. **A neutral never walks.** It can't move to an empty square.
3. **A neutral you use can't capture your own pieces**, and **a neutral can never capture another neutral**.
4. **Neutrals can be captured.** Either player's piece may capture a neutral that its type beats, by the normal rules of §2.6. The neutral is removed.
5. **Neutrals never win.** A neutral standing on a goal square wins nothing for anyone.
6. **A neutral on a goal square blocks it.** A player can only enter that square by capturing the neutral.
7. **Using a neutral is your move for the turn.** It counts for repetition and the move limit like any move.
8. **Neutral captures are legal moves.** A player with a neutral capture available is not out of moves (§2.8).
9. Neutrals don't count toward either side's material, and they don't make anyone's pieces less permanent unless they are of the predator type (§2.10).

### 4.3 What it feels like

A neutral piece is a standing threat to any piece **of either colour** that steps next to it with the type it beats — and whoever's turn it is gets to fire it. A neutral Paper next to your Rock is your opponent's weapon on their turn; the same neutral next to their Rock is yours. The board gains no-go zones that belong to nobody.

From the start position Blue has 35 legal moves in this variant, not 36: the neutral Scissors on `e5` blocks `Sd4-e5`. No neutral can capture anything on move one.

### 4.4 What failed, and must not be reintroduced

| Design | Result in testing | Why it failed |
|---|---|---|
| Neutrals may walk freely, like any piece | 28% of games drawn (34 of 120) | A shared piece is a free pass move, so players shuffle it back and forth. |
| Neutrals on `d6`, `e5`, `f4` (the three centre squares), including a Rock | First player won 77 to 42 | A neutral Rock there touches both front lines of Scissors, so the first player captures with it on move one. |
| Neutrals as inert blockers anyone may capture | Balanced but longer (144 plies); little new play | Adds nothing a player can use. |

---

## 5. Variants as data

Variants MUST be configuration, not separate code paths. The engine reads a `VariantConfig` and behaves accordingly.

```ts
type Side = 'blue' | 'red';
type VariantId = 'original' | 'corner2x2' | 'neutrals';

interface VariantConfig {
  id: VariantId;
  name: string;                    // shown in the interface
  rulesVersion: 1;
  start: string;                   // position notation, §8.2
  goals: Record<Side, string[]>;   // squares each side must REACH
  neutrals: false | { captureOnly: true };
  draw: { repetitions: 3; maxPlies: 300 };
}

export const VARIANTS: Record<VariantId, VariantConfig> = {
  original: {
    id: 'original', name: 'Original', rulesVersion: 1,
    start: '9/4PR3/4SPR2/5SPR1/1ps3SP1/1rps5/2rps4/3rp4/9 blue',
    goals: { blue: ['i9'], red: ['a1'] },
    neutrals: false,
    draw: { repetitions: 3, maxPlies: 300 },
  },
  corner2x2: {
    id: 'corner2x2', name: '2×2 Corner', rulesVersion: 1,
    start: '9/4PR3/4SPR2/5SPR1/1ps3SP1/1rps5/2rps4/3rp4/9 blue',
    goals: { blue: ['h8', 'i8', 'h9', 'i9'], red: ['a1', 'b1', 'a2', 'b2'] },
    neutrals: false,
    draw: { repetitions: 3, maxPlies: 300 },
  },
  neutrals: {
    id: 'neutrals', name: 'Neutrals', rulesVersion: 1,
    start: '9/4PR3/2nP1SPR2/5SPR1/1ps1nS1SP1/1rps5/2rps1nP2/3rp4/9 blue',
    goals: { blue: ['i9'], red: ['a1'] },
    neutrals: { captureOnly: true },
    draw: { repetitions: 3, maxPlies: 300 },
  },
};
```

- **Combining variants** is free with this design. Neutrals plus 2×2 Corner was also tested and came out balanced (48 to 50 over 100 games, 2 draws, 114 plies). It MAY ship as a fourth option, but v1 SHOULD launch with the three above.
- **Never mutate a shipped variant.** A rules change gets a new `rulesVersion`, so saved games and, later, ratings stay interpretable.

---

## 6. Why these variants: simulation evidence

About 2,000 computer-vs-computer games were played with a reference engine and AI built for this spec, searching two or three moves ahead. The three variants in this spec are the ones that came out balanced and decisive. These numbers are the baseline the shipped engine and AI should reproduce (§9.6).

### 6.1 Balance

| Variant | Search depth | Games | Blue (moves first) | Red | Draws | Average length (plies) |
|---|---|---|---|---|---|---|
| Original | 3 | 60 | 30 | 26 | 4 | 129 |
| Original | 2 | 260 | 111 | 147 | 2 | 138 |
| 2×2 Corner | 3 | 40 | 17 | 22 | 1 | 101 |
| 2×2 Corner | 2 | 120 | 61 | 59 | 0 | 107 |
| Neutrals | 3 | 40 | 21 | 16 | 3 | 124 |
| Neutrals | 2 | 100 | 49 | 50 | 1 | 139 |
| Neutrals + 2×2 Corner | 2 | 100 | 48 | 50 | 2 | 114 |

How to read it:

- **All three variants are balanced within the noise of these sample sizes.** Samples of 40–120 games carry roughly ±8–15 points of uncertainty on a win share, so treat any single row as a signal, not a verdict.
- **The Original leaned slightly to the second player at the shallower search** (43% first-player wins over 260 games) and evened out at the deeper one. Stepping into contact first tends to hand the opponent the first capture; a player who looks further ahead avoids that.
- **Draws are rare**: 0–8% in every row.

### 6.2 What decides games (Original, depth 2, 100 games)

| Measure | Result |
|---|---|
| Games in which one side loses every piece of some type | 68% |
| …and the side that wiped out a type first went on to win | 65% |
| The side that made the first capture won | 55% |
| The side ahead on pieces after 40 plies won | 52% |
| Corner wins by the side with fewer pieces | 20% |
| Depth-3 player against depth-1 player | Depth 3 won 53 of 60 |

In plain terms: **skill decides games**, **wiping out a type is the main strategic lever**, and **material alone doesn't decide games** — a player behind on pieces can still win the race to the corner, which keeps games alive.

### 6.3 The Keep

A computer player that valued sealing its own corner was run for 60 games per variant, with sealing detected by the algorithm in §7.6.

| Variant | Games in which a corner got sealed | Sealing side won / drew / lost | All draws in the run |
|---|---|---|---|
| Original | 7 of 60 | 2 / 4 / 1 | 4 |
| 2×2 Corner | 0 of 60 | — | 1 |
| Neutrals | 7 of 60 | 7 / 0 / 0 | 0 |

An earlier Original run that counted only a permanent piece parked on the corner square found 5 sealed games in 60; the sealing side won all 5. Across both Original runs, the sealing side won 7, drew 4 and lost 1 of 12.

What this means for the build:

- **The Keep is real and strong.** Roughly one game in ten reaches it once a player goes looking, and the sealing side almost never loses. Expect human players to discover it and aim for it.
- **In the Original it's the main source of draws**: every draw in that run came from a sealed game, because a sealed corner can turn a lost race into a standoff.
- **The 2×2 Corner effectively removes it** while keeping defensive corner play, since four squares are far harder to seal than one.
- **In Neutrals the sealing side won every sealed game** (7 of 7).
- A seal lasts only as long as its pieces stay put. The engine re-checks `isSealed` after every move rather than remembering it.

### 6.4 Strategy notes

These came out of the simulations and belong in the tutorial, the How-to-play page and the AI's evaluation:

1. **Contact is dangerous.** Stepping next to an enemy piece that beats yours hands the opponent a capture. Approach with the type that beats what's in front of you, or not at all.
2. **Hunt a type.** Each side has only three Rocks and three Scissors. Wipe out all of one enemy type and the pieces it used to threaten become permanent.
3. **Build the Keep.** Once one of your types is permanent, a single one of them on your own corner (Original) ends your risk of losing by the corner.
4. **Count the race.** When nothing can intercept, the runner closer to its goal — counting whose turn it is — arrives first, and king distance makes the count easy. The race meter (§10.5) shows it.
5. **Respect the layers.** Your back Rocks are the answer to their front Scissors. Moving them forward early opens your corner.

### 6.5 Caveats

- This is computer-vs-computer play at shallow depth. It is strong evidence about balance and structure, and weak evidence about fun. Human players will find lines the AI didn't.
- Re-run §9.6 with the shipped AI before launch, and collect real game results after launch to watch for first-player advantage and draw rates.

---

## 7. Architecture and engine

### 7.1 Stack for v1

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, strict mode | One language for engine, AI, app, and the future server |
| App | Vite + React | Small, fast, well known; nothing here needs a framework server |
| Board | SVG | 81 squares and ≤23 pieces: crisp at any size, easy to animate and inspect, accessible |
| Animation | CSS transitions, or Motion for React | Piece moves and captures only |
| Computer player | Web Worker | Search never blocks the board |
| Tests | Vitest, fast-check, Playwright | Unit, property and end-to-end |
| Hosting | Static files on Vercel | No server in v1 |
| Package manager | pnpm workspaces | Engine and AI stay separate packages the server can import later |

Repository layout (this game only):

```text
stone-paper-scissors/
  packages/
    engine/    rules only: no DOM, no timers, no Math.random, no dependencies
    ai/        search and evaluation; depends on engine; runs in a Worker and in Node
  apps/
    web/       the React app
  tools/
    sim/       Node CLI for computer-vs-computer runs (§9.6)
  docs/
    spec.md    this file
```

The one architectural rule that matters: **the engine is pure.** Same state plus same move always gives the same result, state is plain serialisable data, and nothing in the engine knows about screens, clocks or networks. The browser, the AI, the test suite and the future multiplayer server (§13) all run the same engine unchanged.

### 7.2 Data model

```ts
export type Side = 'blue' | 'red';
export type Owner = Side | 'neutral';
export type PieceType = 'rock' | 'paper' | 'scissors';
export type Square = number;                 // 0..80, see §2.1

export interface Piece { owner: Owner; type: PieceType }

export interface Move {
  from: Square;
  to: Square;
  // derived, but carried for display and events:
  piece: Piece;                              // the piece that moves (may be neutral)
  captured: Piece | null;
}

export type GameResult =
  | { winner: Side; reason: 'corner' | 'no-moves' | 'resign' }
  | { winner: null; reason: 'repetition' | 'move-limit' | 'agreed' };

export interface GameState {
  variant: VariantConfig;
  board: Int8Array;                          // 81 cells, encoding below
  turn: Side;
  ply: number;                               // moves made so far
  positionCounts: Map<string, number>;       // for threefold repetition
  result: GameResult | null;
}
```

**Board encoding** (fast, and what the reference engine used): each cell is `0` for empty, otherwise `owner × 4 + type + 1` with owner `blue = 0`, `red = 1`, `neutral = 2` and type `rock = 0`, `paper = 1`, `scissors = 2`.

| Code | 1 | 2 | 3 | 5 | 6 | 7 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|
| Piece | Blue Rock | Blue Paper | Blue Scissors | Red Rock | Red Paper | Red Scissors | Neutral Rock | Neutral Paper | Neutral Scissors |

Keep `GameState` immutable from the app's point of view: `applyMove` returns a new state. Inside the AI's search, a mutable make/unmake version is fine for speed as long as it passes the same tests.

### 7.3 Engine API

```ts
createGame(variant: VariantConfig): GameState
fromFen(fen: string, variant: VariantConfig): GameState      // validates; see §8.2
toFen(state: GameState): string

legalMoves(state: GameState): Move[]                         // [] once the game is over
isLegal(state: GameState, move: Pick<Move, 'from' | 'to'>): boolean
applyMove(state: GameState, move: Pick<Move, 'from' | 'to'>): { state: GameState; events: GameEvent[] }
                                                             // throws IllegalMoveError if not legal
getResult(state: GameState): GameResult | null

moveToText(state: GameState, move: Move): string             // §8.1
parseMove(state: GameState, text: string): Move              // throws on unknown or illegal

typeCounts(state: GameState): Record<Side, Record<PieceType, number>>
isPermanent(state: GameState, square: Square): boolean       // §2.10
isSealed(state: GameState, side: Side): boolean              // §7.6
distanceToGoal(state: GameState, square: Square): number     // king distance to the owner's nearest goal square
positionKey(state: GameState): string                        // board + side to move

replay(variant: VariantConfig, moves: string[]): { state: GameState; events: GameEvent[][] }
```

### 7.4 Move generation

```text
legalMoves(state):
  if state.result: return []
  me  = state.turn
  opp = other(me)
  for each square i with piece P:
    if P.owner == me:                        mover is own piece
    else if P.owner == neutral and variant.neutrals:  mover is a neutral (capture-only)
    else: continue
    for each neighbour j of i:
      T = board[j]
      if T is empty:
        if P is neutral: continue            neutrals never walk (§4.2.2)
        emit move i→j
      else if T.owner == P.owner: continue    own piece, or neutral onto neutral
      else if P is neutral and T.owner == me: continue   a neutral you use can't take your own piece
      else if beats(P.type) == T.type: emit capture i→j
      // anything else is illegal: same type, or T beats P
```

Order moves by origin square, then destination square, whenever order matters (tests and replays). The reference engine produced exactly **36** moves for Blue from the Original start and **35** in Neutrals (§11.3).

### 7.5 Applying a move — order of operations

`applyMove` MUST do these steps in this order:

1. If the game is over or the move isn't in `legalMoves`, throw `IllegalMoveError`.
2. Remove any captured piece from `to`; move the piece from `from` to `to`.
3. `ply += 1`.
4. Emit events: `move`, then `capture` if something was taken, then `type-extinct` for each type whose count just reached zero, then `sealed` for each side whose corner just became sealed.
5. **Corner check.** If the mover's side has a piece on any of its goal squares → result `{ winner: mover, reason: 'corner' }`. Stop. (A neutral move can never trigger this.)
6. Switch `turn`.
7. **No-moves check.** If the new side to move has no legal moves → result `{ winner: previous mover, reason: 'no-moves' }`. Stop.
8. **Repetition.** Increment the count for `positionKey`; at 3 → result `{ winner: null, reason: 'repetition' }`. Stop.
9. **Move limit.** If `ply >= variant.draw.maxPlies` → result `{ winner: null, reason: 'move-limit' }`.
10. If a result was set, emit `game-over`.

The corner check comes first: a move that reaches the goal wins even if it also leaves the opponent with no moves.

`createGame` and `fromFen` MUST record the initial position with count 1, and MUST detect an already-finished position (a side on its goal, or no legal moves for the side to move).

### 7.6 Sealed-corner detection (for the Keep)

```text
isSealed(state, defender):
  attacker = other(defender)
  goal = variant.goals[attacker]                       the defender's corner square(s)
  wall = squares holding a permanent defender piece      (§2.10)
  frontier = every square holding an attacker piece
  breadth-first search from frontier over king moves, never entering a wall square
  if the search reaches any goal square that is not a wall square: return false
  return true                                          (also false if the attacker has no pieces)
```

This treats the attacker's own pieces and the defender's non-permanent pieces as passable, because they can move or be captured. It's cheap: at most 81 squares. The reference implementation used exactly this to measure how often corners got sealed (§6.3).

### 7.7 Events

```ts
export type GameEvent =
  | { type: 'move'; from: Square; to: Square; piece: Piece }
  | { type: 'capture'; at: Square; captured: Piece; by: Piece }
  | { type: 'type-extinct'; side: Side; pieceType: PieceType }   // that side just lost its last piece of a type
  | { type: 'sealed'; side: Side }                               // that side's corner just became unreachable
  | { type: 'game-over'; result: GameResult };
```

The interface animates and announces from events, never by diffing boards. The future server will broadcast the same events.

### 7.8 Randomness

The engine has none. The AI takes a seed and uses a small seeded generator (for example `mulberry32`), so any computer game can be replayed exactly from its seed and move list.

### 7.9 Performance targets

- `legalMoves` on any position: well under 0.1 ms. There are at most about 23 pieces and 8 directions each.
- The reference engine (plain JavaScript, `Int8Array` board, allocation in the search) searched three moves ahead from the opening in about 35 ms on a laptop in Node. A careful TypeScript version should do better.
- The AI MUST return a move within its time budget (§9.4) on a mid-range Android phone.

---

## 8. Notation and records

### 8.1 Moves

Grammar: `[n]<Type><from><sep><to>[#]`

| Part | Meaning |
|---|---|
| `n` | Present only when a neutral piece is used (Neutrals variant) |
| `<Type>` | `R`, `P` or `S` — the type of the piece that moves |
| `<from>`, `<to>` | Square names, e.g. `d4` |
| `<sep>` | `-` for a plain move, `x` for a capture |
| `#` | The move reaches the goal and wins |

Examples: `Sd4-e5` · `Pc4xd5` · `nRe5xf6` (use a neutral Rock to capture on f6) · `Sh8xi9#` (capture onto the corner and win).

Moves are unambiguous from `<from>` and `<to>` alone; the type letter and `n` are for people and for validation. `parseMove` MUST reject text whose type or `n` doesn't match the board.

### 8.2 Positions

A one-line position string, modelled on chess FEN:

```text
<rank 9>/<rank 8>/…/<rank 1> <side to move>
```

- Within a rank, files run `a` to `i`.
- A digit `1`–`9` is that many empty squares.
- Blue pieces are `r p s`, Red pieces `R P S`, neutral pieces `nR nP nS`.
- Side to move is the word `blue` or `red`.

| Variant | Start position |
|---|---|
| Original, 2×2 Corner | `9/4PR3/4SPR2/5SPR1/1ps3SP1/1rps5/2rps4/3rp4/9 blue` |
| Neutrals | `9/4PR3/2nP1SPR2/5SPR1/1ps1nS1SP1/1rps5/2rps1nP2/3rp4/9 blue` |

The variant (goals, neutral rules) is not part of the string; it travels alongside it. `fromFen` MUST reject a rank that doesn't add up to 9 files, an unknown character, a missing side to move, a neutral piece in a variant without neutrals, and more pieces for a side than the variant starts with.

### 8.3 Game record

```json
{
  "game": "stone-paper-scissors",
  "rulesVersion": 1,
  "variant": "neutrals",
  "start": "9/4PR3/2nP1SPR2/5SPR1/1ps1nS1SP1/1rps5/2rps1nP2/3rp4/9 blue",
  "players": { "blue": "human", "red": "computer:medium" },
  "seed": 918273,
  "moves": ["Sd4-d5", "Se7-d6", "Rc3-c2"],
  "result": { "winner": "blue", "reason": "corner" },
  "startedAt": "2026-09-21T10:30:00Z"
}
```

The move list is the source of truth: the full game state is always `replay(variant, moves)`. Saved games, undo, shareable links and — later — the server's match log all use this record.

### 8.4 Shareable links

`/#g=<base64url of the record without players and seed>`. A 140-ply game is about 1 KB of moves before encoding, which fits comfortably in a URL. Opening such a link loads the game in review mode (§10.8).

---

## 9. Computer opponent

### 9.1 Search

- **Negamax with alpha-beta pruning.**
- **Quiescence search** at the leaves: only captures and moves that reach the goal, up to 4 extra plies, with a stand-pat score.
- **Move ordering:** captures first, then moves that bring the moving piece closer to its goal, then the rest. Break ties with the seeded random generator.
- **Terminal scores:** a win is `+1,000,000 − ply` and a loss `−1,000,000 + ply`, so the AI prefers faster wins and slower losses; a draw is 0.
- **Root choice:** score every root move, then pick uniformly at random among moves within `jitter` points of the best. Without this the AI plays the identical game every time.
- **Iterative deepening under a time budget** is recommended for the shipped AI. The reference used fixed depths of 1, 2 and 3 plies.

### 9.2 Evaluation

From the point of view of the side to move. These are the weights the reference AI used for every result in §6:

```text
score  = 100  × (my pieces − their pieces)
       +  70  × (my permanent pieces − their permanent pieces)                    §2.10
       +  28  × (their nearest distance to goal − my nearest distance to goal)
       + 0.35 × ( Σ over my pieces (9 − d)²  −  Σ over their pieces (9 − d)² )     d = distance to goal

Keep terms (on at Medium and Hard):
       + 3000 if my corner is sealed, − 3000 if theirs is                          §7.6
       +  6   × (8 − d) for each of my permanent pieces, d = distance to my own corner
       −  6   × (8 − d) for each of their permanent pieces, d = distance to their own corner
```

- **Distance** is king distance to the nearest square of the relevant goal or corner. (The reference measured to a single corner square; for the 2×2 Corner, the nearest square is the correct choice.)
- **Neutral pieces** are ignored by the evaluation; the search sees their captures anyway.
- The reference's Keep term checked only for permanent pieces standing on the corner squares themselves. Using `isSealed` is strictly better.

### 9.3 Difficulty levels

| Level | Search | Jitter (points) | Keep terms | Target think time on a mid-range phone |
|---|---|---|---|---|
| Easy | 1 ply + quiescence | 60 | Off | ≤ 150 ms |
| Medium | 2 plies + quiescence | 8 | On | ≤ 400 ms |
| Hard | Iterative deepening, at least 3 plies | 2 | On | ≤ 1.2 s |

- The ladder is real: depth 3 beat depth 1 in 53 of 60 games (§6.2).
- Show a "thinking" state for at least 350 ms even when the AI is faster, so moves don't snap in instantly.

### 9.4 Worker protocol

```ts
// app → worker
{ type: 'think', record: GameRecord, level: 'easy' | 'medium' | 'hard', seed: number }
{ type: 'cancel' }

// worker → app
{ type: 'move', move: string, stats: { depth: number; nodes: number; ms: number } }
```

The worker rebuilds the state from the record, so it never holds game state of its own. A new game or an undo sends `cancel` first.

### 9.5 Hints

In games against Easy or Medium, a Hint button MAY ask the worker for a Medium-strength move and highlight it. Hints are off in pass-and-play.

### 9.6 Self-play harness

`tools/sim` is a Node CLI that plays computer-vs-computer games and prints a JSON summary:

```text
pnpm sim --variant original --blue medium --red medium --games 200 --seed 1
→ { "blue": …, "red": …, "draws": …, "reasons": { "corner": …, "no-moves": …, "repetition": …, "move-limit": … },
    "avgPlies": …, "avgCaptures": …, "typeWipedOutRate": …, "firstToWipeOutWins": …, "sealedRate": … }
```

- Use it before any rules change and in CI.
- **CI guard:** at Medium against Medium over 200 games per variant, the first player's share of decisive games stays between 40% and 60%, and draws stay under 10%. Fail the build otherwise.
- The first run of the finished AI should land near the numbers in §6. Large differences point to a rules bug before they point to an AI difference.

---

## 10. Interface and UX

### 10.1 Screens

| Screen | Contents |
|---|---|
| **Home** | Title; three variant cards (mini board, name, one-line description); mode (vs Computer / Pass-and-play); difficulty; side (Blue / Red / Random); How to play; Tutorial; Settings. Remembers the last choices. |
| **Game** | Board; a panel for each player (opponent above the board, you below); type counts; race meter; move list; Undo, Resign, Menu; one status line. |
| **How to play** | Three illustrated rules (move, capture, win), then one card per variant, then the Keep. |
| **Tutorial** | Six short puzzles (§10.9). |
| **Game over** | Overlay on the game screen (§10.7). |
| **Review** | Read-only replay of a finished or shared game (§10.8). |
| **Settings** | Aids on/off (§10.5), coordinates, sound, board flip in pass-and-play, reset stats. |

Variant card copy:

- **Original** — "Ten pieces, king moves, first to the enemy corner."
- **2×2 Corner** — "A bigger target: reach any of four corner squares. Faster games."
- **Neutrals** — "Three pieces belong to nobody. Either player can use one — but only to capture."

### 10.2 Board

- **Orientation:** your own corner sits bottom-left. Playing Red against the computer rotates the board 180°. Pass-and-play keeps one orientation, with an optional "flip each turn" setting that is off by default.
- **Corners:** each corner square is tinted in its owner's colour — Blue's `a1` blue, Red's `i9` red — so each side's goal is the other colour. In the 2×2 Corner variant, tint all four squares of each block. Label them "Goal" in a player's first game.
- **Coordinates** along the edges, `a`–`i` and `1`–`9`, toggleable.
- **Last move:** its origin and destination squares get a soft highlight.
- **Size:** a square board as large as fits: width is the smaller of the viewport width minus 32 px, the space left after the panels, and 640 px. On a 390 px phone that gives squares of about 40 px.

### 10.3 Pieces and art

- **Three silhouettes** that stay distinguishable in greyscale and at 28 px: Rock as a rounded boulder, Paper as a ruled sheet, Scissors as open blades. **Draw original art** — don't reuse meaf's drawings.
- **Owner is never colour alone.** Besides the Blue/Red colour, give each side a second cue that survives greyscale, for example solid fill for Blue and a heavy outline for Red, or a small notch pointing toward the piece's own corner.
- **Neutral pieces** use the same silhouettes in a desaturated ink colour with a dashed ring.
- **Starting colour tokens** (adapt freely): Blue `#3D6FD6`, Red `#D2493C`, Neutral `#7A7F87`, squares `#F4F3EF`, grid `#2B2B2B`. Provide dark-theme equivalents and keep pieces at 3:1 contrast or better against squares.

### 10.4 Moving

- **Tap to select** one of your pieces. Its legal destinations show as dots and its captures as rings. Tap a destination to move; tap the piece again, or empty space, to cancel.
- **Drag and drop** works too, with the same targets shown while dragging.
- **Danger marks:** while a piece is selected, destinations where it could be captured next turn get a small warning mark. This is the single most useful aid in an intransitive game.
- **Explain illegal targets.** Tapping an enemy piece your selected piece can't take shows a short reason — "Paper beats Rock" or "Same type — can't capture" — with a gentle shake and no penalty.
- **Neutrals:** on your turn, a neutral piece with a capture available gets a subtle pulse. Selecting it shows only its capture targets, and the status line reads "Using the neutral Paper — capture a Red Rock". Selecting a neutral with nothing to capture explains "Neutrals only move to capture".
- **Keyboard:** arrow keys move a focus cursor, Enter or Space selects and moves, Esc cancels, `U` undoes, `F` flips the board.
- **Animation:** a moving piece slides for 150 ms; a captured piece shrinks and fades over 150 ms; a winning move makes the corner pulse for 600 ms before the game-over overlay.

### 10.5 Information aids

All on by default, each switchable in Settings.

| Aid | What it shows |
|---|---|
| **Type counts** | Rock, Paper and Scissors counts in each player panel. At 1 the icon turns amber ("last one"). At 0 it's struck through, with the consequence spelled out: "Red has no Paper left — Blue's Rocks are permanent." |
| **Threat lines** | While a piece is selected or hovered: arrows to adjacent enemy pieces it can capture now, and from adjacent enemy pieces that can capture it. |
| **Race meter** | "Nearest runner: 4 moves" in each panel — that side's smallest king distance to its goal, ignoring blockers, labelled "at best". Hovering highlights the runner. |
| **Permanent pieces** | A small shield on any piece that can no longer be captured (§2.10). |
| **The Keep** | When a corner becomes sealed (§7.6): a lock icon on that corner and a panel line such as "Blue's corner is sealed — Red can't win by the corner." |
| **Hint** | vs Easy or Medium only: highlights a suggested move (§9.5). |

### 10.6 Status and announcements

- One status line: "Your move", "Computer is thinking…", "Red captured your Scissors on d4", "Blue reached the corner — Blue wins".
- A polite `aria-live` region announces every move in words: "Blue Scissors d4 to e5." "Red Rock captures Blue Scissors on e5." "Blue uses the neutral Paper to capture Red Rock on d6."

### 10.7 Game over

- The overlay shows the winner and the reason in words — "reached Red's corner", "Red had no legal moves", "the same position three times", "300-ply limit", "resigned" — plus moves played, captures each side, and which types were wiped out and when.
- Buttons: **Rematch** (same settings, sides swapped), **New game**, **Review**, **Copy link**.
- Local stats per variant and difficulty: wins, losses, draws and current streak.

### 10.8 Move list, undo and review

- The move list uses the notation of §8.1, numbered by full moves: `1. Sd4-d5 Se7-d6  2. …`. Tapping a move shows that position read-only.
- **Undo:** against the computer it takes back your move and the computer's reply; in pass-and-play it takes back one ply. Unlimited in v1.
- **Review mode** steps through a game with ← and →, and jumps to the start or end. Shared links (§8.4) open here.

### 10.9 Tutorial

Six puzzles, each verified against the reference engine. Tutorial positions don't need to be full armies.

| # | Teaches | Position | Solution |
|---|---|---|---|
| 1 | Move like a king | `R8/9/9/9/4p4/9/9/9/9 blue` | Any move of the Paper on e5 (8 legal) |
| 2 | Take only what you beat | `9/9/9/3PRS3/4r4/9/9/9/9 blue` | `Re5xf6`. Paper on d6 beats Rock and Rock on e6 is the same type, so neither can be taken. |
| 3 | Reach the corner | `R8/7p1/9/9/9/9/9/9/9 blue` | `Ph8-i9#` |
| 4 | Defend your corner | `9/9/9/9/9/9/2r6/1S7/8P blue` | `Rc3xb2` is the only move that stops Red reaching a1 next turn. |
| 5 | Build the Keep | `9/9/9/4S4/9/9/9/1r7/9 blue` | `Rb2-a1`. Red has no Paper, so a Rock on your own corner can never be removed; show the lock icon. |
| 6 | Win the race | `9/9/6p2/9/9/9/2S6/9/9 blue` | `Pg7-h8`, Red replies `Sc3-b2`, then `Ph8-i9#`. You move first, so you arrive first; `Pg7-h8` is the only move that keeps the lead. |

### 10.10 Accessibility

- Type is shown by silhouette and owner by colour plus a second cue (§10.3); nothing depends on colour alone.
- The whole game is playable by keyboard with a visible focus ring.
- The board is exposed as a grid of labelled cells ("e5, Blue Scissors"); moves are announced (§10.6).
- `prefers-reduced-motion` turns animations into instant changes.
- Text meets WCAG AA contrast.

### 10.11 Layout

- **Phone, portrait:** opponent panel, board, your panel, controls; the move list lives in a drawer.
- **Desktop:** board on the left; panels and move list on the right.
- No horizontal scrolling at 360 px wide.

### 10.12 Sound

A soft tick on a move, a thud on a capture and a chime on a win, with a mute toggle that's remembered.

### 10.13 Local persistence (v1)

- `localStorage` holds settings, the in-progress game record (so a reload resumes the game) and local stats.
- Wrap every read and write in `try`/`catch`; the game MUST work when storage is unavailable.
- There are no accounts in v1.

---

## 11. Testing and acceptance

### 11.1 Rule tests

Write one unit test per row of the table in §2.6, per rule in §4.2, and per ending in §2.7–§2.9: corner by step, corner by capture, entering your own corner, no legal moves, threefold repetition (counting the start position), and the 300-ply limit.

### 11.2 Fixture vectors

Produced by the reference engine. For each vector: load `fen` with the named variant, check that `legalMoves` equals `legal` **compared as a set**, then, if `play` is present, apply it and check `result` (`null` means the game continues) and `fenAfter`. `resultBeforeMoving` means the position is already over when loaded.

```json
[
  { "name": "capture-legality", "variant": "original",
    "fen": "9/9/9/3PRS3/4r4/9/9/9/9 blue",
    "legal": ["Re5-d4", "Re5-d5", "Re5-e4", "Re5-f4", "Re5-f5", "Re5xf6"] },
  { "name": "corner-by-step", "variant": "original",
    "fen": "R8/7s1/9/9/9/9/9/9/9 blue",
    "legal": ["Sh8-g7", "Sh8-g8", "Sh8-g9", "Sh8-h7", "Sh8-h9", "Sh8-i7", "Sh8-i8", "Sh8-i9#"],
    "play": "Sh8-i9#", "result": {"winner": "blue", "reason": "corner"} },
  { "name": "corner-by-capture", "variant": "original",
    "fen": "R7P/7s1/9/9/9/9/9/9/9 blue",
    "legal": ["Sh8-g7", "Sh8-g8", "Sh8-g9", "Sh8-h7", "Sh8-h9", "Sh8-i7", "Sh8-i8", "Sh8xi9#"],
    "play": "Sh8xi9#", "result": {"winner": "blue", "reason": "corner"} },
  { "name": "own-corner-entry-allowed", "variant": "original",
    "fen": "9/7R1/9/9/9/9/9/9/s8 red",
    "legal": ["Rh8-g7", "Rh8-g8", "Rh8-g9", "Rh8-h7", "Rh8-h9", "Rh8-i7", "Rh8-i8", "Rh8-i9"],
    "play": "Rh8-i9", "result": null, "fenAfter": "8R/9/9/9/9/9/9/9/s8 blue" },
  { "name": "keep-blocks-entry", "variant": "original",
    "fen": "8R/7s1/9/9/9/9/9/9/9 blue",
    "legal": ["Sh8-g7", "Sh8-g8", "Sh8-g9", "Sh8-h7", "Sh8-h9", "Sh8-i7", "Sh8-i8"] },
  { "name": "no-legal-moves-loses", "variant": "original",
    "fen": "sR7/RR7/9/9/9/9/9/9/8P blue",
    "legal": [],
    "resultBeforeMoving": {"winner": "red", "reason": "no-moves"} },
  { "name": "neutral-capture-only", "variant": "neutrals",
    "fen": "R8/9/9/5S3/4nR4/3s5/9/9/9 blue",
    "legal": ["Sd4-c3", "Sd4-c4", "Sd4-c5", "Sd4-d3", "Sd4-d5", "Sd4-e3", "Sd4-e4", "nRe5xf6"],
    "play": "nRe5xf6", "result": null, "fenAfter": "R8/9/9/5nR3/9/3s5/9/9/9 red" },
  { "name": "capture-a-neutral", "variant": "neutrals",
    "fen": "R8/9/9/9/4nR4/3p5/9/9/9 blue",
    "legal": ["Pd4-c3", "Pd4-c4", "Pd4-c5", "Pd4-d3", "Pd4-d5", "Pd4-e3", "Pd4-e4", "Pd4xe5"],
    "play": "Pd4xe5", "result": null, "fenAfter": "R8/9/9/9/4p4/9/9/9/9 red" },
  { "name": "neutral-on-goal-square", "variant": "neutrals",
    "fen": "R7nP/7sr/9/9/9/9/9/9/9 blue",
    "legal": ["Ri8-h7", "Ri8-h9", "Ri8-i7", "Sh8-g7", "Sh8-g8", "Sh8-g9", "Sh8-h7", "Sh8-h9", "Sh8-i7", "Sh8xi9#"],
    "play": "Sh8xi9#", "result": {"winner": "blue", "reason": "corner"} },
  { "name": "2x2-not-in-original", "variant": "original",
    "fen": "R8/9/6s2/9/9/9/9/9/9 blue",
    "legal": ["Sg7-f6", "Sg7-f7", "Sg7-f8", "Sg7-g6", "Sg7-g8", "Sg7-h6", "Sg7-h7", "Sg7-h8"],
    "play": "Sg7-h8", "result": null, "fenAfter": "R8/7s1/9/9/9/9/9/9/9 red" },
  { "name": "2x2-goal-square", "variant": "corner2x2",
    "fen": "R8/9/6s2/9/9/9/9/9/9 blue",
    "legal": ["Sg7-f6", "Sg7-f7", "Sg7-f8", "Sg7-g6", "Sg7-g8", "Sg7-h6", "Sg7-h7", "Sg7-h8#"],
    "play": "Sg7-h8#", "result": {"winner": "blue", "reason": "corner"} }
]
```

### 11.3 Opening moves and move counts

Blue's 36 legal first moves in the Original and 2×2 Corner:

```text
Pb5-a4  Pb5-a5  Pb5-a6  Pb5-b6  Pb5-c6  Pc4-b3  Pc4-d5  Pd3-c2  Pd3-e4
Pe2-d1  Pe2-e1  Pe2-f1  Pe2-f2  Pe2-f3  Rb4-a3  Rb4-a4  Rb4-a5  Rb4-b3
Rc3-b2  Rc3-b3  Rc3-c2  Rd2-c1  Rd2-c2  Rd2-d1  Rd2-e1  Sc5-b6  Sc5-c6
Sc5-d5  Sc5-d6  Sd4-d5  Sd4-e4  Sd4-e5  Se3-e4  Se3-f2  Se3-f3  Se3-f4
```

In Neutrals Blue has the same list minus `Sd4-e5` (35 moves), because the neutral Scissors on e5 can't be taken by Scissors.

**Perft** — the number of distinct move sequences of length *n* from the start position. A move that ends the game counts at its own depth and isn't expanded; repetition and the move limit are ignored. No game can end within four plies of these starts, so those details don't affect these numbers.

| Variant | 1 ply | 2 plies | 3 plies | 4 plies |
|---|---|---|---|---|
| Original | 36 | 1,293 | 52,758 | 2,146,591 |
| 2×2 Corner | 36 | 1,293 | 52,758 | 2,146,591 |
| Neutrals | 35 | 1,225 | 48,377 | 1,908,941 |

A mismatch here almost always means a bug in move generation. Compare move lists position by position to find it.

### 11.4 Property tests

With fast-check, over random legal move sequences in every variant:

- Every square holds at most one piece, and piece counts never increase.
- Every move `legalMoves` returns is accepted by `applyMove`, and everything else is rejected.
- A finished game has no legal moves, and `applyMove` on it throws.
- `fromFen(toFen(state))` reproduces the state, and `parseMove(moveToText(m))` reproduces the move.
- `replay(variant, moves)` reproduces the state reached by applying the moves one by one.
- A neutral piece never moves to an empty square, never captures its user's pieces or another neutral, and never produces a `corner` result.
- `isSealed` never reports a side as sealed while an attacker piece has an unblocked king path to the goal.

### 11.5 Simulation checks

- **1,000 random-vs-random games per variant:** every game ends by a result or the move limit, and no invariant from §11.4 breaks.
- **The balance guard from §9.6** runs in CI.

### 11.6 End-to-end tests (Playwright)

- Select, move, capture and win a full scripted game in each variant.
- Illegal target shows its reason, and the board doesn't change.
- Undo against the computer takes back two plies; in pass-and-play, one.
- Use a neutral to capture; confirm a neutral with nothing to capture can't be moved.
- Reload mid-game resumes the same position.
- A shared link opens the game in review mode.
- A complete game played with the keyboard alone.
- Phone viewport of 390 × 844: no horizontal scroll, and the board fills the width.

### 11.7 v1 acceptance checklist

- [ ] Engine passes §11.1–§11.4, including every fixture vector and every perft number.
- [ ] Computer-vs-computer results land near §6, and the §9.6 guard passes for all three variants.
- [ ] All three variants are playable against the computer at three levels and in pass-and-play.
- [ ] Hard never takes more than 1.2 s per move on a mid-range Android phone.
- [ ] Every aid in §10.5 works and can be switched off.
- [ ] All six tutorial puzzles work.
- [ ] Undo, review, shareable links and resume-after-reload work.
- [ ] Keyboard play, screen-reader announcements and reduced motion work.
- [ ] No horizontal scrolling at 360 px.

---

## 12. Build plan for v1

Each milestone ends in something that runs. Don't start one until the previous milestone's "done when" holds.

| # | Build | Done when |
|---|---|---|
| M1 | Engine: rules, position notation, move notation, events, `isSealed` | §11.1–§11.4 green, perft matches |
| M2 | AI and the `tools/sim` harness | Balance runs land near §6 for all three variants |
| M3 | Board UI and pass-and-play, Original only | Two people can finish a game on one phone |
| M4 | Play against the computer: worker, three levels, undo | Hard stays inside its time budget on a phone |
| M5 | 2×2 Corner and Neutrals, and the variant picker | All three variants playable both ways |
| M6 | Information aids (§10.5) | Each aid on and off, correct in the fixture positions |
| M7 | How to play and the tutorial | A new player finishes all six puzzles |
| M8 | Sound, animation, accessibility, persistence, review and share links | §11.6 passes |
| M9 | Release | §11.7 fully ticked; deployed |

---

## 13. The future: designed for, not built in v1

### 13.1 What v1 must already get right

These cost almost nothing now and make everything below cheap:

- The engine is pure and deterministic, with plain serialisable state (§7.1).
- The move list is the source of truth, and every record carries `rulesVersion` (§8.3).
- Variants are data (§5); new modes are new configurations plus small engine hooks.
- Results carry a reason code; the engine has no timers, so clocks can live on a server later.
- The AI lives behind a message protocol (§9.4) that a server-side bot can reuse.

### 13.2 Online play in real time

- **Model:** one server-authoritative room per match. Players send the move they want; the room checks it with the same engine package, applies it, and broadcasts the events to both players and any spectators.
- **Recommended platform:** Cloudflare Durable Objects — one object per match, with WebSocket Hibernation. Every player in a match connects to the same object, which handles messages one at a time, so two moves can never race. Save the record to the object's own storage after every move, because memory resets when a hibernating object wakes, and run clocks on Durable Object alarms rather than timers so rooms can still sleep. The free plan covers early usage; WebSocket messages bill at 20 incoming messages per request ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).
- **Alternatives considered:** [Vercel WebSockets](https://vercel.com/docs/functions/websockets) are in beta, players in one match may reach different instances (so rooms need Redis), and connections close at the function's maximum duration ([300 s on Hobby, 800 s on Pro](https://vercel.com/docs/functions/limitations)). Supabase Realtime Broadcast relays messages but holds no authoritative game logic. Colyseus on a rented server works but has to be run and scaled by hand.

**Messages** (JSON over WebSocket):

```ts
// client → room
{ t: 'hello', matchId: string, token: string, lastPly: number }
{ t: 'move', ply: number, move: string }          // ply = the ply this move is meant to be
{ t: 'resign' } | { t: 'draw-offer' } | { t: 'draw-accept' } | { t: 'draw-decline' } | { t: 'ping' }

// room → client
{ t: 'welcome', record: GameRecord, clocks: Clocks, you: 'blue' | 'red' | 'spectator' }
{ t: 'moved', ply: number, move: string, events: GameEvent[], clocks: Clocks }
{ t: 'rejected', ply: number, reason: string }
{ t: 'result', result: GameResult }
{ t: 'presence', blue: 'online' | 'away', red: 'online' | 'away' }
{ t: 'draw-offered', by: 'blue' | 'red' } | { t: 'pong', serverTime: number }
```

- **Idempotent moves:** a move carries the ply it's meant for; the room rejects stale or duplicate plies. On reconnect, `hello.lastPly` tells the room which moves to resend.
- **Clocks:** the server keeps them. Offer time controls such as 3 minutes plus 2 seconds a move; the client displays server time adjusted for latency.
- **Leaving:** a disconnected player's clock keeps running. In casual games the opponent may claim the win after 60 seconds away.
- **First online feature:** "play a friend by link", with no accounts. Create a match, share the link, and the second person to open it takes the other side.

### 13.3 Accounts and ratings

- **Supabase Auth and Postgres.** Accounts are optional until a player wants a rating.
- **Tables:**

| Table | Columns |
|---|---|
| `profiles` | `id`, `handle`, `created_at` |
| `games` | `id`, `variant`, `rules_version`, `rated`, `blue_user`, `red_user`, `record` (jsonb), `winner`, `reason`, `plies`, `started_at`, `ended_at` |
| `ratings` | `user_id`, `variant`, `time_control`, `rating`, `rd`, `volatility`, `games`, `updated_at` |
| `rating_history` | `game_id`, `user_id`, `rating_before`, `rating_after` |

- **Glicko-2**, with separate ratings per variant and per time-control bucket. Start at 1500 with deviation 350 and volatility 0.06; show a rating as provisional ("1540?") while its deviation is above 110.
- **Only the room updates ratings,** once, at the end of a rated game between two accounts. Clients never write ratings.
- **Leaderboards** per variant, with a minimum number of rated games to appear.

### 13.4 Matchmaking

- One queue per variant and time control. Pair players within a rating window that widens the longer they wait.
- After 30 seconds without a match, offer a computer opponent.

### 13.5 Archive, replays and analysis

- Every finished online game gets a page at `/g/<id>` that opens in review mode.
- Analysis runs in the browser's AI worker, so it costs no server time.

### 13.6 More modes

Each of these should be a `VariantConfig` plus a small engine hook, never a second engine.

| Mode | Idea | What we know |
|---|---|---|
| **Secret setup** | Each side arranges its 10 pieces on its own 10 starting squares in secret; both reveal together. | Random arrangements tested balanced: 55 to 65 over 120 games. |
| **Crazyhouse** | Captured pieces join your reserve, type intact; drop one on an empty square instead of moving. | Untested. Start with drops at least three king-steps from the enemy corner, so a drop can never win outright. |
| **Bughouse** | Two boards, two teams; your captures go to your partner's reserve. | Both boards must live in one room so a capture and the partner's reserve change together — the Durable Object design already allows this. |
| **Horde** | A larger army against the standard 10. | The Horde must keep all three types; without one, the Army's pieces of the type it would capture become permanent and can wall off the Army's corner. |
| **Fog** | Enemy types hidden until contact; moving onto an enemy piece reveals both and resolves like Stratego. | Untested. |

### 13.7 Trust and safety

- The server validates every move; clients are never trusted.
- Rate-limit match creation, joins and moves.
- Start with preset messages ("Good game", "Rematch?") instead of free chat.
- Detecting engine assistance is out of scope at first.

---

## 14. Open questions for the owner

1. **Name and art.** The game needs its own name and look before launch.
2. **Default variant** on first launch. Original is the natural choice.
3. **Neutrals plus 2×2 Corner as a fourth option?** It tested balanced (§5).
4. **Keep standoffs.** When both corners are sealed, neither side can win by the corner and the game drifts to a repetition or the 300-ply limit. One option is to end the game at once and award it on piece count. This is untested.
5. **Aids at Hard.** Show the permanent-piece shields and the Keep lock at every level, or let strong players find them?
6. **A note to meaf.** The base rules are theirs. Crediting them and saying hello before launch costs nothing.

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **Corner** | A side's home square: `a1` for Blue, `i9` for Red (a 2×2 block in the 2×2 Corner variant). |
| **Goal** | The corner a side must reach: the opponent's corner. |
| **Type** | Rock, Paper or Scissors. |
| **Predator** | The type that beats a given type: Paper for Rock, Rock for Scissors, Scissors for Paper. |
| **Permanent piece** | A piece whose predator type the opponent has lost entirely (and, in Neutrals, no neutral of that type remains), so nothing can capture it. |
| **Sealed corner / the Keep** | A corner the opponent can no longer reach, because every path runs through the defender's permanent pieces. |
| **Neutral piece** | A piece owned by nobody (Neutrals variant) that either player may use, only to capture. |
| **Ply** | One move by one player. Two plies make a full move. |
| **Perft** | A count of move sequences to a fixed depth, used to test move generation. |

## Appendix B — Provenance

- **Base rules:** meaf's *rps2*, from its How-to-play screen: king moves, Rock takes Scissors and so on, reach the enemy's zone to win, Blue first. The starting layout was read square by square from a screenshot of the game.
- **Added by this spec:** the draw rules, the no-moves rule, position and move notation, the 2×2 Corner and Neutrals variants, and every number in §6 and §11.
- **Reference engine:** a quick JavaScript prototype written to run the simulations. It is not production code, and the build should not copy it. It was checked against every vector in §11.2.
- **Our own work only:** the name, art and code of this game must be original. Game rules generally aren't protected by copyright, but meaf's name, drawings and code are.
