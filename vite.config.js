import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    build: {
        lib: {
            entry: path.resolve(__dirname, 'src/main.js'),
            formats: ['es'],
            fileName: () => 'otnet-player.js',
            name: 'OTNetPlayer',
        },
        rollupOptions: {
            output: {
                inlineDynamicImports: true,
            },
        },
        // outDir: path.resolve(__dirname, '../public'),
        outDir: path.resolve(__dirname, 'dist'),
        emptyOutDir: false,
    },
});
