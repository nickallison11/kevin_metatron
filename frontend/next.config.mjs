/** @type {import('next').NextConfig} */
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000").replace(/\/+$/, "");

// Backend endpoints that outside services and already-sent emails still call on
// the frontend's domain (platform.metatron.id used to be fronted by KVM2's nginx,
// which sent these straight to the backend). Forward them to the API so they
// keep working; new integrations should use the API domain directly.
const LEGACY_BACKEND_PATHS = [
  "/whatsapp/webhook", // Meta WhatsApp Cloud API
  "/commerce/webhook", // Paystack
  "/commerce/nowpayments/webhook", // NowPayments IPN
  "/api/founders/webhook-event", // Resend email events
  "/kevin/inbound-email", // Cloudflare kevin@metatron.id email worker
  "/unsubscribe", // links in sent emails (/unsubscribe?token=...)
];

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
      ...LEGACY_BACKEND_PATHS.map((source) => ({ source, destination: `${API_BASE}${source}` })),
    ];
  },
};

export default nextConfig;
