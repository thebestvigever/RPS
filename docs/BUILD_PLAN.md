# Build plan

From spec §12. **Each milestone ends in something that runs. Don't start one until
the previous milestone's "done when" holds.**

| # | Build | Done when | State |
|---|---|---|---|
| M0 | Scaffold: workspace, packages, fixtures, test harness | `pnpm test`, `pnpm typecheck` and `pnpm build` all green | **done** |
| M1 | Engine: rules, position notation, move notation, events, `isSealed` | §11.1–§11.4 green, perft matches | **done** |
| M2 | AI and the `tools/sim` harness | Balance runs land near §6 for all three variants | **built** |
| M3 | Board UI and pass-and-play, Original only | Two people can finish a game on one phone | **M3a done, M3b next** |
| C1 | Clocks, offers and time gifts (`docs/ADDENDUM-CLOCKS.md`) | Clock, offers and gift policy green; engine still timer-free | **done** |
| C2 | Premove, abort, low-time warning, Zen | Logic green; rendering waits on M3 | **done** |
| M4 | Play against the computer: worker, three levels, undo | Hard stays inside its time budget on a phone | |
| M5 | 2×2 Corner and Neutrals, and the variant picker | All three variants playable both ways | |
| M6 | Information aids (§10.5) | Each aid on and off, correct in the fixture positions | |
| M7 | How to play and the tutorial | A new player finishes all six puzzles | |
| M8 | Sound, animation, accessibility, persistence, review and share links | §11.6 passes | |
| M9 | Release | §11.7 fully ticked; deployed | |

## What C1 left behind

Vig asked for clocks, draw offers and two ways of handing time around — which
the base spec had put in the future (§13.2) or restricted to pass-and-play
(§2.9). `docs/ADDENDUM-CLOCKS.md` records the change and is normative where it
disagrees with `spec.md`.

**`packages/match` is the new home**, and it is pure in the same sense the
engine is: it holds no timer and never reads the time itself — every operation
is handed `now`. That is what lets a clock be tested to the millisecond,
replayed from a record, and later run on the server unchanged. §7.1's rule that
the engine knows nothing of clocks is untouched.

* `time-control.ts` — stages, so tournament controls are expressible rather than
  special-cased; four bonus kinds; presets sized for **this** game's length.
* `clock.ts` — the clock itself, plus pause, gifts and flagging.
* `offers.ts` — draw, takeback and rematch, on lichess's rules.
* `gifts.ts` — who may give time to whom, per mode.

Three things worth knowing:

* **Presets assume 67 moves a side, not chess's 40.** §6.1 measured 129–138
  plies. At 67 moves a 2-second increment is worth over two minutes, so a "3+2"
  here is a much longer game than a chess 3+2, and the categories are derived
  from that rather than copied.
* **Bronstein and simple delay are one code path.** They are the same
  arithmetic and differ only in display. Two `kind`s so the interface can tell
  them apart; one computation so they can never disagree about the time.
* **A pause cannot rewind a delay.** The clock banks `elapsedThisTurnMs` across
  pauses, so opening the menu inside a simple delay does not hand out free time.
  A test covers it, because the naive version is wrong in a way nobody would
  notice until someone exploited it.

The computer answers draw offers in `packages/ai/src/draw.ts`: it accepts when
it is not meaningfully ahead, refuses in the opening, and accepts outright when
both corners are sealed — §6.3 found that is where the Original's draws come
from, so there is genuinely nothing to play on for.

**Not built:** the clock UI, the time-control picker, and wiring the record's
`clock` section on save. Those are M3/M8, and they wait on visual direction.

## What M2 left behind

The computer opponent plays all three variants at three levels, and the
self-play harness runs. 207 tests pass, with no todos left anywhere in the repo.

**Search** is negamax with alpha-beta and a captures-only quiescence, walking one
mutable board with make/unmake. It never calls `applyMove` — see the M1 note
below for why. Move generation and sealing still come from the engine, so there
is exactly one implementation of the rules.

From the opening position, on this machine:

| Level | Depth | Nodes | Time | Budget (§9.3) |
|---|---|---|---|---|
| Easy | 1 | 72 | 4 ms | 150 ms |
| Medium | 2 | 526 | 10 ms | 400 ms |
| Hard | 4 | 134,000 | 1.2 s | 1.2 s |

Hard reaches depth **4**, not the three the spec asks for, because iterative
deepening spends the whole budget. On a slower device it completes depth 3 and
abandons depth 4, so the ladder degrades rather than blowing the budget — the
shallowest search always runs to completion, because the AI must return a move.
The real check is a mid-range phone (§11.7), which is M4.

