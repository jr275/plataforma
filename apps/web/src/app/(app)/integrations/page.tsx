import { PlannedArea, plannedMetadata } from "@/components/intel/planned-area";

export const metadata = plannedMetadata("integrations");

export default function Page() {
  return <PlannedArea id="integrations" />;
}
