# Roadmap — what comes after v1, and what each step actually costs

`BUILD_PLAN.md` tracks the milestones that get v1 finished. **This file is the
layer above that**: how you actually play the thing, and what the three steps
beyond v1 involve — playing a friend over the internet, a lobby with saved
games, and a genuinely strong engine.

It is written to be read by someone who does not write code. Where a technical
choice matters, the reason is given rather than the jargon.

---

## Where things stand

Done and tested (286 tests):

* **The rules.** Every legal move, both notations, the Keep, all three variants.
  Verified against the spec's own move counts — the engine reproduces
  2,146,591 distinct four-move sequences exactly.
* **The computer opponent.** Three levels. Looks four moves ahead at Hard.
* **Clocks, draw offers and time gifts.** Full chess-clock behaviour, including
  tournament controls.
* **The self-play harness**, which plays the computer against itself and checks
  the game is still balanced.

Not done: **everything you can see.** `apps/web` is a placeholder that proves
the engine reaches the browser and nothing more.

---

## 1. Playing against the computer, on your own machine

### What still needs building

| Piece | What it is | Status |
|---|---|---|
| The board | Squares, pieces, click to move | In progress |
| The worker hookup | Letting the computer think without freezing the screen | Small, not done |
| Difficulty and undo | Easy/Medium/Hard, take-back | Not done |
| Clock display | The two clocks, ticking | Not done |

**The worker hookup** is the only one that needs explaining. When the computer
thinks, that work happens somewhere. If it happens in the same place that draws
the screen, the whole page freezes for a second on every move — buttons stop
responding, nothing animates. So the thinking is pushed into a separate
background lane (a "worker") and the board stays alive while it runs.

The thinking side of that is already written (`packages/ai/src/worker.ts`). What
is missing is the handful of lines on the board's side that hand work over and
collect the answer.

### How you would actually play it

**Option A — the easy one.** It goes on the internet as a web page (Vercel,
free). You open a link. Nothing to install, and it works on your phone. This is
possible because the game is a self-contained page: there is no server, so
"hosting" it is just putting a file somewhere.

**Option B — the developer one.** Install Node.js, clone the repo, run
`pnpm install` then `pnpm dev`, and it opens at a local address.

Option A is the one to use unless you want to change the code.

---

## 2. Playing a friend over the internet

This is a genuine architectural step, not a feature. Worth understanding why.

Right now the whole game lives inside your browser and nothing leaves your
computer. For two people to play, something has to sit in the middle and pass
moves between them — two home browsers cannot reliably call each other directly.

**A postbox is not enough.** If the middle just forwards whatever each side
says, anyone willing to tamper with their own browser can claim an illegal move
or simply announce they have won. So the thing in the middle has to be the
**referee**: it holds the real game, checks every move against the rules itself,
and tells both players what happened. Players send requests; the server decides.

### What makes this cheaper than it sounds

Two decisions taken early pay off here:

* **The rules engine knows nothing about screens or networks.** That was a rule
  from the spec (§7.1) and it was kept. So the *same rules code* runs on the
  server — there is no second copy to keep in sync, which is the usual way these
  projects go quietly wrong.
* **The clock never reads the time; it is told the time.** So the server can run
  the clock authoritatively, which matters because a player's own clock cannot
  be trusted.

### What needs building

| Piece | Why | Status |
|---|---|---|
| A room per game | Somewhere both players connect to, holding the one true game | **built** |
| A live connection | A line that stays open, rather than each browser repeatedly asking "anything new?" | **built** |
| Referee logic | Checking moves, running the clocks, declaring results | **built** |
| Invite links | Create a game, send a link, whoever opens it takes the other side | **built** |
| Dropout handling | Wifi dies mid-game: reconnect and carry on, and a rule for walking away | **built** |
| A screen for it | Somewhere to press "play a friend", and a board that talks to the room | **built** |

The spec already chose the technology (§13.2): **Cloudflare Durable Objects**,
which is built almost exactly for this. One small consistent "room" per match,
messages handled strictly one at a time so two moves can never collide, and idle
rooms cost nothing while they sleep. The free tier covers early use.

**No accounts needed.** "Play a friend by link" works with strangers and no
sign-up, and it is the right first online feature.

### What has been built

The referee itself, and the thing it runs inside — `packages/referee` and
`apps/server`. It creates matches, hands out invite links, checks every move
against the same rules the browser uses, runs both clocks, survives a player's
wifi dying and hands the game to whoever is still there when a clock runs out.
It has been driven end to end on Cloudflare's own runtime, not only in tests.

**And it now has a screen.** Home has a "Play a friend" button; it gives you a
link to send, and the first person to open it takes the other side. From there
it is the ordinary board — the same pieces, the same aids, the same sounds —
because the online game is that board with the room told about every move,
rather than a second board built alongside it.

