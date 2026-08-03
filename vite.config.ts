import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import fs from 'fs';

const dataDirectory = path.resolve(process.cwd(), 'data');

function listDataFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listDataFiles(entryPath) : [entryPath];
  });
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.csv')) return 'text/csv; charset=utf-8';
  return 'application/octet-stream';
}

function dataDevServerPlugin(): Plugin {
  return {
    name: 'local-data-dev-server',
    apply: 'serve',
    configureServer(server) {
      const mountPath = `${server.config.base}data`.replace(/\/+/g, '/');

      server.middlewares.use(mountPath, (request, response, next) => {
        const pathname = decodeURIComponent((request.url ?? '').split('?')[0]);
        const filePath = path.resolve(dataDirectory, `.${pathname}`);

        if (!filePath.startsWith(`${dataDirectory}${path.sep}`) || !fs.existsSync(filePath)) {
          next();
          return;
        }

        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
          next();
          return;
        }

        response.setHeader('Content-Type', contentTypeFor(filePath));
        fs.createReadStream(filePath).pipe(response);
      });
    },
  };
}

function dataBuildAssetsPlugin(): Plugin {
  return {
    name: 'local-data-build-assets',
    apply: 'build',
    buildStart() {
      for (const filePath of listDataFiles(dataDirectory)) {
        const relativePath = path.relative(dataDirectory, filePath).split(path.sep).join('/');
        this.emitFile({
          type: 'asset',
          fileName: `data/${relativePath}`,
          source: fs.readFileSync(filePath),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    dataDevServerPlugin(),
    dataBuildAssetsPlugin(),
  ],
  resolve: {
    tsconfigPaths: true
  }
});
