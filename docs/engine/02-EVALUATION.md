# Plan — teaching the evaluation what it is looking at

> Fixes the actual complaint. Everything in `01-DIAGNOSIS.md` §1 and §2.
>
> **§9 of the spec is not normative** (only §2–§5 are), so these weights are free
> to change. But §9.2's weights produced every number in §6, so per CLAUDE.md:
> run `pnpm sim` before and after, and say what moved. The §9.6 CI guard —
> first-player share of decisive games between 40% and 60%, draws under 10%, at
> Medium over 200 games per variant — must still hold afterwards.

---

## The one idea to take away

Chess evaluations are a sum of independent features: material, pawn structure,
king safety, mobility. Ours is too. But chess has a **value ladder** — a queen
beats a rook beats a bishop — and ours has a **cycle**. That single difference
changes what the features should be, and it hands us one identity that makes
everything else fall out:

```text
predator(predator(t)) === beats(t)
```

The predator of my Rock is Paper. The predator of Paper is Scissors. And
Scissors is exactly what a Rock beats. Which means:

> **A piece is defended by a friendly piece of the type it itself beats.**
> Your Scissors are guarded by your Paper. Your Paper is guarded by your Rock.
> Your Rock is guarded by your Scissors.

That is not a coincidence, and it is not new — it is the starting position.
§2.3's wedge (Scissors in front, Paper in the middle, Rock at the back) is a
**fully mutually defended chain**: every front Scissors has a Paper behind it,
every Paper has a Rock behind it. The spec calls this "each side's back row of
Rock is exactly what eats the enemy's front row of Scissors." It is also what
guards your own middle. The formation the spec chose by feel is the one this
identity predicts.

Every term below is built out of that.

---

## Term 1 — Threats. *(the one that matters)* — SHIPPED

**Status: implemented**, in `evaluate.ts` (the term) and `search.ts`
(quiescence evasions). What is below is the plan as designed; the box right
after it is what actually shipped, and why it is simpler.

**The chess analogue:** hanging pieces, and "you may not stand pat while in
check." The Chess Programming Wiki's rule for quiescence search is that stand-pat
is forbidden when the side to move is in check, because the assumption behind it
— *I could always decline to act and be no worse off* — is false there. This game
has no check. Its equivalent is **"a piece of mine is attacked and cannot be
recaptured."** We currently treat that as a quiet position. It is not.

**What to compute.** For each piece `p` on square `x` belonging to side `S`:

* `attacked(x)` — some adjacent enemy piece has type `predator(p.type)`.
  `threatenedBy()` in `packages/engine/src/analysis.ts` already does this, and
  the AI has never called it.
* `defended(x)` — some adjacent **friendly** piece has type `beats(p.type)`, by
  the identity above. (Check it directly rather than trusting the identity in
  code; write the identity down as a test.)
* `canFlee(x)` — some adjacent square is empty or capturable **and** not itself
  attacked. On a 9×9 board where everything moves like a king this is nearly
  always true, which is why fleeing, not defending, is the main resource here.

**How to score it.** Not linearly, and not symmetrically in whose turn it is:

| Situation | Roughly worth | Why |
|---|---|---|
| Attacked, undefended, **opponent to move** | −85 | It is gone. Not −100, because they must spend a move and may prefer something else. |
| Attacked, undefended, **my move** | −25 | I can almost certainly save it, but it costs me the move. This is a tempo loss, not a material loss. |
| Attacked **and** defended | −10 | An exchange is available; usually near-even, slightly bad because they choose whether to take. |
| I attack an undefended enemy piece, **my move** | +85 | Mirror. |

**Only count one.** If three of my pieces hang and it is their move, they still
only take one per turn. Summing three threats linearly is how engines end up
panicking and throwing material away to "solve" a problem that was never three
problems. Take the **worst** threat at full weight and the rest at roughly a
quarter. Chess engines do the same thing for the same reason.

**Do a real exchange evaluation, and note that it is unusual.** Static Exchange
Evaluation in chess sorts attackers by *value* — always recapture with the
cheapest. Here every piece is worth the same and only *type* decides who may
capture. So the swap-off on square `x` is a walk around the cycle: whoever
stands on `x` can be taken only by the one type that beats them, and each
capture changes which type is needed next. It terminates in at most a handful of
steps, and it is genuinely simpler than chess's version. Write it as
`exchangeOn(state, square)` returning net pieces won or lost. **Not shipped
yet** — see "left on the table" below.

