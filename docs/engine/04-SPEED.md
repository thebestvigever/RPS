# Plan — making a node cheap

> Fixes `01-DIAGNOSIS.md` §4. Target: **40.8 µs per node → 5–6 µs**, which is
> roughly seven times the positions in the same 1.2 s.
>
> This changes no behaviour at all, which makes it the easiest thing in these
> documents to verify: the search must return **the identical move** for every
> position and seed before and after. `tools/sim` with a fixed seed is a perfect
> regression gate for it.

---

## Where the time goes

Measured, midgame position (`01-DIAGNOSIS.md` §4):

```text
evaluate(state, true)      22.6 µs      ← called at every quiescence node
  └ permanentMask           12.1 µs     ← allocates a Uint8Array(81) and a nested
                                          object, every call
  └ isSealed                16.1 µs     ← a breadth-first search, inside the
                                          evaluation, when a permanent piece exists
legalMoves(state)           8.9 µs      ← allocates ~45 Move objects and an array
whole node                 40.8 µs      = 24 500 nodes/second
```

Nothing here is inherently expensive. The board is 81 squares with at most 20
pieces on it. A well-written node in this game should cost single-digit
microseconds. The cost is **allocation and rescanning**, not arithmetic.

---

## A constraint that must not be traded away

CLAUDE.md: *"The engine is pure… Same state plus same move gives the same
result."* And `search.ts` already gets this right:

> *Move generation and sealing still come from the engine, so there is only ever
> one implementation of the rules.*

Every optimisation below must keep that true. The fast paths belong **in
`packages/engine`**, exercised by the engine's own fixtures and perft numbers
(§11.2–§11.3) — not re-implemented inside `packages/ai`. Two copies of the rules
is how this project would go quietly wrong, and §11.3's 2 146 591 four-move
sequences are exactly the test that catches a divergence.

---

## 1. Nine counters instead of a board scan *(biggest single win)*

`permanentMask` costs 12 µs a node and answers one question: *does either side
still hold a piece of type X?* That is **nine integers** — three types × three
owners — and they change by at most one per move.

* Keep `counts[owner][type]` on the search state.
* `make` decrements on a capture; `unmake` increments. Two lines each.
* Permanence becomes an O(1) table lookup: a piece is permanent iff the
  opponent's count of its predator type is zero **and** the neutral count of that
  type is zero (`permanentGiven` already encodes exactly this rule — keep the
  rule, drop the scan).
* Delete the `Uint8Array(81)` allocation entirely. The evaluation loop can ask
  "is this piece permanent?" per piece, from the counters.

This also gives `02-EVALUATION.md` Term 3 (extinction economics) its inputs for
free — the counters *are* the type census.

**Expected: 22.6 µs → about 9 µs**, before anything else.

---

## 2. A piece list instead of 81 squares

Both `legalMoves` and `evaluate` loop `for (square = 0; square < 81; square++)`
and skip the empties. In the midgame that is 81 iterations to find 14 pieces.

Maintain a piece list per side — an `Int8Array` of occupied squares plus a
length, with a `squareToIndex` back-pointer so removal is O(1) swap-with-last.
Update it in `make`/`unmake` alongside the board.

Move generation then walks **your** pieces only (about 7–10 in the midgame),
which also removes the `piece.owner === me` test from the inner loop.

**Expected: roughly 4× on both scans.**

---

## 3. Stop allocating moves

Per node, today:

* `legalMoves` allocates an array plus ~45 `{from, to, piece, captured}` objects.
* `orderMoves` allocates ~45 more `{move, key}` objects, sorts them, then
  allocates a third array via `.map()`.

That is ~90 short-lived objects and 3 arrays per node, at 24 500 nodes a second —
about two million allocations a second, all of which the garbage collector has to
chase.

**Pack a move into one integer.** `from | (to << 7) | (capturedCode << 14)` fits
comfortably in a 32-bit int. Generate into a preallocated `Int32Array` owned by
the search, one slice per ply (`moveBuffer[ply * 128 …]`), so no allocation
happens below the root at all.

