// oc-models-pro/rows.ts — the facts both surfaces read the same way.
//
// The terminal draws a monospace table and the desktop draws a grid, but what a row *means* is not the
// renderer's business: the effective price, what counts as free, and the ten orders are one definition
// here. Two copies would drift the way they already did once — the terminal kept free models out of the
// price order and the desktop did not.
//
// Runnable standalone for its self-check: node plugins/oc-models-pro/rows.ts --self-check

export interface Row {
	name: string
	providerID: string
	modelID: string
	provider: string
	/** Two letters from `tags.ts`: the provider's, unique in the catalogue. */
	tag: string
	/** Undefined when the catalogue has no price for the model: an unknown figure, not a free one. */
	input?: number
	output?: number
	/** Undefined when the model carries no limit. */
	context?: number
	/** Monthly limit ÷ the $10 plan: the ordering multiplier, shown so the order explains itself. */
	credit: number
	/** Allowance ÷ its normal one, when the page marks a promotion. */
	promo?: number
	/** Peak price ÷ off-peak price, for a model with two tariffs. */
	peak?: number
	/** Stencil's intelligence score and its speed; absent when the catalogue has no row for the model. */
	int?: number
	tps?: number
	/** Tokens per second measured here, on this provider. Outranks `tps` and carries no tilde. */
	measured?: number
	enabled: boolean
}

/** What the Go plan makes a model cost: the figure the effective order sorts by. An unknown price is
 *  `undefined`, not infinity, so an order can tell "not measured" from "very expensive". */
export function effective(row: Row): number | undefined {
	if (row.input === undefined) return undefined
	return row.input / (row.credit || 1)
}

/** A missing price is not a free one: both figures must be there, and be zero. */
export function isFree(row: Row): boolean {
	return row.input === 0 && row.output === 0
}

/** The speed to sort and print: what this machine measured first, the borrowed figure after. */
export function speedOf(row: Row): number | undefined {
	return row.measured ?? row.tps
}

export type SortKey =
	| "effective"
	| "input"
	| "output"
	| "inputSum"
	| "context"
	| "int"
	| "speed"
	| "recent"
	| "provider"
	| "name"

export interface SortContext {
	/** `providerID/modelID` → its place in the recent list; smaller is more recent. */
	recent: Map<string, number>
}

export interface Order {
	/** The long name: a footer, a menu, a title. */
	label: string
	/** The short name the terminal prints in its title bar. */
	short: string
	/** True when more is better, so the first row is the largest figure. */
	desc?: true
	/** `undefined` when the order cannot measure this row — the caller sorts it last, in either direction. */
	value(row: Row, context: SortContext): number | undefined
}

/** Whatever an order cannot measure sorts last, never first, and in either direction: an unknown price is
 *  not the cheapest thing on the list, and a missing score is not the highest. */

export const ORDERS: Record<SortKey, Order> = {
	effective: { label: "effective price", short: "effective↑", value: effective },
	input: { label: "input price", short: "in↑", value: (row) => row.input },
	output: { label: "output price", short: "out↑", value: (row) => row.output },
	inputSum: {
		label: "input + output",
		short: "in+out↑",
		value: (row) =>
			row.input === undefined || row.output === undefined ? undefined : (row.input + row.output) / (row.credit || 1),
	},
	context: { label: "context window", short: "ctx↓", desc: true, value: (row) => row.context },
	// A missing score sorts last, never first: Pi's rule, and the honest one.
	int: { label: "intelligence", short: "int↓", desc: true, value: (row) => row.int },
	speed: { label: "speed", short: "speed↓", desc: true, value: (row) => speedOf(row) },
	recent: {
		label: "recently used",
		short: "recent",
		value: (row, context) => context.recent.get(row.providerID + "/" + row.modelID),
	},
	provider: { label: "provider", short: "provider", value: () => 0 },
	name: { label: "name", short: "name", value: () => 0 },
}

/** The orders in the cycle the terminal walks with `ctrl+o`, in the same sequence. */
export const ORDER: SortKey[] = [
	"effective",
	"input",
	"output",
	"inputSum",
	"context",
	"int",
	"speed",
	"recent",
	"provider",
	"name",
]

/** The direction an order reads in when nothing else says otherwise. */
export function direction(key: SortKey): 1 | -1 {
	return ORDERS[key].desc ? -1 : 1
}

const id = (row: Row) => row.providerID + "/" + row.modelID

/**
 * The comparator both surfaces sort with. The two label orders compare text; every other order compares
 * a number, and the direction is passed in because the desktop lets the reader flip it. Ties fall back to
 * the name so the list never reshuffles between two reads of the same data.
 */
