/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server build (what the host runs). Everything the server needs is bundled in.
  output: "standalone",
  // Never ship a local data file inside a build.
  outputFileTracingExcludes: { "*": [".data/**"] },
};
export default nextConfig;
