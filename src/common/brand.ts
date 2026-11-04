// Shared asset identity for React headers, public documents and installed apps.
export const BRAND = {
  home: '/#/',
  label: 'HypoExplorer home',
  logo: '/brand/v1/hypoexplorer-logo.png',
  width: 200,
  height: 45,
  stylesheet: '/brand/v1/brand.css',
  themeColor: '#4C78A8',
} as const;

export const BRAND_HEAD = `<link rel="icon" href="/favicon.ico?v=brand-1" sizes="16x16 32x32 48x48">
<link rel="icon" type="image/png" href="/brand/v1/favicon-32.png" sizes="32x32">
<link rel="icon" type="image/png" href="/brand/v1/favicon-16.png" sizes="16x16">
<link rel="apple-touch-icon" href="/brand/v1/apple-touch-icon.png" sizes="180x180">
<link rel="stylesheet" href="${BRAND.stylesheet}">`;