**Expected effect.** This is the fix for "it doesn't defend." It should take the
"left a piece hanging for free" rate in `01-DIAGNOSIS.md` §2 from 33% to single
digits without any extra depth at all.

> **What actually shipped, and why it's simpler than the table above.**
>
> The −85/−25/+85 asymmetry above tries to price *who gets to act first*. It
> turns out `evaluate()` cannot do that: every call is already "my move" by
> definition (`me = state.turn`), so within one call there is no way to
> distinguish "opponent to move" from "my move" for the *same* side's pieces —
> that distinction only exists by comparing DIFFERENT calls a ply apart, and
> negamax's own sign-flip already handles it. Trying to bake it into the
> weights broke `evaluate.test.ts`'s antisymmetry test
> (`evaluate(state) === -evaluate(flip(state))`, flipping only `turn`), which
> every other term in this file satisfies by construction.
>
> So the shipped version drops the asymmetry and keeps everything else:
> `hanging` (attacked, undefended) at 85 and `contested` (attacked, defended)
> at 15, each with a quarter-weight `Extra` for a second simultaneous
> instance (exactly the "only count one" rule above), combined the same
> `theirs − mine` way as material or distance. The result is *not* trying to
> say "I could capture this right now" — the search's own move exploration
> already finds that capture and scores it directly, one ply on. This term
> only has to say "an undefended piece is a real, standing danger," which is
> exactly the fact the search was missing, and `defendersOf()` (new, alongside
> `threatenedBy()` in `packages/engine/src/analysis.ts`) is the defended-check
> the plan called for.
>
> **Left on the table for later:** the real `exchangeOn()` walk (deeper
> exchanges — a defended piece whose defender is itself undefended, and so
> on), and `canFlee` as an input to the *evaluation* rather than only to the
> search (below). Both are refinements on a term that already measurably
> works — see the measured effect in `01-DIAGNOSIS.md`'s follow-up.

---

## Term 2 — The race, as a verdict rather than a slope

**The chess analogue:** the *rule of the square* for passed pawns, and endgame
tablebases. A chess engine does not score "my pawn is advanced, +0.4" when the
pawn is unstoppable — it scores it as a win, because that is what it is.

§6.4's own strategy note 4 says the same thing about this game: *"When nothing
can intercept, the runner closer to its goal — counting whose turn it is —
arrives first, and king distance makes the count easy."* The interface already
shows this to the player as the race meter (§10.5). **The AI approximates it with
`28 × distance` and a `(9−d)²` curve, which is a slope where the truth is a
cliff.**

Two pieces:

**(a) A hard, conservative "unstoppable" detector.** Returns a win score, not a
bonus. Conditions, all cheap:

1. My runner is **permanent** (`permanentMask` already knows), so it cannot be
   captured at all; *or* no enemy piece of its predator type can reach a square
   adjacent to its remaining path in time.
2. No enemy piece can reach any square of my goal region before I do, counting
   the tempo — `distance(enemy, goal) ≤ myDistance` decides it, adjusted by one
   for whose move it is.
3. The goal square is empty, or holds something my runner beats.

Be strictly conservative: a false "unstoppable" is a thrown game, a missed one
just costs you the old behaviour. Start with "permanent runner, and no enemy
piece within `myDistance` of the goal region," which is sound and catches the
common case.

**(b) A non-linear race margin** for everything the detector does not settle.
`margin = theirDistance − myDistance` (± 1 for the tempo) should be worth far
more at `margin = 2, myDistance = 3` than at `margin = 2, myDistance = 7`,
because a long race has time to go wrong. Something like
`w × margin × (9 − myDistance)` rather than the flat `28 × margin` we have now.

**Why this matters beyond winning races:** a detector that says "they are
unstoppable in three" is also what makes the AI *come back and defend*. Right
now a runner heading for its corner registers as a gentle negative drift that
any capture elsewhere outweighs.

---

## Term 3 — Extinction economics

**The chess analogue:** the bishop pair, opposite-coloured bishops, and "the last
pawn" — material terms that are *interactions*, not sums. Nobody scores a chess
position as 9·Q + 5·R + 3·B; every strong engine adjusts piece values by what
else is on the board.

§6.2 is unambiguous about what decides games here:

> Games in which one side loses every piece of some type: **68%**.
> …and the side that wiped out a type first went on to win: **65%**.

And yet the evaluation prices every capture at a flat 100. Taking their third
Scissors and taking their **last** Paper score identically — even though the
second one makes every Rock you own permanent, forever.

