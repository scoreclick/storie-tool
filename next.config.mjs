/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Configure proper handling of Web Workers
    config.module.rules.push({
      test: /\.worker\.js$/,
      use: { loader: 'worker-loader' },
    });
    
    return config;
  },
};

export default nextConfig;
