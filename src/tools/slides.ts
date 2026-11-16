import { z } from "zod";
import { flexJson } from "../utils/coercion";
import type { McpServer, SendCommandFn } from "./types";
import { mcpJson, mcpError } from "./types";
import { translateDeck } from "../translator/index";
import type { VibmaCommand } from "../translator/index";

// ─── MCP Registration ────────────────────────────────────────────

export function registerMcpTools(server: McpServer, sendCommand: SendCommandFn) {
  server.tool(
    "create_slides_from_figdeck",
    "Create Figma Slides from figdeck JSON. Pass the JSON array from `figdeck build <file.md>`. " +
    "Translates each slide into frames + text nodes with proper layout, spacing, and styling. " +
    "Requires a Figma Slides file to be open with Vibma plugin connected.",
    {
      slides: flexJson(z.array(z.any())).describe(
        "The JSON array output from `figdeck build`. Each element is a slide object with blocks, background, styles, etc."
      ),
    },
    async ({ slides }: any) => {
      try {
        // Translate figdeck JSON to Vibma commands
        const result = translateDeck(slides);

        // Execute commands sequentially, resolving parent refs
        const idStore = new Map<string, string>();
        const createdSlides: string[] = [];
        let commandsExecuted = 0;

        for (const cmd of result.commands) {
          // Resolve parentRef to actual Figma node ID
          const params = resolveParentRef(cmd, idStore);

          // Execute via Vibma
          const response = await sendCommand(cmd.tool, params) as any;

          // Store result ID if requested
          if (cmd.storeIdAs && response?.results?.[0]?.id) {
            idStore.set(cmd.storeIdAs, response.results[0].id);

            // Track slide-level frames for the report
            if (cmd.storeIdAs.startsWith("slide_")) {
              const slideName = (cmd.params as any).items?.[0]?.name || "Untitled";
              createdSlides.push(`${slideName} (${response.results[0].id})`);
            }
          }

          commandsExecuted++;
        }

        return mcpJson({
          success: true,
          slideCount: result.slideCount,
          commandsExecuted,
          slides: createdSlides,
          warnings: result.warnings.length > 0 ? result.warnings : undefined,
        });
      } catch (e) {
        return mcpError("Error creating slides from figdeck", e);
      }
    }
  );
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Resolve parentRef in a command's params by looking up the stored ID.
 * Returns a new params object with parentId set on each item.
 */
function resolveParentRef(cmd: VibmaCommand, idStore: Map<string, string>): Record<string, unknown> {
  const params = { ...cmd.params };

  if (cmd.parentRef) {
    const parentId = idStore.get(cmd.parentRef);
    if (!parentId) {
      throw new Error(`Parent ref '${cmd.parentRef}' not found in ID store. Available: [${[...idStore.keys()].join(", ")}]`);
    }

    // Inject parentId into each item in the items array
    if (Array.isArray(params.items)) {
      params.items = (params.items as any[]).map(item => ({ ...item, parentId }));
    }
  }

  return params;
}

// No figmaHandlers — this tool runs entirely on the MCP server side
// by composing existing Vibma tools (create_frame, create_text, etc.)
export const figmaHandlers: Record<string, (params: any) => Promise<any>> = {};
