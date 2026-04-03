import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { addToTotals, emptyTotals } from "./aggregate";
import { todayStart } from "./dates";
import { fmtCost, fmtTokens } from "./format";
import { UsageRecord } from "./types";

export const FOOTER_ITEM_IDS = [
	"projectTodayCost",
	"totalTodayCost",
	"projectTodayTokens",
	"totalTodayTokens",
	"projectTodaySummary",
	"totalTodaySummary",
] as const;

export type FooterItemId = (typeof FOOTER_ITEM_IDS)[number];
export type FooterPresetId = "minimal" | "costs" | "tokens" | "summary" | "full";

export type FooterStyle = "plain" | "muted" | "cost";

export interface FooterConfig {
	enabled: boolean;
	items: FooterItemId[];
	separator: string;
	style: FooterStyle;
	template?: string;
}

interface FooterMetricSet {
	cost: string;
	costRaw: string;
	tokens: string;
	tokensRaw: string;
	input: string;
	inputRaw: string;
	output: string;
	outputRaw: string;
	cacheRead: string;
	cacheReadRaw: string;
	cacheWrite: string;
	cacheWriteRaw: string;
	summary: string;
}

export const FOOTER_PRESETS: Record<FooterPresetId, FooterItemId[]> = {
	minimal: ["projectTodayCost", "totalTodayCost"],
	costs: ["projectTodayCost", "totalTodayCost"],
	tokens: ["projectTodayTokens", "totalTodayTokens"],
	summary: ["projectTodaySummary", "totalTodaySummary"],
	full: ["projectTodayTokens", "projectTodayCost", "totalTodayTokens", "totalTodayCost"],
};

export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
	enabled: true,
	items: FOOTER_PRESETS.minimal,
	separator: "  •  ",
	style: "muted",
};

const FOOTER_CONFIG_FILENAME = ".pi-token-usage.json";

const DEFAULT_ITEM_LABELS: Record<FooterItemId, string> = {
	projectTodayCost: "Proj today",
	totalTodayCost: "Total today",
	projectTodayTokens: "Proj today",
	totalTodayTokens: "Total today",
	projectTodaySummary: "Proj today",
	totalTodaySummary: "Total today",
};

const FOOTER_TEMPLATE_VARS = [
	"{projectToday.cost}",
	"{projectToday.costRaw}",
	"{projectToday.tokens}",
	"{projectToday.tokensRaw}",
	"{projectToday.input}",
	"{projectToday.inputRaw}",
	"{projectToday.output}",
	"{projectToday.outputRaw}",
	"{projectToday.cacheRead}",
	"{projectToday.cacheReadRaw}",
	"{projectToday.cacheWrite}",
	"{projectToday.cacheWriteRaw}",
	"{projectToday.summary}",
	"{totalToday.cost}",
	"{totalToday.costRaw}",
	"{totalToday.tokens}",
	"{totalToday.tokensRaw}",
	"{totalToday.input}",
	"{totalToday.inputRaw}",
	"{totalToday.output}",
	"{totalToday.outputRaw}",
	"{totalToday.cacheRead}",
	"{totalToday.cacheReadRaw}",
	"{totalToday.cacheWrite}",
	"{totalToday.cacheWriteRaw}",
	"{totalToday.summary}",
] as const;

export function getGlobalFooterConfigPath(): string {
	return join(homedir(), ".pi", "agent", FOOTER_CONFIG_FILENAME);
}

export function getProjectFooterConfigPath(cwd: string): string {
	return join(cwd, FOOTER_CONFIG_FILENAME);
}

export function loadFooterConfig(cwd: string): FooterConfig {
	return mergeFooterConfigs(
		DEFAULT_FOOTER_CONFIG,
		readFooterConfigFile(getGlobalFooterConfigPath()),
		readFooterConfigFile(getProjectFooterConfigPath(cwd)),
	);
}

export function saveProjectFooterConfig(cwd: string, patch: Partial<FooterConfig>): FooterConfig {
	const path = getProjectFooterConfigPath(cwd);
	const current = readFooterConfigFile(path);
	const next = mergeFooterConfigs(DEFAULT_FOOTER_CONFIG, current, patch);
	writeFooterConfigFile(path, next);
	return next;
}

export function writeProjectFooterConfig(cwd: string, config: FooterConfig): FooterConfig {
	const path = getProjectFooterConfigPath(cwd);
	writeFooterConfigFile(path, config);
	return config;
}

export function resetProjectFooterConfig(cwd: string): void {
	const path = getProjectFooterConfigPath(cwd);
	if (existsSync(path)) unlinkSync(path);
}

