// Spec 10.5 ("each [aid] switchable in Settings") and 10.1's Settings
// screen — previously unbuilt (docs/VISUAL_SYSTEM.md 7, 10 both note the
// gap explicitly). This is the smallest thing that closes it: the six aids
// M6 actually renders, and the theme picker for the three themes M3a
// already built and validated (packages/board/test/contrast.test.ts).
//
// Two things deliberately NOT here, both on the same principle
// (VISUAL_SYSTEM.md 11.4: "a permanently disabled control ... is noise;
// ship it when it works"):
//   - Hint. `Aids.hint` exists and defaults on, but nothing computes a
//     suggested move yet (spec 9.5) — a toggle for it would do nothing.
//   - Family, coordinates-adjacent extras, myColor/opponentColor. Only
//     Cut stone is built (families.ts), and per-piece colour needs its own
//     contrast validation before it's a safe thing to expose.
// `coordinates` IS here: it's genuinely wired (Game.tsx passes it straight
// to `renderBoard`), so it's not the same kind of noise.
//
// Zen and sound already have their own control in the game bar
// (spec C2, 10.12) — repeating them here would be a second place to look
// for the same one switch, not a new capability.

import type { Aids, DisplaySettings } from '@sps/match';
import { THEMES, THEME_IDS } from '@sps/board';
import type { ThemeId } from '@sps/board';
import './settings.css';

export interface SettingsProps {
  settings: DisplaySettings;
  onUpdateSettings: (patch: Partial<DisplaySettings>) => void;
  themeId: ThemeId;
  onThemeChange: (id: ThemeId) => void;
  onExit: () => void;
}

const AID_LABELS: ReadonlyArray<{ key: keyof Aids; label: string; description: string }> = [
  { key: 'typeCounts', label: 'Type counts', description: 'Rock, Paper and Scissors counts in each panel.' },
  {
    key: 'threatLines',
    label: 'Threat lines',
    description: 'Arrows to and from the pieces a selected or hovered piece can take, or be taken by.',
  },
  { key: 'raceMeter', label: 'Race meter', description: 'Each side’s smallest king distance to its goal.' },
  {
    key: 'permanentPieces',
    label: 'Permanent shields',
    description: 'A shield on any piece that can no longer be captured.',
  },
  { key: 'keepLock', label: 'Keep lock', description: 'A lock on a corner the opponent can no longer reach.' },
  {
    key: 'dangerMarks',
    label: 'Danger marks',
    description: 'A warning on a destination where the moving piece could be taken right back.',
  },
];

export default function Settings({ settings, onUpdateSettings, themeId, onThemeChange, onExit }: SettingsProps) {
  const setAid = (key: keyof Aids, on: boolean) => {
    onUpdateSettings({ aids: { ...settings.aids, [key]: on } });
  };

  return (
    <main className="settings-screen">
      <button className="back" onClick={onExit} type="button">
        ← Home
      </button>
      <h1>Settings</h1>

      <section className="settings-section">
        <h2>Information aids</h2>
        <p className="settings-note">
          Spec 10.5. Hidden automatically in Zen and against a Hard computer, whatever these say — turning one off
          here is what stays true the rest of the time.
        </p>
        {AID_LABELS.map(({ key, label, description }) => (
          <label key={key} className="settings-row">
            <input type="checkbox" checked={settings.aids[key]} onChange={(event) => setAid(key, event.target.checked)} />
            <span className="settings-row-text">
              <span className="settings-row-label">{label}</span>
              <span className="settings-row-description">{description}</span>
            </span>
          </label>
        ))}
      </section>

      <section className="settings-section">
        <h2>Board</h2>
        <label className="settings-row">
          <input
            type="checkbox"
            checked={settings.coordinates}
            onChange={(event) => onUpdateSettings({ coordinates: event.target.checked })}
          />
          <span className="settings-row-text">
            <span className="settings-row-label">Coordinates</span>
            <span className="settings-row-description">File and rank labels along the board's own edges.</span>
          </span>
        </label>
      </section>

      <section className="settings-section">
        <h2>Colour scheme</h2>
        <p className="settings-note">Only your own device remembers this — it never travels with a shared game.</p>
        <div className="theme-picker" role="radiogroup" aria-label="Theme">
          {THEME_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={themeId === id}
              className={`theme-option${themeId === id ? ' theme-option--on' : ''}`}
              onClick={() => onThemeChange(id)}
            >
              <span className="theme-option-name">{THEMES[id].name}</span>
              <span className="theme-option-description">{THEMES[id].description}</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
