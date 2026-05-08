import { TopBar } from "@/components/layout/TopBar";
import { TodayView } from "@/components/views/TodayView";

export default function TodayPage() {
  return (
    <div className="flex h-full flex-col">
      <TopBar title="Today" queryKeyPrefix={["today"]} />
      <div className="flex-1 overflow-auto p-6">
        <TodayView />
      </div>
    </div>
  );
}
