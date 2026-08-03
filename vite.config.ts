import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      name: 'serve-data-dir',
      configureServer(server) {
        server.middlewares.use('/data', (req, res, next) => {
          const filePath = path.join(process.cwd(), 'data', req.url || '');
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.writeHead(200);
            fs.createReadStream(filePath).pipe(res);
          } else {
            next();
          }
        });
      }
    }
  ]
});
