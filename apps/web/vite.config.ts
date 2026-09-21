import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static files only — there is no server in v1 (spec 7.1).
export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022', sourcemap: true },
});
