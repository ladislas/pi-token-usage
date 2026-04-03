export interface UsageRecord {
	timestamp: number; // Unix ms
	isoTimestamp: string;
	provider: string;
	model: string;
	project: string;
	sessionId: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	costTotal: number;
}

export interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	costTotal: number;
	count: number;
}

export interface TableWidths {
	first: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}
