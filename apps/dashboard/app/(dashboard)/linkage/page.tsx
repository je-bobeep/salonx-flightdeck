import { TopBar } from "@/components/layout/TopBar";
import { LinkageView } from "@/components/views/LinkageView";

export default function LinkagePage() {
  return (
    <div className="flex h-full flex-col">
      <TopBar title="Linkage / Coverage" queryKeyPrefix={["linkage"]} />
      <div className="flex-1 overflow-auto p-6">
        <LinkageView />
      </div>
    </div>
  );
}
