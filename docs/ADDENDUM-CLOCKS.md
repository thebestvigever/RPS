# Addendum — clocks, offers and time gifts

**Status:** normative, and it overrides the base spec where they disagree.
**Decided by:** Vig, 21 Sep 2026.
**Rules version:** still `1`. No rule of play changes — see "Versioning" below.

The base spec puts clocks in the future (§13.2, "the server keeps them") and
draw offers in pass-and-play only (§2.9). Vig asked for both in v1, on device,
plus two ways of handing time around. This records what that means, because
`docs/spec.md` is the source of truth for this repo and a silent divergence from
it is worse than a change to it.

---

## 1. The engine still has no clock

§7.1's rule stands and is not weakened: *the engine is pure — same state plus
same move always gives the same result, and nothing in it knows about screens,
clocks or networks.*

Clocks live in `packages/match`, which is also pure: it holds no timer and
**never reads the time itself**. Every operation is handed `now`. That is what
makes a clock testable to the millisecond, replayable from a game record, and —
when online play arrives — runnable on the server with the identical code. §13.2
wanted the server to own the clock; keeping the clock out of the engine *and*
out of the app is what makes that a move rather than a rewrite.

The engine learns a game ended on time only because somebody tells it:
`flag(state, side)` sets a result, exactly as `resign` already did.

## 2. Result vocabulary

`GameResult` gains two reasons:

| Reason | Winner | Meaning |
|---|---|---|
| `flag` | the opponent | `side` ran out of time |
| `aborted` | nobody | abandoned before it was a game; counts for nothing |

`agreed` and `resign` were already in the type (§7.2) and now have helpers:
`agreeDraw(state)` and the existing `resign(state, side)`.

## 3. Versioning

`rulesVersion` stays **1**. It versions the *rules of play* — what moves are
legal and how a game is won — and none of those changed. A game played with a
clock is the same game.

What did change is the *record* vocabulary: a v1 record may now carry
`reason: "flag"` and a `clock` section. A reader written before this addendum
would not understand either. Nothing is shipped, so this costs nothing today —
but it is the reason a reader should treat an unknown `reason` as "finished,
cause unknown" rather than throwing.

## 4. The record has to carry the clock

§8.3 says the move list is the source of truth, and `replay(variant, moves)`
rebuilds the state. That is still true of the *position* and false of the
*clock*: no amount of move text says how long someone thought.

So a timed game records the control, what each move left on the clock, and
**every gift of time**. Without the gifts, a shared game would quietly hide that
someone handed themselves ten extra minutes.

```ts
clock?: {
  control: string;        // preset id, or a custom control's id
  initialMs: number;
  incrementMs: number;
  remainingMs: number[];  // after each move in `moves`
  gifts?: Array<{ ply: number; from: Side; to: Side; ms: number }>;
}
```

## 5. Time controls

A control is a list of **stages**, so tournament controls ("40 moves in 90
minutes, then 30 minutes, 30 seconds a move throughout") are expressible rather
than special-cased. Most are one stage.

Four bonus kinds: `none` (sudden death), `fischer` (added every move),
`bronstein` (you get back what you used, up to the delay) and `simple` (the US
delay: the clock waits before counting down).

> **Bronstein and simple delay are the same arithmetic.** Both cost a turn
> `elapsed − delay`. They differ only in what the clock *shows*: simple waits
> then counts down; Bronstein counts down at once and jumps back when the move
> is made. They are two kinds here so the display can tell them apart, and one
> code path so they can never disagree about the time.

### Presets assume this game's length, not chess's

Lichess estimates a chess game at 40 moves. §6.1 measured **this** game at
129–138 plies — about 67 moves a side. `TYPICAL_MOVES = 67`, and the categories
(bullet / blitz / rapid / classical) are derived from it.

That is not a detail. At 67 moves, a 2-second increment is worth over two
minutes, so a "3+2" here plays much longer than a chess 3+2. Every preset
except the shortest carries an increment: without one, a long endgame on a short
clock is decided by the clock rather than the board, which would waste the thing
that makes the game interesting.

## 6. Giving time away

Two separate gestures, both 15 seconds a press:

* **To your opponent.** Lichess's courtesy, and like theirs it is casual-only:
  in a rated game it would be a way to buy a result.
* **To yourself, against the computer, as often as you like.** There is nobody
  to cheat. It makes a timed game against the computer a soft limit rather than
  a hard one — the difference between losing a good position to a phone call and
  not.

| Mode | To opponent | To self |
|---|---|---|
| Pass-and-play | yes | no |
| Against the computer | yes | **yes, unlimited** |
| Online casual | yes | no |
| Rated | no | no |

Every gift is recorded (§4 above).

## 7. Draw offers

The engine already knew a game can end `agreed`; this is the etiquette. The
rules are lichess's, because they are the ones players expect:

* one pending offer at a time;
* making a move declines a draw offer you were sitting on;
* offering into an opponent's identical offer accepts it;
* and you cannot re-offer straight after a refusal.

That last one earns its place: without it, "offer draw" is a way to interrupt
someone once a move while their clock runs.

Threefold repetition and the 300-ply limit stay **automatic** (§2.9). Lichess
makes threefold a claim; this game does not, and should not — it already has
enough for a new player to hold in their head.

### The computer's answer

`shouldAcceptDraw` takes the offer when the computer is not meaningfully ahead
(under 60 points, where a piece is 100), and refuses in the first 24 plies,
where an offer is a player trying their luck rather than a real proposal.

It also accepts outright when **both corners are sealed**, whatever the
evaluation. Neither side can then win by the corner (§2.10), and §6.3 found that
is exactly where the Original's draws come from. There is nothing to play on
for, and a computer that refused would just be running out the move limit.

---

## Still open — for Vig

1. **A flag against a player who could not have won.** Chess gives a draw if the
   winner has insufficient mating material. The analogue here is real: if your
   corner is sealed and your opponent flags, should you win on time, or is it a
   draw? Current behaviour is the simple one — **the flag loses, always**.
2. **A first-move time limit.** Lichess aborts a game if nobody moves in the
   first 30 seconds. Worth having if online play arrives; pointless before.
3. **Whether gifts belong in pass-and-play at all.** Both clocks are on one
   device, so giving your opponent time is a gesture between two people in a
   room. Kept because it costs nothing; drop it if it just clutters the bar.