**The fix is derivable, not a guess.** The permanence term is already worth 70 a
piece. So the value of removing the enemy's last Paper is exactly:

```text
70 × (number of Rocks I have)
```

because that is the permanence bonus you collect the moment it dies. So make the
pressure on a scarce enemy type proportional to what its death would free:

```text
extinctionPressure = Σ over enemy types t:
        scarcity(count_enemy(t)) × 70 × count_mine(beatenBy(t))
```

with `scarcity(1)` large, `scarcity(2)` modest, `scarcity(3+)` ≈ 0. Mirror it for
your own types, which gives you the other half for free: **your last Rock is not
worth 100, it is worth 100 plus everything it is holding down.** That is what
"my piece is precious" means here, and it is why the AI should not trade it off
casually.

This also fixes move ordering (`03-SEARCH.md`): captures are currently ordered
flat, so the single most important capture in the game is tried in board order.

---

## Term 4 — Mobility, and not being smothered

**The chess analogue:** mobility is one of the oldest evaluation terms there is,
and stalemate avoidance. Here it is sharper than in chess, because **running out
of moves is a loss** (§2.8) — not a draw.

A full mobility count means a second move generation per node, which we cannot
afford yet (see `04-SPEED.md`). Two cheaper versions, in order:

* **Smother danger only.** A steep penalty when your own move count drops below
  about 4, and nothing at all above that. 45 moves versus 43 means nothing; 3
  versus 8 means the game. This is one `if` and it catches the real cases.
* **Empty-neighbour count** as a proxy, summed over your pieces. Falls out of a
  loop you are already running.

Do the full symmetric mobility term only once the node is cheap enough.

---

## Term 5 — Cover, or "respect the layers"

§6.4's strategy note 5: *"Your back Rocks are the answer to their front Scissors.
Moving them forward early opens your corner."*

By the identity at the top, this is one line of code: count your pieces that have
at least one friendly piece of the type they beat within one square, and weight
it — with a *rearward* bias, since a defender between the piece and your own
corner is worth more than one in front of it.

**The chess analogue:** pawn structure. Defended chains, weighted by direction.
This term is what stops the AI dismantling its own wedge in the first ten moves —
which, watching it play, is roughly what it does.

---

## Term 6 — Small corrections to what is already there

* **Tempo.** A fixed bonus (~10) for the side to move. Every chess engine has
  this. In a race game it is worth more than in chess, since a tempo *is* the
  race.
* **Corner occupancy for non-permanent pieces too.** The Keep terms only count
  permanent pieces near home (§9.2). But an ordinary piece parked on your own
  corner still has to be captured before anyone can enter (§2.7) — it is worth
  something, just much less than a permanent one.
* **Neutral pieces are invisible to the evaluation** (§9.2 says so deliberately).
  In the Neutrals variant a neutral Paper sitting next to your Rock is a real
  threat *to both sides*, and `permanentGiven` already knows neutrals count as
  predators. Once Term 1 exists, letting it see neutrals is nearly free.

---

## Two properties worth testing, not just asserting

`fast-check` is already a dev dependency, so make these property tests:

1. **Rotational antisymmetry.** The game is 180°-symmetric (§2.3). So for any
   position, `evaluate(pos) === -evaluate(rotate180AndSwapColours(pos))`. Any
   new term that breaks this has a sign or an index bug, and this catches it
   instantly on random positions.
2. **The cycle identity.** `predator(predator(t)) === beats(t)` for all three
   types. One line, and it is the load-bearing assumption under Terms 1 and 5.

---

## Order of work, and what to expect

| Step | Effort | Expected |
|---|---|---|
| Term 1 (threats) + qsearch evasions (`03-SEARCH.md`) | ~1 day | The complaint goes away. Biggest single jump in the whole document. |
| Term 3 (extinction) + capture ordering | ~half a day | Plays the game's actual strategy instead of grabbing material. |
| Term 2 (race verdict) | ~1 day | Stops losing races it could see; starts winning ones it currently drifts out of. |
| Terms 4–6 | ~half a day | Positional polish; small individually. |
| Re-tune every weight together | see `05-LEARNING-AND-TABLES.md` | The weights above are **guesses to start from, not answers.** |

**Say this out loud before shipping any of it:** these terms interact. Adding
five hand-picked weights and declaring victory is how evaluations get worse while
feeling better. Add them one at a time, gate each on a match against the previous
version (`06-MEASUREMENT-AND-LEVELS.md`), and then tune the whole set together.
