export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalMoveError';
  }
}

export class FenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FenError';
  }
}

/** Thrown by every stub still waiting on M1 (spec 12). */
export class NotImplementedError extends Error {
  constructor(what: string, specSection: string) {
    super(`${what} is not implemented yet — see spec ${specSection} (milestone M1).`);
    this.name = 'NotImplementedError';
  }
}

export class NotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotationError';
  }
}

export class ShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareError';
  }
}
