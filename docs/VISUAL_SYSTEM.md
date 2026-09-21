# Visual system — themes, pieces, captures, layouts

**Status:** normative for what the interface renders. The rules spec wins on
rules: nothing here touches §2–§5, and `rulesVersion` stays `1`.
**Source:** the *Game Visual Directions* handoff of 21 Sep 2026 — three themes,
four piece families, capture motion per matchup, three control layouts.
**Decided by:** Vig, 21 Sep 2026.

`docs/spec.md` §10 left the look open and said so. This is the answer, plus the
four things the handoff got wrong and the reasons they were wrong. Where this
file and §10 disagree about appearance, this file is later and wins. Where it
and `ADDENDUM-CLOCKS.md` disagree about *behaviour*, the addendum wins.

---

## 0. Why this arrives now

`apps/web/src/App.tsx` says it: *"The real one is spec §10.1 and lands with M3,
once there is visual direction to build to."* There are two bodies of finished,
tested logic with nothing drawn on them — the engine and AI (M1, M2) and the
match layer (C1, C2: clocks, offers, gifts, premove, abort, low-time, Zen). The
handoff unblocks both.

It is also much larger than M3. It spans M3, M6's aid layer, M8's animation and
accessibility, and the rendering C1/C2 are waiting for. Built as one lump it
stops being verifiable, so §8 slices it along the milestone gates that already
exist in `BUILD_PLAN.md`.

## 1. The four decisions

| # | Decision |
|---|---|
| 1 | **Ownership cue is chosen by size, not by the player.** Above a threshold, the opponent's hairline ring; at or below it, the knockout treatment. Automatic, per render. §2 |
| 2 | **Player colours are per-theme, and checked at pick time.** Each theme ships its own validated swatches; the picker enforces 3:1 against that theme's board square. §3 |
| 3 | **First launch seeds the theme from `prefers-color-scheme`, once.** Dark → Signal, otherwise Field Notes. After that the stored choice is the only input. §4 |
| 4 | **M3 ships one theme, one family, one layout, Original only** — the gate is *two people finish a game on one phone*. Switching is built after M3 is tested and reviewed. §8 |

## 2. Ownership is a size problem

Spec §10.3, §10.10 and `CLAUDE.md` all require a second ownership cue that
survives greyscale. The handoff's cue is a 1.5px ring on every opponent piece,
with a visible gap between ring and silhouette — and the handoff itself notes
the ring merges with the fill at **≤30px**.

The pieces are smaller than that on every phone. Board size is
`min(viewport − 32, 640)` (§10.2); at a 62% mark box:

