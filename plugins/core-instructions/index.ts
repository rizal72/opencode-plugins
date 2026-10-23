import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const CORE = join(homedir(), ".agents", "CORE.md")

export default {
  id: "core.instructions",
  async setup(ctx: any) {
    await ctx.session.hook("context", async (event: any) => {
      try {
        const text = await readFile(CORE, "utf8")
        if (text.trim()) event.system.push({ type: "text", text: `# Global rules (CORE.md)\n\n${text}` })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[core-instructions] could not read ${CORE}; CORE.md rules will not be injected: ${message}`)
      }
    })
  },
}
