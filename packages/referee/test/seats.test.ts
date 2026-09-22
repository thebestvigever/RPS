import { describe, expect, it } from 'vitest';
import {
  SeatError,
  bothClaimed,
  claim,
  createSeats,
  inviteLink,
  isToken,
  parseInvite,
  seatFor,
} from '../src/index.js';

const tokens = { blue: 'blue-token-aaaa', red: 'red-token-bbbb' };

describe('seats', () => {
  it('opens exactly the seat its token was issued for', () => {
    const seats = createSeats(tokens);
    expect(seatFor(seats, tokens.blue)).toBe('blue');
    expect(seatFor(seats, tokens.red)).toBe('red');
    expect(seatFor(seats, 'not-a-real-token')).toBe(null);
    expect(seatFor(seats, null)).toBe(null);
  });

  it('refuses tokens that would not survive a link, or two of the same', () => {
    expect(() => createSeats({ blue: 'short', red: tokens.red })).toThrow(SeatError);
    expect(() => createSeats({ blue: 'has spaces!!', red: tokens.red })).toThrow(SeatError);
    expect(() => createSeats({ blue: tokens.blue, red: tokens.blue })).toThrow(SeatError);
  });

  it('keeps the name a returning player is already known by', () => {
    let seats = createSeats(tokens);
    seats = claim(seats, 'blue', 'Vig', 1_000);
    seats = claim(seats, 'blue', null, 9_000);
    expect(seats.blue.name).toBe('Vig');
    // The claim time is the first one: a reconnect is not a new arrival.
    expect(seats.blue.claimedAt).toBe(1_000);
    expect(bothClaimed(seats)).toBe(false);
    expect(bothClaimed(claim(seats, 'red', 'Ada', 2_000))).toBe(true);
  });
});

describe('invite links', () => {
  it('round-trips a seat link and a spectator link', () => {
    const seat = inviteLink('https://sps.example', 'match-one', tokens.red);
    expect(seat).toBe('https://sps.example/#m=match-one.red-token-bbbb');
    expect(parseInvite(seat)).toEqual({ matchId: 'match-one', token: tokens.red });

    const watching = inviteLink('https://sps.example/', 'match-one', null);
    expect(watching).toBe('https://sps.example/#m=match-one');
    expect(parseInvite(watching)).toEqual({ matchId: 'match-one', token: null });
  });

  it('reads a link out of a whole location, not just a bare hash', () => {
    expect(parseInvite('https://sps.example/play/#m=match-one.blue-token-aaaa')).toEqual({
      matchId: 'match-one',
      token: tokens.blue,
    });
  });

  it('refuses anything that is not one', () => {
    expect(parseInvite('https://sps.example/#g=eyJ9')).toBe(null);
    expect(parseInvite('https://sps.example/')).toBe(null);
    expect(parseInvite('#m=bad id.token')).toBe(null);
    expect(parseInvite('#m=match-one.tiny')).toBe(null);
    expect(isToken('tiny')).toBe(false);
  });
});
