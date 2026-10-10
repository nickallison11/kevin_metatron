/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pitch decks are shown as {site}/deck/<cid> so links carry the metatron
  // domain, not the IPFS gateway's. Vercel proxies the file from the gateway;
  // switching gateways later only changes DECK_GATEWAY_URL, not stored links.
  async rewrites() {
    const gateway = (process.env.DECK_GATEWAY_URL ?? "https://gateway.pinata.cloud/ipfs").replace(/\/+$/, "");
    return [{ source: "/deck/:cid", destination: `${gateway}/:cid` }];
  },
};

export default nextConfig;
