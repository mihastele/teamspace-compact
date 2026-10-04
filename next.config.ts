import type { NextConfig } from "next";
import { isPrivilegedSupabaseKey } from "./src/lib/public-key";

const browserKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (isPrivilegedSupabaseKey(browserKey) || (browserKey && browserKey === process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY must contain a public key. A server key cannot be bundled in the browser.");
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
