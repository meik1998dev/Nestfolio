import { ChartCardSkeleton, StatCardsSkeleton } from "@/components/skeletons";

export default function PerformanceLoading() {
  return (
    <div className="space-y-6">
      <div className="bg-muted h-8 w-80 animate-pulse rounded" />
      <StatCardsSkeleton />
      <ChartCardSkeleton />
    </div>
  );
}
