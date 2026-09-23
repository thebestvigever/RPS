# Diagnosis — what is actually wrong with the computer opponent

> Measured on this machine (Apple M-series, Node 26) against the code as it
> stands at commit `b74046b`. Every number here is reproducible; the scripts are
> at the bottom. Nothing in this file is an opinion.

Vig's report: *"I beat Hard easily, and it doesn't defend — it doesn't notice
when I have a piece moving in to capture."*

That report is correct, and the cause is not what you would guess. It is not
mainly that the search is shallow. **The evaluation function cannot see a
threat at all.** Depth is the second problem, and speed is the third.

---

## 1. The evaluation is threat-blind

This is the headline. Two positions, red to move, red Scissors on `e5`:

| Position | `evaluate()` says |
|---|---|
| Blue Rock on `d4` — adjacent, and Rock beats Scissors, so it is captured next move for free | **−68.85** |
| Blue Rock on `c3` — one step further back, no threat whatever | **−44.40** |

The threatened position scores **24 points better for Blue** — but check where
those 24 points come from. Every one of them is the distance and permanence
bookkeeping in §9.2 noticing that the Rock on `d4` is one square closer to its
own goal and one square closer to its own corner. Work it through:

```text
d4:  28 × (5 − 4) + 0.35 × (25 − 16) − 6 × (8 − 3)  =  28 + 3.15 − 30
c3:  28 × (6 − 4) + 0.35 × (25 −  9) − 6 × (8 − 2)  =  56 + 5.60 − 36
```

The arithmetic closes exactly. **Not one point of that difference is "a piece
is about to be taken."** Move the Rock to a square that is the same distance
from its goal but no longer adjacent, and the score does not move at all.

`packages/ai/src/evaluate.ts` has five terms — material, permanence, nearest
distance, advancement, and the Keep terms. None of them reads an adjacent
square. The engine already exposes `threatenedBy()` and `dangerAfter()` in
`packages/engine/src/analysis.ts`; they were written for the interface's threat
lines in §10.5 (M6) and **the AI has never called either of them.**

### Why that is worse than it sounds

Quiescence search (§9.1) leans on the *stand-pat* score: at a leaf, assume the
side to move can decline to do anything and is at least as well off as the
static evaluation says. The Chess Programming Wiki is explicit that this
assumption collapses when the side to move is in check — you cannot stand pat
when something is hanging over you.

This game has no check. What it has instead is *"one of my pieces is adjacent to
its predator and nothing can recapture."* That is the same kind of fact, and the
search treats it as quiet. So at **every single leaf**, a position where three of
the AI's pieces are one move from being taken for free scores exactly the same
as one where nothing is in danger.

The search does see threats inside its depth — that is why the AI is not a
complete pushover. It stops seeing them the instant they fall past the horizon,
and because captures here are cyclic rather than a value ladder, the horizon
lands in the middle of tactics constantly.

---

## 2. How much it costs, in games

Self-play, Original variant. For every move, count whether the mover left a piece
adjacent to an enemy predator *with no recapture available on that square* — a
piece that can simply be taken.

| Level | Moves | Left a piece hanging **for free** | Already had a piece hanging, and ignored it |
|---|---|---|---|
| Medium | 360 | 50 (**13.9%**) | 42 of 78 (**54%**) |
| Hard | 165 | 54 (**32.7%**) | 35 of 47 (**74%**) |

Read the second column first: **in three out of four positions where Hard
already had a piece it could lose for nothing, it played somewhere else.**

