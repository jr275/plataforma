import { PlannedArea, plannedMetadata } from "@/components/intel/planned-area";

export const metadata = plannedMetadata("learning");

export default function Page() {
  return <PlannedArea id="learning" />;
}
