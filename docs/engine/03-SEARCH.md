# Plan — the search

> Fixes `01-DIAGNOSIS.md` §3 and §5. Target: effective branching factor from
> **14.3 down to about 7**, which is roughly two extra plies at the same time
> budget — before the speed work in `04-SPEED.md` adds its own.

Everything here is standard chess-engine machinery. Two of the standard
techniques are **actively dangerous in this game** and are called out as such.

---

## The order to build it in

Each row assumes the ones above it. The right-hand column is what chess engines
typically see; treat them as direction, not promises, and measure
(`06-MEASUREMENT-AND-LEVELS.md`).

| # | Change | Why here | Typical gain |
|---|---|---|---|
| 1 | **PV move first in iterative deepening** | Currently absent entirely. Free. | Large |
| 2 | **Transposition table** (Zobrist) | King moves transpose constantly | Large |
| 3 | **Killer moves + history heuristic** | Ordering for quiet moves | Large |
| 4 | **Principal Variation Search** | Only pays off once 1–3 land | ~10% nodes |
| 5 | **Quiescence: threat evasions** | The correctness fix | Strength, not speed |
| 6 | **Capture ordering by extinction value** | Game-specific | Moderate |
| 7 | **Aspiration windows** | Cheap once the PV is stable | Moderate |
| 8 | **Late move reductions** | The big one, and the riskiest | Very large |
| 9 | **Repetition detection** | Correctness | — |
| 10 | **Time management** | Uses the depth you bought | Moderate |

---

## 1. Use the previous iteration. *(start here)*

`chooseMove` orders the root moves **once** and then re-searches that same static
order at every depth:

```ts
const moves = orderMoves(context, unordered, state.turn);  // ordered once, statically
reached = config.minDepth;
scores = scoreRootMoves(context, moves, reached, config.jitter);
for (let depth = reached + 1; !context.aborted; depth++) { … }   // same order, every time
```

The whole point of iterative deepening is that depth *n* hands depth *n+1* a
near-perfect first guess. The Chess Programming Wiki puts "PV move from the
previous iteration" at the very top of its move-ordering list, above even the
hash move, and notes that **over 90% of fail-high nodes cut on the first move
tried.** We are searching depth 4 as if we had never searched depth 3.

**Do:** after each completed iteration, re-sort the root moves by the scores that
iteration produced. It is three lines and it is the cheapest win in this
document.

**Also fix while you are there:** if the very first (minimum-depth) iteration
aborts on time, its partial scores are used anyway. `negamax` returns its
running `best` when it breaks out of the loop on `outOfTime`, which is not a real
score. The minimum-depth iteration must be allowed to finish — it is the only
guarantee that a move comes back at all.

---

## 2. Transposition table

**Why this game more than chess.** Every piece moves like a king and there is no
piece-specific geometry, so *move orders commute constantly*: A-then-B and
B-then-A reach the identical position whenever the two moves do not touch. In
chess, castling rights, en passant and pawn structure break many of those
equivalences. Here almost nothing does. The transposition rate should be high.

**Zobrist keys.** 81 squares × 6 piece kinds (2 owners × 3 types) + 3 more for
neutrals = 84 × 81 random 64-bit values, plus one for side-to-move. In
JavaScript, use two `Uint32Array` halves rather than `BigInt` — `BigInt` XOR is
an allocation per operation and will cost more than the table saves. Update the
key incrementally in `make`/`unmake`, exactly where the board is already being
mutated.

**Entries** hold: key (or its high bits), depth, score, bound type
(exact / lower / upper), and **best move**. The best move is half the value: even
an entry too shallow to cut on still tells you what to try first.

**Three pitfalls, all real here:**

* **Path dependence.** Threefold repetition (§2.9) and the 300-ply limit depend on
  *how* you reached a position, not just the position. Two boards that hash
  identically can be a draw down one path and not down another. The standard
  answer: do not let a draw-scored entry cut a node whose path differs, and never
  take TT cutoffs at PV nodes. See §9 below.
* **The score's frame of reference.** `evaluate` is from the side to move's point
  of view (§9.2) and win scores are `±1,000,000 ∓ ply`. Mate-style scores must be
  stored relative to the node, not the root, or a win-in-3 stored at one depth
  will read as a win-in-3 at another. Chess engines get this wrong constantly.
* **Replacement.** Start with two buckets per slot — one depth-preferred, one
  always-replace — which is what most engines settle on anyway.

**Size.** A few megabytes. This runs in a browser worker; do not allocate 256 MB.
Allocate once, reuse across moves within a game, clear on a new game or an undo
(the worker already receives `cancel` for both, §9.4).

---

## 3. Killer moves and history

Ordering quiet moves is where the branching factor actually lives, because
captures are a small minority of the ~45 legal moves.

* **Killers:** two slots per ply, holding quiet moves that caused a beta cutoff
  at the same distance from the root. Try them straight after captures.
