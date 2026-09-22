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
| C2 | Premove, abort, low-time warning, Zen | Logic green; rendering waits on M3 | **done; abort and low-time rendered (M3c), Zen rendered with the Rail — premove is the last piece, and M4 unblocked it** |
| M4 | Play against the computer: worker, three levels, undo | Hard stays inside its time budget on a phone | **done** |
| M4b | Board orientation, and the four cuts it was blocking: side picker, corner-anchored panels, move list + game-over overlay, Undo's clock refund | Playable as Red; §10.7's four buttons all work; Undo puts both clocks back | **done** |
| M5 | 2×2 Corner and Neutrals, and the variant picker | All three variants playable both ways | **done** |
| M6 | Information aids (§10.5) | Each aid on and off, correct in the fixture positions | |
| M7 | How to play and the tutorial | A new player finishes all six puzzles | |
| M8 | Sound, animation, accessibility, persistence; the clock's replay in review | §11.6 passes | review and share links landed early with M4b |
| M9 | Release | §11.7 fully ticked; deployed | |

## What M5 left behind

Most of M5 was already paid for by "variants are data" (CLAUDE.md). The engine
has generated legal moves, sealed corners and terminal results for all three
variants since M1 — the perft table in "What M1 left behind" below already
covers 2×2 Corner and Neutrals — and `apps/web`'s variant picker played either
one the moment it existed, because `Game.tsx` never had an Original-specific
branch to begin with: it plays whatever `legalMoves()` returns. `cornerTintLayer`
generalised to a four-square goal block for free too, since it already looped
over `homeSquares(variant, side)` rather than assuming one square each.

**What M5 actually had to build: the two neutral-specific interactions spec
10.4 describes, which Original never exercises.**

* **The capture-available pulse.** A neutral with a capture on offer gets the
  `neutral-pulse` class from `renderBoard`'s new `pulseSquares` option —
  computed once from `legalMoves`, the same list `isSelectable` already reads,
  so it needs no separate "whose turn" check. CSS drives the animation (a 1.4s
  opacity fade, same `prefers-reduced-motion` override every other animation in
  `game.css` already respects); `@sps/board` only says which square gets it.
* **The two status lines.** Tapping a neutral now reads "Using the neutral
  Paper — capture a Red Rock" or "Neutrals only move to capture" (spec 10.4,
  verbatim). Both live in `packages/board/src/text.ts` beside
  `illegalCaptureReason` — rules-derived wording, not app wiring — and the
  second one needed its own branch in `resolveClick`: a neutral with nothing to
  capture has no legal move, so it never passes `isSelectable`, and without an
  explicit fallback the tap did nothing at all rather than explaining why.
* **The neutral's own victim overlay.** M3b/M4b's capture animation skipped a
  neutral victim outright — `renderPieceSample` only knew "yours" or
  "opponent," not a neutral's dashed ring, so drawing one wrong was worse than
  not drawing it, and the comment above the code said M5 owned the fix. It now
  takes an `isNeutral` option that routes to the same `neutralPiece` drawing
  `piecesLayer` already uses everywhere else, coloured from the theme's own
  `neutral` token instead of a side colour that a neutral piece doesn't have.

**Verified by actually playing it, not just typechecking it.** The five-ply
line that reaches a neutral capture from the Neutrals opening
(`Pb5-a6 Pe8-d9 Pa6-a7 Pf7-e6 nSe5xe6`) came from a short engine search, not a
hand trace — the same reasoning M3b's capture bug and M4's worker exchange were
both caught by. Played through real clicks in pass-and-play: the pulse landed
on `e5` the instant it became Blue's move, selecting it produced the exact
"Using the neutral Scissors — capture a Red Paper" line, and completing it
updated Red's Paper count, moved the neutral itself onto `e6`, and announced
"Using the neutral Scissors to capture Red Paper on e6" with zero console
errors. 2×2 Corner's four-square tint was checked visually at game start, and
both variants were sanity-played a move each against the real computer (not a
stub) with no errors either.

**Not separately re-verified: playing a 2×2 Corner game through to an actual
win in the browser.** Landing on any of the four goal squares is engine logic
untouched by M5 — it was already in M1's perft and fixture vectors — and
`GameOver`/`describeResult` key off `result.reason` strings, never a specific
square, so nothing about winning differently needed new UI code to render.

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

