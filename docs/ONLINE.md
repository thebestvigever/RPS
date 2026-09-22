# Online play — the referee

**Status:** built, tested, and playable from the app.
**Covers:** Roadmap §2, spec §13.2.

Two people in different places play by both connecting to the same room, and
the room — not either browser — decides what happened. This is what that room
is, what it says, and what it deliberately does not do yet.

---

## Where it lives

| Package | What it is |
|---|---|
| `packages/referee` | The whole of online play except the socket. Pure: it owns no connection, opens no storage and never asks what time it is. |
| `apps/server` | The Cloudflare Worker and one Durable Object per match. Sockets, storage, alarms and routing — no rules. |
| `apps/web/src/match-client.ts` | The browser's half, and the same split again: a reducer over the room's messages, tested with no socket and no DOM. |
| `apps/web/src/useMatch.ts` | The socket, the reconnect and the outbox. Nothing else. |
| `apps/web/src/Online.tsx` | The screens with no offline equivalent: waiting for a link to be opened, and the two buttons you get when your opponent stops being there. |

The split is the same one the rest of the repo already makes, and it is the
reason this was a small job rather than a rewrite:

* **The engine is pure** (spec §7.1), so the server checks moves with
  `@sps/engine` — the same code the browser runs. There is no second copy of
  the rules to keep in sync.
* **The clock never reads the time; it is told the time**
  (`ADDENDUM-CLOCKS` §1), so `@sps/match` runs the clock on the server
  unchanged. Both packages are used exactly as they ship.
* **The move list is the source of truth** (spec §8.3), so the room stores a
  move list and replays it. A takeback is `moves.slice(0, n)`; waking from
  hibernation is `replay(variant, moves)`; the archive is the same record the
  browser already writes.

`packages/referee` is a reducer. Every entry point takes the room, a
connection, a message and `now`, and returns the next room plus the messages to
send. That is why the interesting behaviour — a flag falling mid-move, a
reconnect, two people offering a draw at the same instant — is tested in
milliseconds with no network anywhere near it.

---

## Playing a friend by link

No accounts, which spec §13.2 says is the right first online feature.

1. `POST /api/match` creates a match and hands the creator back their own seat
   token, an **invite link** carrying the *other* seat, and a **spectator
   link** carrying neither.
2. Whoever opens the invite link takes that side. The game starts when both
   seats are taken, and the first clock starts then — not before.

A seat token is a bearer credential: whoever presents it is that player, for
joining and for every later reconnect. **That has a cost worth saying out
loud** — anyone the link is forwarded to can take the seat. With no accounts
there is nothing else to check against, and a weaker secret would only look
like security. When accounts arrive (spec §13.3) a seat can be bound to a user
id and the token becomes the fallback.

---

## The messages

JSON over one WebSocket. Spec §13.2 named most of these and its names are kept
exactly; the rest are marked, and are either things the clock addendum made
real after that list was written or things §13.2's own prose asked for without
naming a message.

### Client → room

| Message | Meaning |
|---|---|
| `{ t: 'hello', matchId, token, lastPly, name }` | Always first. `token` is null for a spectator; `lastPly` is what this client already has. |
| `{ t: 'move', ply, move }` | `ply` is the ply this move is meant to be. |
| `{ t: 'resign' }` | |
| `{ t: 'draw-offer' \| 'draw-accept' \| 'draw-decline' }` | |
| `{ t: 'ping', at }` | `at` comes back in the pong, for measuring the round trip. |
| `{ t: 'draw-withdraw' }` | *added* — `offers.ts` already had it. |
| `{ t: 'takeback-offer' \| 'takeback-accept' \| 'takeback-decline' \| 'takeback-withdraw' }` | *added* — casual games only, per `OFFER_POLICIES`. |
| `{ t: 'abort' }` | *added* — first two plies, then "resign instead" (addendum §9). |
| `{ t: 'gift' }` | *added* — 15 seconds to the opponent (addendum §6). Casual only. |
| `{ t: 'claim' }` | *added* — §13.2's "claim the win after 60 seconds away" had no message. |
| `{ t: 'claim-draw' }` | *added* — the other half of a claim: take the draw instead. |

### Room → client

| Message | Meaning |
|---|---|
| `{ t: 'welcome', matchId, you, record, clocks, presence, offer, names, mode }` | `you` is `blue`, `red` or `spectator`. Carries the whole record and any pending offer, so a reconnect misses nothing. |
| `{ t: 'moved', ply, move, events, clocks }` | |
| `{ t: 'rejected', ply, reason }` | A move that was not played, and why. |
| `{ t: 'result', result, clocks }` | |
| `{ t: 'presence', blue, red }` | |
| `{ t: 'draw-offered', by }` · `{ t: 'pong', serverTime, at }` | |
| `{ t: 'started', clocks, startedAt }` | *added* — both seats taken; the clock is running. |
| `{ t: 'draw-declined' \| 'draw-withdrawn', by }` and the takeback equivalents | *added* |
| `{ t: 'took-back', ply, clocks }` | *added* — the game is now `ply` plies long. |
| `{ t: 'gifted', from, to, ms, clocks }` | *added* |
| `{ t: 'error', code, reason }` | *added* — for problems that are not about a move, so `rejected` can keep its ply. |

**The interface animates and announces from events, never by diffing boards**
(CLAUDE.md), so `moved` carries the engine's own `GameEvent[]` — including the
ones a reconnecting client slept through, which come back from `replay`.

### Reading the clocks

Every `clocks` carries its own `serverTime`, and that is how a client tells a
live reading from a historical one. Catching up after a reconnect delivers the
clocks as they stood after each missed move: right for a move list, wrong for
the face of a clock. **Display the view with the newest `serverTime`.**

