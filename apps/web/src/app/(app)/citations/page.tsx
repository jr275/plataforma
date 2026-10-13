import { PlannedArea, plannedMetadata } from "@/components/intel/planned-area";

export const metadata = plannedMetadata("citations");

export default function Page() {
  return <PlannedArea id="citations" />;
}
