import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  FileUp,
  History,
  ImagePlus,
  Minus,
  PackageCheck,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { classifyProduct, parsePdf } from './pdfParser.js';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const apiUrl = (path) => `${API_URL}${path}`;
const EMPTY_STATE = { orders: [], items: [], products: [] };

function formatSize(sizeMl) {
  if (!sizeMl) return '—';
  return sizeMl >= 1000 ? `${Number((sizeMl / 1000).toFixed(2))} L` : `${sizeMl} ml`;
}

function formatDate(deliveryDate, createdAt) {
  if (!deliveryDate) {
    return new Date(createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const long = deliveryDate.match(/(\d{1,2}) de (\w+) de (20\d{2})/i);
  if (long) return `${long[1]} ${long[2].slice(0, 3)} ${long[3]}`;
  const slash = deliveryDate.match(/(\d{2})\/(\d{2})\/(20\d{2})/);
  if (slash) return `${Number(slash[1])}/${Number(slash[2])}/${slash[3]}`;
  return deliveryDate;
}

async function readResponse(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) throw new Error(payload.error || 'No se pudo completar la operación.');
  return payload;
}

function Modal({ open, title, description, onClose, children, wide = false }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={19} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function ProductPicture({ product, onUpload, readOnly }) {
  const inputRef = useRef(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [product.imageKey]);
  const initials = product.name.split(' ').slice(0, 2).join(' ');
  const tone = product.category.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');

  return (
    <div className={`product-picture tone-${tone}`}>
      {product.imageKey && !broken ? (
        <img alt={`Envase de ${product.name}`} src={apiUrl(`/api/products/${product.id}/image?v=${encodeURIComponent(product.imageKey)}`)} onError={() => setBroken(true)} />
      ) : (
        <div className="picture-type"><span>{initials}</span></div>
      )}
      {!readOnly && (
        <>
          <button className="photo-action" type="button" title="Agregar o cambiar foto" aria-label={`Agregar foto de ${product.name}`} onClick={() => inputRef.current?.click()}>
            <ImagePlus size={16} />
          </button>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) onUpload(product.id, file);
              event.currentTarget.value = '';
            }}
          />
        </>
      )}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState(EMPTY_STATE);
  const [activeOrderId, setActiveOrderId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(null);
  const [reviewChecked, setReviewChecked] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeChecked, setFinalizeChecked] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todos');
  const [sizeFilter, setSizeFilter] = useState('Todos');
  const [statusFilter, setStatusFilter] = useState('Pendientes');
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('1');
  const fileInputRef = useRef(null);
  const patchQueue = useRef(new Map());

  async function loadState(preferredOrderId) {
    try {
      const next = await readResponse(await fetch(apiUrl('/api/state'), { cache: 'no-store' }));
      setState(next);
      setActiveOrderId((current) => {
        if (preferredOrderId && next.orders.some((order) => order.id === preferredOrderId)) return preferredOrderId;
        if (current && next.orders.some((order) => order.id === current)) return current;
        return next.orders.find((order) => order.status === 'in_progress')?.id || next.orders[0]?.id || '';
      });
      setMessage('');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadState(); }, []);

  const activeOrder = state.orders.find((order) => order.id === activeOrderId);
  const orderItems = state.items.filter((item) => item.orderId === activeOrderId);
  const productsById = useMemo(() => Object.fromEntries(state.products.map((product) => [product.id, product])), [state.products]);
  const rows = orderItems.map((item) => ({ item, product: productsById[item.productId] || { id: item.productId, ...classifyProduct(item.originalName), imageKey: null } }));
  const categories = ['Todos', ...new Set(rows.map(({ product }) => product.category))];
  const sizes = [...new Set(rows.map(({ product }) => product.sizeMl).filter(Boolean))].sort((a, b) => a - b);
  const totalReceived = orderItems.reduce((sum, item) => sum + item.received, 0);
  const totalExpected = orderItems.reduce((sum, item) => sum + item.expected, 0);
  const completeCount = orderItems.filter((item) => item.received === item.expected).length;
  const readOnly = activeOrder?.status === 'completed';

  const visibleRows = rows.filter(({ item, product }) => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery = !normalizedQuery || `${product.id} ${product.name}`.toLowerCase().includes(normalizedQuery);
    const matchesCategory = category === 'Todos' || product.category === category;
    const matchesSize = sizeFilter === 'Todos' || product.sizeMl === Number(sizeFilter);
    const matchesStatus = statusFilter === 'Todos'
      || (statusFilter === 'Pendientes' && item.received < item.expected)
      || (statusFilter === 'Completos' && item.received >= item.expected);
    return matchesQuery && matchesCategory && matchesSize && matchesStatus;
  });

  const discrepancies = orderItems.filter((item) => item.received !== item.expected);
  const missingBoxes = orderItems.reduce((sum, item) => sum + Math.max(0, item.expected - item.received), 0);
  const extraBoxes = orderItems.reduce((sum, item) => sum + Math.max(0, item.received - item.expected), 0);

  async function handlePdf(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setMessage('');
    setLoading(true);
    try {
      const parsed = await parsePdf(file);
      setPreview(parsed);
      setReviewChecked(false);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function updatePreviewItem(index, field, value) {
    setPreview((current) => {
      if (!current) return current;
      const items = current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return { ...item, [field]: field === 'quantity' ? Number(value) || 0 : value };
      });
      return { ...current, items };
    });
  }

  const previewValid = Boolean(
    preview?.externalId
    && preview.items.length
    && preview.items.every((item) => /^\d{3,6}$/.test(item.productId) && item.name.trim() && Number.isInteger(item.quantity) && item.quantity > 0)
    && (preview.expectedLines === null || preview.items.length === preview.expectedLines)
    && (preview.expectedUnits === null || preview.items.reduce((sum, item) => sum + item.quantity, 0) === preview.expectedUnits),
  );

  async function savePreview() {
    if (!preview || !previewValid || !reviewChecked) return;
    setSaving(true);
    try {
      const result = await readResponse(await fetch(apiUrl('/api/orders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preview),
      }));
      setPreview(null);
      setReviewChecked(false);
      setQuery('');
      setCategory('Todos');
      setSizeFilter('Todos');
      setStatusFilter('Pendientes');
      await loadState(result.orderId);
      if (result.alreadyExists) setMessage('Este pedido ya estaba guardado. Abrimos el registro existente.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  function changeReceived(item, delta) {
    if (readOnly) return;
    const nextReceived = Math.max(0, item.received + delta);
    if (nextReceived === item.received) return;
    setState((current) => ({
      ...current,
      items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, received: nextReceived } : candidate),
    }));

    const request = (patchQueue.current.get(item.id) || Promise.resolve())
      .catch(() => undefined)
      .then(() => readResponse(fetch(apiUrl(`/api/items/${item.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ received: nextReceived }),
      })))
      .catch(async (error) => {
        await loadState(activeOrderId);
        setMessage(`${error.message} Revisa el contador antes de continuar.`);
      });
    patchQueue.current.set(item.id, request);
  }

  async function uploadImage(productId, file) {
    if (file.size > 2 * 1024 * 1024) {
      setMessage('La foto debe pesar menos de 2 MB.');
      return;
    }
    try {
      await readResponse(await fetch(apiUrl(`/api/products/${productId}/image`), { method: 'PUT', headers: { 'Content-Type': file.type }, body: file }));
      await loadState(activeOrderId);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function finalizeOrder() {
    if (!activeOrder || (discrepancies.length > 0 && !finalizeChecked)) return;
    setSaving(true);
    try {
      await Promise.all([...patchQueue.current.values()].map((promise) => promise.catch(() => undefined)));
      await readResponse(await fetch(apiUrl(`/api/orders/${activeOrder.id}/complete`), { method: 'PATCH' }));
      setFinalizeOpen(false);
      setSummaryOpen(false);
      setFinalizeChecked(false);
      await loadState(activeOrder.id);
      setMessage('Pedido finalizado y guardado en el historial.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !state.orders.length) {
    return <div className="loading-screen"><PackageCheck size={34} /><strong>Cargando recepción…</strong></div>;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon"><PackageCheck size={24} strokeWidth={2.4} /></div>
          <div><strong>Recepción</strong><small>COCA-COLA</small></div>
        </div>
        <button className="button primary" type="button" onClick={() => fileInputRef.current?.click()}><FileUp size={18} /> Subir PDF</button>
        <input ref={fileInputRef} className="sr-only" type="file" accept=".pdf,application/pdf" onChange={handlePdf} />
      </header>

      {message && <div className="message"><AlertCircle size={17} /><span>{message}</span><button type="button" onClick={() => setMessage('')}><X size={16} /></button></div>}

      <div className="workspace">
        <aside className="desktop-side">
          <p className="eyebrow">PEDIDOS</p>
          <div className="order-stack">
            {state.orders.map((order) => (
              <button key={order.id} className={`order-link ${activeOrderId === order.id ? 'active' : ''}`} type="button" onClick={() => setActiveOrderId(order.id)}>
                <span className="order-line"><strong>{formatDate(order.deliveryDate, order.createdAt)}</strong>{order.status === 'completed' && <em>Finalizado</em>}</span>
                <span>{order.source} · {order.externalId.slice(0, 13)}…</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="main-area">
          {activeOrder ? (
            <>
              <div className="order-heading">
                <div>
                  <span className="eyebrow">{readOnly ? 'PEDIDO FINALIZADO' : 'PEDIDO EN RECEPCIÓN'}</span>
                  <h1>{formatDate(activeOrder.deliveryDate, activeOrder.createdAt)}</h1>
                  <p>{activeOrder.source} · {activeOrder.externalId}</p>
                </div>
                <div className="heading-actions">
                  <button className="button outline" type="button" onClick={() => setSummaryOpen(true)}>Resumen</button>
                  <label className="mobile-orders-select">
                    <History size={16} />
                    <select value={activeOrderId} onChange={(event) => setActiveOrderId(event.target.value)}>
                      {state.orders.map((order) => <option key={order.id} value={order.id}>{formatDate(order.deliveryDate, order.createdAt)}{order.status === 'completed' ? ' · Finalizado' : ''}</option>)}
                    </select>
                    <ChevronDown size={16} />
                  </label>
                </div>
              </div>

              {readOnly && <div className="completed-banner"><Check size={18} /><span>Este pedido fue finalizado {activeOrder.completedAt ? new Date(activeOrder.completedAt).toLocaleString('es-MX') : ''}. Se conserva en modo de solo lectura.</span></div>}

              <div className="progress-panel">
                <div className="progress-copy">
                  <div><strong>{totalReceived}<span> / {totalExpected}</span></strong><small>unidades registradas</small></div>
                  <div className="progress-right"><strong>{completeCount} / {orderItems.length}</strong><small>productos completos</small></div>
                </div>
                <div className="progress-track"><div style={{ width: `${totalExpected ? Math.min(100, (totalReceived / totalExpected) * 100) : 0}%` }} /></div>
              </div>

              <div className="filters">
                <div className="search"><Search size={19} /><input aria-label="Buscar producto" placeholder="Buscar Coca, Fresca, 2 L, código…" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" aria-label="Borrar búsqueda" onClick={() => setQuery('')}><X size={18} /></button>}</div>
                <div className="filter-label">PRODUCTO</div>
                <div className="chips">{categories.map((value) => <button key={value} className={`chip ${category === value ? 'selected' : ''}`} type="button" onClick={() => setCategory(value)}>{value}</button>)}</div>
                <div className="filter-label">TAMAÑO</div>
                <div className="chips"><button className={`chip ${sizeFilter === 'Todos' ? 'selected' : ''}`} type="button" onClick={() => setSizeFilter('Todos')}>Todos</button>{sizes.map((value) => <button key={value} className={`chip ${String(sizeFilter) === String(value) ? 'selected' : ''}`} type="button" onClick={() => setSizeFilter(String(value))}>{formatSize(value)}</button>)}</div>
                <div className="status-row">{['Pendientes', 'Todos', 'Completos'].map((value) => <button key={value} className={`status ${statusFilter === value ? 'active' : ''}`} type="button" onClick={() => setStatusFilter(value)}>{value}</button>)}<span>{visibleRows.length} producto{visibleRows.length === 1 ? '' : 's'}</span></div>
              </div>

              {visibleRows.length ? (
                <div className="card-grid">
                  {visibleRows.map(({ item, product }) => {
                    const remaining = item.expected - item.received;
                    return (
                      <article key={item.id} className={`product-card ${remaining <= 0 ? 'is-complete' : ''}`}>
                        <ProductPicture product={product} onUpload={uploadImage} readOnly={readOnly} />
                        <div className="product-main">
                          <div className="product-title"><span className="size-number">{formatSize(product.sizeMl)}</span>{remaining <= 0 && <span className="done-tag"><Check size={13} /> Completo</span>}</div>
                          <h2>{product.name.replace(/\s*\d+(?:[.,]\d+)?\s*(?:ml|l|lt)\b/i, '').replace(/\s*\d+\s*(?:Pack|pk)\b/i, '').trim()}</h2>
                          <p>{product.pack ? `Caja × ${product.pack}` : 'Pieza'} <span>·</span> ID {product.id}</p>
                          <div className="card-bottom">
                            <div className="count-copy"><strong>{item.received} <span>/ {item.expected}</span></strong><small>{remaining > 0 ? `Faltan ${remaining}` : remaining < 0 ? `Sobran ${-remaining}` : 'Recibido'}</small></div>
                            {!readOnly && <div className="stepper"><button className="step outline" type="button" aria-label={`Restar una unidad de ${product.name}`} disabled={item.received === 0} onClick={() => changeReceived(item, -1)}><Minus size={22} /></button><button className="step primary" type="button" aria-label={`Sumar una unidad de ${product.name}`} onClick={() => changeReceived(item, 1)}><Plus size={22} /></button></div>}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="no-results"><PackageCheck size={30} /><h2>{statusFilter === 'Pendientes' && !query && category === 'Todos' && sizeFilter === 'Todos' ? 'Todo está contado' : 'No hay productos con estos filtros'}</h2><p>{statusFilter === 'Pendientes' ? 'Cambia a Todos para ver los productos completos.' : 'Prueba otro nombre, tamaño o categoría.'}</p></div>
              )}
            </>
          ) : (
            <div className="welcome"><div className="welcome-icon"><FileUp size={34} /></div><span className="eyebrow">PRIMER PEDIDO</span><h1>Tu lista de recepción empieza con el PDF</h1><p>Sube un pedido de Juntos+ o una nota de entrega. Antes de guardarlo podrás revisar todos los productos y cantidades.</p><button className="button primary large" type="button" onClick={() => fileInputRef.current?.click()}><FileUp size={18} /> Elegir PDF</button><small>La app no guarda nada hasta que confirmes la vista previa.</small></div>
          )}
        </section>
      </div>

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title="Revisar pedido importado" description="Compara esta lista con el PDF antes de guardarla. Puedes corregir, eliminar o agregar renglones." wide>
        {preview && <div className="preview-body">
          <div className="preview-meta"><label>Número de pedido<input value={preview.externalId} onChange={(event) => setPreview({ ...preview, externalId: event.target.value })} /></label><label>Fecha de entrega<input value={preview.deliveryDate || ''} onChange={(event) => setPreview({ ...preview, deliveryDate: event.target.value })} /></label></div>
          <div className="preview-stats"><span><strong>{preview.items.length}</strong> productos leídos</span><span><strong>{preview.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)}</strong> unidades</span><span>{preview.source}</span></div>
          {preview.expectedLines !== null && <p className={preview.items.length === preview.expectedLines ? 'check-line' : 'error-line'}>El PDF indica {preview.expectedLines} productos · Se leyeron {preview.items.length}</p>}
          {preview.expectedUnits !== null && <p className={preview.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) === preview.expectedUnits ? 'check-line' : 'error-line'}>La nota indica {preview.expectedUnits} unidades en total</p>}
          {preview.warnings.map((warning, index) => <p className="preview-warning" key={`${warning}-${index}`}><AlertCircle size={16} /> {warning}</p>)}
          <div className="preview-list">{preview.items.map((item, index) => <div className="preview-item" key={`${item.productId}-${index}`}><input className="preview-id" aria-label="ID del producto" value={item.productId} onChange={(event) => updatePreviewItem(index, 'productId', event.target.value)} /><input className="preview-name" aria-label="Nombre del producto" value={item.name} onChange={(event) => updatePreviewItem(index, 'name', event.target.value)} /><input className="preview-qty" aria-label="Cantidad de unidades" type="number" min="1" value={item.quantity || ''} onChange={(event) => updatePreviewItem(index, 'quantity', event.target.value)} /><button className="remove-row" type="button" aria-label="Quitar renglón" onClick={() => setPreview({ ...preview, items: preview.items.filter((_, itemIndex) => itemIndex !== index) })}><X size={18} /></button></div>)}</div>
          <div className="add-row"><input placeholder="ID" value={newId} onChange={(event) => setNewId(event.target.value)} /><input placeholder="Producto" value={newName} onChange={(event) => setNewName(event.target.value)} /><input type="number" min="1" value={newQty} onChange={(event) => setNewQty(event.target.value)} /><button className="button outline" type="button" disabled={!/^\d{3,6}$/.test(newId) || !newName.trim() || Number(newQty) < 1} onClick={() => { setPreview({ ...preview, items: [...preview.items, { productId: newId, name: newName, quantity: Number(newQty) }] }); setNewId(''); setNewName(''); setNewQty('1'); }}><Plus size={17} /> Agregar</button></div>
          <label className="review-check"><input type="checkbox" checked={reviewChecked} onChange={(event) => setReviewChecked(event.target.checked)} /><span>Comparé los productos y cantidades con el PDF.</span></label>
          {!previewValid && <p className="error-line">Corrige los datos y haz que los totales coincidan antes de guardar.</p>}
          <div className="modal-actions"><button className="button outline" type="button" onClick={() => setPreview(null)}>Cancelar</button><button className="button primary" type="button" disabled={!previewValid || !reviewChecked || saving} onClick={savePreview}>{saving ? 'Guardando…' : 'Guardar y recibir'}</button></div>
        </div>}
      </Modal>

      <Modal open={summaryOpen && Boolean(activeOrder)} onClose={() => setSummaryOpen(false)} title="Resumen del pedido" description={activeOrder ? `${formatDate(activeOrder.deliveryDate, activeOrder.createdAt)} · ${orderItems.length} productos` : ''} wide>
        <div className="summary-totals"><span><strong>{completeCount}</strong> completos</span><span><strong>{missingBoxes}</strong> unidades pendientes</span><span><strong>{extraBoxes}</strong> unidades extra</span></div>
        <div className="summary-list">{discrepancies.map((item) => <div key={item.id}><strong>{formatSize(productsById[item.productId]?.sizeMl)} · {productsById[item.productId]?.name || item.originalName}</strong><span>{item.received} / {item.expected} · {item.received < item.expected ? `Faltan ${item.expected - item.received}` : `Sobran ${item.received - item.expected}`}</span></div>)}{orderItems.length > 0 && discrepancies.length === 0 && <p>Todos los productos coinciden con el pedido.</p>}</div>
        <div className="modal-actions"><button className="button outline" type="button" onClick={() => setSummaryOpen(false)}>Cerrar</button>{!readOnly && <button className="button primary" type="button" onClick={() => { setFinalizeChecked(false); setFinalizeOpen(true); }}>Revisar y finalizar</button>}</div>
      </Modal>

      <Modal open={finalizeOpen && Boolean(activeOrder)} onClose={() => setFinalizeOpen(false)} title="Vista final antes de cerrar" description="Esta es la última comprobación. Al finalizar, el pedido quedará guardado en el historial y pasará a solo lectura." wide>
        <div className="final-review">
          <div className="final-header"><span><strong>{orderItems.length}</strong> productos</span><span><strong>{totalReceived}</strong> recibidas / {totalExpected} esperadas</span></div>
          <div className="final-table"><div className="final-table-head"><span>Producto</span><span>Esperado</span><span>Recibido</span><span>Diferencia</span></div>{rows.map(({ item, product }) => { const difference = item.received - item.expected; return <div className={`final-table-row ${difference !== 0 ? 'has-diff' : ''}`} key={item.id}><span><strong>{product.name}</strong><small>ID {product.id}</small></span><span>{item.expected}</span><span>{item.received}</span><span>{difference === 0 ? <em className="ok-text">Correcto</em> : difference < 0 ? <em>Faltan {-difference}</em> : <em>Sobran {difference}</em>}</span></div>; })}</div>
          {discrepancies.length > 0 ? <><p className="preview-warning"><AlertCircle size={17} /> Hay {discrepancies.length} producto{discrepancies.length === 1 ? '' : 's'} con diferencia. Puedes volver al conteo o finalizar así si la diferencia es real.</p><label className="review-check"><input type="checkbox" checked={finalizeChecked} onChange={(event) => setFinalizeChecked(event.target.checked)} /><span>Revisé las diferencias y quiero finalizar el pedido con estas cantidades.</span></label></> : <p className="check-line"><Check size={16} /> Todo coincide con el pedido.</p>}
          <div className="modal-actions"><button className="button outline" type="button" onClick={() => setFinalizeOpen(false)}>Volver al conteo</button><button className="button primary" type="button" disabled={saving || (discrepancies.length > 0 && !finalizeChecked)} onClick={finalizeOrder}>{saving ? 'Finalizando…' : 'Finalizar pedido'}</button></div>
        </div>
      </Modal>
    </main>
  );
}
