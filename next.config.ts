import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "exceljs"],
  outputFileTracingIncludes: {
    "/api/export/**": ["./public/rawia-logo-cream.svg", "./node_modules/pdfkit/js/data/**/*"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