* **History:** a `[side][from][to]` table — 2 × 81 × 81, trivially small — scored
  `+= depth × depth` on a cutoff, with a penalty for quiet moves that were
  searched and failed. Use history-gravity (scale the update by how *unexpected*
  the cutoff was, and clamp) so the table does not saturate over a long game.
* **Counter-moves** are a cheap third table if the first two pay off.

The one to add after those is game-specific: **a "this move escapes a threat"
bonus**, computed from the threat information `02-EVALUATION.md` already builds.
In a game where the defensive resource is nearly always *running away*, escapes
deserve to be ordered with captures, not with quiet moves.

---

## 4. Principal Variation Search

Search the first move with the full window; search everything after it with a
null window (`alpha, alpha+1`) and re-search fully only if it beats alpha. Worth
about 10% of nodes **when ordering is good**, and nothing at all when it is bad —
which is why it belongs after 1–3, not before them.

Note there is already a partial version of this at the root:

```ts
const alpha = best === -Infinity ? -Infinity : best - jitter - 1;
```

That is a sound trick and the comment explaining it is good. Once real PVS exists
it should be folded into it rather than kept as a separate mechanism, and the
`jitter` move-choice should then read exact scores from the last completed
iteration rather than a mixture of scores and bounds.

**Make everything fail-soft.** `negamax` returns its true `best` (fail-soft);
`quiesce` returns `alpha`/`beta` (fail-hard). Mixed conventions work but throw
away information a transposition table would have stored. Pick fail-soft
everywhere.

---

## 5. Quiescence search — the correctness fix — SHIPPED

**Status: implemented**, alongside `02-EVALUATION.md` Term 1 — this is its
search half, and the two only work together: pricing a hang in `evaluate()`
without ever searching the move that fixes it just makes the search correctly
pessimistic, not better.

Today `quiesce` searches **only captures**. Its stand-pat says *"assume the side
to move can decline to act."* The Chess Programming Wiki is blunt about when that
assumption fails: **stand-pat is not allowed when in check**, because there may
be no move at all that reaches alpha.

This game has no check. It has the exact structural equivalent: **a piece of mine
is attacked and cannot be recaptured.** Treat that as the analogue and the fix
writes itself:

* If the side to move has a piece attacked-and-undefended, **forbid stand-pat**
  and search evasions as well as captures — the moves that take that piece to a
  square nothing attacks. Cap this at one or two plies of qsearch so it cannot
  explode.
* Otherwise, stand pat as now.

**Shipped as designed, with one simplification.** `hangingSquaresOf()` finds the
mover's own attacked-and-undefended squares (a one-line reuse of the same
`threatenedBy`/`defendersOf` pair the evaluation term uses); `evasions()` filters
the already-generated move list down to quiet moves off those squares that land
somewhere `dangerAfter()` says is safe, and only those get added to the tactical
list — captures stay exactly as before. The early `standPat >= beta` cutoff is
skipped when a hang exists (so the position can't be dismissed before an escape
is even tried); `alpha = standPat` is still set unconditionally, so the priced
score still stands as the fallback if no escape or capture actually helps. No
separate ply cap was added: it rides the existing `QUIESCENCE_MAX_PLIES` budget
rather than a second counter, which keeps one thing to reason about instead of
two — worth revisiting only if profiling ever shows it needs its own limit.

Also add, in rough order of value:

* **Delta pruning.** If stand-pat plus one piece (100) plus a margin still cannot
  reach alpha, stop. Cheap, standard, safe.
* **Bad-capture pruning.** Once `exchangeOn()` from `02-EVALUATION.md` exists,
  skip captures it says lose material — unless they escape a bigger threat.
* **Order the captures.** `quiesce` currently calls `orderMoves` on the tactical
  list only, which is right, but that ordering treats all captures as equal —
  see §6.

---

## 6. Order captures by what they actually do

`orderMoves` gives every capture the flat key `1_000`. In chess this slot is
MVV-LVA — take the most valuable victim with the least valuable attacker. Here
every piece is worth the same, so MVV-LVA has nothing to sort on. But
`02-EVALUATION.md` Term 3 gives us the right sort key instead:

1. Winning the game (already `10_000`).
2. **A capture that takes the enemy's last piece of a type** — this makes every
   one of your pieces of the corresponding type permanent, forever (§2.10), and
   §6.2 says the side that first wipes out a type wins 65% of the games where it
   happens. This is the most important capture in the game and it is currently
   ordered in board order.
3. Captures that reduce an enemy type to one remaining.
4. Captures with a non-negative `exchangeOn()`.
5. Moves that escape a threat.
6. Killers, then history.
7. Everything else, by progress toward the goal (as now).
8. Losing captures.

---

## 7. Aspiration windows

Start each iteration with a narrow window around the previous iteration's score
(±50 is a reasonable first guess here, given a piece is 100) and re-search wider
on a fail-high or fail-low. Cheap, and it compounds with everything above.

