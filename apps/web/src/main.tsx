import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { applyTheme, loadThemeFonts } from './apply-theme.js';
import { loadThemeId } from './storage.js';

// Applied here, synchronously, before React renders anything — so the first
// paint is already the saved theme rather than a flash of styles.css's
// static (Field Notes) fallback. App.tsx's own effect covers every change
// after this one.
const initialTheme = loadThemeId();
applyTheme(initialTheme);
loadThemeFonts(initialTheme);

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
