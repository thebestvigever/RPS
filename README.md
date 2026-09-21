# Stone Paper Scissors

*Working title.* A two-player abstract strategy game: rock-paper-scissors
captures on a 9×9 board, every piece moves like a chess king, and the first
player to reach the enemy's corner wins.

Three variants ship in v1 — **Original**, **2×2 Corner** and **Neutrals** —
playable against the computer or pass-and-play on one device.

**Status: engine and computer opponent done (M1, M2).** The rules, both
notations, events and the Keep pass every fixture vector and perft number in the
spec. The AI plays all three variants at three levels, and the self-play harness
runs. The board UI is next. See `docs/BUILD_PLAN.md`.

## Quick start

```sh
pnpm install
pnpm test        # 207 passing
pnpm typecheck
pnpm dev         # placeholder home screen
pnpm build

# Computer against computer, with the balance guard from the spec
pnpm sim --variant original --blue medium --red medium --games 200 --seed 1
```

Node 22+, pnpm 10+.

## Layout

```text
packages/
  engine/    rules only: no DOM, no timers, no Math.random, no dependencies
  ai/        search and evaluation; depends on engine; runs in a Worker and in Node
apps/
  web/       the React app
tools/
  sim/       Node CLI for computer-vs-computer runs (spec §9.6)
docs/
  spec.md          the build spec — normative, and the source of truth
  BUILD_PLAN.md    milestones, and exactly what the scaffold left behind
```

Packages are consumed as TypeScript source. Nothing builds to `dist/` except the
web app, which Vite bundles.

## The one rule that matters

**The engine is pure.** Same state plus same move always gives the same result,
state is plain serialisable data, and nothing in the engine knows about screens,
clocks or networks. The browser, the AI, the test suite and any future
multiplayer server all run the same package unchanged.

Two consequences worth stating out loud:

* **Variants are configuration, not code paths** (spec §5). A new mode is a new
  `VariantConfig` plus a small engine hook, never a second engine.
* **Never mutate a shipped variant.** A rules change gets a new `rulesVersion`,
  so saved games — and, later, ratings — stay interpretable.

## Two things that look like bugs and are not

* **A player may move onto their own corner.** That is what makes the
  **Keep** possible (spec §2.10): a defensive formation where a permanent piece
  seals a corner so the opponent can never win by reaching it. It is a deliberate
  design decision. Do not add a rule against it, and do not special-case it in
  the engine — it emerges from §2.6–§2.7.
* **A neutral piece only ever moves to capture** (spec §4.2). Letting neutrals
  walk freely was tested and drew 28% of games, because a shared piece becomes a
  free pass move. See §4.4 for the other two designs that failed and must not be
  reintroduced.

## Credit

The base rules are meaf's *rps2* ([meaf.us/rps2](https://meaf.us/rps2/)): king
moves, rock-paper-scissors captures, reach the enemy's zone to win, Blue first.
The draw rules, the no-moves rule, the notation, and the 2×2 Corner and Neutrals
variants are additions by this spec.

**The name, art and code of this game must be original.** Game rules generally
aren't protected by copyright, but meaf's name, drawings and code are — do not
reuse their art. Saying hello and crediting them before launch costs nothing
(spec §14.6).
