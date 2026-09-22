// spec 10.4's two named illegal-capture reasons, verbatim.

import { describe, expect, it } from 'vitest';
import { PIECE_TYPES, beats } from '@sps/engine';
import { illegalCaptureReason, pieceTypeName } from '../src/text.js';

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
