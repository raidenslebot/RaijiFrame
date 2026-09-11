import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
// @ts-expect-error - plain JS dev plugin, no types needed
import { liveDataPlugin } from './scripts/dev-live-data.mjs';

const root = import.meta.dirname;

// Overwolf loads windows from disk over file:// - every asset ref must be relative.
export default defineConfig(() => ({
  base: './',
  plugins: [react(), tailwindcss(), liveDataPlugin()],
  resolve: { alias: { '@': resolve(root, 'src') } },
  /*
   * DEV ONLY: a proxy for the read-only public APIs the app fetches.
   *
   * In Overwolf these hosts are reachable because the manifest's
   * externally_connectable list doubles as the CORS allowance. A browser on
   * localhost has no such grant, so every market and drop-table request failed
   * in development and only in development - which is the worst place for a
   * difference, because it is where the work gets verified.
   *
   * The proxy exists only in the Vite dev server. The shipped build talks to
   * these hosts directly, under the manifest allowance, and never sees this.
   */
  server: {
    proxy: {
      '/__wfm': {
        target: 'https://api.warframe.market',
        changeOrigin: true,
        /*
         * FOLLOW REDIRECTS ON THE SERVER SIDE, OR THEY LEAVE THE PROXY.
         *
         * warframe.market 301s some item slugs to a canonical form -
         * `mirage_prime_systems` becomes `mirage_prime_systems_blueprint` -
         * and the Location header it sends is ABSOLUTE. Without this the
         * browser is handed that absolute URL and follows it cross-origin,
         * outside the proxy, with no CORS grant: the request dies as an opaque
         * "Failed to fetch" and the item silently never gets a price.
         *
         * It is dev-only and slug-dependent, which is what made it look like
         * rate limiting: most slugs resolve directly and work, and the ones
         * that redirect fail every time. The packaged app follows the redirect
         * itself under the manifest allowance and never sees this.
         */
        followRedirects: true,
        rewrite: (p: string) => p.replace(/^\/__wfm/, ''),
      },
      '/__drops': {
        target: 'https://drops.warframestat.us',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/__drops/, ''),
      },
      /*
       * THE HOST THIS PROXY'S OWN COMMENT WAS WRITTEN ABOUT, AND MISSED.
       * ————————————————————————————————————————————
       * The note above says a missing host fails "in development and only in
       * development - which is the worst place for a difference, because it is
       * where the work gets verified". `api.warframestat.us` was then left out,
       * so the entire worldstate - fissures, the day/night cycles, Baro, the
       * Nightwave acts, the sortie, invasions - has never loaded in the dev
       * server. Every one of those panels was being looked at with its data
       * source silently absent.
       *
       * The manifest already grants this host, so the shipped app was fine. The
       * gap was only ever here, which is exactly what made it invisible.
       */
      '/__ws': {
        target: 'https://api.warframestat.us',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/__ws/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome108', // Overwolf CEF floor; raise once minimum-overwolf-version rises
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(root, 'background.html'),
        desktop: resolve(root, 'desktop.html'),
        ingame: resolve(root, 'ingame.html'),
        automod: resolve(root, 'automod.html'),
      },
    },
  },
}));
