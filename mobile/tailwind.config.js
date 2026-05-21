/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        accent: "var(--accent)",
        pink: "#f8c8dc",
        lime: "#c8e84c",
      },
      fontFamily: {
        sans: ["Manrope", "System"],
      },
    },
  },
  plugins: [],
};
