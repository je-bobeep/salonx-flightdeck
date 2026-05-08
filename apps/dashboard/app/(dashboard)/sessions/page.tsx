import { TopBar } from "@/components/layout/TopBar";
import { SessionsView } from "@/components/views/SessionsView";

export default function SessionsPage() {
  return (
    <div className="flex h-full flex-col">
      <TopBar title="Scoping Sessions" queryKeyPrefix={["sessions"]} />
      <div className="flex-1 overflow-auto p-6">
        <SessionsView />
      </div>
    </div>
  );
}
