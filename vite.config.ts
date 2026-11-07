import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-api',
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith('/api/')) return next();
          try {
            const { route } = await import('./server/router.js');
            const apiResponse = {
              status(status: number) { response.statusCode = status; return this; },
              json(body: unknown) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body)); },
            };
            await route(request, apiResponse);
          } catch {
            response.statusCode = 500;
            response.setHeader('Content-Type','application/json');
            response.end(JSON.stringify({ error:'Request failed.' }));
          }
        });
      },
    },
  ],
});
