interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function ConnectPage({ searchParams }: PageProps) {
  const { error } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 p-8 text-center">
        <h1 className="text-2xl font-semibold mb-2">Connect your Shopee shop</h1>
        <p className="text-sm text-gray-600 mb-6">
          You will be redirected to Shopee to authorize this app to read your shop data and reply
          to chat. You can revoke access anytime in Seller Center.
        </p>
        {/* Plain anchor — server-side redirect handles everything */}
        <a
          href="/api/shopee/authorize"
          className="block w-full py-3 rounded-lg bg-shopee text-white font-medium"
        >
          Authorize with Shopee
        </a>
        {error && (
          <p className="mt-4 text-sm text-red-600 break-words text-left">Error: {error}</p>
        )}
      </div>
    </main>
  );
}
