import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Tier = "cheap" | "normal" | "hard";

type Route = {
	tier: Tier;
	model: string;
	thinking: "low" | "medium" | "high";
	reason: string;
};

const PROVIDER = "openai-codex";

const ROUTES: Record<Tier, Omit<Route, "tier" | "reason">> = {
	// Default for day-to-day work. Large context, much cheaper than 5.5-codex.
	cheap: { model: "gpt-5.4-mini", thinking: "low" },
	// Strong coding/default route without jumping to 5.5-codex.
	normal: { model: "gpt-5.4", thinking: "medium" },
	// Only for high-risk/complex/failed tasks.
	hard: { model: "gpt-5.5", thinking: "high" },
};

let enabled = true;
let nextOverride: Tier | undefined;
let lastAutoModel: string | undefined;
let toolErrorsThisTurn = 0;
let escalationReason: string | undefined;

function includesAny(text: string, needles: string[]): boolean {
	return needles.some((needle) => text.includes(needle));
}

function countMatches(text: string, regex: RegExp): number {
	return [...text.matchAll(regex)].length;
}

function classifyPrompt(prompt: string): Route {
	const p = prompt.toLowerCase();
	const route = (tier: Tier, reason: string): Route => ({ tier, ...ROUTES[tier], reason });

	// Explicit user control in natural language.
	if (/(use|switch to).*(gpt-5\.5|5\.5|hard|best|beast)|#hard|#strong|#beast/.test(p)) {
		return route("hard", "explicit hard request");
	}
	if (/(use|switch to).*(mini|cheap|fast|small)|#cheap|#mini|#fast/.test(p)) {
		return route("cheap", "explicit cheap request");
	}
	if (/(use|switch to).*(normal|balanced|standard)|#normal|#balanced/.test(p)) {
		return route("normal", "explicit normal request");
	}

	let score = 0;
	const reasons: string[] = [];

	const hardSignals = [
		"architecture",
		"architectural",
		"design a system",
		"root cause",
		"race condition",
		"concurrency",
		"deadlock",
		"security",
		"auth flow",
		"oauth",
		"migration",
		"database migration",
		"distributed",
		"multi-service",
		"production issue",
		"incident",
		"performance investigation",
		"memory leak",
		"refactor",
		"large refactor",
		"deep dive",
		"think deeply",
		"complex",
		"hard problem",
		"plan and implement",
	];
	if (includesAny(p, hardSignals)) {
		score += 5;
		reasons.push("hard keyword");
	}

	const normalSignals = [
		"implement",
		"fix",
		"debug",
		"test",
		"failing",
		"error",
		"add",
		"change",
		"update",
		"endpoint",
		"component",
		"integration",
		"typescript",
		"sequelize",
		"react",
		"api",
	];
	if (includesAny(p, normalSignals)) {
		score += 2;
		reasons.push("coding keyword");
	}

	const cheapSignals = [
		"explain",
		"summarize",
		"where is",
		"find",
		"search",
		"grep",
		"read",
		"list",
		"show me",
		"what is",
		"quick",
		"small update",
		"typo",
		"format",
	];
	if (includesAny(p, cheapSignals)) {
		score -= 1;
		reasons.push("simple/read-only signal");
	}

	const fileRefs = countMatches(prompt, /(?:^|\s)@?[^\s]+\.(ts|tsx|js|jsx|json|md|sql|sh|yml|yaml|css|scss)\b/g);
	if (fileRefs >= 4) {
		score += 3;
		reasons.push("many file refs");
	} else if (fileRefs >= 2) {
		score += 1;
		reasons.push("multiple file refs");
	}

	if (prompt.length > 1800) {
		score += 4;
		reasons.push("long prompt");
	} else if (prompt.length > 800) {
		score += 2;
		reasons.push("medium prompt");
	}

	// Commands/questions with no edit intent should stay cheap.
	const editIntent = /(implement|fix|change|update|write|edit|create|add|remove|refactor|migrate|debug)/i.test(prompt);
	if (!editIntent && prompt.length < 500) {
		score -= 2;
		reasons.push("short read-only/question");
	}

	if (score >= 6) return route("hard", reasons.join(", ") || "high complexity");
	if (score >= 2) return route("normal", reasons.join(", ") || "normal coding task");
	return route("cheap", reasons.join(", ") || "low complexity");
}

