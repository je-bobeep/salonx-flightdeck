import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic aliases for aging signals + status. Everything else uses
        // Tailwind's built-in neutral / blue / red / amber palettes directly.
        warn: "#d97706", // amber-600
        danger: "#dc2626", // red-600
        success: "#16a34a", // green-600
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Hiragino Sans",
          "Noto Sans JP",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        // Subtle Stripe-style card shadow
        card: "0 1px 2px rgba(15, 23, 42, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
