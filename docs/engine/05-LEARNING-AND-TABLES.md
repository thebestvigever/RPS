# Plan — tuning, books, and solving the endgame

> Everything here assumes `02`–`04` have landed. These are the things that make
> an engine strong *without* making it faster: better numbers, remembered
> openings, and perfect endings.
>
> `ROADMAP.md` §4 already sketches this and gets the framing right — including
> the observation that matters most: **nobody has ever studied this game.** A
> chess engine had to beat centuries of human theory. Here there is none. A
> moderately strong engine is already beyond every human player alive, because no
> human yet knows what good play looks like.

---

## 1. Stop guessing the weights

§9.2's weights (100 / 70 / 28 / 0.35 / 3000 / 6) were chosen by hand for the
reference engine. `02-EVALUATION.md` adds five or six more. Hand-picking eleven
interacting numbers does not work — it is how evaluations get *worse* while
feeling better.

**Texel tuning** is the standard answer and it fits this repo almost too neatly.
The method: take a large set of positions, each labelled with how the game it
came from actually *ended* (1 / ½ / 0), and fit the weights so that
`sigmoid(K × score)` predicts that outcome. It is ordinary logistic regression;
no neural network, no GPU, no special infrastructure.

**We already produce the data.** `tools/sim` plays computer-vs-computer games and
`seedFor` already varies the seed per game *and* per ply specifically so games
diverge. What is missing is three small pieces:

1. Record positions, not just summaries — sample a few quiet positions per game.
2. Label each with its game's result.
3. A fitter: ~100 lines, gradient descent or plain coordinate descent over the
   weight vector, minimising mean squared error.

**Two warnings that matter more here than in chess:**

* **Self-play labels inherit the engine's blind spots.** If the engine cannot see
  threats, positions where it is about to lose a piece get labelled by whatever
  happened next — which was also decided blindly. Tune *after* `02-EVALUATION.md`,
  not before, and mix in games from several levels and randomised openings.
* **A lower tuning loss is not a stronger engine.** Validate by **match play**,
  never by the loss curve. See `06-MEASUREMENT-AND-LEVELS.md`.

**SPSA** is the other tool worth knowing: it tunes *search* parameters (LMR
reduction amounts, futility margins, aspiration width) that no position-labelled
dataset can express, by perturbing several at once and playing matches. Slower,
noisier, and only worth it once the search has parameters worth tuning.

---

## 2. An opening book

The starting position is fixed (§2.3) and Blue has exactly 36 legal moves
(§11.3). The first ten plies get searched from scratch, identically, every single
game — and they are the plies where a shallow search is least reliable, because
nothing is resolved yet.

A book is cheap here:

* Search the start position deeply **once**, offline, at depth far past anything
  the live engine can afford. Store the best few moves with their scores.
* Expand breadth-first down the lines that self-play actually reaches, to maybe
  8–12 plies.
* Keep several moves per position with weights, so the AI still varies (the
  `jitter` mechanism in §9.1 exists precisely so it does not play the identical
  game every time — a book must not undo that).

**One nice shortcut: the book is half the size you think.** The starting position
is 180°-rotationally symmetric (§2.3), so Red's book is Blue's book rotated. Store
one.

A book also *hides* the engine's opening weakness, which is a real product win
independent of strength: the first ten moves come back instantly and look
confident.

---

## 3. Solving the endgame exactly

This is the shortcut chess cannot fully use, and `ROADMAP.md` §4 is right to
flag it. Here are the actual numbers.

**Retrograde analysis** works backwards from terminal positions. Ours are clean:
a piece standing on its goal (§2.7), and a side to move with no legal move
(§2.8). Everything else is derived: a position is a win if some move leads to a
loss for the opponent, a loss if every move does.

**How many positions?** `k` pieces on 81 squares, each one of 6 kinds
(2 owners × 3 types), times 2 for side to move:

| Pieces | Positions | After symmetry (÷4) | At 2 bits each |
|---|---|---|---|
| 2 | 233 280 | 58 000 | 15 KB |
| 3 | 36 858 240 | 9.2 M | **2.3 MB** |
| 4 | 4 312 414 080 | 1.08 G | 270 MB |
| 5 | ~4 × 10¹¹ | — | out of reach |

**Where the ÷4 comes from** — and this is a nice piece of geometry worth writing
down, because it is not obvious:

* **180° rotation + colour swap.** Standard; §2.3 already notes the start
  position has it.
