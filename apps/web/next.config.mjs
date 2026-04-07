import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Aponta pra raiz do monorepo pra que o standalone copie packages/* corretamente
  outputFileTracingRoot: path.join(__dirname, '../../'),
  serverExternalPackages: ['postgres'],
  transpilePackages: ['@jt/db', '@jt/shared'],
  images: {
    remotePatterns: [
      // Thumbnails do Meta vêm de scontent.xx.fbcdn.net
      { protocol: 'https', hostname: '**.fbcdn.net' },
      { protocol: 'https', hostname: '**.facebook.com' },
    ],
  },
  webpack: (config) => {
    // Permite imports com .js que apontam pra arquivos .ts
    // (necessário para os pacotes @jt/db e @jt/shared que usam ESM puro)
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