Keep the existing object-shaped `legalMoves()` as the engine's public API — the
interface, the referee and the notation code all want it, and it is the readable
one. Add `generateInto(state, buffer, offset): count` beside it, and make the
engine's own tests assert the two agree on every fixture position.

**Sort lazily.** Alpha-beta usually cuts after one to three moves, so sorting all
45 is wasted work. Score into a parallel `Int32Array` and do a selection pass for
the next-best move each time one is needed. Standard practice, and it composes
with the transposition-table move and killers from `03-SEARCH.md`.

**Expected: 8.9 µs → about 2.5 µs**, and most of the GC pressure gone.

---

## 4. Incremental evaluation

Once counters and a piece list exist, most of `evaluate` can be maintained rather
than recomputed in `make`/`unmake`:

* **Material** — trivially incremental.
* **Advancement** `Σ (9 − d)²` — add the new square's contribution, subtract the
  old one, subtract any captured piece's. Two table lookups.
* **Permanence bonus** — changes only when a counter hits zero, which is rare and
  detectable.
* **Nearest distance to goal** — the one that resists, because removing the
  nearest runner means finding the next one. With a piece list of ~10 that is a
  cheap loop; do not over-engineer it.
* **`isSealed`** — keep the existing guard (only when a permanent piece exists),
  and add a second: the seal can only change when a piece moves into or out of
  the region near the corner, or when a permanence counter changes. Cache the
  last result keyed on the Zobrist hash from `03-SEARCH.md` §2 and it will
  usually be a hit.

This is the same idea as NNUE's accumulator — the network is fast enough to run
at every node *only* because a move touches two or three inputs and the rest is
carried forward. The principle applies to a hand-written evaluation just as well.

**Do this last**, after §1–§3. Incremental state is where subtle bugs live, and
the earlier steps are most of the win with none of the risk. Guard it with a
debug assertion that recomputes from scratch and compares — cheap to run in
tests, off in production.

---

## 5. Small things

* `evaluate()` calls `distanceTables(variant)` on every invocation, which is a
  `WeakMap` lookup per node. `Context` already holds the tables — pass them in.
* `terms` is a fresh `Record<Side, SideTerms>` object literal per call. Reuse two
  preallocated structs on the context.
* `isGoalSquare` → `goalSquares().includes()` is a linear scan of an array on
  every `winsNow` check. Precompute an 81-entry `Uint8Array` goal mask per side
  per variant, alongside the distance tables.
* `NEIGHBOURS` is an array of arrays. A flat `Int8Array(81 × 8)` with an offset
  table is measurably faster in V8 and costs nothing in readability with a
  comment.

---

## Where to stop

**Do §1–§3 and stop there for now.** Expected node cost ~8 µs, a 5× gain, with no
behaviour change and no incremental-state risk. §4 takes it to ~5–6 µs and is
worth doing when the evaluation stops changing shape — doing it while
`02-EVALUATION.md` is still adding terms means rewriting it twice.

**Do not reach for bitboards.** 81 bits does not fit a JavaScript number, so a
9×9 bitboard means three 27-bit lanes with hand-written carry handling across
lane boundaries, or `BigInt` (which allocates on every operation and would be
*slower* than the `Int8Array` we have). The gain over a piece list on a board
this sparse does not come close to justifying it.

**WebAssembly is a different project.** `ROADMAP.md` §4 is right that it is where
the raw-speed ceiling is, and right that it is "months." A 7× gain is sitting in
plain JavaScript first; take that, ship it, and see whether anyone still wants
more.

---

## How to verify

1. **Identical output.** `chooseMove(state, level, seed)` must return the same
   move and the same score for every fixture position and a few hundred self-play
   positions, before and after. Add this as a test, not a one-off check.
2. **Perft still matches.** §11.3's 2 146 591 four-move sequences. Any move
   generation change that passes perft has not changed the rules.
3. **`pnpm sim` with a fixed seed reproduces game-for-game.** If the games differ,
   something changed that should not have.
4. **Profile, don't guess.** `node --cpu-prof` on a sim run, and re-run the
   micro-benchmarks in `01-DIAGNOSIS.md`. Two of the four numbers in that table
   surprised me; assume the next four will too.
