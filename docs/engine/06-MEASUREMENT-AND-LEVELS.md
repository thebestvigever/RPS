# Plan — proving it got better, and what "Hard" should mean afterwards

> Two halves. The first is infrastructure: **every change in `02`–`05` is the
> kind that feels better and isn't**, and without a way to tell them apart this
> work will wander. The second is the product question Vig's complaint actually
> raises — once the engine is strong, what should the difficulty ladder be?

---

# Part one — measurement

## The rule

Stockfish's settings are not chosen by taste. Every proposed change plays tens of
thousands of games against the current version and is accepted only if it wins by
a statistically convincing margin. The infrastructure matters as much as the
code, and it is the reason chess engines improved steadily for thirty years while
most hobby engines plateau.

We need a much smaller version of the same thing. Build it **first**, before
touching `evaluate.ts`.

## 1. Engine-versus-engine matches

`tools/sim` already plays computer-vs-computer and already varies the seed per
game and per ply so games diverge. What it cannot do is play **two different
engines** — `SimOptions` takes a `Level` per side, and levels are the only
configuration that exists.

What is needed:

* An engine *config* object — depth/time, which evaluation terms are on, which
  search features are on — passed per side, with the current `LEVELS` entries as
  named presets.
* Report **Elo difference with an error bar**, not just a win count. 55 wins in
  100 games sounds decisive and is not: the 95% interval spans roughly ±70 Elo.
  This is the single most common way engine work goes wrong.
* **SPRT** — the sequential probability ratio test — so a match stops as soon as
  the answer is clear, instead of always running a fixed number of games. Bounds
  of [0, 5] Elo are the usual "is this an improvement at all?" test. Typically
  a few hundred to a few thousand games; at ~130 plies and 1.2 s a move that is
  hours, so also support a fast control (~50 ms a move) for screening.
* **Varied openings.** Both sides start from the same position every game (§2.3),
  so without variation every game is near-duplicate. Play each opening line twice
  with colours reversed, which also cancels any first-player advantage from the
  result.

## 2. A tactical test suite

Chess has WAC and STS: positions with a known best move, scored as "how many does
the engine find in N seconds." It catches regressions that match play is too
noisy to see, and it runs in seconds rather than hours.

Build one here from three sources:

* **Defensive positions** — the ones this whole project is about. Take the
  self-play positions from `01-DIAGNOSIS.md` §2 where a piece hangs for free and
  the solution is to save it. These are generatable by the hundred; no hand
  authoring needed.
* **Race positions** — where a deep search says "run" and a shallow one says
  "capture." Find them by searching the same position at depth 4 and depth 8 and
  keeping the disagreements.
* **Endgame positions with known answers**, straight from the tablebase in
  `05-LEARNING-AND-TABLES.md` §3. These are ground truth, not opinion.

The repo already has the right shape for this: `TUTORIAL_PUZZLES` in
`packages/engine/src/data/tutorial.json`, position plus expected move in §8.1
notation, checked by comparing `moveToText` against the solution. Reuse it.

## 3. Keep the metrics from the diagnosis

Turn `01-DIAGNOSIS.md`'s measurements into a permanent `tools/bench`:

| Metric | Today | Target |
|---|---|---|
| Moves leaving a piece hanging for free (Hard) | 32.7% | < 5% |
| Free threats ignored (Hard) | 74% | < 10% |
| Depth reached in 1.2 s (midgame) | 3–4 | 7–8 |
| Nodes per second (midgame) | 24 500 | 150 000+ |
| Effective branching factor | 14.3 | ~5 |

Each of these is a one-line regression check and each one maps to a specific
document. The first two are the ones Vig would actually notice.

## 4. The balance guard still has to hold — and may not

§9.6's CI guard: at Medium against Medium over 200 games per variant, the first
player's share of decisive games stays between 40% and 60% and draws stay under
10%. `checkBalanceGuard` already encodes it.

**Expect this to move, and do not "fix" it quietly.** §6.1 already shows the
effect: the Original leaned to the *second* player at depth 2 (43% first-player
wins over 260 games) and evened out at depth 3. The spec's own explanation is that
"stepping into contact first tends to hand the opponent the first capture; a
player who looks further ahead avoids that." An engine at depth 7–8 is a
different observer again, and the balance may well shift a third time.

If it does, that is **a finding about the game**, not a bug in the engine, and it
lands squarely on §14's open questions — which variant ships as the default, and
whether the draw rules need revisiting. Per CLAUDE.md: propose and draft; Vig
decides. It is explicitly not a fix-it-while-you're-there.