---

## The rules the room enforces

* **Nothing before `hello`,** and one `hello` per socket.
* **An unknown token is refused and the socket closed** — never quietly demoted
  to a spectator. A stale or mistyped link should say so rather than seating
  somebody in the audience of their own game.
* **The same token on a new socket is the same player coming back.** The older
  socket is closed with 4002. That is what makes a dead connection recoverable
  without a timeout.
* **Moves carry their ply.** A stale or duplicate ply is rejected — and the
  client is sent whatever it evidently missed, rather than left guessing.
* **The clock is checked before anything a player asks for.** A move that
  arrives after the flag loses to the flag: the server's receipt time is the
  only honest timestamp in the system.
* **A disconnected player's clock keeps running** (§13.2). Pausing it would
  make pulling the plug the cheapest way to think.
* **Thirty seconds to play the first move**, or the game is `aborted` — not
  lost: nobody has played anything, so there is no game to lose. The countdown
  starts when the second player arrives, never before, so a match sitting on an
  unopened link has nothing running against it.
* **The win against someone who left is claimed, not awarded.** Sixty seconds,
  casual games, and the player who stayed has to press the button — or takes
  the draw instead. Somebody who gets back at 61 seconds finds the game still
  there unless they were claimed. A claimed win is recorded as `abandoned`, a
  result reason of its own: a player whose wifi died did not resign, and a
  record that says they did is a record that lies about them.
* **Rate limiting** per connection (§13.7), as a token bucket that nothing a
  person can do by playing will ever hit.

---

## Running it

```bash
pnpm --filter @sps/server dev      # wrangler dev, on real workerd
pnpm --filter @sps/server deploy   # wrangler deploy
```

`wrangler.toml` has two variables to set before any link is shared:

* `APP_ORIGIN` — where the web app is served from, because invite links must
  point at the game and not at this API.
* `ALLOWED_ORIGIN` — who may call the JSON endpoints from a browser. Narrow it
  in production.

| Route | |
|---|---|
| `POST /api/match` | Create one. Body: `variant`, `control` (a preset id), `mode`, `side`, `name` — all optional. |
| `GET /api/match/<id>` | What a link leads to, without taking a seat. Carries the full record once the game is over. |
| `GET /ws/<id>` | The socket. |

---

## What it does not do yet

* **Rematch.** The offer kind exists in `@sps/match`; a rematch needs a *new*
  room, which is a routing question this deliberately left alone. The game-over
  overlay's Rematch button leaves an online game rather than starting one.
* **Takebacks have no button.** The protocol, the room and the offer policy
  all support them in a casual game; the board simply hides Undo online rather
  than offering to ask. Undoing by agreement is a real interface of its own.
* **Time gifts have no button online** either, for the same reason: the room
  takes `gift` and the courtesy is allowed in a casual game.
* **Ratings and accounts** (spec §13.3), and therefore rated play is only a
  mode string today.
* **Match-creation rate limiting is per isolate.** It stops the ordinary
  runaway loop and nothing cleverer; the real answer is a rate-limiting binding
  or a gate object keyed by address.
* **Archival.** A finished game's record is kept in its own object, which is
  enough for spec §13.5's permanent page but is not one.

## Playing it

Home → **Play a friend** → a link to send. The first person to open it takes
the other side and the game starts on its own.

The board is the ordinary board: `Game.tsx` with an `online` prop, so the
gestures, the aids, the animations, the sounds and the clock face are the same
ones offline play has. A move is played locally and sent at the same instant,
and the room's answer is what the position is rebuilt from — which is what
makes an online move feel like an offline one on a connection with any latency
at all. When the two disagree (a move that arrived after the flag, a takeback,
a rejected ply) the room's list wins and the board is put back without asking.

The room owns the clock, so the browser is told the time rather than keeping
it. `clockFromServer` reads the room's view back as the `ClockState` the clock
display already takes — which is why nothing about how a clock is drawn,
warned about or read aloud needed a second version for online play. It is exact
for every control the room accepts: those are all presets, and every preset is
Fischer or none, where a turn costs exactly the time it takes.

Two things the browser does NOT do: decide anything, and keep its own sixty
seconds. The room sends the instant an absence becomes claimable rather than a
countdown, because a client timing it from when the message arrived would be
wrong by the whole of a reconnect.

## Decided, 23 Sep 2026

Vig settled two of the three questions this file opened with:

1. **A claimed win is `abandoned`**, a new reason in the result vocabulary
   (spec §7.2, `ADDENDUM-CLOCKS` §2). `rulesVersion` stays **1** — no rule of
   play changed — and a reader that does not know the reason should treat it as
   "finished, cause unknown" rather than throwing, exactly as the clock
   addendum asked of `flag`. The draw a player can take instead is `agreed`:
   it is a real result, and the one player still there is the only one in a
   position to agree to it.
2. **The first move gets thirty seconds**, which is the clock addendum's own
   first open question ("worth having if online play arrives"). It has arrived.

## Open, for Vig

1. **Whether rated play ships at all before accounts.** The mode exists and
   turns off takebacks, time gifts and away-claims. Rating nobody is arguably
   worse than not offering it.
2. **Whether players can name themselves online.** The protocol carries a name
   and the record keeps it; there is no field to type one into, so every online
   game currently reads Blue and Red. Pass-and-play has had name fields since
   M5, and copying them here is small — it is a wording and layout call rather
   than a technical one.
3. **What a spectator link should be.** The room has always allowed one and
   the server hands one back; nothing in the app offers it, and watching
   currently shows the position without animating each move in.
