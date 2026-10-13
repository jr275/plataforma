import { PlannedArea, plannedMetadata } from "@/components/intel/planned-area";

export const metadata = plannedMetadata("trends");

export default function Page() {
  return <PlannedArea id="trends" />;
}
