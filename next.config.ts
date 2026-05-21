import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingExcludes: {
    "*": [
      "**/Application Data/**",
      "**/AppData/Local/Application Data/**",
      "**/Cookies/**",
      "**/Local Settings/**",
      "**/NetHood/**",
      "**/PrintHood/**",
      "**/Recent/**",
      "**/SendTo/**",
      "**/Start Menu/**",
      "**/Templates/**",
    ],
  },
};

export default nextConfig;
