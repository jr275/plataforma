import type { Metadata } from "next";
import { PLANNED_AREAS, type PlannedAreaId } from "@/config/planned-areas";
import { PlannedWorkspace } from "./planned-workspace";
import { AreaRecords } from "./area-records";

export const plannedMetadata = (id: PlannedAreaId): Metadata => ({ title: PLANNED_AREAS[id].title });

export function PlannedArea({ id }: { id: PlannedAreaId }) {
  const a = PLANNED_AREAS[id];
  return (
    <PlannedWorkspace crumbs={a.crumbs} title={a.title} description={a.description} state={a.state} purpose={a.purpose} dependencies={a.dependencies} related={"related" in a ? a.related : undefined}>
      <AreaRecords id={id} />
    </PlannedWorkspace>
  );
}
