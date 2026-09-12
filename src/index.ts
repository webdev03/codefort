import { createApp } from './app';

const app = createApp(process.env['CODEFORT_API_KEY'] || '');
export default {
  hostname: process.env['HOST'] || '127.0.0.1',
  port: process.env['PORT'] || 3000,
  maxRequestBodySize: 1024 * 1024,
  fetch: app.fetch,
};
