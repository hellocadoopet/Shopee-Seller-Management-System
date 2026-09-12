"use client";
import { useEffect, useState } from "react";

interface Item {
  item_id: number;
  item_name: string;
  item_sku: string;
  item_status: string;
  has_model: boolean;
  price: number | null;
  stock: number | null;
}

export default function ProductsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // inline price edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    fetch("/api/products")
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((d: { items: Item[] }) => setItems(d.items))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function startEdit(it: Item) {
    setEditingId(it.item_id);
    setEditValue(it.price != null ? String(it.price) : "");
  }

  async function savePrice(it: Item) {
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
        body: JSON.stringify({
          item_id: it.item_id,
          price_list: [{ original_price: newPrice }],
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      setItems((prev) => prev.map((p) => (p.item_id === it.item_id ? { ...p, price: newPrice } : p)));
      setEditingId(null);
    } catch (e) {
      alert("Failed to update price: " + String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Products</h1>
        <button onClick={load} className="px-3 py-1.5 text-sm rounded-md border border-gray-200 hover:bg-gray-50">
          Refresh
        </button>
      </div>

      {loading && <p className="text-gray-500">Loading from Shopee…</p>}
      {error && <p className="text-red-600 text-sm mb-4">Error: {error}</p>}

      {!loading && !error && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
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
                <tr key={it.item_id} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-medium">{it.item_name}</td>
                  <td className="px-4 py-3 text-gray-500">{it.item_sku || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {editingId === it.item_id ? (
                      <input
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-24 border border-gray-300 rounded px-2 py-1 text-right"
                        autoFocus
                      />
                    ) : it.price != null ? (
                      it.price.toFixed(2)
                    ) : it.has_model ? (
                      <span className="text-gray-400" title="Has variants — edit in Seller Center for now">
                        variants
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{it.stock ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">
                      {it.item_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {editingId === it.item_id ? (
                      <>
                        <button
                          onClick={() => savePrice(it)}
                          disabled={saving}
                          className="text-shopee hover:underline mr-3 disabled:opacity-50"
                        >
                          {saving ? "…" : "Save"}
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-gray-400 hover:underline">
                          Cancel
                        </button>
                      </>
                    ) : (
                      !it.has_model && (
                        <button onClick={() => startEdit(it)} className="text-shopee hover:underline">
                          Edit price
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No products.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        Variant products (multiple options) show "variants" — editing each variant price comes later.
        Single products can be edited inline here.
      </p>
    </div>
  );
}
