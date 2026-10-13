import { PlannedArea, plannedMetadata } from "@/components/intel/planned-area";

export const metadata = plannedMetadata("search-gaps");

export default function Page() {
  return <PlannedArea id="search-gaps" />;
}
