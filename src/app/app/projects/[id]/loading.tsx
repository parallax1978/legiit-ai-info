import { Skeleton } from "@/components/ui/skeleton";

/** Skeletons in the shape of the project page while the data loads. */
export default function ProjectLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading the project">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-64 max-w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-40 rounded-full" />
          <Skeleton className="h-8 w-40 rounded-full" />
        </div>
      </div>

      <div className="lg:flex lg:items-start lg:gap-8">
        <div className="space-y-4 lg:w-64 lg:shrink-0">
          <div className="rounded-card border border-line bg-white p-4 shadow-card">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-16" />
            <Skeleton className="mt-3 h-1 w-full" />
            <Skeleton className="mt-3 h-4 w-full" />
          </div>
          <div className="hidden space-y-2 lg:block">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
        <div className="mt-6 flex-1 space-y-4 lg:mt-0">
          <Skeleton className="h-6 w-40" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-card border border-line bg-white p-5 shadow-card">
              <div className="flex justify-between gap-3">
                <Skeleton className="h-5 w-48 max-w-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="mt-4 h-4 w-3/4" />
              <Skeleton className="mt-2 h-4 w-1/2" />
              <Skeleton className="mt-5 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
