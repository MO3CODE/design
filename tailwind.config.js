/** @type {import('tailwindcss').Config} */
export default {
  content: ['./web/index.html', './web/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        graphite: { DEFAULT: '#26272A', 2: '#2F3034', 3: '#3A3B40', 4: '#4A4B51' },
        gold: { DEFAULT: '#A29265', light: '#CEB18F', deep: '#8C734B', pale: '#EDE6D3' },
        ivory: { DEFAULT: '#F4F1E9', 2: '#EEE9DD', 3: '#E4DDCC' },
        ink: { DEFAULT: '#2E2A24', soft: '#6B655A', mute: '#9A9384' },
        sun: '#EFBF04',
      },
      fontFamily: { sans: ['ThSans', 'Plex', 'system-ui', 'sans-serif'], display: ['Expo', 'ThSans', 'Plex', 'sans-serif'], serif: ['ThSerif', 'serif'] },
      boxShadow: { card: '0 1px 2px rgba(38,39,42,.06), 0 8px 24px -12px rgba(38,39,42,.18)', lift: '0 18px 48px -18px rgba(38,39,42,.45)' },
    },
  },
  plugins: [],
};
