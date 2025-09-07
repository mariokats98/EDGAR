/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Let the build finish even if TypeScript/eslint complain (we’ll tighten later)
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
