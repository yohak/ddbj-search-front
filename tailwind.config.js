/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#ff8c00",
        "primary-dark": "#cc7000",
      },
      gridTemplateColumns: {
        "min-1fr": "min-content 1fr",
      },
    },
  },
  plugins: [],
};