| Board | Square | Mark | Cue |
|---|---|---|---|
| 328px (360 viewport) | 36.4px | 22.6px | knockout |
| 358px (390 viewport) | 39.8px | 24.7px | knockout |
| 408px (the handoff's own Bar layout) | 45.3px | 28.1px | knockout |
| 468px | 52.0px | 32.2px | ring |
| 560px (Rail) | 62.2px | 38.6px | ring |
| 640px (max) | 71.1px | 44.1px | ring |

So the design's primary cue is below its own stated failure point on the
design's own phone layout. Raising the mark box does not rescue it: clearing
30px on a 390px phone needs a box of ≥76%, which eats the ring-to-silhouette gap
the cue depends on.

**The rule.** Two render modes, selected from the rendered mark size, never from
a setting:

* **Standalone** — mark ≥ 32px, i.e. board ≥ 468px. The family silhouette is
  drawn as a filled shape. Opponent pieces carry the 1.5px ring with its gap.
* **Knockout** — mark < 32px. The silhouette is knocked out of a disc in the
  square colour. Yours is a filled disc, the opponent's an outlined one. The
  disc may occupy **76%** of the square rather than 62%, because a circle
  tessellates safely where an irregular silhouette does not; the mark is 52% of
  the disc, so ~15–16px on a phone.

32px is the 30px failure point plus a modest margin. It is one constant in
`themes.ts`, not a magic number scattered through the renderer.

**This preserves the families.** Knockout is a *rendering mode*, not a
substitution: a hexagon knocked out of a disc is still a hexagon, and D · Weight's
bars are still bars. Only C · Seal looks identical in both modes, because it is
already a knockout. Family choice therefore stays meaningful on phones — which
is the opposite of what a "fall back to the Seal family" rule would have meant.

What is genuinely uncertain is whether a ~15px knocked-out mark distinguishes
*rock from paper from scissors*, which is the requirement §10.3 actually sets.
The gate in §9 decides it, and the plan B is named in §8.

## 3. Colour is user-settable, so it has to be checked

The handoff carries two colour systems that were never reconciled: a per-theme
"default side A/B" table, and a single theme-independent swatch list. Measured
against each theme's board square, **6 of 24 combinations break the spec's own
3:1 floor** (§10.3, *"keep pieces at 3:1 contrast or better against squares"*):

| Swatch | On Signal (`#161A21`) | |
|---|---|---|
| `#2F5AA8` — the offered **default** for "you" | 2.62:1 | fails |
| `#B23A2E` — the offered **default** for "opponent" | 2.94:1 | fails |
| `#6B4FA8` | 2.75:1 | fails |
| `#1E1E1C` | **1.04:1** | invisible |

`#C77A18` also fails on Tabletop at 2.42:1. To be fair to the handoff, the parts
it *did* specify hold up: muted text measures 5.44 / 6.85 / 5.57:1 across the
three themes, comfortably clear of AA. It is specifically the surface it handed
to the player that was never checked, which is the predictable cost of making
colour a setting.

**The swatches.** Each theme ships its own. Every value below is measured
against that theme's board square; the first in each row is the theme's default.

| Theme | You | Opponent |
|---|---|---|
| Field Notes (`#F4F2EC`) | `#2F5AA8` 5.96 · `#2E7D6B` 4.40 · `#6B4FA8` 5.67 · `#1E1E1C` 14.92 | `#B23A2E` 5.30 · `#9A5A11` 4.88 · `#A8347A` 5.46 · `#6E6A5E` 4.83 |
| Signal (`#161A21`) | `#4CC2F5` 8.59 · `#5FD3A8` 9.44 · `#A98CF0` 6.39 · `#E8ECF2` 14.71 | `#F57A6E` 6.56 · `#ED9152` 7.29 · `#EE7FC4` 7.03 · `#A9A296` 6.89 |
| Tabletop (`#E6D9C4`) | `#36497E` 6.26 · `#2A6B57` 4.52 · `#5B3F87` 6.02 · `#1E1E1C` 12.00 | `#A8503A` 3.89 · `#8A5A10` 4.25 · `#8E2F66` 5.49 · `#5C5B57` 4.88 |

Field Notes keeps the handoff's list with one change: `#C77A18` → `#9A5A11`,
which was at 3.01:1 and had no headroom. Signal's are the handoff's hues
lightened for a dark ground. Tabletop's are darkened.

**The gate.** A pure `contrastRatio(fg, bg)` and a check the picker runs against
the *active* theme. A failing colour is offered but not selectable, with the
reason shown. It is ~30 lines, and the test that asserts every shipped swatch
clears 3:1 on every theme is what stops this recurring the next time a palette
is touched.

**Pair confusability warns, it does not block.** Ownership is already carried by
§2's cue independent of colour, so two similar colours are a comfort problem,
not an accessibility one. Warn when the chosen pair is within 25° of hue *and*
under 1.5:1 — no cross-role pairing in the table above trips it.

**Legal-move dots are computed, not fixed.** The handoff's 55% alpha measures
1.62–2.42:1 against the square; the dot is the primary move affordance and WCAG
1.4.11 wants 3:1. Since alpha 1.0 is the colour itself, and the colour already
cleared 3:1 at the gate, a solution always exists:

```ts
dotAlpha(color, square) // smallest a in [0.55, 1] where contrast(over(color, square, a), square) >= 3
```

With the swatches above this lands between .55 and .83. Deriving it beats a
per-theme constant, because the input is a colour the player chose.

## 4. The look is data

`CLAUDE.md` already says it for rules: *"Variants are data, never separate code
paths."* Three themes × four families × two layouts is the same problem and gets
the same answer, or it becomes 24 hand-tuned screens nobody can verify.

```text
packages/board/         pure: (position, settings, appearance) -> SVG
  themes.ts             3 token sets, identical keys
  families.ts           4 geometry sets, identical keys
  motion.ts             (captorType, capturedType) -> motion; the ending overlay
  contrast.ts           contrastRatio, checkSwatch, dotAlpha
```

Pure in the same sense the engine and `packages/match` are: no DOM reads, no
timers, no React state, no engine mutation. That is what makes the matrix
affordable — it screenshot-tests directly against the fixtures that already
exist (`packages/engine/test/fixtures/vectors.json`, `tutorial.json`), rather
than needing a running game.

**Theme selection.** On first launch only, with no stored theme:
`matchMedia('(prefers-color-scheme: dark)').matches ? 'signal' : 'field-notes'`,
persisted immediately. After that the stored value is the only input. This
settles the handoff's open question 1 without a coin flip: a player on a dark
phone should not be handed a white board on first run, and a player who has
chosen should not have the OS change it back.

> **Delete the `prefers-color-scheme` block in `apps/web/src/styles.css`.** Once
> themes are explicit tokens, a media query that also rewrites `--square` and
> `--ink` is a second theming mechanism fighting the first.

**Fonts load per theme, never eagerly.** Six families across three themes is
wasteful on the mid-range Android §11.7 targets. Field Notes needs IBM Plex Sans
and IBM Plex Mono and nothing else; a theme switch fetches its own.

## 5. Piece families

Four, from the handoff's §3 — A · Shears (literal), B · Cut stone (flat
polygons), C · Seal (disc + knockout), D · Weight (abstract bars). Each is a
geometry set behind identical keys, drawn as **original SVG paths** from the
numbers, not traced from the prototype's CSS shapes (`CLAUDE.md`: draw original
art; and the prototype drew with `clip-path` only because it had no SVG
pipeline).