**Not built at the time:** the clock UI, the time-control picker, and wiring
the record's `clock` section on save. The first two arrived with M3c; the
third with M4b, which needed the same per-ply snapshots to refund Undo.

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

* **Corner-anchored names.** The design has names sitting beside each
  player's own corner. `Game.tsx` stacked two plain panels instead (opponent
  above the board, yours below — spec 10.11's own phone layout): functionally
  the same information, with the corner-precise positioning deferred rather
  than rushed. **Done in M4b**, which needed orientation first.
* **Cut's victim doesn't split into two halves.** The captor's motion is the
  real thing (README 3b's rotate-close); the taken piece fades and scales
  instead of splitting, because a true split needs its own geometry per
  family and this pass owns getting the mechanism working, not every
  family's exact silhouette break.
* **No board flip.** Spec 10.2's orientation-aware square mapping was a real
  feature, not a bug, and worth its own pass rather than a rushed half-version
  — which is what it got in **M4b**. (Pass-and-play still shows Blue's corner
  bottom-left, which is what 10.2 asks for; its optional "flip each turn"
  setting remains Settings work.)
* **Move list and the full game-over overlay (Rematch, Swap sides, Review,
  Copy link) aren't built.** The status line and a plain result sentence are
  what M3's gate actually needed. M3c shipped one of the four buttons;
  **M4b shipped the rest, the move list and the share links they depend on.**

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

**The human only ever played Blue** — a documented scope decision at the time,
and the one M3b cut that turned out to gate two later features (Home's side
picker and Rematch's "sides swapped"). **Closed in M4b below.**

**`shouldAcceptDraw` runs on the main thread, not the worker.** It can search
as deep as `chooseMove` does, so this is the one place M4 doesn't fully honour
"search never blocks the board" (spec 9.1) — a draw offer is rare and not
time-critical the way every move is, which is why it was a reasonable place
to cut, but it is a cut: the worker protocol would need a second message type
to close it, and that's a small, well-scoped follow-up rather than something
folded in here.

**Undo against the computer takes back two plies (spec 10.8)**, landing back
on the human's own turn — verified by playing one exchange and undoing it
back to the empty history. It did not refund clock time; **M4b below does.**

## Accent contrast, and a gate for it

`.play` was white on `--blue`, which is 2.52:1 in the dark theme because that
theme's blue is a *light* blue. Auditing the rest with the repo's own
`contrastRatio` found it was not one button: **four of the five filled accents
were below WCAG AA (spec 10.10), and two of those failed in the LIGHT theme**,
so this was never a dark-mode problem.

| | |
|---|---|
| white on `--blue` (light) | 4.73:1 — the only pass |
| white on `--blue` (dark) | 2.52:1 |
| white on `--red` (light) | 4.41:1 |
| white on `--red` (dark) | 2.89:1 |
| white on `--alert` (both) | 3.78:1 |

**Contrast is symmetric, which made the fix much smaller than it looked.** A
colour that fails carrying white also fails *as text* on white — so `--alert`
at 3.78:1 was illegible both as the low-clock fill and as the "last one" count.
Darkening `--red` by 2% and `--alert` by 10% fixes each in both roles at once,
which is why there are no separate fill tokens: the accents simply became the
versions that pass. Spec 10.3 marks these values "adapt freely", and the
board's own piece colours are untouched — those come from `@sps/board`'s
validated swatches, so nothing moved off the 3:1 floor against the squares.

One new token, `--on-fill`, is what sits ON a filled accent: white in the light
theme, near-black in the dark one. One per theme rather than one per accent,
because a single foreground clears AA on all three. The six sites that
hard-coded `color: white` now use it.

**`.play:hover` stopped brightening the fill.** `brightness()` on a filled
accent moves it toward its own foreground and quietly spends the contrast this
change just bought. It lifts with a shadow instead, which changes no colour
pair at all.

**The gate.** `apps/web` had no test directory; `vitest.config.ts` now includes
`apps/*/test`, and `tokens.test.ts` parses `styles.css` — rather than
duplicating the values — and asserts every accent clears AA both as text on
the page and under `--on-fill`, in both themes. It also fails on any
`color: white` in either stylesheet, because that is exactly how this broke:
it reads as obviously right on a blue button and is wrong in whichever theme
owns the light accent. Verified by reverting `--red` and watching it fail with
the original 4.41:1.

## The Rail layout and Zen

Two things `docs/VISUAL_SYSTEM.md` decision 4 had deferred past M3, built
together because the first decides how the second looks.

**The Rail (spec 10.11's desktop layout).** Board on the left, options on the
right, one column below the breakpoint. Three decisions worth keeping:

* **The breakpoint is a TypeScript constant applied as a class, not a media
  query.** `RAIL_MIN_PX` decides the layout *and* feeds the board's own
  sizing, because spec 10.2 makes board width depend on "the space left after
  the panels". Two numbers that have to agree are two numbers that eventually
  will not.
* **1024 is derived, not picked.** A 640 board, a 20rem rail and the gap
  between them come to just under it, so the rail never squeezes the board —
  verified at 1000 (stacked, board 640) and 1100 (railed, board 640).
* **The panels stay welded to the board**, which is a deliberate departure
  from 10.11's "panels and move list on the right". They are corner-anchored
  (M4b), so each name sits beside its own corner square; floating them into a
  side column would undo the thing that makes them worth having. 10.11
  predates that decision.

**Zen** now renders, and Vig's definition of it changed what the addendum
first specified. Zen keeps the clocks, the **type counts** and the control
bar; it drops the names, the move list and the status line's visible text.

`ZEN_AIDS` in `settings.ts` is where that lives, and the reasoning is in the
comment above it: the counts are the only aid that *reports* the position
rather than *advising* on it. Threat lines, the race meter, shields, the Keep
lock, danger marks and the hint all tell you what to think; the counts only
say what is on the board, which you could get by counting. Hiding them buys
clerical work, not depth.

Two properties that were already true and stayed true: Zen overrides rather
than overwrites, so leaving it restores the player's own choices; and it never
turns an aid back **on** that the player had switched off — a test covers each.

**The status line is hidden to look at, not to hear.** It stays in the DOM as
the polite live region every move is announced through (spec 10.6, 10.10),
clipped with `.sr-only` rather than `display: none`, which would take it out
of the accessibility tree as well. A quiet board is a request about the eyes.
Each panel keeps its name the same way, because the counts alone do not say
whose they are — without it a screen reader would read two identical rows of
numbers.

**The toggle is in the control bar**, not behind a Settings screen (there
still is not one — spec 10.1's Settings is unbuilt). The bar is the one piece
of chrome Zen keeps, so the way out is exactly where the way in was. Zen lives
in `App` rather than `Game` because a rematch remounts `Game`, and a player who
asked for quiet should not have to ask again every game. It is session-only;
persisting it is M8 (`localStorage`, spec 10.13).

**One bug fixed on the way, and it was not a layout bug.** On a 375px phone the
board rendered 475px wide and clipped the a-file off the edge. `useBoardPx`
read `window.innerWidth` on a `resize` event, and that event can lag or be
missed when the viewport changes without a user gesture — leaving the board
sized for the *previous* viewport. It now uses a `ResizeObserver`, which
reports the real box every time, and it subtracts the rail, which is spec
10.2's "space left after the panels" finally meaning something.

## Fixed after M4b — three bugs Vig hit by playing it

All three were found the way M3a's scissors and M3b's tap race were: by using
the thing, not by reading it. None was caught by 450 passing tests. Two had
been shipped broken since M3b, and the first since M4 — and two of the three
were on **every single move** of every game.

**Pass-and-play could not get past Blue's first move.** M3b's gate — "two
people finish a game on one phone" — had genuinely been met, with selection
ungated: `isSelectable = legal.some(...)`. M4 then added `humanTurn &&` so you
could not move the computer's pieces, and `humanSide` is Blue by construction
when there is no computer. So the moment Blue moved, `humanTurn` went false
and **no Red piece was selectable**. The clock still handed the turn to Red,
which is what made it read as a board that had stopped responding rather than
one disagreeing with itself about who was playing.

Nothing type-checked it and nothing could: `turn` and `humanSide` are both
valid `Side`s, and the comparison is perfectly well-typed nonsense. So the
rule moved out of the component and into `packages/match/src/control.ts`
(`controlsSide`), beside the offer, gift and premove policies it belongs with,
where `control.test.ts` pins it — including the exact regression, that Red
stays movable in pass-and-play after Blue has moved.

The lesson worth keeping: **a mode question was being answered by comparing
two sides.** M4 only ever tested the mode it was building.

**Every moving piece flashed through the top-left square.** A CSS `transform`
*property* replaces an SVG `transform` *attribute* rather than composing with
it. Each piece group carries its `translate` to its square as an attribute, and
the slide/capture animation set the property on that same group — so for the
length of every animation the piece rendered from the SVG origin, then snapped
back when the animation was removed. Measured: a piece resting at (492, 414)
sat at (188, 109) mid-animation, against a board origin of (185, 114). The
illegal-target shake had it too, since that is also a transform on the outer
group.

`piecesLayer` now nests a second, untransformed group (`PIECE_MOTION_CLASS`)
inside each positioned one, and apps/web animates that. Nothing to clobber, so
the transforms compose. It also fixes a capture's `scale()`, which had been
pivoting about the board's corner rather than the piece — `transform-box:
fill-box` puts the pivot on the mark. Shipped broken since M3b, on every move.

While it was open: each keyframe now carries its own easing (WAAPI applies a
keyframe's curve to the interval starting at it, so one curve stretched over
four keyframes was spending its deceleration on the travel and leaving the
overshoot linear), and the captor animation gained `fill: 'both'` so no frame
of the final position paints before the first keyframe.

`render.test.ts` pins the nesting, because apps/web cannot express "do not
clobber my transform" by itself — the markup has to hand it something safe.

**Every game opened with a dashed circle in the top-left corner.** The
keyboard cursor (spec 10.4) initialises to square 0 — `a9` — and the renderer
drew it unconditionally, so a ring sat in an empty corner of every fresh board
looking like a rendering artefact, which is exactly what a player reported it
as. It is now shown only once the keyboard is actually driving: `:focus-visible`
on the board (a tab, not a click) or the first arrow key, whichever comes
first. Pre-existing since M3b.

## What M4b left behind

Four things M3b and M4 had each cut for the same reason, and one of them was
the reason: **the board could not be turned around.** `@sps/board` now does
orientation, and the other three fell out of it.

**Orientation is a display mapping, and only a display mapping.** The engine's
square numbering never rotates — a1 is square 72 whichever way anyone is
looking, and every rule, event and move string stays in those absolute terms.
`packages/board/src/orientation.ts` is the whole of it: `displayCell` and
`squareAtCell`, one pair, used in both directions.

That pair being shared is the point, not a tidiness preference. `apps/web`
needs the mapping read **backwards** — a pointer lands on a screen cell and
has to come back as a `Square` — and it needs it a third time for arrow keys,
which move the cursor in *screen* directions, so a Red-playing human pressing
Up moves up the screen and down the board. A second copy of the rotation would
have disagreed the first time either was touched, and it would have disagreed
*silently*, as taps landing one square off. Nothing type-checks that.

The renderer has one chokepoint (`squareXY`) that every layer already went
through, so pieces, tints, the last-move highlight, selection and the focus
ring all rotated together for free. **The coordinates did not** — that layer
computes its own positions — and a board whose pieces turn while its labels do
not is exactly the bug that survives a screenshot review. `coordinatesLayer`
now reads its letters back through `squareAtCell`, so the two cannot drift,
and `render.test.ts` pins `abcdefghi` against `ihgfedcba`.

**What that unblocked:** Home's side picker (Blue / Red / Random, §10.1),
Rematch's "sides swapped" (§10.7), and the panels below.

**Corner-anchored panels** (the Bar layout). Each player's name sits beside
their own corner rather than in a neutral row. Two things make that work at
360px without a second layout:

* The panel is exactly as wide as the board — `--board-px`, set inline from
  the same number the renderer is handed — so its outer edge lines up with the
  board's and the name really is over the corner square, not the page margin.
* It anchors by **whose** panel it is, never by colour. Because the board turns
  around, the viewer's own corner is always bottom-left on screen, so "yours,
  bottom-left" holds either way where "Blue, bottom-left" would be wrong half
  the time. `place: 'you' | 'opponent'` is the prop; there is no second rule
  for a rotated board.

**Undo refunds the clock**, and the thing that makes it possible is worth more
than the refund. `Game.tsx` keeps a `clockStack` where `stack[n]` is the clock
with n moves played. Undo restores `rewind(stack, target)` and re-anchors it
with `startTurn` — **both** sides, and the stage each was in, not just the
player who pressed it. A single `remainingMs` would have thrown four of those
five things away.

That stack **is** the per-move `remainingMs` §8.3's record carries, which is
why the same commit could finally wire the record's `clock` section — the last
"not built" item C1 left. So Copy link ships a link that tells the truth about
a timed game instead of quietly dropping the clock, which is what
`GameClockRecord`'s own comment asks for.

Gifts made before the undone point survive, because they are in the snapshot;
one made *during* an undone turn does not. Nothing is farmable either way — a
self-gift is already unlimited against the computer (`gifts.ts`: "there is
nobody to cheat"), and in pass-and-play a gift only ever helps the opponent.

**Move list and the full game-over overlay** (§10.7, §10.8). One piece of
state — `viewPly` — serves both of §10.8's readers: tapping a move in the list,
and Review's own stepper. Positions are replayed rather than stacked, because
the move list is the source of truth (`CLAUDE.md`) and a 140-ply replay is well
under a frame. In review the arrows step instead of moving the cursor, which is
not a clash: a read-only board has no cursor to move.

The overlay's numbers come from `summarise` over the engine's event stream,
never from comparing the start position with the end one — "**when** a type
went extinct" is not recoverable from two boards at all, and a capture count
taken by subtracting piece counts would miscount a game where a neutral was
taken.

**Share links** (§8.4) are `packages/engine/src/share.ts`, beside `fen.ts` and
`notation.ts`, because §8 is one subject: how a game is written down. Base64
and UTF-8 are hand-rolled — `btoa` is latin1-only and deprecated in Node,
`TextEncoder`/`Buffer` are environment-specific, and the package's contract is
that browser, AI, tests and any future server run it unchanged. Opening a link
is built too: shipping Copy link without it would have been a button that
produces a dead URL.

**Two bugs, both found by driving the app rather than reading it** — the same
way M3a's scissors and M3b's tap race were:

* **Rematch rendered as plain text.** `.game-over-buttons button` is a class
  plus a type selector, which out-specifies `.play`'s single class in
  `styles.css`, so the primary button lost its background and border and read
  as a label. Restated in `game.css` rather than left to import order.
* **A review ran a clock.** `reviewOnly` started the clock like any game, so a
  shared link left open would have ticked a finished game down to a flag and
  invented a result nobody played for. The clock is now never started in
  review, the flag detector skips it, and the chips are hidden rather than
  showing the control's full 10:00 over a game somebody actually lost on time.

**Not done, and not pretended:**

* **A review does not reconstruct the clock.** The record carries the per-move
  `remainingMs` to do it; nothing replays it yet, so the chips are hidden
  instead of lying. That is a real review feature and belongs with M8.
* **Local stats** (§10.7's wins/losses/draws/streak) are `localStorage`, so
  they are M8's persistence work — the same milestone that owns resuming an
  in-progress game. A streak that reset on every reload would be worse than
  none.
* **Pass-and-play still keeps one orientation**, which is what §10.2 asks for.
  Its optional "flip each turn" setting is Settings work, and off by default.
* **§10.5's consequence line** ("Red has no Paper left — Blue's Rocks are
  permanent") is still missing from the type-counts aid. It is a gap in a
  shipped aid rather than one of these four items, so it was left for M6 with
  the rest of the aid layer.

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

**Not done at the time:** the four-button game-over overlay (spec 10.7's
Rematch/Swap sides/Review/Copy link — M3c ships one of the four), the move
list, and an accurate clock replay on Undo. **All three are M4b's**, which
found that the per-move `remainingMs` spec 8.3 carries did not need M8's
persistence to exist — only to be kept in memory as the game is played. Zen
(C2) has nothing to hide yet — that's the aid layer, M6.

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