export function compare(key: SortKey, a: Row, b: Row, context: SortContext, sign: 1 | -1 = direction(key)): number {
	if (key === "name" || key === "provider") {
		const left = key === "name" ? a.name : a.provider
		const right = key === "name" ? b.name : b.provider
		const delta = left.localeCompare(right)
		return delta !== 0 ? delta * sign : id(a).localeCompare(id(b))
	}
	const left = ORDERS[key].value(a, context)
	const right = ORDERS[key].value(b, context)
	// The direction flips what can be measured, never what cannot: an unknown figure goes last when the
	// arrow points up and when it points down, or flipping a column would head the list with blanks.
	if (left === undefined || right === undefined) {
		if (left === right) return a.name.localeCompare(b.name)
		return left === undefined ? 1 : -1
	}
	if (left === right) return a.name.localeCompare(b.name)
	return (left < right ? -1 : 1) * sign
}

/** What a list of rows looks like once it is drawn: one section per provider, or the flat blocks. */
export interface Section {
	/** The provider's name, or `Free` for the free bucket. `undefined` when the block needs no label: the
	 *  leading one, and the paying block after it in the flat layout. */
	title?: string
	rows: Row[]
}

/**
 * The order the surfaces draw, which is not the order they sort: free models never enter a price order,
 * so they follow their provider's paying rows; and the model in use is never buried — it leads its
 * provider, and its provider leads the list. Both surfaces held a copy of this (`gui.tsx` and
 * `tui.tsx`), and the copies drifted the moment a filter was added.
 */
export function arrange(list: Row[], options: { inUse?: string; grouped: boolean }): Section[] {
	const used = options.inUse === undefined ? undefined : list.find((row) => id(row) === options.inUse)

	if (!options.grouped) {
		const rest = used ? list.filter((row) => row !== used) : list
		const paying = rest.filter((row) => !isFree(row))
		const free = rest.filter((row) => isFree(row))
		return [
			...(used ? [{ rows: [used] }] : []),
			...(paying.length ? [{ rows: paying }] : []),
			...(free.length ? [{ title: "Free", rows: free }] : []),
		]
	}

	// Built from the whole list, the in-use row included: leaving it out left its provider with no group
	// at all when it was the only row a filter kept, and the row surfaced under the first header.
	const groups = new Map<string, Section>()
	for (const row of list) {
		const group = groups.get(row.providerID) ?? { title: row.provider, rows: [] }
		// Paying first, then free: `isFree` sorts false before true.
		const at = group.rows.findIndex((entry) => isFree(entry) && !isFree(row))
		if (at === -1) group.rows.push(row)
		else group.rows.splice(at, 0, row)
		groups.set(row.providerID, group)
	}
	// By name, and by id when two providers share one: the id decides, the name only labels.
	const sections = [...groups.entries()]
		.sort(([idA, a], [idB, b]) => (a.title ?? "").localeCompare(b.title ?? "") || idA.localeCompare(idB))
		.map(([, section]) => section)
	if (used) {
		// The in-use provider leads, and its model leads inside it.
		const at = sections.indexOf(groups.get(used.providerID)!)
		if (at > 0) sections.unshift(...sections.splice(at, 1))
		const first = sections[0]
		if (first) first.rows = [used, ...first.rows.filter((row) => row !== used)]
	}
	return sections
}

