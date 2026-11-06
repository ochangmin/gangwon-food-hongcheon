/** @type {import('next').NextConfig} */
export default {
  eslint: { ignoreDuringBuilds: true },
  experimental: { serverActions: { bodySizeLimit: '5mb' } },
};
