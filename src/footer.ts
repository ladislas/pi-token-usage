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

export interface FooterConfig {
	enabled: boolean;
	items: FooterItemId[];
	separator: string;
	labels: Partial<Record<FooterItemId, string>>;
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
	labels: {},
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
	const customLabels = Object.entries(config.labels)
		.filter(([, value]) => typeof value === "string" && value.length > 0)
		.map(([key, value]) => `${key}=${JSON.stringify(value)}`);

	return [
		`Footer: ${config.enabled ? "enabled" : "disabled"}`,
		`Items: ${config.items.join(", ") || "(none)"}`,
		`Separator: ${JSON.stringify(config.separator)}`,
		`Custom labels: ${customLabels.length > 0 ? customLabels.join(", ") : "(none)"}`,
		`Presets: ${Object.keys(FOOTER_PRESETS).join(", ")}`,
		`Project config: ${getProjectFooterConfigPath(cwd)}`,
		`Global config: ${getGlobalFooterConfigPath()}`,
		`Available items: ${FOOTER_ITEM_IDS.join(", ")}`,
	].join("\n");
}

export function buildFooterStatus(records: UsageRecord[], cwd: string, config: FooterConfig): string | undefined {
	if (!config.enabled || config.items.length === 0) return undefined;

	const todayMs = todayStart();
	const todayProject = emptyTotals();
	const todayTotal = emptyTotals();

	for (const record of records) {
		if (record.timestamp < todayMs) continue;
		addToTotals(todayTotal, record);
		if (record.project === cwd) addToTotals(todayProject, record);
	}

	const parts = config.items.map((item) => formatFooterItem(item, todayProject, todayTotal, config.labels[item]));
	return parts.join(config.separator);
}

export function getFooterLabel(item: FooterItemId, config: FooterConfig): string {
	return config.labels[item] || DEFAULT_ITEM_LABELS[item];
}

function formatFooterItem(
	item: FooterItemId,
	todayProject: ReturnType<typeof emptyTotals>,
	todayTotal: ReturnType<typeof emptyTotals>,
	customLabel?: string,
): string {
	const label = customLabel || DEFAULT_ITEM_LABELS[item];
	switch (item) {
		case "projectTodayCost":
			return `${label} ${fmtCost(todayProject.costTotal)}`;
		case "totalTodayCost":
			return `${label} ${fmtCost(todayTotal.costTotal)}`;
		case "projectTodayTokens":
			return `${label} ${fmtTokens(todayProject.totalTokens)} tok`;
		case "totalTodayTokens":
			return `${label} ${fmtTokens(todayTotal.totalTokens)} tok`;
		case "projectTodaySummary":
			return `${label} ${fmtCost(todayProject.costTotal)} / ${fmtTokens(todayProject.totalTokens)} tok`;
		case "totalTodaySummary":
			return `${label} ${fmtCost(todayTotal.costTotal)} / ${fmtTokens(todayTotal.totalTokens)} tok`;
	}
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
	const merged: Partial<FooterConfig> = { labels: {} };
	for (const config of configs) {
		if (typeof config.enabled === "boolean") merged.enabled = config.enabled;
		if (Array.isArray(config.items)) merged.items = config.items.filter(isFooterItemId);
		if (typeof config.separator === "string") merged.separator = config.separator;
		if (config.labels) merged.labels = { ...merged.labels, ...normalizeLabels(config.labels) };
	}

	return {
		enabled: merged.enabled ?? DEFAULT_FOOTER_CONFIG.enabled,
		items: merged.items && merged.items.length > 0 ? merged.items : DEFAULT_FOOTER_CONFIG.items,
		separator: merged.separator ?? DEFAULT_FOOTER_CONFIG.separator,
		labels: merged.labels ?? {},
	};
}

function normalizeFooterConfig(value: unknown): Partial<FooterConfig> {
	if (!value || typeof value !== "object") return {};
	const config = value as Record<string, unknown>;
	return {
		enabled: typeof config.enabled === "boolean" ? config.enabled : undefined,
		items: Array.isArray(config.items) ? config.items.filter(isFooterItemId) : undefined,
		separator: typeof config.separator === "string" ? config.separator : undefined,
		labels: normalizeLabels(config.labels),
	};
}

function normalizeLabels(value: unknown): Partial<Record<FooterItemId, string>> {
	if (!value || typeof value !== "object") return {};
	const labels: Partial<Record<FooterItemId, string>> = {};
	for (const [key, label] of Object.entries(value as Record<string, unknown>)) {
		if (isFooterItemId(key) && typeof label === "string" && label.length > 0) labels[key] = label;
	}
	return labels;
}

function isFooterItemId(value: unknown): value is FooterItemId {
	return typeof value === "string" && (FOOTER_ITEM_IDS as readonly string[]).includes(value);
}

function isFooterPresetId(value: unknown): value is FooterPresetId {
	return typeof value === "string" && value in FOOTER_PRESETS;
}
