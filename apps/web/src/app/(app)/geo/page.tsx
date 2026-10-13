import { PlannedArea, plannedMetadata } from "@/components/intel/planned-area";

export const metadata = plannedMetadata("geo");

export default function Page() {
  return <PlannedArea id="geo" />;
}