Hard being *worse* than Medium is not a paradox. Hard searches deeper, so it
pushes harder and makes more contact, and every extra contact is another threat
its evaluation cannot price. A deeper search on a blind evaluation walks
confidently into more trouble, not less. (These are AI-vs-AI games, so both
sides are equally blind and the games still look reasonable. A human who *can*
see the threats collects the difference — which is exactly Vig's experience.)

### More depth does not fix it

The obvious objection to §1 is that the search should *see* a threat even if the
evaluation cannot describe one, and that Hard just needs to look further. It
does not. Twelve self-play positions where the side to move had a piece it could
lose for nothing, each analysed at depth 4 (what Hard actually reaches) and at
depth 5 (which cost **37–115 seconds a position**, thirty to ninety times Hard's
whole budget):

```text
depth 4 rescued the piece in  5 of 12
depth 5 rescued the piece in  4 of 12
```

**One extra ply, bought at ninety times the cost, made it slightly worse.** That
is what an evaluation problem looks like. Seven of those twelve positions are the
same Blue Scissors on `h1` on seven consecutive plies — the engine walked past it
every single time, at both depths, and never came back for it.

If the fix were depth, the rest of this folder would be a performance exercise.
It is not.

---

## 3. The search is shallower than the spec assumes

§9.3 asks Hard for "iterative deepening, at least 3 plies" in 1.2 s. What it
actually reaches:

| Position | Depth reached in 1.2 s |
|---|---|
| Opening | 4 |
| Midgame (ply 30, 49 legal moves) | **3 or 4, depending on the position** |

Depth 4 means: my move, your move, my move, your move — then stop. Any threat
you create on your *third* move is invisible. Against a person who plans two
moves ahead, that is not much of a wall.

Worse, the cost of one more ply is enormous:

| Depth | Time from the start position (honest full window) |
|---|---|
| 1 | 1 ms |
| 2 | 34 ms |
| 3 | 155 ms |
| 4 | 2 223 ms |
| 5 | 12 682 ms |

**Effective branching factor from depth 3 to 4: 14.3×.** With around 45 legal
moves per position, perfect alpha-beta ordering would give roughly √45 ≈ 6.7.
We are getting about a third of the benefit alpha-beta is capable of. That gap
is all move ordering, and it is all recoverable — see `03-SEARCH.md`.

The specific ordering failure is easy to name. `chooseMove` orders the root
moves **once**, statically, then re-searches that same fixed order at every
iteration of the deepening loop:

```ts
const moves = orderMoves(context, unordered, state.turn);   // ordered once
scores = scoreRootMoves(context, moves, reached, config.jitter);
for (let depth = reached + 1; !context.aborted; depth++) { … }   // same order
```

The best move found at depth 3 is not tried first at depth 4. Iterative
deepening's single biggest payoff — that every iteration hands the next one a
near-perfect first guess — is being thrown away. There is also no transposition
table, no killer moves and no history heuristic, and in a game where every piece
moves like a king, move orders transpose constantly.

---

## 4. Each node costs 40 microseconds, and it should cost 5

Measured per call, midgame position:

| Function | Time | Calls per second |
|---|---|---|
| `evaluate(state, true)` | **22.6 µs** | 44 000 |
| ├ `permanentMask(state)` (inside it) | 12.1 µs | 83 000 |
| └ `isSealed(state, side)` (inside it, sometimes) | 16.1 µs | 62 000 |
| `legalMoves(state)` | 8.9 µs | 112 000 |
| **Whole search, per node** | **40.8 µs** | **24 500 nodes/s** |

`ROADMAP.md` §4 claims ~110 000 nodes a second. In the opening that is roughly
right (65–70 k); in the midgame, where it matters, it is **24 500**.

Three quarters of every node goes on `evaluate` and `legalMoves`, and neither is
doing anything expensive in principle. Both scan all 81 squares although at most
20 hold a piece. `permanentMask` allocates a fresh `Uint8Array(81)` **and** a
nested presence object **per node**, to answer a question — "does either side
still have a Paper?" — that is nine integers and could be maintained
incrementally for free. `isSealed` runs a breadth-first search over the board
inside the evaluation.

This is not micro-optimisation for its own sake. At 14× per ply, a 7× speedup is
half a ply on its own; combined with the ordering fixes it is the difference
between depth 4 and depth 6.

---

## 5. Smaller things that are still wrong

* **No repetition detection inside the search.** The comment in `search.ts` says
  so plainly. The AI cannot steer towards or away from a draw, and will happily
  shuffle in a won position.
* **Quiescence searches only captures.** It never considers *getting out of the
  way*, which in this game is the main defensive resource — every piece moves
  like a king, so escape squares are almost always available.
* **Captures are ordered flat.** Every capture gets key `1000` regardless of what
  it takes. Taking the opponent's last Paper — which makes every one of your
  Rocks permanent forever and is the game's central strategic lever (§6.2: 68%
  of games see a type wiped out, and the wiper wins 65% of those) — is ordered
  identically to taking their third Scissors.
* **No mobility term**, in a game where running out of moves is a *loss
  condition* (§2.8).
* **The race is a linear bonus, not a verdict.** §6.4's "count the race" — the
  runner who is closer, counting whose turn it is, simply arrives first — is a
  decidable fact, and the evaluation approximates it with `28 × distance`.

---

## 6. What this means for the plan

Ordered by payoff per hour of work:

1. **Teach the evaluation about threats** (`02-EVALUATION.md`). Nothing else on
   this list fixes the complaint Vig actually made.
2. **Make the node cheap** (`04-SPEED.md`). Pure win, no behaviour change, and it
   makes everything below affordable.
3. **Fix the search** (`03-SEARCH.md`). Transposition table, PV-first ordering,
   killers, PVS. Gets the branching factor from 14 to nearer 7.
4. **Then, and only then, tune and learn** (`05-LEARNING-AND-TABLES.md`).
5. **Measure all of it properly** (`06-MEASUREMENT-AND-LEVELS.md`), because every
   one of these changes is the kind that feels better and isn't.

---

## Reproducing these numbers

