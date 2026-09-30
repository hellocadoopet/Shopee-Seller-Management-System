import { useState } from "react";
import { Package } from "lucide-react";
import { useShopParam } from "../lib/shops";
import { useCapability } from "../lib/capabilities";
import { errorText, useFetch, type ShopList, type Tagged } from "../lib/useFetch";
import { formatMoney, statusTone } from "../lib/format";
import { ShopBadge, ShopErrors, useMultiShop } from "../components/Shop";
import { PageHeader, RefreshButton } from "../components/Page";
import { EmptyState, ErrorNotice, Loading, NeedsCapability } from "../components/States";

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
  const cap = useCapability("catalog");
  const { data, error, loading, reload } = useFetch<ShopList<Item>>(
    cap.ready && cap.supported ? `/api/products?shop=${shop}` : null,
  );

  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, number>>({}); // optimistic prices after a successful save

  const items = (data?.items ?? [])
    .map((it) => (saved[key(it)] != null ? { ...it, price: saved[key(it)]! } : it))
    .filter((it) => !query || `${it.name} ${it.sku}`.toLowerCase().includes(query.toLowerCase()))
    .filter((it) => !lowOnly || (it.stock != null && it.stock <= LOW_STOCK));

  async function savePrice(it: Row) {
    const newPrice = Number(editValue);
    if (!newPrice || newPrice <= 0) {
      setEditError("Enter a price greater than 0");
      return;
    }
    setSaving(true);
    setEditError(null);
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
      setEditError(`Couldn't update the price: ${errorText(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const startEdit = (it: Row) => {
    setEditing(key(it));
    setEditValue(it.price != null ? String(it.price) : "");
    setEditError(null);
  };
  const cancelEdit = () => {
    setEditing(null);
    setEditError(null);
  };

  const header = (
    <PageHeader
      title="Products"
      actions={cap.supported && <RefreshButton onClick={reload} loading={loading && !!data} />}
    />
  );
  if (!cap.ready) return <div>{header}<Loading /></div>;
  if (!cap.supported) return <div>{header}<NeedsCapability what="Products" providers={cap.providers} /></div>;

  const cols = multi ? 7 : 6;

  return (
    <div>
      {header}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or SKU…"
          aria-label="Search products"
          className="input w-full sm:w-64"
        />
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Low stock only (≤ {LOW_STOCK})
        </label>
      </div>

      <ShopErrors errors={data?.errors} />
      {error && <ErrorNotice error={error} onRetry={reload} />}

      {loading && !data ? (
        <Loading />
      ) : data && !data.items.length ? (
        <EmptyState icon={Package} title="No products" body="The shops in view have no listings." />
      ) : data ? (
        <div className="panel relative overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-gray-50">
              <tr>
                {multi && <th className="th">Shop</th>}
                <th className="th">Item</th>
                <th className="th">SKU</th>
                <th className="th text-right">Price</th>
                <th className="th text-right">Stock</th>
                <th className="th">Status</th>
                <th className="th text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const tone = statusTone(it.status);
                const isEditing = editing === key(it);
                return (
                  <tr key={key(it)} className="border-t border-gray-100 align-top">
                    {multi && (
                      <td className="td">
                        <ShopBadge shopId={it.shop_id} name={it.shop_name} />
                      </td>
                    )}
                    <td className="td font-medium">{it.name}</td>
                    <td className="td text-gray-500">{it.sku || "—"}</td>
                    <td className="td text-right tabular-nums whitespace-nowrap">
                      {isEditing ? (
                        <>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void savePrice(it);
                              if (e.key === "Escape") cancelEdit();
                            }}
                            aria-label={`New price for ${it.name}`}
                            className="input w-28 px-2 py-1 text-right"
                            autoFocus
                          />
                          {editError && (
                            <p role="alert" className="text-xs text-red-700 mt-1 whitespace-normal text-left max-w-[12rem] ml-auto">
                              {editError}
                            </p>
                          )}
                        </>
                      ) : it.price != null ? (
                        formatMoney(it.price)
                      ) : it.has_variants ? (
                        <span className="text-gray-500" title="Has variants — edit on the platform for now">
                          variants
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      className={`td text-right tabular-nums ${
                        it.stock === 0
                          ? "text-red-700 font-semibold"
                          : it.stock != null && it.stock <= LOW_STOCK
                            ? "text-amber-700 font-semibold"
                            : ""
                      }`}
                    >
                      {it.stock ?? "—"}
                    </td>
                    <td className="td">
                      <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${tone.className}`}>{tone.label}</span>
                    </td>
                    <td className="td text-right whitespace-nowrap">
                      {isEditing ? (
                        <>
                          <button type="button" onClick={() => void savePrice(it)} disabled={saving} className="link mr-3 disabled:opacity-50">
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button type="button" onClick={cancelEdit} className="text-gray-500 hover:underline">
                            Cancel
                          </button>
                        </>
                      ) : (
                        !it.has_variants && (
                          <button type="button" onClick={() => startEdit(it)} className="link">
                            Edit price
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
              {!items.length && (
                <tr>
                  <td colSpan={cols} className="td text-center text-gray-500 py-8">
                    No products match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.items.length > 0 && (
        <p className="text-xs text-gray-500 mt-4">
          {items.length} shown of {data.items.length}. Variant products show "variants" — per-variant editing comes later.
        </p>
      )}
    </div>
  );
}
