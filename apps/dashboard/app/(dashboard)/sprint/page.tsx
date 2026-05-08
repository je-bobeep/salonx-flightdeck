import { TopBar } from "@/components/layout/TopBar";
import { SprintView } from "@/components/views/SprintView";

export default function SprintPage() {
  return (
    <div className="flex h-full flex-col">
      <TopBar title="This Week / Next Week" queryKeyPrefix={["sprint"]} />
      <div className="flex-1 overflow-auto p-6">
        <SprintView />
      </div>
    </div>
  );
}
