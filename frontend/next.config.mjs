/** @type {import('next').NextConfig} */
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000").replace(/\/+$/, "");

const nextConfig = {
  reactStrictMode: true,
  // Pitch decks and logos are shown on the metatron domain
  // ({site}/deck/<cid>, {site}/media/<cid>). Both go to the backend's
  // GET /uploads/file/:cid, which serves only files metatron stored, and only
  // PDFs and raster images — never arbitrary IPFS content on the app's origin.
  async rewrites() {
    return [
      { source: "/deck/:cid", destination: `${API_BASE}/uploads/file/:cid` },
      { source: "/media/:cid", destination: `${API_BASE}/uploads/file/:cid` },
    ];
  },
};

export default nextConfig;
