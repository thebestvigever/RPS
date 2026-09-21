import { VARIANTS, VARIANT_BLURBS, VARIANT_IDS } from '@sps/engine';
import './styles.css';

// Placeholder home screen. The real one is spec 10.1 and lands with M3.
// It reads the variant list from the engine, which is the point of the
// scaffold: variants are data, and the app never hard-codes them.
export default function App() {
  return (
    <main>
      <h1>Stone Paper Scissors</h1>
      <p className="sub">
        Ten pieces, king moves, first to the enemy corner. Rules version{' '}
        {VARIANTS.original.rulesVersion}.
      </p>

      {VARIANT_IDS.map((id) => (
        <section className="variant" key={id}>
          <h2>{VARIANTS[id].name}</h2>
          <p>{VARIANT_BLURBS[id]}</p>
        </section>
      ))}

      <div className="status">
        <p>
          Scaffold only. The engine is next (M1): rules, position notation, move
          notation, events and <code>isSealed</code>, green against every fixture
          vector and perft number before any board UI starts.
        </p>
      </div>
    </main>
  );
}
