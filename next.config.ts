import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@google-cloud/firestore", "@supabase/supabase-js"],
};

export default nextConfig;