The scripts were temporary; they are reproduced here so the numbers can be
re-derived. Drop each into `tools/sim/src/` and run
`pnpm --filter @sps/sim exec vite-node src/<name>.ts`.

**Threat blindness (§1).**

```ts
import { getVariant, fromFen, threatenedBy, parseSquare, squareName } from '@sps/engine';
import { evaluate } from '@sps/ai';
const v = getVariant('original');
const hung = fromFen('9/9/9/9/4S4/3r5/9/9/9 red', v);  // blue Rock d4 attacks red Scissors e5
const safe = fromFen('9/9/9/9/4S4/9/2r6/9/9 red', v);  // same Rock on c3, no threat
console.log(evaluate(hung, true), evaluate(safe, true));
```

**Hanging-piece rate (§2).** Play self-play games; after each move, for each
piece of the mover, use `threatenedBy` to find attackers, play the first
attacker's capture on a scratch board, and ask `legalMoves` whether the mover can
recapture on that square. Count the moves where it cannot.

**Depth and speed (§3, §4).** `chooseMove(state, 'hard', seed).stats` reports
depth, nodes and milliseconds. For the fixed-depth table use
`analyseRoot(state, { depth, keepTerms: true, seed: 1, jitter: Infinity })`, which
turns off the root window and is the honest cost.

These belong in a permanent `tools/bench` once the work starts — see
`06-MEASUREMENT-AND-LEVELS.md`.

---

## 7. Measured after shipping the fix (`02-EVALUATION.md` Term 1, `03-SEARCH.md` §5)

Two results, one clean and positive, one that came back different from what
this document predicted. Both are worth having in the open.

**`pnpm sim`, before and after, identical seed** (200 medium-vs-medium games,
Original, seed 1 — this is the exact CLAUDE.md-required before/after):

| | Before | After |
|---|---|---|
| Blue / Red / draws | 104 / 88 / 8 | 93 / 96 / 11 |
| Average plies | 159.3 | **129.2** |
| First player's share of decisive games | 54.2% | 49.2% |
| Sealed-corner rate | 0.15 | 0.11 |
| §9.6 CI guard (40–60%, draws <10%) | passed | passed |

Games got meaningfully shorter and more balanced — 129.2 average plies sits
right next to §6.1's own **depth-3** reference number (129), while this run is
still depth 2 (Medium). That is the outcome this whole document hoped for:
better evaluation quality doing some of the work that raw depth would
otherwise have to.

**The self-play hanging-rate metric — the 32.7% headline number itself — did
NOT move the way this document predicted, at the sample size a quick check
can afford.** Same script and seeds, before and after, at Hard (3 games,
n=150 moves each): **14.7% → 16.7%**. At Medium (12 games, n≈1050): **13.9% →
17.1%**. Both went up, not down, though at n=150 a few-point move is within
noise (95% CI on a 15% rate at n=150 is roughly ±5.7 points).

**Why, and why it doesn't undercut the fix.** Self-play pits the fixed engine
against *itself*. The fix makes both sides smarter at the same time, so there
is no reason the raw "how often does a move leave something hanging" rate has
to fall — what should fall, and did, is how *decisive* the resulting hangs
are (shorter games, more corner wins, fewer draws). A hang the opponent can
also see and immediately capture is a different animal from a hang nobody
notices; this metric doesn't distinguish them, and building a metric that
does is `06-MEASUREMENT-AND-LEVELS.md`'s job, not a five-minute script's.

**A second finding, and a real trap avoided.** The first version of the
regression test for this fix used a hand-built "piece is hanging, is there
anything better to do" position, and Hard "failed" it — by choosing to march
an unrelated Rock toward its own corner instead of saving the hanging Paper.
That looked like exactly the bug this document describes. It wasn't: the Rock
was *already permanent* in that position (the test's Red army happened to
have no Paper anywhere), so sealing the Keep was worth +3000 against roughly
+85 for the Paper — Hard found the correct, much bigger idea. Fixing the test
(giving Red a spare Paper so the Rock has a real predator again) made both
Medium and Hard choose the flee move, as expected. Left in
`packages/ai/test/search.test.ts` as `defence (docs/engine/01-DIAGNOSIS.md)`,
comment and all — it's a good demonstration of exactly the kind of thing
`06-MEASUREMENT-AND-LEVELS.md` warns about: a five-minute hand-built position
is easy to get subtly wrong, and the wrongness looks exactly like the bug you
went looking for.

**What this means for what's next.** The mechanism works — `evasions()` finds
the escape when nothing bigger is at stake, and the eval term prices a hang
correctly enough that Hard preferred sealing the Keep over saving one piece,
which is the right call. What it doesn't yet do is show up as a clean
percentage drop in a five-minute self-play probe. Before claiming a specific
number, build the actual measurement harness (`06-MEASUREMENT-AND-LEVELS.md`
part one) — engine-vs-engine matches with an error bar, not self-play
hang-counting.
