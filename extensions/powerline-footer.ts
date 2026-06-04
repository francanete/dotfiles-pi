import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

const arrow = "\ue0b4";
const leftCap = "\ue0b6";
const branchIcon = "\uf1d3";
const ctxIcon = "\uf012";
const windowIcon = "\uf017";

const palette = {
	dirBg: "58;110;161",
	dirFg: "229;224;222",
	gitCleanBg: "115;191;159",
	gitCleanFg: "46;52;64",
	gitDirtyBg: "211;186;85",
	gitDirtyFg: "46;52;64",
	modelBg: "200;134;116",
	modelFg: "46;52;64",
	ctxBg: "163;191;220",
	ctxFg: "30;32;48",
	ctxWarnBg: "208;135;112",
	ctxWarnFg: "46;52;64",
	ctxCritBg: "191;97;106",
	ctxCritFg: "236;239;244",
	weeklyBg: "136;121;178",
	weeklyFg: "236;239;244",
};

function rgbFg(rgb: string): string {
	return `\x1b[38;2;${rgb}m`;
}

function rgbBg(rgb: string): string {
	return `\x1b[48;2;${rgb}m`;
}

function reset(): string {
	return "\x1b[0m";
}

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function visibleWidth(s: string): number {
	return [...stripAnsi(s)].length;
}

function truncateToWidth(s: string, width: number): string {
	if (visibleWidth(s) <= width) return s;
	// This footer is usually shorter than the terminal. If it ever overflows,
	// prefer clipping simply over risking malformed ANSI sequences.
	let out = "";
	let visible = 0;
	for (let i = 0; i < s.length && visible < width; ) {
		if (s[i] === "\x1b") {
			const match = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(s.slice(i));
			if (match) {
				out += match[0];
				i += match[0].length;
				continue;
			}
		}
		const cp = s.codePointAt(i)!;
		out += String.fromCodePoint(cp);
		visible++;
		i += cp > 0xffff ? 2 : 1;
	}
	return out + reset();
}

function segment(prevBg: string | undefined, bg: string, fg: string, text: string): { out: string; bg: string } {
	const joiner = prevBg ? `${rgbFg(prevBg)}${rgbBg(bg)}${arrow}` : `${rgbFg(bg)}${leftCap}`;
	return {
		out: `${joiner}${rgbBg(bg)}${rgbFg(fg)} ${text} ${reset()}`,
		bg,
	};
}

type GitInfo = { text: string; dirty: boolean };

function runGit(cwd: string, args: string[]): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(
			"git",
			["-C", cwd, "-c", "gc.autodetach=false", ...args],
			{ encoding: "utf8", timeout: 750 },
			(error, stdout) => resolve(error ? undefined : String(stdout).trim()),
		);
	});
}

async function gitOperation(cwd: string): Promise<string> {
	const gitDirRaw = await runGit(cwd, ["rev-parse", "--absolute-git-dir"]);
	if (!gitDirRaw) return "";
	const gitDir = isAbsolute(gitDirRaw) ? gitDirRaw : join(cwd, gitDirRaw);

	try {
		if (existsSync(join(gitDir, "rebase-merge")) || existsSync(join(gitDir, "rebase-apply"))) return " REBASE";
		if (existsSync(join(gitDir, "MERGE_HEAD"))) return " MERGE";
		if (existsSync(join(gitDir, "CHERRY_PICK_HEAD"))) return " CHERRY-PICK";
		if (existsSync(join(gitDir, "BISECT_LOG"))) return " BISECT";
		if (existsSync(join(gitDir, "REVERT_HEAD"))) return " REVERT";
	} catch {
		// Ignore fs errors.
	}
	return "";
}

