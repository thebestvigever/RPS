// spec 10.4's two named illegal-capture reasons, verbatim.

import { describe, expect, it } from 'vitest';
import { PIECE_TYPES, beats } from '@sps/engine';
import { illegalCaptureReason, keepLockText, permanentPieceText, pieceTypeName, raceMeterText } from '../src/text.js';

describe('illegalCaptureReason', () => {
  it('same type: "Same type — can\'t capture"', () => {
    expect(illegalCaptureReason('rock', 'rock')).toBe("Same type — can't capture");
    expect(illegalCaptureReason('paper', 'paper')).toBe("Same type — can't capture");
  });

  it('the defender beats the attacker: "<Defender> beats <Attacker>"', () => {
    // Rock can't take Paper: Paper beats Rock.
    expect(illegalCaptureReason('rock', 'paper')).toBe('Paper beats Rock');
    expect(illegalCaptureReason('paper', 'scissors')).toBe('Scissors beats Paper');
    expect(illegalCaptureReason('scissors', 'rock')).toBe('Rock beats Scissors');
  });

  it('is consistent with beats(): the reason always names the type that legitimately beats the attacker', () => {
    for (const attacker of PIECE_TYPES) {
      const defender = beats(attacker); // the type attacker WOULD legally capture
      // Reverse it: defender can't be captured BY beats(defender), i.e. the type defender itself beats.
      const illegalAttacker = beats(defender);
      expect(illegalCaptureReason(illegalAttacker, defender)).toBe(`${pieceTypeName(defender)} beats ${pieceTypeName(illegalAttacker)}`);
    }
  });
});

describe('pieceTypeName', () => {
  it('capitalises the three types', () => {
    expect(pieceTypeName('rock')).toBe('Rock');
    expect(pieceTypeName('paper')).toBe('Paper');
    expect(pieceTypeName('scissors')).toBe('Scissors');
  });
});

describe('permanentPieceText (spec 10.5)', () => {
  it('names the spec\'s own example verbatim', () => {
    expect(permanentPieceText('red', 'paper')).toBe("Red has no Paper left — Blue's Rocks are permanent");
  });

  it('pluralises Rock and Paper, but leaves Scissors alone', () => {
    // Blue out of rock -> Red's Scissors (rock's predator) are permanent.
    expect(permanentPieceText('blue', 'rock')).toBe("Blue has no Rock left — Red's Scissors are permanent");
    // Blue out of scissors -> Red's Paper (scissors's predator) are permanent.
    expect(permanentPieceText('blue', 'scissors')).toBe("Blue has no Scissors left — Red's Papers are permanent");
  });

  it('uses custom names when given them', () => {
    expect(permanentPieceText('red', 'paper', { blue: 'Maya', red: 'Sam' })).toBe(
      "Sam has no Paper left — Maya's Rocks are permanent",
    );
  });
});

describe('keepLockText (spec 7.6, 10.5)', () => {
  it('names the sealed side\'s own corner and the side shut out of it', () => {
    expect(keepLockText('blue')).toBe("Blue's corner is sealed — Red can't win by the corner");
    expect(keepLockText('red')).toBe("Red's corner is sealed — Blue can't win by the corner");
  });
});

describe('raceMeterText (spec 10.5)', () => {
  it('singular for one move, plural otherwise', () => {
    expect(raceMeterText(1)).toBe('Nearest runner: 1 move');
    expect(raceMeterText(4)).toBe('Nearest runner: 4 moves');
    expect(raceMeterText(0)).toBe('Nearest runner: 0 moves');
  });

  it('says so when nothing is left to run', () => {
    expect(raceMeterText(Infinity)).toBe('Nearest runner: none left');
  });
});
