import { PlannedArea, plannedMetadata } from "@/components/intel/planned-area";

export const metadata = plannedMetadata("experiments");

export default function Page() {
  return <PlannedArea id="experiments" />;
}
