export default function CampaignsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Campaigns</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <p className="text-gray-700">
          Shopee campaigns (5.5, 6.6, Mega Sales) are run by Shopee. The Open Platform API is
          mostly read-only for campaigns.
        </p>
        <p className="text-sm text-gray-500 mt-3">
          Coming next: list of campaigns your shops joined, items entered, and post-campaign
          performance.
        </p>
      </div>
    </div>
  );
}