Three decisions worth knowing about:

* **The root prunes, but only where it cannot matter.** `jitter` picks among
  moves within a few points of the best, so only those need exact scores. Each
  root move is searched with alpha just below "best so far minus jitter";
  anything that cannot become a candidate fails low and returns a bound. Scoring
  every root move with a full window instead — the obvious way to keep scores
  honest — turns alpha-beta off at the root and cost about twenty times the
  nodes. `analyseRoot` is exported so the invariant is testable: pruned and
  unpruned must choose the same move.
* **Move ordering breaks ties with a hash, not the generator.** Drawing the
  tiebreak from the seeded stream couples it to how much of the tree the search
  visits, so any change to ordering or pruning reshuffles every self-play game
  and a before/after comparison becomes meaningless. Hashing the move keeps the
  generator for the root choice alone.
* **`isSealed` short-circuits when no defender piece is permanent.** There is no
  wall in that case, so the search would reach every square — and most positions
  have no permanent piece at all. Without this the Keep terms dominated the
  profile.

### Running the balance guard

```sh
pnpm sim --variant original --blue medium --red medium --games 200 --seed 1
```

At Medium against Medium the run exits non-zero if the first player's share of
decisive games falls outside 40–60% or draws reach 10% (§9.6). That is minutes
of CPU per variant, so CI runs a 40-game smoke on every change and the full
200-game guard nightly (`.github/workflows/balance.yml`), plus on demand.

**Run it before and after any rules change and say what moved.** A large
difference from the §6 numbers points to a rules bug before it points to an AI
difference.

## Starting M3

**Read `docs/VISUAL_SYSTEM.md` first.** §10 of the spec left the look open; that
file closes it, and is normative for what the interface renders. It slices M3
into M3a (the board renders), M3b (it plays — this is the milestone gate) and
M3c (the clock furniture C1 and C2 are waiting for), and it records four
corrections to the design handoff that code in `packages/match` already
contradicts. It also holds the three tests to write **before** the UI code:
swatch contrast, greyscale at 24px, and dot alpha.

M3 ships one theme, one family, one layout and Original only. The other themes,
families and layouts are a data drop once M3 has been played and reviewed.

The board is SVG, your own corner bottom-left, and the interface animates and
announces from engine **events** rather than by diffing boards (§7.7). The
engine already emits `move`, `capture`, `type-extinct`, `sealed` and
`game-over`, which is exactly what §10.5's aids and §10.6's announcements need.

`apps/web` is still mostly a placeholder — selecting a variant swaps which
position renders, nothing is clickable yet. What it now proves is `@sps/board`
reaching the browser, not just the engine.

## What M3a left behind

`packages/board` renders a position: tokens, coordinates, corner tints, the
last-move tint and the flame placeholder, per `docs/VISUAL_SYSTEM.md` 8. One
theme (Field Notes), one family (Cut stone) — the other two themes are filled
in as data (`themes.ts`) since the swatches were already corrected and
validated, but `familyMark` throws a clear, specific error for every family
but Cut stone rather than shipping unbuilt geometry. All three of `9`'s gates
are in `test/`: swatch contrast and dot alpha are asserted directly; the
greyscale-at-size question is not — it never can be, it's a person's call, not
a boolean — so `greyscale-review.test.ts` generates the sheet
(`test/fixtures/greyscale-review.svg`) for Vig to look at instead of faking a
pass. `render.test.ts` runs the renderer against the engine's own fixtures
(`vectors.json`, `tutorial.json`) rather than a hand-picked sample, so it's
checked against the same positions the rules already are.

Two things worth knowing before extending it:

* **The reviewed-three-times scissors geometry needed re-deriving once, not
  just transcribing.** The README's CSS reads as "the bow, centred on the
  bar's bottom edge" — take that literally (bow centre = bar's bottom-centre
  point) and the two loops land almost concentric, close to the exact
  failure mode §3 rejects ("detached blades + free-floating rings ... reads
  as 'V oo'"). The full `translate(-50%, 42%)` — worked through in the
  comment above `blade()` in `families.ts` — moves the loops' centre 92% of
  their own diameter past that edge, not onto it, which is what actually
  gives two distinguishable finger holes. Caught by rendering it and looking,
  not by re-reading the CSS harder; there was no test that would have caught
  it, because there is no automated test for "does this look like scissors."
* **Ownership mode is decided by the renderer, not passed in.** `renderMode`
  is called with the actual square size every time; nothing upstream chooses
  standalone or knockout. A future settings screen has nothing to get wrong
  here — there is no setting.

`knockoutPiece`'s figure-ground inversion (filled disc / hollow mark for
"yours", hollow disc / filled mark for the opponent) reads clearly even at a
390px phone's actual square size in `apps/web` — confirmed by rendering it and
looking, not assumed from the fraction arithmetic alone.

