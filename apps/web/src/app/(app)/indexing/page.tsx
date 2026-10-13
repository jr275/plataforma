import { PlannedArea, plannedMetadata } from "@/components/intel/planned-area";

export const metadata = plannedMetadata("indexing");

export default function Page() {
  return <PlannedArea id="indexing" />;
}
