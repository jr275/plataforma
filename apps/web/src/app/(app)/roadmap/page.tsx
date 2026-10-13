import { PlannedArea, plannedMetadata } from "@/components/intel/planned-area";

export const metadata = plannedMetadata("roadmap");

export default function Page() {
  return <PlannedArea id="roadmap" />;
}
