import { describe, expect, it } from "vitest";
import { colorCost, stripAnsi, visibleWidth } from "../src/format";

describe("format helpers", () => {
	it("stripAnsi and visibleWidth ignore color codes", () => {
		const colored = colorCost(12.34);
		expect(stripAnsi(colored)).toBe("$12.3");
		expect(visibleWidth(colored)).toBe(5);
	});
});
