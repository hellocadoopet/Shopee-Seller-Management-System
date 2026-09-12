export default function DashboardHome() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Overview</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <p className="text-gray-700">
          Pick a tab on the left to start. Or connect another shop with the link at the bottom of
          the sidebar.
        </p>
        <p className="text-sm text-gray-500 mt-3">
          Tip: switch between shops with the dropdown in the sidebar.
        </p>
      </div>
    </div>
  );
}
