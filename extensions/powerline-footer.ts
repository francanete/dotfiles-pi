import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ARROW = "";
const LEFT_CAP = "";
const BRANCH_ICON = "";
const CTX_ICON = "";
const WINDOW_ICON = "󰥔";
const WEEK_ICON = "";

const PALETTE = {
  dir: { bg: "58;110;161", fg: "229;224;222" },
  gitClean: { bg: "115;191;159", fg: "46;52;64" },
  gitDirty: { bg: "211;186;85", fg: "46;52;64" },
  model: { bg: "200;134;116", fg: "46;52;64" },
  ctx: { bg: "163;191;220", fg: "30;32;48" },
  ctxWarn: { bg: "208;135;112", fg: "46;52;64" },
  ctxCrit: { bg: "191;97;106", fg: "236;239;244" },
  limit: { bg: "108;91;123", fg: "236;239;244" },
};

type Rgb = { bg: string; fg: string };

function fg(rgb: string, text: string) {
  return `\x1b[38;2;${rgb}m${text}\x1b[0m`;
}

function segment(prevBg: string | undefined, colors: Rgb, text: string) {
  const join = prevBg
    ? `\x1b[38;2;${prevBg}m\x1b[48;2;${colors.bg}m${ARROW}`
    : `\x1b[38;2;${colors.bg}m${LEFT_CAP}`;

  return `${join}\x1b[48;2;${colors.bg}m\x1b[38;2;${colors.fg}m ${text} \x1b[0m`;
}

function renderSegments(parts: Array<{ colors: Rgb; text: string }>) {
  let out = "";
  let prevBg: string | undefined;

  for (const part of parts) {
    out += segment(prevBg, part.colors, part.text);
    prevBg = part.colors.bg;
  }

  if (prevBg) out += fg(prevBg, ARROW);
  return out;
}

function git(args: string[], cwd: string) {
  try {
    return execFileSync("git", ["-C", cwd, "-c", "gc.autodetach=false", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 250,
    }).trim();
  } catch {
    return "";
  }
}

function getGitSegment(cwd: string) {
  if (!git(["rev-parse", "--git-dir"], cwd)) return undefined;

  const branch = git(["branch", "--show-current"], cwd) || git(["rev-parse", "--short", "HEAD"], cwd);
  if (!branch) return undefined;

  const dirty =
    git(["status", "--porcelain"], cwd)
      .split("\n")
      .filter(Boolean).length > 0;

  let ahead = "";
  let behind = "";
  const upstream = git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], cwd);
  if (upstream) {
    const [behindCount, aheadCount] = upstream.split(/\s+/).map((v) => Number(v));
    if (aheadCount > 0) ahead = ` ↑${aheadCount}`;
    if (behindCount > 0) behind = ` ↓${behindCount}`;
  }

  const gitDir = git(["rev-parse", "--git-dir"], cwd);
  const op = gitDir
    ? git(["status", "--branch", "--porcelain=v1"], cwd).includes("rebase")
      ? " REBASE"
      : ""
    : "";

  return {
    colors: dirty || op ? PALETTE.gitDirty : PALETTE.gitClean,
    text: `${BRANCH_ICON} ${branch}${ahead}${behind}${dirty ? " !" : ""}${op}`,
  };
}

function fmtDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

function fmtResetFromEpochSeconds(epochSeconds: number) {
  return fmtDuration(Math.max(0, epochSeconds * 1000 - Date.now()));
}

type CodexLimitWindow = {
  usedPercent: number;
  resetAt: number;
};

type CodexLimits = {
  planType: string;
  session?: CodexLimitWindow;
  weekly?: CodexLimitWindow;
  fetchedAt: number;
};

function readCodexAuth() {
  const candidates = [
    path.join(os.homedir(), ".codex", "auth.json"),
    path.join(os.homedir(), ".pi", "agent", "auth.json"),
  ];

  for (const file of candidates) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      const tokens = raw.tokens ?? raw["openai-codex"];
      const accessToken = tokens?.access_token ?? tokens?.access;
      const accountId = tokens?.account_id ?? tokens?.accountId;
      if (accessToken) return { accessToken, accountId };
    } catch {
      // Try the next auth location.
    }
  }

  return undefined;
}

async function fetchCodexLimits(): Promise<CodexLimits | undefined> {
  const auth = readCodexAuth();
  if (!auth) return undefined;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    "Content-Type": "application/json",
  };
  if (auth.accountId) headers["chatgpt-account-id"] = auth.accountId;

  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers });
  if (!response.ok) return undefined;

  const data = await response.json() as any;
  const primary = data?.rate_limit?.primary_window;
  const secondary = data?.rate_limit?.secondary_window;

  return {
    planType: data?.plan_type ?? "unknown",
    session: primary ? { usedPercent: primary.used_percent ?? 0, resetAt: primary.reset_at ?? 0 } : undefined,
    weekly: secondary ? { usedPercent: secondary.used_percent ?? 0, resetAt: secondary.reset_at ?? 0 } : undefined,
    fetchedAt: Date.now(),
  };
}

