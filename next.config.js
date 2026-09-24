/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // Supabase Storage
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
      // Replicate outputs
      {
        protocol: 'https',
        hostname: 'replicate.delivery',
      },
      {
        protocol: 'https',
        hostname: '*.replicate.delivery',
      },
      // FAL.ai outputs
      {
        protocol: 'https',
        hostname: 'fal.media',
      },
      {
        protocol: 'https',
        hostname: '*.fal.media',
      },
      // Google Cloud Storage / Vertex AI outputs
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
      },
      {
        protocol: 'https',
        hostname: '*.googleapis.com',
      },
    ],
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
    // The prompting skill is read from disk at runtime (src/lib/skills/registry.ts,
    // src/lib/headless/mcp-prompts.ts). Without this the files were never traced
    // into the serverless bundle and every prompt rewrite ran on a generic fallback.
    outputFileTracingIncludes: {
      '/api/**/*': ['./src/lib/skills/**/*.md', './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
    },
    // The CMF spec check reads a PDF's text with pdf.js's legacy build on the server
    // (src/lib/creative/cmf/pdf-lines.ts); it is loaded from node_modules, not bundled, and its
    // fake worker file is traced above.
    serverComponentsExternalPackages: ['pdfjs-dist'],
  },
  webpack: (config, { isServer }) => {
    // Handle Node.js modules for server-side only (for Vertex AI SDK)
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        tls: false,
        fs: false,
        dns: false,
        child_process: false,
        canvas: false,
      }
    }
    return config
  },
}

module.exports = nextConfig