// Self-check: node plugins/oc-models-pro/rows.ts --self-check
// Guarded: this module is also bundled into the desktop window, where `process` does not exist.
if (typeof process !== "undefined" && process.argv?.[2] === "--self-check") {
	const row = (over: Partial<Row> = {}): Row => ({
		name: "Model",
		providerID: "p",
		modelID: "m",
		provider: "Provider",
		tag: "PR",
		credit: 1,
		enabled: true,
		...over,
	})
	const context: SortContext = { recent: new Map([["p/m", 0]]) }
	const check = (ok: boolean, message: string) => {
		if (!ok) throw new Error("self-check: " + message)
	}

	check(effective(row()) === undefined, "an unknown input price is not zero")
	check(effective(row({ input: 0.8, credit: 8 })) === 0.1, "the credit divides the input price")
	check(effective(row({ input: 0.8, credit: 0 })) === 0.8, "a zero credit must not divide by zero")
	check(!isFree(row()), "a missing price is not free")
	check(!isFree(row({ input: 0, output: 2 })), "a zero input with a paid output is not free")
	check(isFree(row({ input: 0, output: 0 })), "both at zero is free")
	check(speedOf(row({ tps: 40, measured: 12 })) === 12, "a measured speed outranks a borrowed one")
	check(speedOf(row()) === undefined, "no speed is no speed")

	// The price orders put an unknown figure last, and the descending ones put a missing figure last too.
	const sorts = (key: SortKey, rows: Row[]) => [...rows].sort((a, b) => compare(key, a, b, context))
	const cheap = row({ name: "cheap", input: 1, output: 1 })
	const dear = row({ name: "dear", input: 10, output: 10 })
	const unknown = row({ name: "unknown" })
	check(sorts("input", [unknown, dear, cheap]).map((r) => r.name)[0] === "cheap", "in↑ starts at the cheapest")
	check(sorts("input", [unknown, dear, cheap]).map((r) => r.name)[2] === "unknown", "an unknown price sorts last")
	const winning: Row[] = [row({ name: "few", context: 1000, int: 10 }), row({ name: "many", context: 100_000, int: 50 }), unknown]
	check(sorts("context", winning)[0].name === "many", "ctx↓ starts at the widest window")
	check(sorts("context", winning)[2].name === "unknown", "a missing window sorts last, not first")
	check(sorts("int", winning)[0].name === "many", "int↓ starts at the highest score")
	check(sorts("int", winning)[2].name === "unknown", "a missing score sorts last, not first")
	check(sorts("speed", winning)[2].name === "unknown", "a missing speed sorts last, not first")
	// Flipping a column is the reader's right, and it must never bring the blanks to the top: this is the
	// state two clicks reach, and the one the sentinels used to get wrong.
	const flipped = (key: SortKey, rows: Row[]) => [...rows].sort((a, b) => compare(key, a, b, context, -1))
	check(flipped("input", [unknown, dear, cheap])[2].name === "unknown", "in↓ puts an unknown price last too")
	check(flipped("input", [unknown, dear, cheap])[0].name === "dear", "in↓ starts at the dearest")
	check(flipped("context", winning)[2].name === "unknown", "ctx↑ puts a missing window last too")
	check(flipped("int", winning)[2].name === "unknown", "int↑ puts a missing score last too")
	check(flipped("speed", winning)[2].name === "unknown", "speed↑ puts a missing speed last too")
	check(flipped("effective", [unknown, dear, cheap])[2].name === "unknown", "effective↓ puts an unknown price last too")
	const recentContext: SortContext = { recent: new Map([["p/fresh", 0]]) }
	const fresh = row({ name: "fresh", modelID: "fresh" })
	const stale = row({ name: "stale", modelID: "stale" })
	check(
		[stale, fresh].sort((a, b) => compare("recent", a, b, recentContext))[0].name === "fresh",
		"the recent list orders by its index",
	)
	check(compare("input", cheap, dear, context, -1) > 0, "the sign the caller passes flips the order")
	check(compare("name", row({ name: "a" }), row({ name: "b" }), context) < 0, "name compares text")
	check(compare("provider", row({ provider: "a" }), row({ provider: "b" }), context) < 0, "provider compares text")
	check(direction("effective") === 1 && direction("int") === -1, "the default direction follows the order")

	// The order the surfaces draw: the cases that each cost a bug.
	const a = row({ name: "a", modelID: "a", providerID: "pa", provider: "A", input: 2, output: 2 })
	const b = row({ name: "b", modelID: "b", providerID: "pa", provider: "A", input: 0, output: 0 })
	const c = row({ name: "c", modelID: "c", providerID: "pb", provider: "B", input: 3, output: 3 })

	const grouped = arrange([a, b, c], { inUse: "pb/c", grouped: true })
	check(grouped.map((s) => s.title).join() === "B,A", "the provider in use leads the list")
	check(grouped[0].rows[0] === c, "and its model leads inside it")
	check(grouped[1].rows.map((r) => r.name).join() === "a,b", "paying before free inside a group")

	// The in-use row shares its group here: hoisting the provider is not enough, the row itself must move,
	// and this is the shape the panel depends on (its sort does not pre-hoist, unlike the terminal's).
	const inner = arrange([a, b, c], { inUse: "pa/b", grouped: true })
	check(inner[0].title === "A" && inner[0].rows[0] === b, "the in-use row leads inside a group that has others")
	check(inner[0].rows.map((r) => r.name).join() === "b,a", "and the rest of the group keeps its order")

	// Free in use: it leads the list in both layouts, and never falls into the free bucket.
	const freeUsed = arrange([a, b, c], { inUse: "pa/b", grouped: false })
	check(freeUsed[0].rows[0] === b, "flat: a free model in use still leads")
	check(!freeUsed.some((s) => s.title === "Free"), "flat: and is not repeated in the free bucket")

	const solo = arrange([c], { inUse: "pb/c", grouped: true })
	check(solo.length === 1 && solo[0].title === "B", "the only row a filter kept still has its own group")

	const flat = arrange([b, c, a], { inUse: "pb/c", grouped: false })
	check(flat[0].rows[0] === c, "flat: the model in use leads the list")
	check(flat[flat.length - 1].title === "Free", "flat: the free bucket is last")
	check(flat[flat.length - 1].rows[0] === b, "flat: and holds the free row")

	const twin = row({ name: "twin", modelID: "twin", providerID: "p2", provider: "A", input: 4, output: 4 })
	const twins = arrange([a, twin], { inUse: "p2/twin", grouped: true })
	check(twins.length === 2, "two providers sharing a display name stay two groups")
	check(twins[0].rows[0] === twin, "and the one in use leads by id, not by the shared name")

	console.log("self-check ok: " + ORDER.length + " orders, unknown figures last in every one of them")
}
