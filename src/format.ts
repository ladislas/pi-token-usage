import { GREEN, RED, RST, YELLOW } from "./ansi";

export function fmtTokens(n: number): string {
	if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

export function fmtCost(n: number): string {
	if (n >= 100) return `$${n.toFixed(0)}`;
	if (n >= 10) return `$${n.toFixed(1)}`;
	if (n >= 0.01) return `$${n.toFixed(2)}`;
	if (n >= 0.001) return `$${n.toFixed(3)}`;
	if (n === 0) return "$0.00";
	return `$${n.toFixed(4)}`;
}

export function colorCost(n: number): string {
	const s = fmtCost(n);
	if (n >= 10) return `${RED}${s}${RST}`;
	if (n >= 1) return `${YELLOW}${s}${RST}`;
	return `${GREEN}${s}${RST}`;
}

export function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function visibleWidth(s: string): number {
	return stripAnsi(s).length;
}

export function pad(s: string, width: number): string {
	const len = visibleWidth(s);
	return len >= width ? s : " ".repeat(width - len) + s;
}

export function padL(s: string, width: number): string {
	const len = visibleWidth(s);
	return len >= width ? s : s + " ".repeat(width - len);
}
