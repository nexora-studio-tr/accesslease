// Keep the browser bundle optimized even when the API/test process uses NODE_ENV=test.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build();
await import('./compress.mjs');
