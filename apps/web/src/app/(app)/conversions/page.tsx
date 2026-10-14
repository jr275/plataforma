import { PlannedArea, plannedMetadata } from "@/components/intel/planned-area";

export const metadata = plannedMetadata("conversions");

export default function Page() {
  return <PlannedArea id="conversions" />;
}
