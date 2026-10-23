// oc-models-pro — how a row and the footer fit a panel of a given width, in columns.
//
// The host hands `session.panel` a `width` in columns (pixels on the very first frame, which the
// clamp absorbs). Everything that depends on it lives here, so the thresholds sit in one place:
//   node plugins/oc-models-pro/fit.ts --self-check

/** The name column at its widest: 32 + the fixed 53 is the 85-character table. */
export const NAME = 32
/** ...and at its narrowest. Below this a model name is unreadable, and a column is worth more. */
export const NAME_MIN = 24
/** The cells that never go: marker 2, tag 4, in 6, out 6, cred 4 and the nine separators. */
const FIXED = 53

export type Fit = { name: number; ctx: boolean; int: boolean; tkps: boolean; note: boolean }

/** Columns dropped as the panel narrows: one with no data, then the note, then context, then int. */
const DROPS = [
	{ key: "tkps", width: 7 },
	{ key: "note", width: 7 },
	{ key: "ctx", width: 6 },
	{ key: "int", width: 6 },
] as const

/** The width of a row in columns, for a given fit. */
export function rowWidth(f: Fit): number {
	let width = f.name + FIXED
	if (!f.tkps) width -= 7
	if (!f.note) width -= 7
	if (!f.ctx) width -= 6
	if (!f.int) width -= 6
	return width
}

export function fit(width: number): Fit {
	// A missing width (and the pixel value of the first frame) is "unknown", not "tiny": the wide
	// layout is the safe answer. Anything positive is a real column count and takes the ladder.
	const w = Number.isFinite(width) && width > 0 ? Math.floor(width) : Infinity
	const out: Fit = { name: NAME, ctx: true, int: true, tkps: true, note: true }
	let fixed = FIXED
	for (const drop of DROPS) {
		// Stop as soon as the name can give the rest: it shrinks before anything else goes.
		if (Math.min(NAME, w - fixed) >= NAME_MIN) break
		out[drop.key] = false
		fixed -= drop.width
	}
	out.name = Math.max(NAME_MIN, Math.min(NAME, w - fixed))
	return out
}

/** The panel width below which the legend shortens rather than being cut mid-sentence. */
export const LEGEND_MIN = 72

/** The footer hints, in the order they are read. Splitting on these keeps the line data-driven. */
const HINTS = ["↑↓ enter", "ctrl+o sort", "ctrl+s scope", "ctrl+g groups", "ctrl+r recent", "ctrl+f fav", "ctrl+y full", "esc"]

/** The same hints wrapped to `width` columns: one line when they fit, and never truncated. */
export function hintLines(width: number): string[] {
	const w = Number.isFinite(width) && width > 0 ? Math.floor(width) : Infinity
	const lines: string[] = []
	let line = ""
	for (const hint of HINTS) {
		const next = line ? line + " · " + hint : hint
		if (line && next.length >= w) {
			lines.push(" " + line)
			line = hint
		} else line = next
	}
	if (line) lines.push(" " + line)
	return lines
}

// Self-check: node plugins/oc-models-pro/fit.ts --self-check
if (process.argv[2] === "--self-check") {
	const check = (ok: boolean, message: string) => {
		if (!ok) throw new Error("self-check: " + message)
	}
	const wide = fit(200)
	check(wide.name === NAME && wide.tkps && wide.note && wide.ctx && wide.int, "200 columns keeps every column")
	check(rowWidth(wide) === 85, "the full table is 85 characters, got " + rowWidth(wide))
	check(fit(1400).name === NAME, "a pixel width on the first frame resolves to the wide layout")
	check(hintLines(200).length === 1 && hintLines(200)[0].length === 103, "the footer is one 103-column line when it fits")
	check(hintLines(102).length === 2 && hintLines(102).every((l) => l.length <= 102), "at 102 the footer wraps to two lines")
	check(hintLines(40).every((l) => l.length <= 40), "at 40 no line exceeds the panel")
	check(fit(76).name === 30 && !fit(76).tkps, "at 76 tok/s goes and the name grows into its space")
	check(!fit(70).tkps && fit(70).note && fit(70).name === 24, "at 70 tok/s alone frees enough and the note stays")
	check(!fit(69).note && fit(69).name === 30, "at 69 the note column goes and the name grows into its space")
	check(!fit(62).ctx && fit(62).int, "at 62 context is gone and int is still there")
	check(!fit(56).int && fit(56).name >= NAME_MIN, "at 56 int is the last to go")
	check(fit(5).name === NAME_MIN && !fit(5).int, "a genuinely tiny width takes the narrowest rung, not the wide one")
	for (let w = 51; w <= 140; w++) {
		check(fit(w).name >= NAME_MIN, "name floor holds at " + w)
		check(rowWidth(fit(w)) <= w, "the row fits " + w + " columns, got " + rowWidth(fit(w)))
	}
	// A single hint longer than the panel cannot be split; nothing may overflow beyond that.
	const longest = Math.max(...HINTS.map((hint) => hint.length)) + 1
	for (let w = 12; w <= 60; w++) check(hintLines(w).every((l) => l.length <= Math.max(w, longest)), "the footer fits " + w)
	console.log("self-check ok: 85 wide, " + hintLines(102).length + " footer lines at 102, rows fit 51..140")
}
