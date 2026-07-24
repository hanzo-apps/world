import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// Dedicated Vite config for the React + @hanzo/gui (Tamagui) surface. It is fully
// separate from the shipping vanilla vite.config.ts so the two entries never
// interfere: `npm run build` still builds the vanilla app at index.html untouched,
// while `npm run build:react` builds THIS entry (index.react.html) into dist-react/.
//
// @hanzo/gui is consumed at runtime (no compile-time extraction needed for the
// foundation): @vitejs/plugin-react gives JSX + fast-refresh, and the three knobs
// Tamagui-on-web needs are set below — the react-native → react-native-web alias,
// React de-duplication, and the TAMAGUI_TARGET / __DEV__ defines.

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));
const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  root: __dirname,

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    'process.env.TAMAGUI_TARGET': JSON.stringify('web'),
    __DEV__: JSON.stringify(isDev),
  },

  plugins: [react()],

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Tamagui/@hanzo/gui primitives resolve react-native APIs at runtime through
      // react-native-web on the web.
      'react-native': 'react-native-web',
    },
    // Never let a transitive copy split the React runtime — one instance each.
    dedupe: ['react', 'react-dom', 'react-native-web'],
  },

  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react-native-web'],
    esbuildOptions: {
      // react-native-web / some @hanzogui packages ship .js containing JSX.
      loader: { '.js': 'jsx' },
    },
  },

  build: {
    outDir: 'dist-react',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.react.html'),
    },
  },

  server: {
    port: 5273,
  },
});