async function applyRoute(pi: ExtensionAPI, ctx: ExtensionContext, route: Route, notify = true): Promise<void> {
	const current = ctx.model?.id;
	const model = ctx.modelRegistry.find(PROVIDER, route.model);
	if (!model) {
		ctx.ui.notify(`Auto-model: ${PROVIDER}/${route.model} not found`, "warning");
		return;
	}

	if (current !== route.model) {
		const ok = await pi.setModel(model);
		if (!ok) {
			ctx.ui.notify(`Auto-model: no auth for ${PROVIDER}/${route.model}`, "warning");
			return;
		}
		lastAutoModel = route.model;
		if (notify) ctx.ui.notify(`Auto-model: ${route.tier} → ${route.model} (${route.reason})`, "info");
	}

	pi.setThinkingLevel(route.thinking);
	ctx.ui.setStatus("auto-model", ctx.ui.theme.fg("accent", `auto:${route.tier}`));
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("automodel", {
		description: "Auto-route prompts to cheap/normal/hard OpenAI Codex models",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (!arg || arg === "status") {
				ctx.ui.notify(
					`Auto-model: ${enabled ? "on" : "off"}. Routes: cheap=${ROUTES.cheap.model}, normal=${ROUTES.normal.model}, hard=${ROUTES.hard.model}`,
					"info",
				);
				return;
			}
			if (arg === "on") {
				enabled = true;
				ctx.ui.setStatus("auto-model", ctx.ui.theme.fg("accent", "auto:on"));
				// Make the middle tier the default immediately.
				await applyRoute(pi, ctx, { tier: "normal", ...ROUTES.normal, reason: "enabled: default middle tier" }, false);
				ctx.ui.notify("Auto-model enabled", "info");
				return;
			}
			if (arg === "off" || arg === "disable" || arg === "disabled") {
				enabled = false;
				ctx.ui.setStatus("auto-model", undefined);
				ctx.ui.notify("Auto-model disabled", "info");
				return;
			}
			if (arg === "cheap" || arg === "normal" || arg === "hard") {
				nextOverride = arg;
				ctx.ui.notify(`Auto-model: next prompt forced to ${arg}`, "info");
				return;
			}
			ctx.ui.notify("Usage: /automodel on|off|disable|status|cheap|normal|hard", "warning");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!enabled) return;
		ctx.ui.setStatus("auto-model", ctx.ui.theme.fg("accent", "auto:on"));
		// Make the middle tier the default model for the session (saves usage vs 5.5-codex).
		await applyRoute(pi, ctx, { tier: "normal", ...ROUTES.normal, reason: "session default middle tier" }, false);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		toolErrorsThisTurn = 0;
		escalationReason = undefined;
		if (!enabled) return;

		const route = nextOverride
			? ({ tier: nextOverride, ...ROUTES[nextOverride], reason: "manual next-turn override" } as Route)
			: classifyPrompt(event.prompt);
		nextOverride = undefined;
		await applyRoute(pi, ctx, route);
	});

	pi.on("tool_execution_end", (event) => {
		if (!enabled) return;
		if (event.isError) toolErrorsThisTurn++;
		if (toolErrorsThisTurn >= 2) {
			escalationReason = "multiple tool errors";
		}
	});

	// Before subsequent LLM calls in the same turn, escalate if the current model is struggling.
	pi.on("context", async (_event, ctx) => {
		if (!enabled || !escalationReason) return;
		if (ctx.model?.id === ROUTES.hard.model) return;
		await applyRoute(pi, ctx, { tier: "hard", ...ROUTES.hard, reason: escalationReason });
		escalationReason = undefined;
	});

	pi.on("model_select", (event, ctx) => {
		if (!enabled) return;
		// Keep the footer informative; manual model changes are still allowed, but the
		// next prompt may be re-routed unless /automodel off is used.
		const tier = Object.entries(ROUTES).find(([, r]) => r.model === event.model.id)?.[0] ?? "manual";
		ctx.ui.setStatus("auto-model", ctx.ui.theme.fg("accent", `auto:${tier}`));
		lastAutoModel = event.model.id;
	});
}
