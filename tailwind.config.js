/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f7f7',
          100: '#d9ecec',
          200: '#b6dbdb',
          300: '#86c3c3',
          400: '#5aa5a5',
          500: '#3f8a8a',
          600: '#357474',
          700: '#2f5e5e',
          800: '#2b4e4e',
          900: '#284242',
          950: '#142828',
        },
        accent: {
          50: '#fef9ec',
          100: '#fceec9',
          200: '#f9dc8f',
          300: '#f5c54c',
          400: '#f2b324',
          500: '#e39a0b',
          600: '#c97607',
          700: '#a7540a',
          800: '#88420e',
          900: '#70370f',
          950: '#411c04',
        },
        slate: {
          25: '#f9fafb',
          50: '#f8fafc',
          100: '#f1f5f9',
          150: '#e9eef5',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        body: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      transitionTimingFunction: {
        apple: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      animation: {
        'fade-in': 'fadeIn 0.6s ease forwards',
        'fade-up': 'fadeUp 0.6s ease forwards',
        'slide-up': 'slideUp 0.8s ease forwards',
        'scale-in': 'scaleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        'preloader-logo': 'preloaderLogo 1.4s cubic-bezier(0.25,0.1,0.25,1) forwards',
        'preloader-line-left': 'preloaderLineLeft 1.6s cubic-bezier(0.25,0.1,0.25,1) forwards',
        'preloader-line-right': 'preloaderLineRight 1.6s cubic-bezier(0.25,0.1,0.25,1) forwards',
        'preloader-dot': 'preloaderDot 1.6s cubic-bezier(0.25,0.1,0.25,1) forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(40px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        preloaderLogo: {
          '0%': { opacity: '0', transform: 'scale(0.7)' },
          '50%': { opacity: '1', transform: 'scale(1.03)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        preloaderLineLeft: {
          '0%': { width: '0', opacity: '0' },
          '40%': { width: '0', opacity: '0' },
          '100%': { width: '2rem', opacity: '1' },
        },
        preloaderLineRight: {
          '0%': { width: '0', opacity: '0' },
          '40%': { width: '0', opacity: '0' },
          '100%': { width: '2rem', opacity: '1' },
        },
        preloaderDot: {
          '0%': { opacity: '0', transform: 'scale(0)' },
          '50%': { opacity: '0', transform: 'scale(0)' },
          '70%': { opacity: '1', transform: 'scale(1.5)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
