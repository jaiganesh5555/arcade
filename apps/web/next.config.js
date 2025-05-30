/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    transpilePackages: ["@repo/ui"],
    images: {
        domains: ['pub-3f302ea423334407b3183fceb59dece7.r2.dev'], // Cloudflare R2 public access hostname
    },
}

module.exports = nextConfig