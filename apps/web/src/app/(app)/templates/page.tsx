import { PlannedArea, plannedMetadata } from "@/components/intel/planned-area";

export const metadata = plannedMetadata("templates");

export default function Page() {
  return <PlannedArea id="templates" />;
}
