import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex min-h-dvh flex-col" aria-busy="true" aria-label="Loading tip page">
      <div className="h-36 bg-muted sm:h-44" />
      <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="-mt-14">
          <Skeleton className="size-24 rounded-full ring-4 ring-background" />
          <Skeleton className="mt-4 h-9 w-56" />
          <Skeleton className="mt-2 h-4 w-28" />
          <Skeleton className="mt-4 h-4 w-full max-w-md" />
          <Skeleton className="mt-2 h-4 w-3/4 max-w-sm" />
        </div>
        <div className="space-y-3 lg:mt-6">
          <Skeleton className="h-7 w-40" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-14 rounded-full" />
            <Skeleton className="h-14 rounded-full" />
            <Skeleton className="h-14 rounded-full" />
          </div>
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-full" />
        </div>
      </div>
    </div>
  );
}
