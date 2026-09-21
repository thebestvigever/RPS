# Stone Paper Scissors

A two-player abstract strategy game. This file governs work in this repository.
It is one of Vig's `studio/` projects and is maintained on its own — it shares no
code with the others.

## Read first

1. `docs/spec.md` — the build spec. **§2–§5 are the rules and are normative.**
   If anything else disagrees with them, §2–§5 win.
2. `docs/BUILD_PLAN.md` — which milestone we are on and what the last one left.
3. Whatever the task points at.

The spec was written to answer questions before they are asked. Before asking
Vig anything about rules, notation, balance or UX, check whether §2–§11 already
decides it. They usually do.

## Build order is not negotiable

**The engine first.** §11 has test vectors, move counts (perft) and puzzle
positions from the reference engine. The engine MUST pass them before any UI
work starts. This is what makes the simulation results in §6 mean anything.

Milestones are sequential: don't start one until the previous one's "done when"
holds (§12). `pnpm test` and `pnpm typecheck` green is the floor, not the goal.

## Rules that outlive any one task

* **The engine is pure.** No DOM, no timers, no `Math.random`, no dependencies.
  Same state plus same move gives the same result. State is plain serialisable
  data. The AI takes a seed (§7.8).
* **Variants are data** (§5), never separate code paths. Never mutate a shipped
  variant — a rules change gets a new `rulesVersion`.
* **The move list is the source of truth.** Full state is always
  `replay(variant, moves)` (§8.3). Undo, save, share links and any future server
  log all use the same record.
* **The interface animates and announces from events**, never by diffing boards
  (§7.7).
* **Don't special-case the Keep** (§2.10). It emerges from the move and win
  rules. Expose `isSealed` for the interface and the AI; that is all.
* **Owner is never colour alone** (§10.3). Every piece needs a second cue that
  survives greyscale.

## What needs Vig, not a guess

The spec's §14 is still open: the game's real name, the art direction, the
default variant, whether Neutrals + 2×2 Corner ships as a fourth option, what to
do about Keep standoffs, and whether aids show at Hard. **Propose and draft;
he decides.** Same for anything customer-facing.

Changing a rule in §2–§5 is never a fix-it-while-you're-there. Run
`tools/sim` before and after, and say what moved.

## Original work only

The base rules are meaf's *rps2*, and rules aren't generally copyrightable — but
their name, drawings and code are. **Draw original art.** Do not copy meaf's
assets, and do not copy the reference engine described in Appendix B: it was a
throwaway prototype, not production code.
