/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#fefcf8',
          100: '#fdf7ed',
          200: '#faecd0',
        },
        sage: {
          50: '#f3f7f0',
          100: '#e3ecdb',
          200: '#c8dab8',
          300: '#a4c388',
          400: '#82a862',
          500: '#658d44',
          600: '#4f7134',
          700: '#3f592b',
          800: '#344826',
          900: '#2c3c22',
        },
        tomato: {
          50: '#fef3f0',
          100: '#fde2da',
          200: '#fbc0b1',
          300: '#f6957c',
          400: '#ef6848',
          500: '#e54a26',
          600: '#cc3615',
          700: '#a72a13',
          800: '#882517',
          900: '#6f2215',
        },
        butter: {
          50: '#fffaeb',
          100: '#fff0c6',
          200: '#ffe188',
          300: '#ffca4a',
          400: '#ffb324',
          500: '#f9930b',
          600: '#dd7207',
          700: '#b75309',
          800: '#94410e',
          900: '#7a370f',
        },
        // Dark-mode surface palette
        ink: {
          50: '#f5f5f4',
          100: '#e7e5e4',
          200: '#d6d3d1',
          300: '#a8a29e',
          400: '#78716c',
          500: '#57534e',
          600: '#44403c',
          700: '#2d2a26',
          800: '#1c1a17',
          900: '#13110f',
          950: '#0a0908',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 2px 12px -2px rgba(60, 40, 20, 0.08), 0 4px 24px -8px rgba(60, 40, 20, 0.06)',
        card: '0 1px 3px rgba(60, 40, 20, 0.05), 0 4px 16px -4px rgba(60, 40, 20, 0.08)',
        pop: '0 8px 32px -8px rgba(60, 40, 20, 0.18)',
        glow: '0 0 0 1px rgba(255, 255, 255, 0.06), 0 12px 40px -12px rgba(101, 141, 68, 0.4)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'sheet-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-3deg)' },
          '75%': { transform: 'rotate(3deg)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in 0.2s ease-out',
        'sheet-up': 'sheet-up 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
        'wiggle-once': 'wiggle 0.4s ease-in-out',
        shimmer: 'shimmer 3s linear infinite',
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};