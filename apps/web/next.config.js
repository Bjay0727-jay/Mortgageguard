/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@mortgageguard/shared"],
};

module.exports = nextConfig;
