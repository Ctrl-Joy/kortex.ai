import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ProductThumb } from "@/components/status/ProductThumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { EmptyState, ErrorState, Skeleton, Switch, Tooltip } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useProducts } from "@/hooks/queries";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatINR, paiseToRupeeString, parseRupeesToPaise } from "@/lib/format";
import type { Product } from "@/types/api";

/** GS1 check-digit validation mirrors the backend (which re-validates anyway). */
function gs1Valid(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13].includes(code.length)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const schema = z.object({
  sku: z.string().trim().min(2, "SKU is required").regex(/^[A-Za-z0-9\-_]+$/, "Letters, digits, - and _ only"),
  barcode: z.string().trim().refine(gs1Valid, "Enter a valid EAN-13, EAN-8 or UPC-A barcode (check digit verified)"),
  name: z.string().trim().min(2, "Name is required"),
  category: z.string().trim().min(2, "Category is required"),
  price: z.string().refine((v) => (parseRupeesToPaise(v) ?? 0) > 0, "Enter a price above ₹0 (max 2 decimals)"),
  weight_grams: z.string().refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Whole grams above 0"),
  model_class: z.string().trim().max(64),
  image_url: z.string().trim().refine((v) => v === "" || v.startsWith("/") || v.startsWith("https://"), "Local /path or https:// URL"),
  active: z.boolean(),
});

type FormState = z.input<typeof schema>;

const empty: FormState = { sku: "", barcode: "", name: "", category: "", price: "", weight_grams: "", model_class: "", image_url: "", active: true };

function toForm(p: Product): FormState {
  return {
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    category: p.category,
    price: paiseToRupeeString(p.price_paise),
    weight_grams: p.weight_grams ? String(p.weight_grams) : "",
    model_class: p.model_class ?? "",
    image_url: p.image_url ?? "",
    active: p.active,
  };
}

export default function ProductsPage() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const q = useProducts({ q: search || undefined, includeInactive: true });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, SKU, barcode" className="pl-9" aria-label="Search products" />
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => setEditing("new")}>
          <Plus /> Add product
        </Button>
      </div>

      <Card className="overflow-hidden">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : q.data.items.length === 0 ? (
          <EmptyState icon={<Package />} title="No products found" action={<Button onClick={() => setEditing("new")}>Add product</Button>} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH>SKU / barcode</TH>
                <TH>Category</TH>
                <TH className="text-right">Price</TH>
                <TH>Model class</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {q.data.items.map((p) => (
                <TR key={p.id} className={p.active ? "" : "opacity-60"}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <ProductThumb product={p} />
                      <div className="min-w-0">
                        <p className="font-medium">{p.name}</p>
                        <p className="font-mono text-xs text-subtle">{p.id}</p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <p className="font-mono text-[13px]">{p.sku}</p>
                    <p className="font-mono text-xs text-subtle">{p.barcode}</p>
                  </TD>
                  <TD className="text-muted">{p.category}</TD>
                  <TD className="num text-right font-medium">{formatINR(p.price_paise)}</TD>
                  <TD>
                    {p.model_class ? (
                      <Tooltip content="Generic detector class (class-level only — not a SKU identity)">
                        <Badge tone="accent">{p.model_class}</Badge>
                      </Tooltip>
                    ) : (
                      <span className="text-xs text-subtle">SKU model / simulation only</span>
                    )}
                  </TD>
                  <TD>{p.active ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                        <Pencil />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <p className="text-xs text-subtle">
        Product art is illustrative placeholder artwork, not photographs of the actual items. Prices are authoritative: every bill is recalculated from this catalogue.
      </p>

      {editing && <ProductDialog product={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteDialog product={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function ProductDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const [form, setForm] = useState<FormState>(product ? toForm(product) : empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      product ? api.patch<Product>(`/api/products/${product.id}`, body) : api.post<Product>("/api/products", body),
    onSuccess: (p) => {
      toast.success(product ? `Saved ${p.name}` : `Added ${p.name}`);
      qc.invalidateQueries({ queryKey: ["products"] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const field = (e.details.field as string | undefined) ?? (e.details.fields as { field: string }[] | undefined)?.[0]?.field;
        if (field) {
          setErrors({ [field === "price_paise" ? "price" : field]: e.message });
          return;
        }
      }
      toast.error(errorMessage(e));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    const v = parsed.data;
    save.mutate({
      sku: v.sku,
      barcode: v.barcode,
      name: v.name,
      category: v.category,
      price_paise: parseRupeesToPaise(v.price),
      weight_grams: v.weight_grams ? Number(v.weight_grams) : null,
      model_class: v.model_class || null,
      image_url: v.image_url || null,
      active: v.active,
    });
  };

  const bind = (k: keyof FormState) => ({
    id: k,
    value: form[k] as string,
    "aria-invalid": !!errors[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value })),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={product ? `Edit ${product.name}` : "Add product"} description="Barcodes and prices are validated again by the backend." className="max-w-xl">
        <form onSubmit={submit} noValidate>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Product name" htmlFor="name" error={errors.name} className="sm:col-span-2">
              <Input {...bind("name")} placeholder="e.g. Mineral Water 1 L" />
            </Field>
            <Field label="SKU" htmlFor="sku" error={errors.sku}>
              <Input {...bind("sku")} placeholder="BEV-WATER-1L" className="font-mono" />
            </Field>
            <Field label="Barcode" htmlFor="barcode" error={errors.barcode} hint="EAN-13 / EAN-8 / UPC-A">
              <Input {...bind("barcode")} inputMode="numeric" className="font-mono" />
            </Field>
            <Field label="Category" htmlFor="category" error={errors.category}>
              <Input {...bind("category")} placeholder="Beverages" />
            </Field>
            <Field label="Price (₹)" htmlFor="price" error={errors.price} hint="Stored as integer paise">
              <Input {...bind("price")} inputMode="decimal" placeholder="40.00" />
            </Field>
            <Field label="Weight (g)" htmlFor="weight_grams" error={errors.weight_grams} hint="Optional, supporting evidence only">
              <Input {...bind("weight_grams")} inputMode="numeric" />
            </Field>
            <Field label="Detector class" htmlFor="model_class" error={errors.model_class} hint="Optional, e.g. bottle (class-level)">
              <Input {...bind("model_class")} />
            </Field>
            <Field label="Image" htmlFor="image_url" error={errors.image_url} hint="Optional local path, e.g. /products/cola.svg" className="sm:col-span-2">
              <Input {...bind("image_url")} />
            </Field>
            <label className="flex items-center gap-3 sm:col-span-2">
              <Switch checked={form.active} onCheckedChange={(c) => setForm((f) => ({ ...f, active: c }))} />
              <span className="text-[13px]">Active (available to shoppers)</span>
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {product ? "Save changes" : "Add product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.del(`/api/products/${product.id}`),
    onSuccess: () => {
      toast.success(`Deleted ${product.name}`);
      qc.invalidateQueries({ queryKey: ["products"] });
      onClose();
    },
    onError: (e) => toast.error("Cannot delete", { description: errorMessage(e) }),
  });
  const deactivate = useMutation({
    mutationFn: () => api.patch(`/api/products/${product.id}`, { active: false }),
    onSuccess: () => {
      toast.success(`${product.name} deactivated`);
      qc.invalidateQueries({ queryKey: ["products"] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Delete ${product.name}?`} description="Products that appear in shopping history cannot be deleted — deactivate them instead to preserve the audit trail.">
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" loading={deactivate.isPending} onClick={() => deactivate.mutate()}>
            Deactivate instead
          </Button>
          <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
            <Trash2 /> Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
