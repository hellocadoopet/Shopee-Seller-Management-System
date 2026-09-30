import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        shopee: {
          DEFAULT: "#EE4D2D", // brand: logo, decorative fills with no text on them
          50: "#FFF1EC", // selected row / active nav background
          600: "#D0401F", // anything carrying text: buttons, bubbles, links, badges (4.73:1 with white)
          700: "#B23519", // hover/pressed of 600
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
