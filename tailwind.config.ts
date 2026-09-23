import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { shopee: "#EE4D2D" },
    },
  },
  plugins: [],
} satisfies Config;
