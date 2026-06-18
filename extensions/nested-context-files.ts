import { access, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
const CUSTOM_TYPE = "nested-context-files";

type CacheEntry = {
  mtimeMs: number;
  content: string;
};

const contentCache = new Map<string, CacheEntry>();
const injectedKeys = new Set<string>();
const injectedContextFiles = new Set<string>();

function looksPathLike(command: string): boolean {
  return /(^|\s)(\.{1,2}\/|\/|~\/)/.test(command) || /\b(?:cat|sed|grep|rg|ls|find|cp|mv|rm|touch|mkdir|git|npm|pnpm|yarn)\b/.test(command);
}

function extractPathCandidates(input: { path?: unknown; cwd?: unknown; command?: unknown }): string[] {
  const candidates: string[] = [];
  if (typeof input.path === "string" && input.path.trim()) candidates.push(input.path.trim());
  if (typeof input.cwd === "string" && input.cwd.trim()) candidates.push(input.cwd.trim());
  if (typeof input.command === "string") {
    const command = input.command;
    if (!looksPathLike(command)) return candidates;
    const matches = command.match(/(?:^|\s)([./~][^\s'"`]+)/g) ?? [];
    for (const match of matches) {
      candidates.push(match.trim());
    }
  }
  return candidates;
}

function normalizeTargetPath(cwd: string, rawPath: string): string {
  return isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveAncestorContextFiles(targetPath: string): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set<string>();

  let currentDir = dirname(targetPath);
  while (true) {
    for (const name of CONTEXT_FILES) {
      const filePath = join(currentDir, name);
      if (seen.has(filePath)) continue;
      if (await fileExists(filePath)) {
        seen.add(filePath);
        found.push(filePath);
      }
    }

    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  return found.reverse();
}

async function readCached(path: string): Promise<string> {
  const info = await stat(path);
  const cached = contentCache.get(path);
  if (cached && cached.mtimeMs === info.mtimeMs) return cached.content;

  const content = await readFile(path, "utf-8");
  contentCache.set(path, { mtimeMs: info.mtimeMs, content });
  return content;
}

async function injectForPath(pi: ExtensionAPI, ctx: any, rawPath: string, reason: string) {
  const targetPath = normalizeTargetPath(ctx.cwd, rawPath);
  const files = await resolveAncestorContextFiles(targetPath);
  if (files.length === 0) return;

  const injectionKey = `${ctx.sessionManager.getSessionId()}:${targetPath}`;
  if (injectedKeys.has(injectionKey)) return;
  injectedKeys.add(injectionKey);

  const blocks: string[] = [];
  const injectedFiles: string[] = [];
  for (const file of files) {
    const fileKey = `${ctx.sessionManager.getSessionId()}:${file}`;
    if (injectedContextFiles.has(fileKey)) continue;
    injectedContextFiles.add(fileKey);
    injectedFiles.push(file);

    const content = await readCached(file);
    blocks.push(`--- ${file} ---\n${content}`);
  }

  if (blocks.length === 0) return;

  ctx.sessionManager.appendCustomMessageEntry(
    CUSTOM_TYPE,
    `📚 Applicable context files for ${targetPath} (${reason}):\n\n${blocks.join("\n\n")}`,
    false,
    { targetPath, files: injectedFiles, reason },
  );

  if (ctx.hasUI) {
    ctx.ui.notify(
      `📚 Nested context loaded for ${targetPath}:\n${injectedFiles.map((file) => `- ${file}`).join("\n")}`,
      "info",
    );
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const input = event.input as { path?: unknown; cwd?: unknown; command?: unknown };

    if (event.toolName === "read" || event.toolName === "write" || event.toolName === "edit") {
      const path = typeof input.path === "string" ? input.path : undefined;
      if (!path) return;
      await injectForPath(pi, ctx, path, event.toolName);
      return;
    }

    if (event.toolName === "bash") {
      const candidates = extractPathCandidates(input);
      for (const candidate of candidates) {
        try {
          await injectForPath(pi, ctx, candidate, "bash");
          break;
        } catch {
          // ignore individual candidate failures
        }
      }
    }
  });

  pi.registerCommand("nested-context-files", {
    description: "Show which AGENTS.md / CLAUDE.md files apply to a path",
    handler: async (args, ctx) => {
      const raw = String(args || "").trim();
      if (!raw) {
        ctx.ui.notify("Usage: /nested-context-files <path>", "warning");
        return;
      }
      const targetPath = normalizeTargetPath(ctx.cwd, raw);
      const files = await resolveAncestorContextFiles(targetPath);
      ctx.ui.notify(files.length ? files.join("\n") : "No applicable context files found", "info");
    },
  });
}