**Scissors geometry is fully specified and should be taken literally** — it was
reviewed three times and the failure modes are recorded. One continuous stroke
per side, blade tip → pivot → shank → bow, both sides rotating about the same
pivot: bar at `left 44%, top 0, width 12%, height 74%`, origin `50% 84%`,
`±19°`; blade taper `polygon(50% 0, 100% 15%, 100% 100%, 0 100%, 0 15%)`; bow
centred on the bar's bottom edge at 250% of bar width, inheriting the rotation;
pivot dot at `50%/62%`, 15% wide. Rejected in review, so do not rediscover them:
a single tapered polygon (reads as a pawn), detached blades with free-floating
rings (reads as "V oo"), non-square containers (elliptical bows), and bow holes
under ~4px (fill in and read as dots).

Every family must hold up **at 24px and in greyscale** — not the handoff's 28px,
which is above what a 390px phone actually renders (§2).

## 6. Capture motion

Derived from the capture, never stored, never a setting: `(captorType,
capturedType) → motion`, 200ms, captor travels exactly one king step.

| Matchup | Motion |
|---|---|
| Rock × Scissors | **Crush** — captor drops in with overshoot `cubic-bezier(.3,1.6,.4,1)`, scale 1→1.16→0.94→1; victim `scaleY` 1→0.18 from `transform-origin: bottom center`, fading. Thud. |
| Scissors × Paper | **Cut** — victim splits into two halves translating ∓40% / +18% and rotating ∓24° while fading; captor closes −8° → +6° → 0. Snip. |
| Paper × Rock | **Wrap** — captor slides in, scales to 1.45 past the square, holds ~20% of the beat, settles to 1; victim fades under it. Rustle. |

