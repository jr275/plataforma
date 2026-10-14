// Lotes dos agentes 02–05 (20–50 itens por chamada): uma falha de lote NÃO derruba os itens bons. O lote que falha é dividido ao meio (bisseção) até isolar o(s) item(ns) que quebram,
// e só estes ficam como falha individual. Cancelamento cooperativo entre chamadas. Os itens ficam na ordem original; o resultado é determinístico.
export type BatchCall<O> = { readonly ok: true; readonly value: O } | { readonly ok: false; readonly error: string };
export interface BatchOutcome<I, O> { readonly calls: number; readonly succeeded: readonly { readonly items: readonly I[]; readonly value: O }[]; readonly failed: readonly { readonly item: I; readonly error: string }[]; readonly cancelled: readonly I[] }
export async function runBatched<I, O>(items: readonly I[], o: { readonly size: number; readonly call: (batch: readonly I[]) => Promise<BatchCall<O>>; readonly isCancelled?: () => boolean }): Promise<BatchOutcome<I, O>> {
  if (!Number.isInteger(o.size) || o.size < 1) throw new Error("tamanho de lote inválido");
  const succeeded: { items: readonly I[]; value: O }[] = []; const failed: { item: I; error: string }[] = []; const cancelled: I[] = []; let calls = 0;
  const run = async (batch: readonly I[]): Promise<void> => {
    if (o.isCancelled?.()) { cancelled.push(...batch); return; }
    calls += 1; const r = await o.call(batch);
    if (r.ok) { succeeded.push({ items: batch, value: r.value }); return; }
    if (batch.length === 1) { failed.push({ item: batch[0]!, error: r.error }); return; }
    const mid = Math.ceil(batch.length / 2); await run(batch.slice(0, mid)); await run(batch.slice(mid));
  };
  for (let i = 0; i < items.length; i += o.size) await run(items.slice(i, i + o.size));
  return { calls, succeeded, failed, cancelled };
}