## What M1 left behind

The engine is complete and under test. 148 tests pass; the 8 remaining todos are
all M2 (search behaviour and the self-play runs).

**The numbers that matter.** Perft matches the spec exactly at every depth, on
the first run, for all three variants:

| Variant | 1 ply | 2 plies | 3 plies | 4 plies |
|---|---|---|---|---|
| Original | 36 | 1,293 | 52,758 | 2,146,591 |
| 2×2 Corner | 36 | 1,293 | 52,758 | 2,146,591 |
| Neutrals | 35 | 1,225 | 48,377 | 1,908,941 |

All eleven fixture vectors from §11.2 pass, as do all six tutorial puzzles and
1,200 random games (400 per variant) with no invariant broken.

**Modules.** `board.ts` geometry · `pieces.ts` the cycle and encoding ·
`goals.ts` goal and home squares · `fen.ts` position notation ·
`notation.ts` move notation · `moves.ts` generation · `game.ts` lifecycle ·
`analysis.ts` permanence, sealing and distance.

Two things worth knowing before touching the engine:

* **`applyMove` calls `isSealed` four times** — twice before, twice after — so it
  can emit the `sealed` event without the interface diffing boards. That is
  ~2,600 operations a move, invisible in play but real in a search. `perft` in
  the tests shows the pattern to use instead: `legalMoves` plus make/unmake on a
  mutable board, which the spec sanctions for search (§7.2). **M2's search must
  not go through `applyMove`.**
* **`parseMove` is strict about everything derived** — the type letter, the `n`
  prefix, `x` versus `-`, and the `#`. Writing `Sh8-i9` for a winning move is a
  `NotationError`, not a silently accepted move. This is what makes a saved game
  self-checking.

## Starting M2

The AI package already has the weights (§9.2), the difficulty ladder (§9.3),
`mulberry32` (§7.8) and the worker protocol (§9.4) as data and types. What is
missing is `evaluate`, `chooseMove` and `runSimulation`.

Get `tools/sim` running first, then tune. The check that matters: Medium against
Medium over 200 games per variant should land near §6.1 — a first-player share
of decisive games between 40% and 60%, draws under 10%. `checkBalanceGuard`
already encodes that and is tested. Large differences from §6 point to a rules
bug before they point to an AI difference.

## What M0 left behind

Everything that was pure arithmetic or a direct transcription of the spec is
implemented and under test. Everything that needs rules logic is a stub that
throws `NotImplementedError` with its spec section.

**Implemented:**

* `board.ts` — coordinates, `parseSquare`/`squareName`, king distance, the
  neighbour table (§2.1).
* `pieces.ts` — the cycle, predators, the `Int8Array` encoding (§2.2, §7.2).
* `variants.ts` — all three `VariantConfig`s and the variant card copy (§5, §10.1).
* `ai/random.ts` — `mulberry32` and seeded picking (§7.8).
* `ai/levels.ts` — the difficulty ladder as data (§9.3).
* `ai/evaluate.ts` — the evaluation weights and terminal scores as named
  constants (§9.1, §9.2). The function itself is a stub.
* `sim/options.ts`, `sim/summary.ts` — CLI parsing and the CI balance guard (§9.6).

**Stubbed at the time, with the spec algorithm in a comment above each:**
everything in the engine (all delivered by M1), plus `evaluate`, `chooseMove`
and `runSimulation`, which remain for M2.

**Fixtures, ready to run against the engine** — all eleven vectors from §11.2,
the 36 opening moves and the perft numbers from §11.3, and the six tutorial
puzzles from §10.9. `fixtures.test.ts` already checks the fixture data itself is
well formed (every rank adds to nine files, every move matches the §8.1 grammar),
so a transcription typo surfaces now rather than as a mysterious engine failure.

The 65 `todo` entries in the test report are the M1–M2 checklist, taken from
§11.1, §11.4 and §11.5.

## Running the suite

```sh
pnpm install
pnpm test
```

The suite runs 400 random games per variant. For the full §11.5 number:

```sh
SPS_RANDOM_GAMES=1000 pnpm test
```
