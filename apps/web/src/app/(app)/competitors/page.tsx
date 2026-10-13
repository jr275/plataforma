import { PlannedArea, plannedMetadata } from "@/components/intel/planned-area";

export const metadata = plannedMetadata("competitors");

export default function Page() {
  return <PlannedArea id="competitors" />;
}
