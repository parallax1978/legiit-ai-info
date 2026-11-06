import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatCost, type GenerationView } from "@/lib/generate/view";
import { GenerateButton } from "./generate-button";

/** The failed generation on the project and page screens, with the way to try again. */
export function GenerationFailed({ generation }: { generation: GenerationView }) {
  return (
    <Alert className="border-bad/30 bg-bad-soft text-bad">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>The page could not be written</AlertTitle>
      <AlertDescription className="text-bad/90">
        <p>{generation.error?.trim() || "Something stopped the page writer before it finished."}</p>
        {generation.costUsd > 0 ? <p className="text-xs">Model calls so far cost {formatCost(generation.costUsd)}.</p> : null}
        <div className="mt-3">
          <GenerateButton label="Try again" />
        </div>
      </AlertDescription>
    </Alert>
  );
}
