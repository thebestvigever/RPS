# Build plan

Milestones to v1. For what comes *after* — running it, online play, a lobby, a
stronger engine — see `ROADMAP.md`.

From spec §12. **Each milestone ends in something that runs. Don't start one until
the previous milestone's "done when" holds.**

| # | Build | Done when | State |
|---|---|---|---|
| M0 | Scaffold: workspace, packages, fixtures, test harness | `pnpm test`, `pnpm typecheck` and `pnpm build` all green | **done** |
| M1 | Engine: rules, position notation, move notation, events, `isSealed` | §11.1–§11.4 green, perft matches | **done** |
| M2 | AI and the `tools/sim` harness | Balance runs land near §6 for all three variants | **built** |
| M3 | Board UI and pass-and-play, Original only | Two people can finish a game on one phone | **done** |
| C1 | Clocks, offers and time gifts (`docs/ADDENDUM-CLOCKS.md`) | Clock, offers and gift policy green; engine still timer-free | **done, and rendered (M3c)** |
| C2 | Premove, abort, low-time warning, Zen | Logic green; rendering waits on M3 | **done; abort and low-time rendered (M3c) — premove and Zen wait on M4/M6** |
| M4 | Play against the computer: worker, three levels, undo | Hard stays inside its time budget on a phone | **done** |
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

## What M3b left behind — the gate is met

**Two people can finish a game of Original on one phone.** `Game.tsx` runs a
complete pass-and-play loop: tap or drag to move, the same keyboard cursor
spec 10.4 describes (arrows, Enter/Space, Escape), illegal-target reasons with
a shake, the 150ms slide, the three capture motions with a victim overlay,
corner names and type counts, Undo and Resign. Verified by actually playing
it through Playwright rather than trusting the code — a full capture, found
by running the real AI a few plies deep (hand-tracing a legal capture from the
opening position is exactly the kind of thing worth generating instead of
guessing at), replayed through real clicks with zero console errors.

**One real bug, caught the same way the M3a scissors one was — by driving the
app, not by reading the code.** The first version had `pointerdown` eagerly
select whatever piece it landed on, so a drag could show a ghost from the
moment of press. It couldn't: pressing a piece set `selected`, and releasing
on that same square — now seeing it as "the selected one" — matched the
"tap the selected piece again" branch and cleared it right back out, all
within one click. Taps looked like they did nothing. The fix is in `Game.tsx`'s
comment above `onPointerDown`: one state change per gesture, decided entirely
on release, not two racing on press and release of the same tap. `packages/board`'s
tests didn't and couldn't catch this — the bug was in how `apps/web` sequenced
its own state, not in anything pure enough to unit test.

**What's a real, documented simplification rather than a miss:**

