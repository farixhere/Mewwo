/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Shared lib files import siblings with explicit .ts extensions so they also run under Node's test runner.
  transpilePackages: ['three'],
};
export default nextConfig;