export function parseFooterItems(raw: string): FooterItemId[] {
	const values = raw
		.split(/[\s,]+/)
		.map((value) => value.trim())
		.filter(Boolean);

	if (values.length === 0) {
		throw new Error(`No footer items provided. Available items: ${FOOTER_ITEM_IDS.join(", ")}`);
	}

	const items: FooterItemId[] = [];
	for (const value of values) {
		if (!isFooterItemId(value)) {
			throw new Error(`Unknown footer item: ${value}. Available items: ${FOOTER_ITEM_IDS.join(", ")}`);
		}
		if (!items.includes(value)) items.push(value);
	}

	return items;
}

export function parseFooterPreset(raw: string): FooterPresetId {
	const value = raw.trim().toLowerCase();
	if (isFooterPresetId(value)) return value;
	throw new Error(`Unknown footer preset: ${raw}. Available presets: ${Object.keys(FOOTER_PRESETS).join(", ")}`);
}

export function formatFooterConfig(config: FooterConfig, cwd: string): string {
	return [
		`Footer: ${config.enabled ? "enabled" : "disabled"}`,
		`Style: ${config.style}`,
		`Template: ${config.template ? JSON.stringify(config.template) : "(none)"}`,
		`Items: ${config.items.join(", ") || "(none)"}`,
		`Separator: ${JSON.stringify(config.separator)}`,
		`Presets: ${Object.keys(FOOTER_PRESETS).join(", ")}`,
		`Project config: ${getProjectFooterConfigPath(cwd)}`,
		`Global config: ${getGlobalFooterConfigPath()}`,
		`Available items: ${FOOTER_ITEM_IDS.join(", ")}`,
		`Template vars: ${FOOTER_TEMPLATE_VARS.join(", ")}`,
	].join("\n");
}

export function formatFooterTemplateVars(): string {
	return [
		"Footer template variables:",
		"  Project today:",
		"    {projectToday.cost}       formatted cost, e.g. $2.56",
		"    {projectToday.costRaw}    raw cost number",
		"    {projectToday.tokens}     formatted total tokens, e.g. 3.5M",
		"    {projectToday.tokensRaw}  raw total tokens",
		"    {projectToday.input} / {projectToday.inputRaw}",
		"    {projectToday.output} / {projectToday.outputRaw}",
		"    {projectToday.cacheRead} / {projectToday.cacheReadRaw}",
		"    {projectToday.cacheWrite} / {projectToday.cacheWriteRaw}",
		"    {projectToday.summary}    formatted summary, e.g. $2.56 / 3.5M tok",
		"  Total today:",
		"    {totalToday.cost} / {totalToday.costRaw}",
		"    {totalToday.tokens} / {totalToday.tokensRaw}",
		"    {totalToday.input} / {totalToday.inputRaw}",
		"    {totalToday.output} / {totalToday.outputRaw}",
		"    {totalToday.cacheRead} / {totalToday.cacheReadRaw}",
		"    {totalToday.cacheWrite} / {totalToday.cacheWriteRaw}",
		"    {totalToday.summary}",
	].join("\n");
}

export function buildFooterStatus(records: UsageRecord[], cwd: string, config: FooterConfig): string | undefined {
	if (!config.enabled) return undefined;

	const todayMs = todayStart();
	const todayProject = emptyTotals();
	const todayTotal = emptyTotals();

	for (const record of records) {
		if (record.timestamp < todayMs) continue;
		addToTotals(todayTotal, record);
		if (record.project === cwd) addToTotals(todayProject, record);
	}

	if (config.template && config.template.length > 0) {
		return renderFooterTemplate(config.template, todayProject, todayTotal);
	}

	if (config.items.length === 0) return undefined;
	const parts = config.items.map((item) => formatFooterItem(item, todayProject, todayTotal));
	return parts.join(config.separator);
}

export function parseFooterStyle(raw: string): FooterStyle {
	const value = raw.trim().toLowerCase();
	if (isFooterStyle(value)) return value;
	throw new Error(`Unknown footer style: ${raw}. Available styles: plain, muted, cost`);
}

function formatFooterItem(item: FooterItemId, todayProject: ReturnType<typeof emptyTotals>, todayTotal: ReturnType<typeof emptyTotals>): string {
	switch (item) {
		case "projectTodayCost":
			return `${DEFAULT_ITEM_LABELS[item]} ${fmtCost(todayProject.costTotal)}`;
		case "totalTodayCost":
			return `${DEFAULT_ITEM_LABELS[item]} ${fmtCost(todayTotal.costTotal)}`;
		case "projectTodayTokens":
			return `${DEFAULT_ITEM_LABELS[item]} ${fmtTokens(todayProject.totalTokens)} tok`;
		case "totalTodayTokens":
			return `${DEFAULT_ITEM_LABELS[item]} ${fmtTokens(todayTotal.totalTokens)} tok`;
		case "projectTodaySummary":
			return `${DEFAULT_ITEM_LABELS[item]} ${formatSummary(todayProject)}`;
		case "totalTodaySummary":
			return `${DEFAULT_ITEM_LABELS[item]} ${formatSummary(todayTotal)}`;
	}
}

