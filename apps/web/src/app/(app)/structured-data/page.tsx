import { PlannedArea, plannedMetadata } from "@/components/intel/planned-area";

export const metadata = plannedMetadata("structured-data");

export default function Page() {
  return <PlannedArea id="structured-data" />;
}
