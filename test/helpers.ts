import { stripAnsi } from "../src/format";

export function costColumnStart(line: string): number {
	const plain = stripAnsi(line);
	const match = plain.match(/\$\d/);
	if (!match || match.index == null) throw new Error(`No cost column in line: ${plain}`);
	return match.index;
}

export function msgsColumnStart(line: string): number {
	const plain = stripAnsi(line);
	const match = plain.match(/\s\d+\s*$/);
	if (!match || match.index == null) throw new Error(`No trailing numeric column in line: ${plain}`);
	return match.index;
}
