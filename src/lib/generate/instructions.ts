/*
  The install instructions, as markdown, for the owner's platform, with notes
  on the schema the site already has. See docs/build-spec.md; the outputs
  builder replaces the stub.
*/
import type { InstructionsInput } from "./types";

export function buildInstructions(input: InstructionsInput): string {
  return `# Installing the About page for ${input.companyName}\n\nInstructions for ${input.platform} are not built yet.\n`;
}
