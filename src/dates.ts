export function toDateStr(ts: number): string {
	const d = new Date(ts);
	return d.toLocaleDateString("en-CA"); // YYYY-MM-DD
}

export function toMonthStr(ts: number): string {
	return toDateStr(ts).slice(0, 7); // YYYY-MM
}

export function daysAgo(n: number): number {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - n);
	return d.getTime();
}

export function todayStart(): number {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}
