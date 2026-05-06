/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Figtree", "sans-serif"],
        body: ["Figtree", "sans-serif"],
      },
      boxShadow: {
        glow: "0 20px 80px -28px rgba(14, 165, 233, 0.55)",
      },
    },
  },
  plugins: [],
};
