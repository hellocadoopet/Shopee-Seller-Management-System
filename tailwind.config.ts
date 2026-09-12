import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { shopee: "#EE4D2D" },
    },
  },
  plugins: [],
} satisfies Config;
