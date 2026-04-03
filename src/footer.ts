import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { emptyTotals, addToTotals } from "./aggregate";
import { todayStart } from "./dates";
import { fmtCost, fmtTokens } from "./format";
import { UsageRecord } from "./types";

export const FOOTER_ITEM_IDS = [
	"projectTodayCost",
	"totalTodayCost",
	"projectTodayTokens",
	"totalTodayTokens",
] as const;

export type FooterItemId = (typeof FOOTER_ITEM_IDS)[number];

export interface FooterConfig {
	enabled: boolean;
	items: FooterItemId[];
	separator: string;
}

export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
	enabled: true,
	items: ["projectTodayCost", "totalTodayCost"],
	separator: "  •  ",
};

const FOOTER_CONFIG_FILENAME = ".pi-token-usage.json";

export function getGlobalFooterConfigPath(): string {
	return join(homedir(), ".pi", "agent", FOOTER_CONFIG_FILENAME);
}

export function getProjectFooterConfigPath(cwd: string): string {
	return join(cwd, FOOTER_CONFIG_FILENAME);
}

export function loadFooterConfig(cwd: string): FooterConfig {
	return mergeFooterConfigs(DEFAULT_FOOTER_CONFIG, readFooterConfigFile(getGlobalFooterConfigPath()), readFooterConfigFile(getProjectFooterConfigPath(cwd)));
}

export function saveProjectFooterConfig(cwd: string, patch: Partial<FooterConfig>): FooterConfig {
	const path = getProjectFooterConfigPath(cwd);
	const current = readFooterConfigFile(path);
	const next = mergeFooterConfigs(DEFAULT_FOOTER_CONFIG, current, patch);
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
	return next;
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

export function formatFooterConfig(config: FooterConfig, cwd: string): string {
	return [
		`Footer: ${config.enabled ? "enabled" : "disabled"}`,
		`Items: ${config.items.join(", ") || "(none)"}`,
		`Separator: ${JSON.stringify(config.separator)}`,
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

	const parts = config.items.map((item) => formatFooterItem(item, todayProject, todayTotal));
	return parts.join(config.separator);
}

function formatFooterItem(item: FooterItemId, todayProject: ReturnType<typeof emptyTotals>, todayTotal: ReturnType<typeof emptyTotals>): string {
	switch (item) {
		case "projectTodayCost":
			return `Proj today ${fmtCost(todayProject.costTotal)}`;
		case "totalTodayCost":
			return `Total today ${fmtCost(todayTotal.costTotal)}`;
		case "projectTodayTokens":
			return `Proj today ${fmtTokens(todayProject.totalTokens)} tok`;
		case "totalTodayTokens":
			return `Total today ${fmtTokens(todayTotal.totalTokens)} tok`;
	}
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
	}

	return {
		enabled: merged.enabled ?? DEFAULT_FOOTER_CONFIG.enabled,
		items: merged.items && merged.items.length > 0 ? merged.items : DEFAULT_FOOTER_CONFIG.items,
		separator: merged.separator ?? DEFAULT_FOOTER_CONFIG.separator,
	};
}

function normalizeFooterConfig(value: unknown): Partial<FooterConfig> {
	if (!value || typeof value !== "object") return {};
	const config = value as Record<string, unknown>;
	return {
		enabled: typeof config.enabled === "boolean" ? config.enabled : undefined,
		items: Array.isArray(config.items) ? config.items.filter(isFooterItemId) : undefined,
		separator: typeof config.separator === "string" ? config.separator : undefined,
	};
}

function isFooterItemId(value: unknown): value is FooterItemId {
	return typeof value === "string" && (FOOTER_ITEM_IDS as readonly string[]).includes(value);
}
