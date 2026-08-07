import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

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
  if (filePath.endsWith('.svg')) return 'image/svg+xml; charset=utf-8';
  return 'application/octet-stream';
}

function hashContent(content: string | Uint8Array): string {
  return `sha256-${crypto.createHash('sha256').update(content).digest('base64')}`;
}

function createDataResourceEntries(): Record<string, string> {
  return Object.fromEntries(listDataFiles(dataDirectory).map((filePath) => {
    const relativePath = path.relative(dataDirectory, filePath).split(path.sep).join('/');
    return [`data/${relativePath}`, hashContent(fs.readFileSync(filePath))];
  }));
}

function createResourceManifest(resources: Record<string, string>) {
  const sortedResources = Object.fromEntries(
    Object.entries(resources).sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    schemaVersion: 1,
    buildId: hashContent(JSON.stringify(sortedResources)),
    resources: sortedResources,
  };
}

function dataDevServerPlugin(): Plugin {
  return {
    name: 'local-data-dev-server',
    apply: 'serve',
    configureServer(server) {
      const mountPath = `${server.config.base}data`.replace(/\/+/g, '/');
      const manifestPath = `${server.config.base}resource-manifest.json`.replace(/\/+/g, '/');

      server.middlewares.use(manifestPath, (_request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(createResourceManifest(createDataResourceEntries())));
      });

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
    generateBundle(_options, bundle) {
      const resources = createDataResourceEntries();
      for (const [fileName, output] of Object.entries(bundle)) {
        const content = output.type === 'asset' ? output.source : output.code;
        resources[fileName] = hashContent(content);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'resource-manifest.json',
        source: JSON.stringify(createResourceManifest(resources)),
      });
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
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
