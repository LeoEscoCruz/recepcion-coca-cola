import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const PORT = Number(process.env.PORT || 3001);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const IMAGE_BUCKET = 'product-images';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: FRONTEND_URL.split(',').map((value) => value.trim()), methods: ['GET', 'POST', 'PATCH', 'PUT', 'OPTIONS'] }));
app.use('/api', express.json({ limit: '1mb' }));

function cleanString(value, max = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function classifyProduct(name) {
  const clean = cleanString(name);
  const sizeMatch = clean.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|lt|litros?)\b/i);
  const sizeMl = sizeMatch ? Math.round(Number(sizeMatch[1].replace(',', '.')) * (/^m/i.test(sizeMatch[2]) ? 1 : 1000)) : null;
  const packMatch = clean.match(/\b(\d+)\s*(?:pack|pk)\b/i);
  const lower = clean.toLowerCase();
  let category = 'Otros';
  if (/coca[ -]?cola|\bcc[oz]?\b/.test(lower)) category = 'Coca-Cola';
  else if (/ciel|topo chico/.test(lower)) category = 'Agua';
  else if (/powerade/.test(lower)) category = 'Powerade';
  else if (/leche|lechita|santa clara/.test(lower)) category = 'Leche';
  else if (/predator|monster|burn/.test(lower)) category = 'Energéticas';
  else if (/valle|frut|generosa|minibrick/.test(lower)) category = 'Jugos';
  else if (/fuze/.test(lower)) category = 'Té';
  else if (/fresca|fanta|sprite|escuis|sidral|delaware/.test(lower)) category = 'Sabores';
  return { name: clean, category, size_ml: sizeMl, pack: packMatch ? Number(packMatch[1]) : null };
}

function mapOrder(row) {
  return {
    id: row.id,
    externalId: row.external_id,
    source: row.source,
    deliveryDate: row.delivery_date,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
function mapItem(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    originalName: row.original_name,
    expected: row.expected,
    received: row.received,
  };
}
function mapProduct(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    sizeMl: row.size_ml,
    pack: row.pack,
    imageKey: row.image_key,
  };
}

async function getOrderStatus(orderId) {
  const { data, error } = await supabase.from('orders').select('status').eq('id', orderId).single();
  if (error) throw error;
  return data.status;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/state', async (_req, res) => {
  try {
    const [{ data: orders, error: orderError }, { data: items, error: itemError }, { data: products, error: productError }] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('order_items').select('*'),
      supabase.from('products').select('*'),
    ]);
    if (orderError) throw orderError;
    if (itemError) throw itemError;
    if (productError) throw productError;
    res.json({ orders: orders.map(mapOrder), items: items.map(mapItem), products: products.map(mapProduct) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo cargar la información.' });
  }
});

app.post('/api/orders', async (req, res) => {
  const payload = req.body || {};
  const externalId = cleanString(payload.externalId, 100);
  const source = cleanString(payload.source, 80);
  const deliveryDate = payload.deliveryDate ? cleanString(payload.deliveryDate, 120) : null;
  const items = Array.isArray(payload.items) ? payload.items : [];

  if (!externalId || !source || !items.length) return res.status(400).json({ error: 'El pedido importado está incompleto.' });
  if (!items.every((item) => /^\d{3,6}$/.test(String(item.productId)) && cleanString(item.name) && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0)) {
    return res.status(400).json({ error: 'Hay productos con ID, nombre o cantidad inválidos.' });
  }

  try {
    const { data: existing, error: existingError } = await supabase.from('orders').select('id').eq('external_id', externalId).maybeSingle();
    if (existingError) throw existingError;
    if (existing) return res.json({ orderId: existing.id, alreadyExists: true });

    const { data: order, error: orderError } = await supabase.from('orders').insert({ external_id: externalId, source, delivery_date: deliveryDate, status: 'in_progress' }).select('id').single();
    if (orderError) throw orderError;

    try {
      const products = items.map((item) => ({ id: String(item.productId), ...classifyProduct(item.name) }));
      const { error: productError } = await supabase.from('products').upsert(products, { onConflict: 'id' });
      if (productError) throw productError;

      const orderItems = items.map((item) => ({
        order_id: order.id,
        product_id: String(item.productId),
        original_name: cleanString(item.name),
        expected: Number(item.quantity),
        received: 0,
      }));
      const { error: itemError } = await supabase.from('order_items').insert(orderItems);
      if (itemError) throw itemError;
      return res.status(201).json({ orderId: order.id, alreadyExists: false });
    } catch (error) {
      await supabase.from('orders').delete().eq('id', order.id);
      throw error;
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo guardar el pedido.' });
  }
});

app.patch('/api/items/:id', async (req, res) => {
  const received = Number(req.body?.received);
  if (!Number.isInteger(received) || received < 0 || received > 9999) return res.status(400).json({ error: 'Cantidad recibida inválida.' });
  try {
    const { data: item, error: itemError } = await supabase.from('order_items').select('order_id').eq('id', req.params.id).single();
    if (itemError) throw itemError;
    if (await getOrderStatus(item.order_id) === 'completed') return res.status(409).json({ error: 'El pedido ya está finalizado y no puede modificarse.' });
    const { error } = await supabase.from('order_items').update({ received }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo actualizar el conteo.' });
  }
});

app.patch('/api/orders/:id/complete', async (req, res) => {
  try {
    const { data: order, error: readError } = await supabase.from('orders').select('id,status').eq('id', req.params.id).single();
    if (readError) throw readError;
    if (order.status === 'completed') return res.json({ ok: true, alreadyCompleted: true });
    const { error } = await supabase.from('orders').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo finalizar el pedido.' });
  }
});

app.put('/api/products/:id/image', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Imagen inválida.' });
  const extension = req.headers['content-type'] === 'image/png' ? 'png' : req.headers['content-type'] === 'image/webp' ? 'webp' : 'jpg';
  const path = `${req.params.id}.${extension}`;
  try {
    const { error: uploadError } = await supabase.storage.from(IMAGE_BUCKET).upload(path, req.body, { contentType: req.headers['content-type'], upsert: true });
    if (uploadError) throw uploadError;
    const imageKey = `${path}:${Date.now()}`;
    const { error: updateError } = await supabase.from('products').update({ image_key: imageKey }).eq('id', req.params.id);
    if (updateError) throw updateError;
    res.json({ ok: true, imageKey });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo guardar la foto. Verifica el bucket product-images en Supabase.' });
  }
});

app.get('/api/products/:id/image', async (req, res) => {
  try {
    const { data: product, error: productError } = await supabase.from('products').select('image_key').eq('id', req.params.id).single();
    if (productError || !product?.image_key) return res.status(404).end();
    const path = product.image_key.split(':')[0];
    const { data, error } = await supabase.storage.from(IMAGE_BUCKET).download(path);
    if (error) throw error;
    const arrayBuffer = await data.arrayBuffer();
    res.setHeader('Content-Type', data.type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error(error);
    res.status(404).end();
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

app.listen(PORT, () => console.log(`API de Recepción Coca-Cola escuchando en puerto ${PORT}`));