* **Corner-anchored names.** `docs/VISUAL_SYSTEM.md` 5 describes names sitting
  beside each player's own corner. `Game.tsx` stacks two panels instead
  (opponent above the board, yours below — spec 10.11's own phone layout).
  Functionally the same information; the corner-precise positioning is
  deferred rather than rushed.
* **Cut's victim doesn't split into two halves.** The captor's motion is the
  real thing (README 3b's rotate-close); the taken piece fades and scales
  instead of splitting, because a true split needs its own geometry per
  family and this pass owns getting the mechanism working, not every
  family's exact silhouette break.
* **No board flip.** Pass-and-play always shows Blue's corner bottom-left.
  Spec 10.2's "flip each turn" toggle needs orientation-aware square mapping
  that nothing in `@sps/board` does yet — a real feature, not a bug, and
  worth its own pass rather than a rushed half-version here.
* **Move list and the full game-over overlay (Rematch, Swap sides, Review,
  Copy link) aren't built.** The status line and a plain result sentence are
  what M3's gate actually needed; the four-button overlay in spec 10.7 pairs
  naturally with M3c's offer/rematch work and is picked up there.

`@sps/board` grew three pure, tested pieces for this: `motion.ts`
(`captureMotion`, matchup -> name, nothing else), `text.ts` (spec 10.4's two
illegal-capture reasons, verbatim), and `render.ts`'s `selection`/`focusSquare`
options (the dot, the two rings, the dashed cursor — still a function of what
to draw, never of when). Everything about *when* — the gesture state machine,
the two WAAPI animations, the victim overlay — has no DOM to live in inside
`@sps/board`, so it's `apps/web`'s, same split M3a drew for motion's naming
versus its timing.

## What M4 left behind

The computer plays. `apps/web/src/ai-worker.ts` spawns `packages/ai/src/worker.ts`
straight from its real source path — Vite bundles it as its own chunk from a
relative `new URL(...)` import, no package export needed for a browser-only
entry point that `@sps/ai` (which also runs in Node, for `tools/sim`)
shouldn't carry. Every move the computer makes goes through the exact same
`doMove` a tap does: the worker's reply is text, `parseMove` turns it into a
`Move`, and from there it's indistinguishable from a human's — the slide, the
capture motion, the clock press, all of it, for free.

Verified against the real search, not a stub: a full exchange played through
actual clicks, the worker's reply landing as a real legal move ("Red Paper h5
to i5") with zero console errors, and a draw offer answered by the real
`shouldAcceptDraw` ("Computer declines — it is too early to tell" — the exact
sentence `packages/ai/src/draw.ts` produces for a position under `DRAW_MIN_PLY`).

**One thing is a documented scope decision, not a gap: the human only ever
plays Blue.** Spec 10.2 rotates the board 180 degrees for a human playing
Red, and no `@sps/board` release does board orientation yet — that was M3b's
own documented cut, for the same reason. Letting Home offer "play Red" before
orientation exists would show a Red-playing human their own pieces starting
in the far corner, which is worse than not offering the choice at all. Home's
side picker (Blue / Red / Random, spec 10.1) and Rematch's "sides swapped"
button both wait on it — one milestone's cut turning out to gate two features
later is worth knowing, not just noting once.

**`shouldAcceptDraw` runs on the main thread, not the worker.** It can search
as deep as `chooseMove` does, so this is the one place M4 doesn't fully honour
"search never blocks the board" (spec 9.1) — a draw offer is rare and not
time-critical the way every move is, which is why it was a reasonable place
to cut, but it is a cut: the worker protocol would need a second message type
to close it, and that's a small, well-scoped follow-up rather than something
folded in here.

**Undo against the computer takes back two plies (spec 10.8)**, landing back
on the human's own turn — verified by playing one exchange and undoing it
back to the empty history. It doesn't refund clock time any more than M3b's
pass-and-play undo does, for the same reason (a real replay needs the
record's per-move `remainingMs`, spec 8.3 — M8).

## What M3c left behind

C1's clock and C2's abort/low-time warning are on screen, driven by the exact
`packages/match` code those milestones already shipped and tested — nothing
in `clock.ts` or `offers.ts` changed to get here. The urgency colours, the
flag detection, `+15s` in both directions and a real draw-offer exchange were
all played through and checked by hand (`respondToDraw`, `giveTimeTo`), not
just typechecked.

Home also grew the time-control picker `docs/ADDENDUM-CLOCKS.md` left as "not
built" after C1 — a clock nobody can set the length of would have been an odd
thing to ship now that it's rendered. Defaults to `10+5`.

**Two of M3c's row in `docs/VISUAL_SYSTEM.md` 8 turned out not to apply to
pass-and-play, and were skipped rather than faked:**

* **Takeback offers.** `OFFER_POLICIES['pass-and-play'].allowed` is `['draw',
  'rematch']` — `packages/match`'s own comment says why: "Undo is unrestricted
  against the computer and in pass-and-play, so a takeback only needs asking
  for online." M3b's Undo already does that job. The offer machinery's
  `takeback` kind gets its first real exercise in M5's online mode.
* **Premove.** `canPremove('pass-and-play')` returns `false` — `premove.ts`'s
  own comment: one person moving both sides means there is no waiting turn to
  queue a move during. A premove ghost has nothing to attach to until M4 gives
  the human an opponent who thinks on their own time.

**Rematch is one click, not the offer/accept pair `offers.ts` models.** Both
players are already at the device; there is no losing side to ask for
consent, unlike a draw. It calls `createGame` directly rather than exercising
the `rematch` offer kind — that kind's real test is still M5.

**Not done, and not pretended:** the four-button game-over overlay (spec
10.7's Rematch/Swap sides/Review/Copy link — this ships one of the four), the
move list, and an accurate clock replay on Undo (it restarts the clock for
whoever moves next without refunding the undone move's time — a full replay
needs the per-move `remainingMs` the record carries, spec 8.3, which is M8's
persistence work). Zen (C2) has nothing to hide yet — that's the aid layer,
M6.

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