function limitColors(remaining: number) {
  if (remaining <= 10) return PALETTE.ctxCrit;
  if (remaining <= 25) return PALETTE.ctxWarn;
  return PALETTE.limit;
}

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let codexLimits: CodexLimits | undefined;
  let codexLimitsRefreshInFlight: Promise<void> | undefined;

  async function refreshCodexLimits() {
    if (codexLimitsRefreshInFlight) return codexLimitsRefreshInFlight;
    codexLimitsRefreshInFlight = fetchCodexLimits()
      .then((limits) => {
        if (limits) codexLimits = limits;
      })
      .catch(() => {})
      .finally(() => {
        codexLimitsRefreshInFlight = undefined;
      });
    return codexLimitsRefreshInFlight;
  }

  function installFooter(ctx: any) {
    ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          const cwd = process.cwd();
          const dirName = path.basename(cwd);

          let lastTotal = 0;

          for (const entry of ctx.sessionManager.getBranch()) {
            if (entry.type === "message" && entry.message.role === "assistant") {
              const message = entry.message;
              if (!message.usage) continue;

              lastTotal = message.usage.totalTokens ||
                (message.usage.input ?? 0) +
                  (message.usage.output ?? 0) +
                  (message.usage.cacheRead ?? 0) +
                  (message.usage.cacheWrite ?? 0);
            }
          }

          const model = ctx.model?.name || ctx.model?.id || "model";
          const effort = pi.getThinkingLevel();
          const modelText = effort && effort !== "off" ? `${model} ${effort}` : model;
          const contextWindow = ctx.model?.contextWindow || ctx.model?.input || 0;
          const remaining = contextWindow > 0 ? Math.max(0, 100 - Math.round((lastTotal / contextWindow) * 100)) : undefined;
          const ctxColors = remaining === undefined
            ? PALETTE.ctx
            : remaining <= 25
              ? PALETTE.ctxCrit
              : remaining <= 55
                ? PALETTE.ctxWarn
                : PALETTE.ctx;

          const parts: Array<{ colors: Rgb; text: string }> = [
            { colors: PALETTE.dir, text: dirName },
          ];

          const gitSegment = getGitSegment(cwd);
          if (gitSegment) parts.push(gitSegment);

          parts.push({ colors: PALETTE.model, text: modelText });

          if (remaining !== undefined) {
            parts.push({ colors: ctxColors, text: `${CTX_ICON} ${remaining}%` });
          }

          if (ctx.model?.provider === "openai-codex" && codexLimits?.session) {
            const remaining = Math.max(0, Math.round(100 - codexLimits.session.usedPercent));
            parts.push({
              colors: limitColors(remaining),
              text: `${WINDOW_ICON} ${remaining}% ${fmtResetFromEpochSeconds(codexLimits.session.resetAt)}`,
            });
          }

          if (ctx.model?.provider === "openai-codex" && codexLimits?.weekly) {
            const remaining = Math.max(0, Math.round(100 - codexLimits.weekly.usedPercent));
            parts.push({
              colors: limitColors(remaining),
              text: `${WEEK_ICON} ${remaining}% ${fmtResetFromEpochSeconds(codexLimits.weekly.resetAt)}`,
            });
          }

          const line = renderSegments(parts);
          if (visibleWidth(line) <= width) return [line];
          return [truncateToWidth(line, width)];
        },
      };
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    await refreshCodexLimits();
    if (enabled) installFooter(ctx);
  });

  pi.on("turn_end", async () => {
    await refreshCodexLimits();
  });

  pi.registerCommand("powerline-footer", {
    description: "Toggle the capsule-style powerline footer",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      if (enabled) {
        installFooter(ctx);
        ctx.ui.notify("Powerline footer enabled", "info");
      } else {
        ctx.ui.setFooter(undefined);
        ctx.ui.notify("Powerline footer disabled", "info");
      }
    },
  });

  pi.registerCommand("codex-limits", {
    description: "Refresh Codex account limits shown in the footer",
    handler: async (_args, ctx) => {
      await refreshCodexLimits();
      if (!codexLimits) {
        ctx.ui.notify("Could not fetch Codex limits", "warning");
        return;
      }

      const session = codexLimits.session
        ? `${Math.max(0, Math.round(100 - codexLimits.session.usedPercent))}% remaining, resets in ${fmtResetFromEpochSeconds(codexLimits.session.resetAt)}`
        : "unavailable";
      const weekly = codexLimits.weekly
        ? `${Math.max(0, Math.round(100 - codexLimits.weekly.usedPercent))}% remaining, resets in ${fmtResetFromEpochSeconds(codexLimits.weekly.resetAt)}`
        : "unavailable";
      ctx.ui.notify(`Codex limits (${codexLimits.planType}): session ${session}; weekly ${weekly}`, "info");
    },
  });
}
