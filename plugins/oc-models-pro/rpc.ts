// What the desktop's panel reads: a plugin window has no Node built-ins, so every file and every fetch
// stays in the server half and the window asks for the finished table.
import { Rpc } from "@opencode/plugin/rpc"

import type { Row } from "./rows.ts"

const Count = { type: "number" }

const Row = {
	type: "object",
	properties: {
		providerID: { type: "string" },
		modelID: { type: "string" },
		name: { type: "string" },
		/** The provider's display name, account first as the host writes it. */
		provider: { type: "string" },
		/** Two letters from `tags.ts`. */
		tag: { type: "string" },
		/** Prices per million tokens; absent when the catalogue has none — an unknown figure, not a free one. */
		input: Count,
		output: Count,
		context: Count,
		/** Monthly limit ÷ the $10 plan. 1 when the plan is unknown. */
		credit: Count,
		promo: Count,
		peak: Count,
		int: Count,
		/** Borrowed from Artificial Analysis, or the catalogue's own when it still carries one. */
		tps: Count,
		/** Measured on this machine, on this provider. Outranks `tps` and carries no tilde. */
		measured: Count,
		enabled: { type: "boolean" },
	},
	required: ["providerID", "modelID", "name", "provider", "tag", "credit", "enabled"],
	additionalProperties: false,
} as const

const Snapshot = {
	type: "object",
	properties: {
		rows: { type: "array", items: Row },
		/** `providerID/modelID` of the models the host keeps as favourites, from `model.json`. */
		favorites: { type: "array", items: { type: "string" } },
		/** How many offers the catalogue holds, and how many came out with a speed — the pair that tells a
		 *  thin source from a broken key. */
		offers: Count,
		withSpeed: Count,
		/** False when the Go plan could not be read and no cache was there: every credit is 1. */
		credits: { type: "boolean" },
		/** What failed, in the words the panel shows. Empty when everything came back. */
		problems: { type: "array", items: { type: "string" } },
	},
	required: ["rows", "favorites", "offers", "withSpeed", "credits"],
	additionalProperties: false,
} as const

export const Models = Rpc.define({
	id: "models",
	methods: {
		snapshot: {
			input: {
				type: "object",
				properties: { force: { type: "boolean" } },
				additionalProperties: false,
			},
			output: Snapshot,
		},
		setFavorite: {
			input: {
				type: "object",
				properties: {
					providerID: { type: "string" },
					modelID: { type: "string" },
					/** Absent toggles. */
					on: { type: "boolean" },
				},
				required: ["providerID", "modelID"],
				additionalProperties: false,
			},
			output: {
				type: "object",
				properties: {
					/** False when the file could not be read or written: the panel says so instead of pretending. */
					ok: { type: "boolean" },
					favorites: { type: "array", items: { type: "string" } },
				},
				required: ["ok", "favorites"],
				additionalProperties: false,
			},
		},
	},
	// Present (empty) on purpose: a missing events map fails the whole plugin.
	events: {},
})

/** The wire form is the row both surfaces sort: one shape, declared once. */
export type ModelRow = Row

export interface ModelsSnapshot {
	rows: ModelRow[]
	favorites: string[]
	offers: number
	withSpeed: number
	credits: boolean
	problems?: string[]
}

export default Models
