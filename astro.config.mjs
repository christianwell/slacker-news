import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { legacyRedirects } from "./src/data/legacy-redirects.mjs";

const espeakDataPath = fileURLToPath(
    new URL("./node_modules/@echogarden/espeak-ng-emscripten/espeak-ng.data", import.meta.url)
);

function espeakDataPlugin() {
    return {
        name: "espeak-data",
        enforce: "pre",
        transform(code, id) {
            if (!id.includes("@echogarden/espeak-ng-emscripten/espeak-ng.js")) return;
            return code.replace(
                "return `${directoryPath}/espeak-ng.data`",
                'return "/espeak-ng.data"'
            );
        },
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                if (request.url?.split("?")[0] !== "/espeak-ng.data") return next();
                response.setHeader("Content-Type", "application/octet-stream");
                response.setHeader("Content-Length", String(statSync(espeakDataPath).size));
                createReadStream(espeakDataPath).pipe(response);
            });
        },
        generateBundle() {
            this.emitFile({
                type: "asset",
                fileName: "espeak-ng.data",
                source: readFileSync(espeakDataPath),
            });
        },
    };
}

export default defineConfig({
    site: "https://news.hackclub.com",
    server: { port: 4000 },
    markdown: {
        remarkPlugins: [remarkMath],
        rehypePlugins: [rehypeKatex],
    },
    integrations: [mdx()],
    image: {
        domains: ["cdn.hackclub.com", "user-cdn.hackclub-assets.com"]
    },
    vite: {
        optimizeDeps: {
            exclude: ["@echogarden/espeak-ng-emscripten"]
        },
        plugins: [espeakDataPlugin()]
    },
    redirects: legacyRedirects
});
