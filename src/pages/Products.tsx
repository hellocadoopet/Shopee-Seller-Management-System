import { useState } from "react";
import { useShopParam } from "../lib/shops";
import { useFetch, type ShopList, type Tagged } from "../lib/useFetch";
import { ShopBadge, ShopErrors, useMultiShop } from "../components/Shop";

interface Item {
  id: string;
  name: string;
  sku: string;
  status: string;
  has_variants: boolean;
  price: number | null;
  stock: number | null;
}
type Row = Tagged<Item>;

const LOW_STOCK = 5; // matches the Overview default (LOW_STOCK_THRESHOLD)
const key = (it: Row) => `${it.shop_id}:${it.id}`;

export default function ProductsPage() {
  const [shop] = useShopParam();
  const multi = useMultiShop();
  const { data, error, loading, reload } = useFetch<ShopList<Item>>(`/api/products?shop=${shop}`);

  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Record<string, number>>({}); // optimistic prices after a successful save

  const items = (data?.items ?? [])
    .map((it) => (saved[key(it)] != null ? { ...it, price: saved[key(it)]! } : it))
    .filter((it) => !query || `${it.name} ${it.sku}`.toLowerCase().includes(query.toLowerCase()))
    .filter((it) => !lowOnly || (it.stock != null && it.stock <= LOW_STOCK));

  async function savePrice(it: Row) {
    const newPrice = Number(editValue);
    if (!newPrice || newPrice <= 0) {
      alert("Enter a valid price greater than 0");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // shop_id comes from the row, not the filter — the edit always hits this item's own shop
        body: JSON.stringify({ shop_id: it.shop_id, product_id: it.id, price: newPrice }),
      });
      if (!r.ok) throw new Error(await r.text());
      setSaved((s) => ({ ...s, [key(it)]: newPrice }));
      setEditing(null);
    } catch (e) {
      alert(`Failed to update price on ${it.shop_name}: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold">Products</h1>
        <button onClick={reload} className="px-3 py-1.5 text-sm rounded-md border border-gray-200 hover:bg-gray-50">
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or SKU…"
          className="border border-gray-200 rounded-md px-3 py-1.5 text-sm w-64"
        />
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Low stock only (≤ {LOW_STOCK})
        </label>
      </div>

      <ShopErrors errors={data?.errors} />
      {loading && <p className="text-gray-500">Loading…</p>}
      {error && <p className="text-red-600 text-sm mb-4">Error: {error}</p>}

      {data && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                {multi && <th className="text-left px-4 py-3">Shop</th>}
                <th className="text-left px-4 py-3">Item</th>
                <th className="text-left px-4 py-3">SKU</th>
                <th className="text-right px-4 py-3">Price (RM)</th>
                <th className="text-right px-4 py-3">Stock</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={key(it)} className="border-t border-gray-100">
                  {multi && (
                    <td className="px-4 py-3">
                      <ShopBadge shopId={it.shop_id} name={it.shop_name} />
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium">{it.name}</td>
                  <td className="px-4 py-3 text-gray-500">{it.sku || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {editing === key(it) ? (
                      <input
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-24 border border-gray-300 rounded px-2 py-1 text-right"
                        autoFocus
                      />
                    ) : it.price != null ? (
                      it.price.toFixed(2)
                    ) : it.has_variants ? (
                      <span className="text-gray-400" title="Has variants — edit on the platform for now">
                        variants
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td
                    className={`px-4 py-3 text-right ${
                      it.stock === 0 ? "text-red-600 font-semibold" : it.stock != null && it.stock <= LOW_STOCK ? "text-amber-600 font-semibold" : ""
                    }`}
                  >
                    {it.stock ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">{it.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {editing === key(it) ? (
                      <>
                        <button
                          onClick={() => savePrice(it)}
                          disabled={saving}
                          className="text-shopee hover:underline mr-3 disabled:opacity-50"
                        >
                          {saving ? "…" : "Save"}
                        </button>
                        <button onClick={() => setEditing(null)} className="text-gray-400 hover:underline">
                          Cancel
                        </button>
                      </>
                    ) : (
                      !it.has_variants && (
                        <button
                          onClick={() => {
                            setEditing(key(it));
                            setEditValue(it.price != null ? String(it.price) : "");
                          }}
                          className="text-shopee hover:underline"
                        >
                          Edit price
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={multi ? 7 : 6} className="px-4 py-8 text-center text-gray-400">
                    {query || lowOnly ? "No products match." : "No products."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        {items.length} shown{data ? ` of ${data.items.length}` : ""}. Variant products show "variants" — per-variant
        editing comes later.
      </p>
    </div>
  );
}
