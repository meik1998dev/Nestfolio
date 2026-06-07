import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading UI for the dashboard — mirrors the real layout. */
export default function DashboardLoading() {
  return (
    <>
      <PageHeader
        title="Net Worth"
        description="Everything you own, minus what you owe — at a glance."
      />
      <div className="space-y-6">
        <Card>
          <CardHeader className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-12 w-64" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-2 pt-6">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="pt-6">
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-56 w-full" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
