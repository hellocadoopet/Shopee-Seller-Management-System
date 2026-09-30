import { Sparkles } from "lucide-react";
import { PageHeader } from "../components/Page";
import { EmptyState } from "../components/States";

export default function CampaignsPage() {
  return (
    <div>
      <PageHeader title="Campaigns" />
      <EmptyState
        icon={Sparkles}
        title="Not available yet"
        body="Shopee runs campaigns like 5.5 and 11.11, and its API only lets us read them. A list of the campaigns your shops joined is planned."
      />
    </div>
  );
}