Two rules Vig settled while it was being built. **Thirty seconds to play the
first move**, or the game is called off and counts for nothing. And when
somebody's connection dies, the player still there waits a minute and can then
either **claim the win or call it a draw** — a claimed win is recorded as
*abandoned*, which is the honest word for it: someone whose wifi died did not
resign.

`docs/ONLINE.md` is the reference: what the two sides say to each other, what
the room refuses, how to run it, and the three things still waiting on Vig.

---

## 3. A lobby, and saved games

These sound like one thing. They are three, with very different costs, and they
are worth doing in this order.

### Tier 1 — no server at all

* **Shareable game links.** The whole game squeezed into a URL (§8.4). A typical
  game is about 1 KB of moves, which fits comfortably. Send it and the other
  person replays it move by move.
* **Resume after reload.** The browser remembers the game in progress, so
  closing the tab does not lose it (§10.13).

Both are already designed and neither needs a server or a database. This is a
surprisingly large slice of "saved games" for almost nothing, and it is worth
building regardless of whether anything below ever happens.

### Tier 2 — needs the server from step 2

* Every finished online game gets its own page at a permanent link.

### Tier 3 — needs a database and accounts

This is where a real lobby and a real game history live, and it is a different
kind of project:

* A **lobby** is a live list of people waiting for a game. That list has to exist
  somewhere both people can see, which means a database.
* **"My games"** requires knowing who "my" is, which means accounts.
* Once both exist, **ratings and leaderboards** come nearly free (§13.3), and
  they are usually what makes a game sticky.

The spec suggests Supabase — a hosted database with sign-in built in. Free to
start.

**The honest framing:** Tier 3 is the point where you have *users* rather than
*players*, with passwords, privacy, moderation and abuse to think about. Do it
when there is evidence people want it, not before. Step 2 will tell you.

---

## 4. A stronger engine

The game already has one. The gap between it and Stockfish is worth
understanding, because most of it is not where people expect.

|  | This engine | Stockfish |
|---|---|---|
| Positions examined | ~110,000 a second | Tens of millions a second |
| Moves ahead | 4 | Thirty-odd plies |

The second row is the surprising one. Looking twice as deep means examining
roughly **forty times** as many positions. You cannot get from 4 to 30 by being
a thousand times faster — the arithmetic is nowhere close. Almost all of
Stockfish's depth comes from being ruthlessly good at **not looking** at things.

### The four differences

**Raw speed.** Stockfish is C++, which runs far closer to the machine than
JavaScript, and stores the board as a few numbers arranged so that "where can
this piece go?" is a single CPU instruction rather than a loop. To run something
like that in a browser you compile it to WebAssembly — which is exactly how
lichess runs Stockfish inside your browser.

**Not looking at things.** The big one. Remember positions already worked out,
since the same position is often reached by different move orders. Remember
which moves proved good elsewhere and try those first. Search unpromising moves
shallowly and only go deeper if they surprise you. And: "if I let my opponent
move twice and I am *still* fine, this whole branch is safe to ignore." This
engine does a basic version of about two of these.

**Judging a position.** This one uses hand-written rules from the spec — a piece
is worth 100, being nearer the corner is worth this much. Stockfish uses a small
neural network trained on hundreds of millions of positions, designed to be
cheap enough to run at every single position. The self-play tool here already
generates exactly the kind of data that needs.

**Tuning by brute force.** Stockfish's settings are not chosen by taste. Every
proposed change plays tens of thousands of games against the current version on
a volunteer network of donated computers, and is accepted only if it wins by a
statistically convincing margin. That infrastructure matters as much as the code.

### What it would take here

Much less than for chess, for one reason: **nobody has ever studied this game.**
Chess engines had to surpass centuries of accumulated human theory. There is
none here. A moderately strong engine is already beyond any human player,
because no human yet knows what good play looks like.

| Effort | What you get |
|---|---|
| **Weeks** | Remember analysed positions, better move ordering, standard pruning. Likely 4 moves deep → 8 or 10. |
| **Months** | Rewrite the hot part in a compiled language, train an evaluation, build a tuning loop on the self-play tool. |
| **Years, and a community** | Genuine Stockfish parity — and there is no reason to want it. |

There is also a shortcut chess cannot fully use. This game has few pieces, and
once it is down to a handful you could **solve the endgame exactly** —
precompute every possible position and store the perfect answer. Chess does this
for up to seven pieces. Here it might reach considerably further.

---

## Suggested order

1. **Finish v1** (`BUILD_PLAN.md`, M3–M9). Playable against the computer, on a
   link, on a phone.
2. **Tier 1 saved games.** Share links and resume-after-reload. Cheap, no
   server, worth having whatever happens next.
3. **Play a friend by link.** The server step. Biggest jump, most groundwork
   already laid.
4. **Then stop and look.** Whether anyone plays it decides what comes next. If
   they do, Tier 3 — lobby, accounts, ratings. If the complaint is that the
   computer is too weak, the engine work instead.

Steps 3 and 4 are both "only if the game earns it". Step 1 and 2 are worth doing
either way.
