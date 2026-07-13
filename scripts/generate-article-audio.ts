import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Constants, EdgeTTS } from "@andresaya/edge-tts";

const VOICE = "en-GB-RyanNeural";
const CONTENT_DIRECTORY = resolve("src/content/posts");
const OUTPUT_DIRECTORY = resolve("public/article-audio");
const CACHE_ORIGIN = process.env.ARTICLE_AUDIO_CACHE_ORIGIN ?? "https://slacker-news.christianwell.xyz";

type TimedWord = {
  word: string;
  start: number;
  end: number;
};

type AudioManifest = {
  hash: string;
  voice: string;
  chunks: Array<{
    audio: string;
    words: TimedWord[];
  }>;
};

function articleText(source: string): string {
  const body = source.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "");

  return body
    .replace(/^\s*(?:import|export)\s.+$/gm, "")
    .replace(/<Caption\b[^>]*>[\s\S]*?<\/Caption>/gi, " ")
    .replace(/<figcaption\b[^>]*>[\s\S]*?<\/figcaption>/gi, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)\s*\n+\s*\*[^*\n]+\*/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<SlackMention\s+name=["']([^"']+)["'][^>]*\/?\s*>/gi, "@$1")
    .replace(/<SlackChannel\s+id=["']([^"']+)["'][^>]*\/?\s*>/gi, "#$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^```[^\n]*$/gm, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+] |\d+\.\s+)/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]{1,2}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith(".mdx") ? [path] : [];
  }));
  return files.flat();
}

async function restoreDeployedAudio(
  slug: string,
  hash: string,
  directory: string,
  manifestPath: string,
): Promise<boolean> {
  try {
    const manifestUrl = new URL(`/article-audio/${slug}/manifest.json`, CACHE_ORIGIN);
    const manifestResponse = await fetch(manifestUrl);
    if (!manifestResponse.ok) return false;

    const manifest = await manifestResponse.json() as AudioManifest;
    if (manifest.hash !== hash || !manifest.chunks.length) return false;

    const audioFiles = await Promise.all(manifest.chunks.map(async (chunk) => {
      if (chunk.audio.includes("/") || chunk.audio.includes("\\")) {
        throw new Error("Invalid cached audio filename");
      }
      const response = await fetch(new URL(chunk.audio, manifestUrl));
      if (!response.ok) throw new Error(`Cached audio returned ${response.status}`);
      return { name: chunk.audio, data: Buffer.from(await response.arrayBuffer()) };
    }));

    await mkdir(directory, { recursive: true });
    await Promise.all(audioFiles.map((audio) => writeFile(resolve(directory, audio.name), audio.data)));
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    return true;
  } catch {
    return false;
  }
}

async function generateArticle(path: string): Promise<"generated" | "restored" | "cached" | "empty"> {
  const slug = relative(CONTENT_DIRECTORY, path).replace(/\.mdx$/, "");
  const text = articleText(await readFile(path, "utf8"));
  if (!text) return "empty";

  const directory = resolve(OUTPUT_DIRECTORY, slug);
  const manifestPath = resolve(directory, "manifest.json");
  const hash = createHash("sha256").update(`edge-tts-v2\0${VOICE}\0${text}`).digest("hex");

  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as AudioManifest;
    if (manifest.hash === hash) return "cached";
  } catch {
    // This article has not been generated yet.
  }

  if (await restoreDeployedAudio(slug, hash, directory, manifestPath)) {
    return "restored";
  }

  await mkdir(directory, { recursive: true });
  const manifest: AudioManifest = {
    hash,
    voice: "Microsoft Ryan (British English)",
    chunks: [],
  };

  const tts = new EdgeTTS();
  await tts.synthesize(text, VOICE, {
    outputFormat: Constants.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
    rate: "-5%",
  });
  const words = tts.getWordBoundaries().map((word) => ({
    word: word.text,
    start: word.offset / 10_000_000,
    end: (word.offset + word.duration) / 10_000_000,
  }));
  if (!words.length) throw new Error("Edge TTS returned audio without word timings");

  const audioName = "article.mp3";
  await writeFile(resolve(directory, audioName), tts.toBuffer());
  manifest.chunks.push({ audio: audioName, words });

  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  return "generated";
}

let files = (await Promise.all(
  ["essays", "news", "opinion"].map((category) => sourceFiles(resolve(CONTENT_DIRECTORY, category))),
)).flat().sort();
const requestedSlugs = new Set(process.argv.slice(2));
if (requestedSlugs.size) {
  files = files.filter((path) => requestedSlugs.has(relative(CONTENT_DIRECTORY, path).replace(/\.mdx$/, "")));
}
let generated = 0;
let restored = 0;
let cached = 0;
let nextFile = 0;

async function generateNextArticle() {
  while (nextFile < files.length) {
    const index = nextFile;
    nextFile += 1;
    const path = files[index];
    const slug = relative(CONTENT_DIRECTORY, path).replace(/\.mdx$/, "");
    const result = await generateArticle(path);
    console.log(`[${index + 1}/${files.length}] ${slug}: ${result}`);
    if (result === "generated") generated += 1;
    if (result === "restored") restored += 1;
    if (result === "cached") cached += 1;
  }
}

await Promise.all(Array.from({ length: Math.min(3, files.length) }, generateNextArticle));
console.log(`Article audio ready: ${generated} generated, ${restored} restored, ${cached} locally cached.`);
