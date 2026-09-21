# Build plan

From spec §12. **Each milestone ends in something that runs. Don't start one until
the previous milestone's "done when" holds.**

| # | Build | Done when | State |
|---|---|---|---|
| M0 | Scaffold: workspace, packages, fixtures, test harness | `pnpm test`, `pnpm typecheck` and `pnpm build` all green | **done** |
| M1 | Engine: rules, position notation, move notation, events, `isSealed` | §11.1–§11.4 green, perft matches | next |
| M2 | AI and the `tools/sim` harness | Balance runs land near §6 for all three variants | |
| M3 | Board UI and pass-and-play, Original only | Two people can finish a game on one phone | |
| M4 | Play against the computer: worker, three levels, undo | Hard stays inside its time budget on a phone | |
| M5 | 2×2 Corner and Neutrals, and the variant picker | All three variants playable both ways | |
| M6 | Information aids (§10.5) | Each aid on and off, correct in the fixture positions | |
| M7 | How to play and the tutorial | A new player finishes all six puzzles | |
| M8 | Sound, animation, accessibility, persistence, review and share links | §11.6 passes | |
| M9 | Release | §11.7 fully ticked; deployed | |

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

**Stubbed, with the spec algorithm in a comment above each:**
`fromFen`, `toFen`, `moveToText`, `parseMove`, `legalMoves`, `isLegal`,
`createGame`, `applyMove`, `getResult`, `positionKey`, `replay`, `typeCounts`,
`isPermanent`, `isSealed`, `distanceToGoal`, `evaluate`, `chooseMove`,
`runSimulation`.

**Fixtures, ready to run against the engine** — all eleven vectors from §11.2,
the 36 opening moves and the perft numbers from §11.3, and the six tutorial
puzzles from §10.9. `fixtures.test.ts` already checks the fixture data itself is
well formed (every rank adds to nine files, every move matches the §8.1 grammar),
so a transcription typo surfaces now rather than as a mysterious engine failure.

The 65 `todo` entries in the test report are the M1–M2 checklist, taken from
§11.1, §11.4 and §11.5.

## Starting M1

```sh
pnpm install
pnpm test --watch
```

Work through `packages/engine/test/rules.todo.test.ts` top to bottom, turning
each `it.todo` into a real test. The order that works: `fen.ts` first (nothing
can be tested without loading a position), then `moves.ts`, then `game.ts`, then
`analysis.ts`. Perft is the backstop — if the numbers in `perft.json` don't
match, the bug is in move generation, and comparing move lists position by
position is how you find it.

**Do not start M3 until §11.1–§11.4 are green and perft matches.** That
sequencing is the spec's, and it is the reason the reference simulations in §6
are trustworthy.