---

## 8. Late move reductions — the big one, handled carefully

Search the first two or three moves at full depth; search the rest reduced, and
re-search at full depth only if a reduced search beats alpha. The wiki says LMR
"can often reduce the effective branching factor to less than 2." With ~45 moves
a node and a 14× branching factor, this is the single largest structural gain
available.

**Never reduce**, in this game:

* Captures — especially any capture that reduces an enemy type toward extinction.
* Moves that escape an attacked-and-undefended piece. This is the analogue of
  chess's "never reduce a check evasion," and skipping it would re-create exactly
  the blindness we are fixing.
* Moves by the nearest runner, or any move that shortens the race — the analogue
  of chess's passed-pawn-push exclusion.
* Killers and high-history moves.
* Anything at depth < 3, or at a PV node.

---

## 9. Two things chess does that we must not copy

**Null-move pruning: do not.** The idea is "let the opponent move twice; if I am
still fine, this branch is safe to ignore." It relies on the *null-move
observation*: passing is never better than your best legal move. In chess that
fails only in zugzwang, which is why engines disable it in pawn endings.

In **this** game, zugzwang is not an exception — it is a rule of play:

* §2.4: there is **no passing**. Every turn is a move.
* §2.8: having **no legal move is a loss**, outright.
* §2.10 and `canHoldSeal()`: a Keep held by a side's only piece is *forced open on
  their own turn*. The engine already has a dedicated function whose entire
  reason to exist is that there is no passing — its comment says a position that
  merely looks sealed "can be one move from losing."

A game whose win conditions include "you ran out of moves" is a game where the
null-move observation is false often enough to matter. If it is ever tried, it
needs verification search and it must be off entirely in low-piece positions —
and honestly, the LMR in §8 gets most of the same benefit without the risk.

**Static null move / reverse futility pruning: with care.** Same assumption,
weaker form. Safe in the middlegame with a healthy piece count; gate it on
mobility being comfortably above the smother threshold from
`02-EVALUATION.md` Term 4.

---

## 10. Repetition, inside the search

`search.ts` says it plainly:

> *Repetition is not tracked inside the search: the reference engine didn't
> either, and a shallow search cannot see one.*

That was a fair call at depth 3. At depth 6–8 it is not: the AI will shuffle in
won positions, will not steer *towards* a draw when losing, and — once a
transposition table exists — will mix up drawn and non-drawn paths to the same
board.

The cheap and standard fix: keep a small stack of position keys along the current
search path and score **any** repetition along that path as a draw (0), not just
the third. Chess engines have done it that way for decades; it costs one array
lookup per node and is more accurate than waiting for the third occurrence,
because a line that repeats once will repeat again if both sides are happy with
it. `positionKey()` already exists in the engine; the Zobrist key from §2 makes
it free.

---

## 11. Time management

`chooseMove` currently: runs the minimum depth, then loops deeper until
`Date.now() >= deadline`, discarding any iteration that does not finish. That is
the right skeleton. What is missing:

* **A soft bound and a hard bound.** Soft (~60% of budget) is checked *between*
  iterations: do not start depth *n+1* if the branching factor says it cannot
  finish. Hard is checked inside the search. Today an iteration is started with
  1 ms left and thrown away, wasting the whole overshoot.
* **Spend more when the PV is unstable.** If the best move changed at the last
  iteration, or the score dropped sharply, the position deserves more time. If
  the same move has been best for three iterations, return early and give the
  time back.
* **One legal move: return immediately.** Free, and it happens in endgames.
* The node check `(context.nodes & 1023) !== 0` is fine now (40 µs × 1024 ≈ 40 ms
  of granularity) but after `04-SPEED.md` a node costs ~6 µs and the check should
  move to every 4096 nodes to stop `Date.now()` showing up in the profile.

**Keep determinism.** §7.8 and the replay contract require that the same
position, level and seed give the same move — `tools/sim`, the fixtures and every
shared game depend on it. Anything driven by wall-clock time is not
reproducible. Either give `chooseMove` an explicit node budget instead of a time
budget for reproducible contexts (sim, tests) and keep the time budget for
interactive play, or record the depth reached in the game record. **Decide this
before building, not after** — it is the kind of thing that quietly breaks the
test suite three milestones later.

---

## What to expect

| After | Effective branching factor | Depth at Hard, 1.2 s |
|---|---|---|
| Today | 14.3 | 3–4 |
| Steps 1–3 | ~8 | 5 |
| Steps 1–7 | ~7 | 5–6 |
| Steps 1–8 | ~5 | 6–7 |
| …with `04-SPEED.md` on top | ~5 | **7–8** |

The usual rule of thumb in chess is 50–70 Elo per ply in this depth range. Here
the evaluation fixes in `02-EVALUATION.md` are worth more than any of it, because
the current evaluation is missing the most important fact on the board.
