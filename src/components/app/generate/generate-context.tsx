"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { FieldQuestion } from "@/lib/generate/view";

/*
  What the "Generate the page" button needs to know, provided by the project
  and page screens. The button sits inside the project header, which takes no
  props for it, so the screens hand it the state through this context.
*/
export interface GenerateState {
  projectId: string;
  /** False until the project has a fact sheet to write from. */
  hasFactSheet: boolean;
  /** True while a page is queued or being written. */
  busy: boolean;
  /** Required fields with no answer yet; the button warns before it starts. */
  missing: FieldQuestion[];
  /** The review screen, scrolled to the first gap, for "Fill the gaps". */
  reviewHref: string;
}

const GenerateContext = createContext<GenerateState | null>(null);

export function GenerateProvider({ value, children }: { value: GenerateState; children: ReactNode }) {
  return <GenerateContext.Provider value={value}>{children}</GenerateContext.Provider>;
}

/** Null outside a provider: the button renders disabled. */
export function useGenerateState(): GenerateState | null {
  return useContext(GenerateContext);
}
