import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef8f3",
          100: "#d8efe3",
          600: "#2f7d5c",
          700: "#27674d"
        },
        linen: "#faf7f1",
        cream: "#fffdf8",
        ink: "#2d2a26",
        clay: "#8a7460",
        success: "#16a34a",
        warning: "#d97706",
        danger: "#dc2626"
      }
    }
  },
  plugins: []
};

export default config;