function renderFooterTemplate(template: string, todayProject: ReturnType<typeof emptyTotals>, todayTotal: ReturnType<typeof emptyTotals>): string {
	const values = {
		projectToday: createMetricSet(todayProject),
		totalToday: createMetricSet(todayTotal),
	};

	return template.replace(/\{([a-zA-Z]+)\.([a-zA-Z]+)\}/g, (match, scope, field) => {
		const source = values[scope as keyof typeof values];
		if (!source) return match;
		const value = source[field as keyof FooterMetricSet];
		return value ?? match;
	});
}

function createMetricSet(totals: ReturnType<typeof emptyTotals>): FooterMetricSet {
	return {
		cost: fmtCost(totals.costTotal),
		costRaw: String(totals.costTotal),
		tokens: fmtTokens(totals.totalTokens),
		tokensRaw: String(totals.totalTokens),
		input: fmtTokens(totals.input),
		inputRaw: String(totals.input),
		output: fmtTokens(totals.output),
		outputRaw: String(totals.output),
		cacheRead: fmtTokens(totals.cacheRead),
		cacheReadRaw: String(totals.cacheRead),
		cacheWrite: fmtTokens(totals.cacheWrite),
		cacheWriteRaw: String(totals.cacheWrite),
		summary: formatSummary(totals),
	};
}

function formatSummary(totals: ReturnType<typeof emptyTotals>): string {
	return `${fmtCost(totals.costTotal)} / ${fmtTokens(totals.totalTokens)} tok`;
}

export function applyFooterTheme(text: string, style: FooterStyle, theme: { fg: (name: string, text: string) => string }): string {
	if (style === "plain") return text;
	if (style === "muted") return theme.fg("dim", text);

	const parts = text.split(/(\$\d+(?:\.\d+)?)/g);
	return parts
		.map((part) => {
			if (!part) return "";
			if (/^\$\d+(?:\.\d+)?$/.test(part)) return themeCost(theme, part);
			return theme.fg("dim", part);
		})
		.join("");
}

function themeCost(theme: { fg: (name: string, text: string) => string }, cost: string): string {
	const value = Number(cost.slice(1));
	if (value >= 10) return theme.fg("error", cost);
	if (value >= 1) return theme.fg("warning", cost);
	return theme.fg("success", cost);
}

function writeFooterConfigFile(path: string, config: FooterConfig): void {
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

function readFooterConfigFile(path: string): Partial<FooterConfig> {
	if (!existsSync(path)) return {};

	try {
		return normalizeFooterConfig(JSON.parse(readFileSync(path, "utf-8")));
	} catch {
		return {};
	}
}

function mergeFooterConfigs(...configs: Array<Partial<FooterConfig>>): FooterConfig {
	const merged: Partial<FooterConfig> = {};
	for (const config of configs) {
		if (typeof config.enabled === "boolean") merged.enabled = config.enabled;
		if (Array.isArray(config.items)) merged.items = config.items.filter(isFooterItemId);
		if (typeof config.separator === "string") merged.separator = config.separator;
		if (typeof config.style === "string" && isFooterStyle(config.style)) merged.style = config.style;
		if (typeof config.template === "string") merged.template = config.template;
	}

	return {
		enabled: merged.enabled ?? DEFAULT_FOOTER_CONFIG.enabled,
		items: merged.items && merged.items.length > 0 ? merged.items : DEFAULT_FOOTER_CONFIG.items,
		separator: merged.separator ?? DEFAULT_FOOTER_CONFIG.separator,
		style: merged.style ?? DEFAULT_FOOTER_CONFIG.style,
		template: merged.template,
	};
}

function normalizeFooterConfig(value: unknown): Partial<FooterConfig> {
	if (!value || typeof value !== "object") return {};
	const config = value as Record<string, unknown>;
	return {
		enabled: typeof config.enabled === "boolean" ? config.enabled : undefined,
		items: Array.isArray(config.items) ? config.items.filter(isFooterItemId) : undefined,
		separator: typeof config.separator === "string" ? config.separator : undefined,
		style: typeof config.style === "string" && isFooterStyle(config.style) ? config.style : undefined,
		template: typeof config.template === "string" ? config.template : undefined,
	};
}

function isFooterItemId(value: unknown): value is FooterItemId {
	return typeof value === "string" && (FOOTER_ITEM_IDS as readonly string[]).includes(value);
}

function isFooterPresetId(value: unknown): value is FooterPresetId {
	return typeof value === "string" && value in FOOTER_PRESETS;
}

function isFooterStyle(value: unknown): value is FooterStyle {
	return value === "plain" || value === "muted" || value === "cost";
}
