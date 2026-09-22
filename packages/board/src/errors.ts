export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderError';
  }
}

/**
 * Thrown by `familyMark` for a family that is data but not geometry yet.
 * M3 ships Cut stone only (docs/VISUAL_SYSTEM.md 8); the other three are a
 * data drop once M3 has been played and reviewed — see 5.
 */
export class FamilyNotBuiltError extends RenderError {
  constructor(id: string) {
    super(
      `The "${id}" piece family is not built yet — see docs/VISUAL_SYSTEM.md ` +
        `5 and 8. Cut stone is the only family M3 ships.`,
    );
    this.name = 'FamilyNotBuiltError';
  }
}