A **game-ending** capture layers over whichever motion just played: matchup
200ms → square flashes the winner's colour 90ms → taken piece dissolves (blur
0→5px, scale 1→1.3, fade) 260ms → ring expands (2px, scale .3→2.3, fade) 400ms →
overlay at 600ms. A **type going extinct** reuses steps 2–3 at half strength,
which is how *"your Rocks are permanent now"* gets noticed at all.

`prefers-reduced-motion` collapses every one of these to an instant replacement.

All of it is driven from engine **events** — `move`, `capture`, `type-extinct`,
`sealed`, `game-over` — never by diffing boards (§7.7, `CLAUDE.md`). The engine
already emits exactly what this needs.

## 7. Settings: extend, do not fork

The handoff proposes a `UiSettings` that re-declares state `packages/match` has
already built and tested. It also drops two aids that exist (`dangerMarks`,
`hint`) and models Zen as a third `LayoutId`.

**Zen stays a boolean.** `settings.ts` has it right and the addendum says why:
Zen *overrides rather than overwrites*, so switching it off restores the
player's own aid choices instead of the defaults. A third layout value cannot
express that. So `layout: 'rail' | 'bar'`, and `zen: boolean` beside it.

**Two objects, one rule.** `DisplaySettings` in `packages/match` is what the
game *shows* — it stays where it is, tested, and readable by a server later. A
new app-only `Appearance` is what it *looks like*, and never leaves the device,
because the handoff is explicit that colour choices are local and never sent:

```ts
interface Appearance {
  theme: 'field-notes' | 'signal' | 'tabletop';
  family: 'shears' | 'cut-stone' | 'seal' | 'weight';
  layout: 'rail' | 'bar';
  myColor: string;
  opponentColor: string;
}
```

Both persist to `localStorage`, every read and write wrapped in `try`/`catch`
(§10.13). Neither belongs in the engine.

## 8. What M3 ships

M3's gate is unchanged and is the only thing that decides whether it is done:
**two people finish a game on one phone**, Original only.

| | Build | Done when |
|---|---|---|
| **M3a** | `packages/board`; tokens; Field Notes only; Cut stone only; static SVG from a FEN; coordinates; corner tints; last-move tint; flame placeholder. Add `@sps/match` to `apps/web`'s dependencies. | Renders every engine fixture position correctly; the §9 gates pass |
| **M3b** | Select, legal dots, capture rings, illegal-target reason + shake; tap and drag; keyboard cursor; 150ms slide; the three matchup motions; Bar layout; corner names and type counts | **Two people finish a game on one phone** |
| **M3c** | Renders C1/C2: clock chips at every urgency, +15s in both directions, abort, draw/takeback/rematch offers, premove ghost, low-time warning | Every state `packages/match` can produce has a visual and a test |

**Deferred until M3 is tested and reviewed**, per decision 4: the other two
themes, the other three families, the Rail layout, Zen, and the pickers for all
of them. The token indirection ships in M3, so each is a data drop rather than a
rewrite — but the *values* cost three times the review, and reviewing them
against a board nobody has played on is reviewing them blind.

Still on their own milestones: the full aid layer at M6 (threat lines, race
meter, permanent shields, Keep lock, danger diamonds, hint), sound and share
links at M8.

**M3's family is Cut stone, rendering in knockout mode** — flat, no shading, and
the most legible of the four on a small light ground. If the 24px greyscale gate
in §9 shows the three types are not reliably distinguishable as knockouts,
switch M3's default to **D · Weight**: three stacked bars, one flat bar, two
crossed bars is the family the handoff itself calls *"nothing to misread at
28px"*, and it is the safest shape language at this size. Let the gate decide,
not taste.

## 9. Gates

Three tests, all cheap, all written before the UI code they protect. Each exists
because something in §2 or §3 was already wrong once.