Also worth re-running: §6.3's Keep numbers. A stronger engine that can see
sealing coming will seal far more than 7 games in 60, and the Keep's draw rate is
the thing most likely to become a product problem.

## 5. Determinism is a contract, not a nicety

§7.8 requires that the same position, level and seed produce the same move.
`tools/sim`, the fixtures, shared game links and any future server bot all depend
on it. `04-SPEED.md` must not change a single chosen move; `03-SEARCH.md`'s time
management will, unless it is given a node budget rather than a clock in
reproducible contexts.

**Decide this before building.** A transposition table that persists between
moves already makes the search path-dependent on what was searched earlier —
which is fine for play and fatal for a fixture test that expects an exact move.
Clearing the table per search is the simple answer and costs little at these
sizes.

---

# Part two — what "Hard" should mean

## The problem this work creates

Vig's complaint is that Hard is too easy. After `02`–`04`, Hard will be
substantially stronger than any human who has ever played this game — because,
as `ROADMAP.md` puts it, nobody has studied it and there is no accumulated theory
to beat. The likely outcome is a ladder with three levels where the top one is
unbeatable and the gap below it is enormous.

**So the ladder needs rebuilding as part of this work, not after it.**

## Weakening an engine well is its own problem

The obvious approach — reduce depth and add noise to the evaluation — produces an
opponent that plays five good moves and then throws a piece away for no reason.
Players read that as the game being broken, not as the level being easy. It is
also how most chess apps do it, and it is why their easy levels are unpleasant.

Lichess's **Maia** is the state of the art in the other direction: neural networks
trained to predict what a *human of a given rating* would actually play, one
model per rating band. It predicts human blunders — including hanging a queen —
over 25% of the time, because human mistakes are systematic rather than random.
We cannot do that here: it needs millions of human games and this game has none
yet. (Though if online play takes off, §13 games would be exactly that dataset.)

## A ladder that would work here

The realistic middle ground, in rough order of how human the result feels:

1. **Search depth and time** remain the main knob — a genuine ladder, as §9.3
   already establishes and §6.2 confirms (depth 3 beat depth 1 in 53 of 60).
2. **Turn evaluation *terms* off, not just depth.** A level without the threat
   term from `02-EVALUATION.md` plays exactly like today's engine: reasonable
   shape, misses tactics. That is a far more human weakness than random noise,
   and we get it for free because it is what we have now. Likewise
   `keepTerms: false` at Easy is already this idea (§9.3).
3. **Make blunders deliberate and bounded.** Instead of random noise, at a given
   probability choose the best move that loses *at most one piece* rather than the
   best move outright. The mistake is then the kind a person makes — a missed
   capture — not a move no one would ever play.
4. **`jitter` stays** as the variety mechanism it already is (§9.1), so the same
   level does not play the identical game.

## A draft ladder, for Vig to accept or reject

Five levels rather than three, because the strength range is about to get much
wider:

| Level | Search | Threat term | Keep terms | Deliberate slips | Meant for |
|---|---|---|---|---|---|
| Gentle | 1 ply | off | off | often | First game ever |
| Easy | 2 plies | off | off | sometimes | Knows the rules |
| Medium | ~4 plies | on | on | rarely | Has played a few |
| Hard | full, 1.2 s | on | on | never | Wants a real game |
| Ruthless | full, 4 s + book + tables | on | on | never | Wants to lose |

Two things worth saying plainly:

* **Keep a level that is beatable.** An engine nobody can beat is a worse product
  than one that can be beaten on a good day. "Hard" should be the strongest level
  a committed human can still take a game off; "Ruthless" is the wall, clearly
  labelled as such.
* **Target the levels by outcome, not by depth.** "Gentle loses about half its
  games to someone playing their first game" is a testable claim. "Depth 1" is
  not a promise about anything.

**This is a §14 decision.** The names, the count, and whether deliberate slips are
acceptable at all are customer-facing calls, and CLAUDE.md is explicit: propose
and draft; Vig decides. The table above is a draft.

## One more thing, which is free

§9.5's **Hint button** is specified and still unbuilt (`BUILD_PLAN.md`, "What M6
left behind"). A stronger engine makes hints genuinely useful — and post-game
analysis (§13.5) even more so: "you lost the game here, and here is why" needs an
engine that actually knows. `analyseRoot` already returns every root move with a
score, which is the whole data requirement. The engine work pays for a feature
that is otherwise hard to justify.
