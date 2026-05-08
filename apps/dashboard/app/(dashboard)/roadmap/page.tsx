import { TopBar } from "@/components/layout/TopBar";
import { RoadmapView } from "@/components/views/RoadmapView";

export default function RoadmapPage() {
  return (
    <div className="flex h-full flex-col">
      <TopBar title="Roadmap" queryKeyPrefix={["roadmap"]} />
      <div className="flex-1 overflow-auto p-6">
        <RoadmapView />
      </div>
    </div>
  );
}