async function gitText(cwd: string, branchFromFooter: string | null): Promise<GitInfo | undefined> {
	const inside = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
	if (inside !== "true") return undefined;

	const [branchRaw, porcelain, upstream, operation] = await Promise.all([
		branchFromFooter ? Promise.resolve(branchFromFooter) : runGit(cwd, ["branch", "--show-current"]),
		runGit(cwd, ["status", "--porcelain", "--untracked-files=no"]),
		runGit(cwd, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
		gitOperation(cwd),
	]);

	const branch = branchRaw || "detached";
	const dirty = !!porcelain;
	let ahead = "";
	let behind = "";
	if (upstream) {
		const [behindCount, aheadCount] = upstream.split(/\s+/).map((n) => Number.parseInt(n, 10));
		if (aheadCount > 0) ahead = ` ↑${aheadCount}`;
		if (behindCount > 0) behind = ` ↓${behindCount}`;
	}

	return { text: `${branchIcon} ${branch}${ahead}${behind}${dirty ? " !" : ""}${operation}`, dirty: dirty || !!operation };
}

function modelLabel(model: unknown): string {
	const m = model as { name?: string; id?: string; provider?: string } | undefined;
	return m?.name || m?.id || "no model";
}

type LimitInfo = { remainingPct: number; text: string };

function headerNumber(headers: Record<string, string>, names: string[]): number | undefined {
	for (const name of names) {
		const value = headers[name.toLowerCase()];
		if (!value) continue;
		const num = Number.parseFloat(value.replace(/,/g, ""));
		if (Number.isFinite(num)) return num;
	}
	return undefined;
}

function headerValue(headers: Record<string, string>, names: string[]): string | undefined {
	for (const name of names) {
		const value = headers[name.toLowerCase()];
		if (value) return value;
	}
	return undefined;
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function formatReset(value: string | undefined): string {
	if (!value) return "";
	const trimmed = value.trim();
	if (!trimmed) return "";
	const epoch = Number.parseInt(trimmed, 10);
	if (Number.isFinite(epoch) && epoch > 1_000_000_000) {
		const seconds = Math.max(0, epoch - Math.floor(Date.now() / 1000));
		const days = Math.floor(seconds / 86400);
		const hours = Math.floor((seconds % 86400) / 3600);
		if (days > 0) return ` ${days}d${hours}h`;
		if (hours > 0) return ` ${hours}h`;
		return ` ${Math.floor(seconds / 60)}m`;
	}
	return ` ${trimmed}`;
}

function limitFromHeaders(rawHeaders: Record<string, string>): { fiveHour?: LimitInfo; weekly?: LimitInfo } | undefined {
	const headers = normalizeHeaders(rawHeaders);
	const codexHeaderEntries = Object.entries(headers)
		.filter(([key]) => key.includes("codex") || key.includes("ratelimit"))
		.sort(([a], [b]) => a.localeCompare(b));
	if (codexHeaderEntries.length === 0) return undefined;

	const out: { fiveHour?: LimitInfo; weekly?: LimitInfo } = {};

	const primaryUsed = headerNumber(headers, ["x-codex-primary-used-percent"]);
	if (primaryUsed !== undefined) {
		const primaryReset = headerValue(headers, ["x-codex-primary-reset-at"]);
		const remainingPct = Math.max(0, Math.min(100, 100 - primaryUsed));
		out.fiveHour = { remainingPct, text: `${windowIcon} ${Math.round(remainingPct)}%${formatReset(primaryReset)}` };
	}

	const secondaryUsed = headerNumber(headers, ["x-codex-secondary-used-percent"]);
	if (secondaryUsed !== undefined) {
		const secondaryReset = headerValue(headers, ["x-codex-secondary-reset-at"]);
		const remainingPct = Math.max(0, Math.min(100, 100 - secondaryUsed));
		out.weekly = { remainingPct, text: `${windowIcon} ${Math.round(remainingPct)}%${formatReset(secondaryReset)}` };
	}

	if (!out.fiveHour && !out.weekly) {
		const limit = headerNumber(headers, ["x-ratelimit-limit-requests", "x-ratelimit-limit-tokens"]);
		const remaining = headerNumber(headers, ["x-ratelimit-remaining-requests", "x-ratelimit-remaining-tokens"]);
		const reset = headerValue(headers, ["x-ratelimit-reset-requests", "x-ratelimit-reset-tokens"]);
		if (limit && remaining !== undefined) {
			const remainingPct = Math.max(0, Math.min(100, (remaining / limit) * 100));
			out.fiveHour = { remainingPct, text: `${windowIcon} ${Math.round(remainingPct)}%${formatReset(reset)}` };
		}
	}

	return out;
}

export default function (pi: ExtensionAPI) {
	let requestGitRefresh: (() => void) | undefined;
	let requestFooterRender: (() => void) | undefined;
	let fiveHourLimit: LimitInfo | undefined;
	let weeklyLimit: LimitInfo | undefined;

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setFooter((tui, _theme, footerData) => {
			requestFooterRender = () => tui.requestRender();
			let gitCache: GitInfo | undefined;
			let refreshInFlight = false;
			let disposed = false;

			const refreshGit = async () => {
				if (refreshInFlight || disposed) return;
				refreshInFlight = true;
				try {
					gitCache = await gitText(ctx.cwd, footerData.getGitBranch());
				} finally {
					refreshInFlight = false;
					if (!disposed) tui.requestRender();
				}
			};

			const triggerRefresh = () => void refreshGit();
			requestGitRefresh = triggerRefresh;
			void refreshGit();
			const unsubscribe = footerData.onBranchChange(triggerRefresh);

			return {
				dispose() {
					disposed = true;
					if (requestGitRefresh === triggerRefresh) requestGitRefresh = undefined;
					requestFooterRender = undefined;
					unsubscribe();
				},
				invalidate() {},
				render(width: number): string[] {
					const parts: string[] = [];
					let prev: string | undefined;
					const add = (bg: string, fg: string, text: string) => {
						const s = segment(prev, bg, fg, text);
						parts.push(s.out);
						prev = s.bg;
					};

					add(palette.dirBg, palette.dirFg, basename(ctx.cwd) || ctx.cwd);

					if (gitCache) {
						add(
							gitCache.dirty ? palette.gitDirtyBg : palette.gitCleanBg,
							gitCache.dirty ? palette.gitDirtyFg : palette.gitCleanFg,
							gitCache.text,
						);
					}

					add(palette.modelBg, palette.modelFg, ` ${modelLabel(ctx.model)}`);

					const usage = ctx.getContextUsage();
					if (usage?.percent !== null && usage?.percent !== undefined) {
						const remaining = Math.max(0, Math.round(100 - usage.percent));
						if (remaining <= 25) add(palette.ctxCritBg, palette.ctxCritFg, `${ctxIcon} ${remaining}%`);
						else if (remaining <= 55) add(palette.ctxWarnBg, palette.ctxWarnFg, `${ctxIcon} ${remaining}%`);
						else add(palette.ctxBg, palette.ctxFg, `${ctxIcon} ${remaining}%`);
					}

					if (fiveHourLimit) {
						if (fiveHourLimit.remainingPct <= 10) add(palette.ctxCritBg, palette.ctxCritFg, fiveHourLimit.text);
						else if (fiveHourLimit.remainingPct <= 25) add(palette.ctxWarnBg, palette.ctxWarnFg, fiveHourLimit.text);
						else add(palette.weeklyBg, palette.weeklyFg, fiveHourLimit.text);
					}
					if (weeklyLimit) {
						if (weeklyLimit.remainingPct <= 10) add(palette.ctxCritBg, palette.ctxCritFg, weeklyLimit.text);
						else if (weeklyLimit.remainingPct <= 25) add(palette.ctxWarnBg, palette.ctxWarnFg, weeklyLimit.text);
						else add(palette.weeklyBg, palette.weeklyFg, weeklyLimit.text);
					}

					let line = parts.join("");
					if (prev) line += `${rgbFg(prev)}${arrow}${reset()}`;
					const w = visibleWidth(line);
					if (w < width) line += " ".repeat(width - w);
					return [truncateToWidth(line, width)];
				},
			};
		});
	});

	pi.on("after_provider_response", (event) => {
		const next = limitFromHeaders(event.headers);
		if (next) {
			if (next.fiveHour) fiveHourLimit = next.fiveHour;
			if (next.weekly) weeklyLimit = next.weekly;
			requestFooterRender?.();
		}
	});

	pi.on("turn_end", () => {
		requestGitRefresh?.();
	});

	pi.on("tool_execution_end", () => {
		requestGitRefresh?.();
	});

	pi.on("user_bash", () => {
		requestGitRefresh?.();
	});

	pi.on("session_shutdown", () => {
		requestGitRefresh = undefined;
		requestFooterRender = undefined;
		fiveHourLimit = undefined;
		weeklyLimit = undefined;
	});
}
