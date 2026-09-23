# A stronger computer opponent

`ROADMAP.md` §4 is the one-page version of this, written for someone who does not
write code. **This folder is the layer below it**: what is actually wrong,
measured; what to do about it; and in what order.

It exists because of a specific report from Vig:

> *"I am able to beat the computer on Hard also quite easily. Among other
> problems, I sense that it doesn't defend at all — it's not considering when I
> have a piece moving towards its square to capture."*

That report is right, and the cause turned out not to be the obvious one.

---

## The finding, in three lines

**The evaluation function cannot see a threat.** Not "sees it poorly" — there is
no term in `packages/ai/src/evaluate.ts` that reads an adjacent square. A piece
one move from being captured for free scores exactly the same as a safe one. The
engine has had `threatenedBy()` and `dangerAfter()` since M6, written for the
interface's threat lines, and **the AI has never called either.**

Measured consequences, Original variant, self-play:

| | Medium | Hard |
|---|---|---|
| Moves that leave a piece hanging **for free** | 13.9% | **32.7%** |
| Positions where a piece was already hanging free, and it played elsewhere | 54% | **74%** |
| Depth reached in the 1.2 s budget (midgame) | 2 | **3–4** |
| Nodes per second (midgame) | — | **24 500** |
| Effective branching factor (depth 3 → 4) | — | **14.3×** |

Hard is *worse* than Medium at not hanging pieces. That is not a paradox: it
searches deeper, so it pushes harder and makes more contact, and every contact is
another threat it cannot price.

Full working, and how to reproduce every number: **[`01-DIAGNOSIS.md`](01-DIAGNOSIS.md)**.

---

## The documents

| | | |
|---|---|---|
| **[01-DIAGNOSIS.md](01-DIAGNOSIS.md)** | What is wrong, measured | Read first |
| **[02-EVALUATION.md](02-EVALUATION.md)** | Threats, races, extinction economics, mobility, cover | **The fix for the complaint** |
| **[03-SEARCH.md](03-SEARCH.md)** | Transposition table, move ordering, PVS, LMR, quiescence, time | Branching factor 14 → 5 |
| **[04-SPEED.md](04-SPEED.md)** | Incremental counters, piece lists, allocation-free move generation | 40 µs/node → 6 µs |
| **[05-LEARNING-AND-TABLES.md](05-LEARNING-AND-TABLES.md)** | Texel tuning, opening book, endgame tablebases, NNUE | After the above |
| **[06-MEASUREMENT-AND-LEVELS.md](06-MEASUREMENT-AND-LEVELS.md)** | How to prove a change helped; and rebuilding the difficulty ladder | **Build this first** |

---

## The order to actually do it in

0. **Measurement harness** (`06`, part one). Engine-vs-engine matches with error
   bars, a tactical test suite, and the diagnosis metrics as a benchmark. Every
   change below is the kind that feels better and isn't. **Shipped** — as
   `tools/bench`, after step 1 rather than before it (Vig's report was the more
   urgent problem); see `06`'s own status box for what landed and the two
   differences from the plan (budget-bounded levels stand in for literal depth
   pairs like "4 vs 8", and the endgame-puzzle source still waits on `05`).
1. **Threat awareness** — `02` Term 1, plus `03` §5 (quiescence evasions). These
   two only work together, and together they are the answer to Vig's complaint.
   Biggest single jump in the whole folder. **Shipped** — see both docs' status
   boxes for what landed and the one simplification (a symmetric evaluation
   term rather than the asymmetric one first sketched, to keep the
   antisymmetry invariant `evaluate.test.ts` already checks).
2. **Make the node cheap** — `04` §1–§3. No behaviour change, ~5×, and it pays for
   everything after it.
3. **Fix the search** — `03` §1–§4 and §6. PV-first ordering, a transposition
   table, killers and history, PVS.
4. **The rest of the evaluation** — `02` Terms 2–6: the race as a verdict,
   extinction economics, mobility, cover.
5. **Tune it properly** — `05` §1. Retires every hand-picked weight.
6. **Then the long tail** — book, tablebases, LMR, a learned evaluation.

Rough shape: step 1 is about a day and fixes the complaint. Steps 0–4 are a
couple of weeks and take Hard from depth 3–4 to depth 7–8 with an evaluation that
sees the board. Steps 5–6 are open-ended.

---

## Three things that are specific to *this* game

Most of what is in here is standard chess-engine machinery. These three are not,
and they are where the real advantage is:

**1. The cycle identity.** `predator(predator(t)) === beats(t)`. Which means: **a
piece is defended by a friendly piece of the type it itself beats.** Your
Scissors are guarded by your Paper; your Paper by your Rock; your Rock by your
Scissors. §2.3's opening wedge is exactly a fully mutually defended chain — the
formation the spec chose by feel is the one this identity predicts. Everything in
`02-EVALUATION.md` is built on it.

**2. Never copy null-move pruning.** It assumes passing is never better than
moving. In this game there is no passing (§2.4), having no legal move is an
outright **loss** (§2.8), and `canHoldSeal()` exists precisely because a Keep held
by a side's only piece is forced open on their own turn. Zugzwang is not an
exception here; it is a rule of play. `03-SEARCH.md` §9.

**3. The board has a second symmetry.** Reflection in the a1–i9 diagonal —
`(row, col) → (8 − col, 8 − row)` — fixes both corners, preserves king distance,
and holds in **all three variants** (it maps the 2×2 block to itself and swaps the
two neutral Papers). Together with the known 180°-plus-colour-swap that is a
symmetry group of order four, which divides every endgame table by four and
halves the opening book. `05-LEARNING-AND-TABLES.md` §3.

---

## What must not change

* **The engine stays pure** (CLAUDE.md). Fast paths go *in* `packages/engine`,
  exercised by the same fixtures and the same perft numbers — never a second copy
  of the rules inside `packages/ai`. §11.3's 2 146 591 four-move sequences are the
  test that catches a divergence.
* **§2–§5 are not on the table.** Nothing here changes a rule. If a rules change
  ever looks tempting, CLAUDE.md: run `tools/sim` before and after, and say what
  moved.
* **§9 is not normative**, so the weights, the levels and the search are all fair
  game — but §9.2's weights produced every number in §6, so re-run the balance
  guard and expect it to move. If it does, that is a finding about the game and a
  §14 decision for Vig, not a bug to patch. `06-MEASUREMENT-AND-LEVELS.md` §4.
* **Determinism is a contract** (§7.8): same position, level and seed, same move.
  Time-based search breaks it. Decide how before building, not after.

---

## Open questions for Vig

These are the ones in here that are genuinely his call, not a guess:

1. **How strong should "Hard" be?** After this work the top level will be beyond
   any human. Keeping a beatable level and adding a separate wall above it is a
   product decision. Draft ladder in `06-MEASUREMENT-AND-LEVELS.md`, part two.
2. **What happens if the balance shifts?** A depth-8 engine may reveal a
   first-player or second-player advantage that depth 2 and 3 did not. That feeds
   §14's default-variant question directly.
3. **Deliberate mistakes at the easy levels — acceptable or not?** A bounded
   "misses a capture" slip feels human; random noise feels broken. Both are
   customer-facing.
4. **How much of the tail is worth building?** The opening book and the 3-piece
   tablebase are days of work with visible payoff. The 4-piece oracle and a
   learned evaluation are weeks with payoff only a strong player would notice.
