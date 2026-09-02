import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import type { Readiness } from "@/lib/performance/metrics";

const READINESS_LABELS: Record<Readiness, string> = {
  waiting: "Waiting for data",
  "low-confidence": "Low confidence",
  ready: "Ready",
};

export function PerformanceMetricTile({
  title,
  value,
  verdict,
  readiness,
  info,
  explanation,
  detail,
}: {
  title: string;
  value: string;
  verdict: string;
  readiness: Readiness;
  info: string;
  explanation: string;
  detail?: string;
}) {
  return (
    <Card>
      <CardHeader className="gap-2 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <InfoTip>{info}</InfoTip>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{verdict}</Badge>
          <Badge variant="outline">{READINESS_LABELS[readiness]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {detail && <p className="text-muted-foreground text-xs tabular-nums">{detail}</p>}
        <p className="text-muted-foreground text-sm">{explanation}</p>
      </CardContent>
    </Card>
  );
}
