"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Generation is slice 3. The button is here so the screen reads complete. */
export function GenerateButton() {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>
        <Button variant="primary" size="sm" disabled aria-disabled="true">
          <Sparkles aria-hidden="true" />
          Generate the page
        </Button>
      </TooltipTrigger>
      <TooltipContent>Arrives with the next release</TooltipContent>
    </Tooltip>
  );
}