* **Reflection in the a1–i9 diagonal.** Mapping `(row, col) → (8 − col, 8 − row)`
  fixes `a1` and `i9`, preserves king distance, and therefore preserves *every*
  rule of the game. Checked against all three variants: it maps the 2×2 Corner's
  goal block to itself (`h8→h8`, `i8↔h9`, `i9→i9`) and the Neutrals layout to
  itself (`c7↔g3`, `e5→e5`). **All three variants have it.**

So: **three pieces is 2.3 MB and genuinely shippable.** Four pieces is 270 MB —
computable overnight on a laptop, too big to ship, but that is not the point.

**The point of the 4-piece table is not to ship it.** It is an *oracle*. With it
you can:

* Score the evaluation function against ground truth on millions of positions and
  find out exactly where it lies.
* Test whether the "unstoppable runner" detector from `02-EVALUATION.md` Term 2
  is actually sound, rather than hoping.
* Generate perfect training labels, which sidesteps every self-play bias in §1.

Chess engines got most of their endgame knowledge this way; it is the only part
of engine building where you can be *certain* you are right.

**Three caveats, all real:**

* **Draws are path-dependent.** Threefold repetition and the 300-ply limit (§2.9)
  depend on the move history, not the position. Standard resolution: compute
  win/draw/loss ignoring the ply limit, then treat a win that needs more plies
  than remain as a draw at probe time. Chess's Nalimov tables ignore the 50-move
  rule for exactly the same reason.
* **Store depth, not just the verdict.** A win/draw/loss table alone makes an
  engine shuffle forever in a won position. Store distance-to-win as well, or
  keep searching and use the table only as a leaf oracle.
* **Neutrals need their own tables.** A neutral piece is a fourth "owner" and
  multiplies the kind count. Do Original first.

**Where this pays off in real games.** §6.2: 68% of games see one side lose every
piece of a type, and §6.3's Keep positions are exactly low-piece endings where a
single tempo decides everything. These are the positions a shallow search handles
worst and a table handles perfectly.

---

## 4. A learned evaluation — and why it is last

Stockfish's NNUE is a small network — a few hundred binary inputs, one wide
hidden layer, one output — made fast enough to run at every node by **incremental
updates**: a move changes two or three inputs, so the first layer's accumulator is
carried forward rather than recomputed. Quantised to integers, it runs in
microseconds. It was worth a very large jump in strength despite roughly halving
Stockfish's node rate.

A version for this game would be modest: 6 × 81 = 486 inputs per perspective
(no king-bucketing — there is no king), an accumulator of maybe 256, one output.
A move touches at most three inputs, so the same accumulator trick applies
directly. In plain JavaScript with `Int16Array`, that is plausibly 1–2 µs an
evaluation — the same ballpark as the hand-written evaluation *after*
`04-SPEED.md`.

**It is still the last thing to do**, for one reason: a network trained on
self-play from a threat-blind engine learns to be threat-blind. Fix the
evaluation, tune it, build the tables, *then* train against the tables — which is
the one training signal that carries no bias at all.

---

## 5. What about MCTS and AlphaZero-style self-play?

Worth knowing about, and worth **not** doing.

Monte-Carlo Tree Search beats alpha-beta where a good static evaluation is hard —
Go, Havannah, Amazons. This game is the opposite: captures are frequent, tactics
are short and forcing, and the evaluation signal (material, permanence, distance
to goal) is strong and cheap.

The closest published analogue is **Breakthrough** — an abstract race game where
you win by reaching the opponent's back rank, with identical pieces and no
material ladder. The research consensus there is that Breakthrough is a domain
where pure MCTS struggles, because race games are full of *traps*: a line that
looks fine in a random playout is losing to one precise sequence. What works is
**hybrids** — MCTS with minimax backups, or an evaluation function inside the
playouts. Lines of Action and Amazons show the same pattern.

Read: alpha-beta is the right backbone for this game. Spend the effort on §1–§3.

---

## Suggested order

1. **Opening book** — a weekend, immediate visible effect, no risk.
2. **Texel tuning** — a few days, and it retires every hand-picked number in
   `02-EVALUATION.md`.
3. **3-piece tablebase** — 2.3 MB, ships, makes the AI perfect in endings.
4. **4-piece tablebase as an oracle** — the single best validation tool available,
   and it makes everything above verifiable rather than believed.
5. **A learned evaluation** — only if 1–4 are exhausted and someone still wants
   more.