1. **Every shipped swatch clears 3:1** against every theme's board square.
   Pure, table-driven, no rendering. This is the one that would have caught six
   broken combinations in the handoff.
2. **Greyscale at 24px.** Render each family, both owners, all three types,
   desaturated, at the size a 390px phone actually produces. Owner must be
   readable without colour, and the three types must be told apart. This is the
   gate that decides §8's family question.
3. **Dot alpha reaches 3:1** for every swatch on every theme, and `dotAlpha`
   never returns above 1.

Screenshot coverage rides on the engine's existing fixtures rather than new
ones: `vectors.json` and `tutorial.json` already hold the positions that matter,
including a sealed corner and an extinct type.

## 10. Built, but not designed

These have tested logic in `packages/match` and nothing drawn for them. M3c owes
them a visual; the handoff does not supply one.

| Feature | What is missing |
|---|---|
| **Clock chip** | `urgencyOf` returns `normal \| low \| critical`, and there is `pausedSide`, `flagged`, and `stageIndex` for tournament controls. The handoff draws two states: active chip and inactive. |
| **Premove** | No affordance at all. Needs a queued-move ghost and a signal when one is silently dropped. |
| **Time-control picker** | `BUILD_PLAN.md` already lists it as not built. `PRESETS`, `categoryOf` and `estimatedDurationMs` exist as data; no screen does. |
| **Takeback offers** | `offers.ts` handles draw, takeback and rematch. The handoff shows Undo (a local action) and Offer draw, and no takeback flow. |
| **`confirmMoves`** | Exists in `DisplaySettings`, undesigned. |
| **Flame watermark** | The asset does not exist. The striped placeholder disc at .07 opacity, 22% of board width, tinted with the theme ink, is fine through M8; it is part of spec §14's open art question. |

## 11. Corrections to the handoff

Build from the README plus the *Pieces and Captures* file. Four things in the
handoff are stale or contradicted by code that already works:

1. **The *Board System* file's piece sets are superseded.** Turn 2's Cut /
   Carved / Line / Chip and its *user-selectable* capture motions (Pop / Shove
   off / Crumple / Flash & dissolve) were both replaced in turn 3 by the four
   shape families and motion derived from the matchup. Its panel copy still
   reads *"Theme, piece set and capture motion sit in the same panel."* Treat
   that file as **layout only**.
2. **+15s runs in two directions, not one.** `GIFT_POLICIES` sets
   `vs-computer: { toSelf: true }` — unlimited, deliberately, per the addendum
   §6: *"There is nobody to cheat."* The handoff puts the button beside the
   opponent's clock only, which leaves the feature unreachable in the mode it
   was written for.
3. **Abort is the first two plies, not "before the first move".**
   `ABORT_BEFORE_PLY = 2`, and pass-and-play may always abort. The handoff's own
   prototype copy — *"Waiting for Maya's first move"* — matches the code; its
   README bullet does not.
4. **Hint is hidden until M6, not shipped disabled.** `Aids.hint` exists and
   defaults on, §9.5 specifies it, and §11.7 requires every §10.5 aid to work
   and to be switchable. A permanently disabled control with no path to enabled
   is noise; ship it when it works.

Two of the handoff's open questions are already answered by code, and should not
be re-asked: gifts in rated games are off (`GIFT_POLICIES.rated` is `false` both
ways), and piece family is independent of theme.

---

## Still open — for Vig

1. **Whether four families survive the 24px gate.** If knockouts at ~15px do not
   separate rock from paper from scissors, the honest outcome is fewer families
   rather than four that only work on a desktop.
2. **A name.** Spec §14.1 is still open, and every theme's headline type is
   currently set in a placeholder wordmark.
3. **Whether Tabletop earns its keep.** It is the only theme whose board square
   differs from its panel colour, which doubles the tokens that need checking.
   It is also the one that makes pass-and-play feel like an object on a table,
   which is the mode two people in a room will actually use.
