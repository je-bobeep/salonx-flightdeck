import { TopBar } from "@/components/layout/TopBar";
import { TriageView } from "@/components/views/TriageView";

export default function TriagePage() {
  return (
    <div className="flex h-full flex-col">
      <TopBar title="Triage Queue" queryKeyPrefix={["triage"]} />
      <div className="flex-1 overflow-auto p-6">
        <TriageView />
      </div>
    </div>
  );
}
