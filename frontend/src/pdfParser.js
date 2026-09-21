import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerSrc;

const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 25;

function normalizeSpaces(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

export function classifyProduct(name) {
  const clean = normalizeSpaces(name);
  const sizeMatch = clean.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|lt|litros?)\b/i);
  const sizeMl = sizeMatch
    ? Math.round(Number(sizeMatch[1].replace(',', '.')) * (/^m/i.test(sizeMatch[2]) ? 1 : 1000))
    : null;
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

  return { name: clean, category, sizeMl, pack: packMatch ? Number(packMatch[1]) : null };
}

function groupTextItems(items) {
  const rows = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (!item.str?.trim()) continue;
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) < 4.5);
    if (!row) {
      row = { text: '', y: item.y, chunks: [] };
      rows.push(row);
    }
    row.chunks.push(item);
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      row.chunks.sort((a, b) => a.x - b.x);
      row.text = normalizeSpaces(row.chunks.map((chunk) => chunk.str).join(' '));
      return row;
    });
}

function productIdFromRow(row, maxX = 110) {
  const chunk = row.chunks?.find((part) => part.x < maxX && /^\d{3,6}$/.test(part.str.trim()));
  if (chunk) return chunk.str.trim();
  const exact = row.text.match(/^\s*(\d{3,6})\s*$/);
  return exact?.[1] || null;
}

function amountFromX(row, minX = 390, maxX = 445) {
  return row.chunks?.find((part) => part.x > minX && part.x < maxX && /^\d{1,3}$/.test(part.str.trim()))?.str.trim();
}

function textFromX(row, minX, maxX) {
  if (!row.chunks?.length) return row.text;
  return normalizeSpaces(
    row.chunks
      .filter((part) => part.x >= minX && part.x < maxX)
      .map((part) => part.str)
      .join(' '),
  );
}

function flattenPages(pages) {
  return pages.flatMap((rows, pageIndex) =>
    rows.map((row, rowIndex) => ({ ...row, page: pageIndex + 1, rowIndex })),
  );
}

function isPageNoise(text) {
  const value = normalizeSpaces(text);
  return (
    !value ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s/i.test(value) ||
    /^Pedidos$/i.test(value) ||
    /^Buscar$/i.test(value) ||
    /^https?:\/\//i.test(value) ||
    /^\d+\/\d+$/.test(value) ||
    /^¿?Necesitas ayuda/i.test(value) ||
    /^Acerca de Juntos\+/i.test(value) ||
    /^Centro de ayuda$/i.test(value) ||
    /^Aviso de privacidad$/i.test(value) ||
    /^Términos y condiciones$/i.test(value) ||
    /^Política de cookies$/i.test(value) ||
    /^Contáctanos$/i.test(value) ||
    /^Descarga nuestra app$/i.test(value) ||
    /^Cambiar país$/i.test(value) ||
    /^México$/i.test(value) ||
    /^©\s*20\d{2}/i.test(value) ||
    /^800\s*223\s*3672$/i.test(value)
  );
}

function looksLikePrice(text) {
  return /^\$?[\d,.]+$/.test(text.replace(/\s/g, '')) || /^\$[\d,.]+/.test(text);
}

function parseWebPrint(pages) {
  const rows = flattenPages(pages);
  const allText = rows.map((row) => row.text).join('\n');
  const externalId = (allText.match(/Pedido\s*:?\s*(0[\da-f ]{15,})/i)?.[1] || '').replace(/\s/g, '');
  const deliveryDate = allText.match(/Entrega\s*:\s*([^\n]+)/i)?.[1]?.trim() || null;
  const items = [];
  const warnings = [];

  let receivingSectionStarted = false;
  let current = null;

  const commitCurrent = () => {
    if (!current) return;
    if (current.name && Number.isInteger(current.quantity) && current.quantity > 0) {
      items.push({ productId: current.productId, name: current.name, quantity: current.quantity });
    } else {
      warnings.push(`Revisar producto ${current.productId}: no se pudo leer ${!current.name ? 'el nombre' : 'la cantidad'}.`);
    }
    current = null;
  };

  for (const row of rows) {
    const text = normalizeSpaces(row.text);
    if (/\bEntrega\s*:/.test(text)) {
      receivingSectionStarted = true;
      continue;
    }
    if (!receivingSectionStarted) continue;

    if (/^(Métodos de pago|Resumen|Si tienes dudas)/i.test(text)) {
      commitCurrent();
      break;
    }

    const productId = productIdFromRow(row, 90);
    if (productId) {
      commitCurrent();
      current = { productId, name: '', quantity: null };
      continue;
    }
    if (!current || isPageNoise(text)) continue;

    const qty = text.match(/^(\d+)\s+(?:Cajas?|Piezas?)\b/i);
    if (qty) {
      current.quantity = Number(qty[1]);
      if (current.name) commitCurrent();
      continue;
    }

    if (!current.name && !looksLikePrice(text) && !/^Pieza\b/i.test(text)) {
      let candidate = textFromX(row, 35, 430) || text;
      candidate = normalizeSpaces(candidate.replace(/\s+\$[\d,.]+.*$/, ''));
      if (
        candidate &&
        /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(candidate) &&
        !/^(Estatus|Cliente:|Negocio:|Pedido:|Realizado|Entrega:)/i.test(candidate)
      ) {
        current.name = candidate;
        if (current.quantity) commitCurrent();
      }
    }
  }
  commitCurrent();

  if (!externalId) warnings.push('No se encontró el número de pedido.');
  warnings.push('Este diseño no indica cuántos productos contiene: compara la vista previa con el PDF antes de guardar.');

  return {
    externalId,
    source: 'Impresión Juntos+',
    deliveryDate,
    expectedLines: null,
    expectedUnits: null,
    items,
    warnings,
  };
}

function parseJuntosPdf(pages) {
  const rows = flattenPages(pages);
  const allText = rows.map((row) => row.text).join('\n');
  const externalId = allText.match(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/i)?.[0] || '';
  const productsIndex = rows.findIndex((row) => /\bProductos\b/.test(row.text) && !/ID Producto/.test(row.text));
  const expectedLines = productsIndex >= 0 && rows[productsIndex + 1]
    ? Number(textFromX(rows[productsIndex + 1], 295, 340)) || Number(rows[productsIndex + 1].text.match(/^\d+$/)?.[0]) || null
    : null;
  const warnings = [];
  const items = [];

  // This format is table-like. Each row with an ID starts a product. We keep a small
  // rolling buffer so a wrapped description can continue on the next visual row/page.
  let active = false;
  let current = null;
  const commit = () => {
    if (!current) return;
    if (current.name && Number.isInteger(current.quantity) && current.quantity > 0) {
      items.push({ productId: current.productId, name: normalizeSpaces(current.name), quantity: current.quantity });
    } else {
      warnings.push(`Revisar renglón con ID ${current.productId}.`);
    }
    current = null;
  };

  for (const row of rows) {
    if (/ID\s+Producto/i.test(row.text)) {
      active = true;
      continue;
    }
    if (/^Resumen\b/i.test(row.text)) {
      commit();
      active = false;
    }
    if (!active) continue;

    const id = productIdFromRow(row);
    if (id) {
      commit();
      const quantityRaw = amountFromX(row);
      let name = textFromX(row, 108, 310);
      if (!name && row.text) {
        name = normalizeSpaces(row.text.replace(/^\s*\d{3,6}\s+/, '').replace(/\s+Precio por Pieza.*$/i, ''));
      }
      current = {
        productId: id,
        name,
        quantity: quantityRaw ? Number(quantityRaw) : null,
      };
      continue;
    }

    if (!current || isPageNoise(row.text)) continue;
    if (!current.quantity) {
      const columnQty = amountFromX(row);
      const textualQty = row.text.match(/(?:Precio por Pieza\s+)?(\d{1,3})\s+\$?/i)?.[1];
      if (columnQty || textualQty) current.quantity = Number(columnQty || textualQty);
    }
    if (!/Precio por Pieza|^Pieza$/i.test(row.text) && !looksLikePrice(row.text)) {
      const extra = textFromX(row, 108, 310);
      if (extra && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(extra)) current.name = normalizeSpaces(`${current.name} ${extra}`);
    }
  }
  commit();

  if (!externalId) warnings.push('No se encontró el número de pedido.');
  if (expectedLines === null) warnings.push('No se encontró el total de productos del PDF.');
  if (expectedLines !== null && expectedLines !== items.length) {
    warnings.push(`El PDF indica ${expectedLines} productos, pero se leyeron ${items.length}.`);
  }

  const deliveryFragment = allText.includes('Fecha de entrega') ? allText.split('Fecha de entrega')[1].split('\n') : [];
  const firstDeliveryLine = deliveryFragment[0]?.trim() || '';
  const year = firstDeliveryLine.match(/\b20\d{2}\b/)?.[0] || deliveryFragment[1]?.match(/\b20\d{2}\b/)?.[0];
  const deliveryDate = firstDeliveryLine
    ? [firstDeliveryLine, year && !firstDeliveryLine.includes(year) ? year : ''].filter(Boolean).join(' ')
    : null;

  return { externalId, source: 'Juntos+ PDF', deliveryDate, expectedLines, expectedUnits: null, items, warnings };
}

function parseDeliveryNote(pages) {
  const rows = flattenPages(pages);
  const allText = rows.map((row) => row.text).join('\n');
  const externalId = allText.match(/Documento:\s*(\d{10,})/i)?.[1] || '';
  const deliveryDate = allText.match(/ENTREGA:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] || null;
  const expectedUnits = Number(allText.match(/(?:^|\n)(\d+)\/0\s+TOTAL ENTREGA\b/i)?.[1]) || null;
  const warnings = [];
  const provisional = [];
  let active = false;

  for (const row of rows) {
    if (/\bCVE\s+DESCRIPCION/.test(row.text)) {
      active = true;
      continue;
    }
    if (/TOTAL ENTREGA|^PROMOCIONES\b/.test(row.text)) {
      active = false;
      continue;
    }
    if (!active) continue;

    const id = productIdFromRow(row, 75);
    if (id) {
      let name = textFromX(row, 75, 370);
      if (!name) name = normalizeSpaces(row.text.replace(/^\s*\d{3,6}\s+/, ''));
      if (name) provisional.push({ productId: id, name, quantity: 0 });
      continue;
    }

    const quantity = Number(row.text.match(/^(\d+)\/\d+\b/)?.[1]);
    const latest = provisional.at(-1);
    if (latest && latest.quantity === 0 && Number.isInteger(quantity) && quantity > 0) latest.quantity = quantity;
  }

  const items = provisional.filter((item) => item.quantity > 0);
  if (items.length !== provisional.length) warnings.push('Hay productos sin cantidad; revisa la nota.');
  if (!externalId) warnings.push('No se encontró el número de documento.');
  if (expectedUnits === null) warnings.push('No se encontró el total de cajas de entrega.');
  const readUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  if (expectedUnits !== null && readUnits !== expectedUnits) {
    warnings.push(`La nota indica ${expectedUnits} cajas, pero se leyeron ${readUnits}.`);
  }

  return { externalId, source: 'Nota de entrega', deliveryDate, expectedLines: null, expectedUnits, items, warnings };
}

export async function parsePdf(file) {
  if (!file) throw new Error('Selecciona un archivo PDF.');
  if (file.size > MAX_PDF_BYTES) throw new Error('El PDF supera el límite de 12 MB.');

  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  if (pdf.numPages > MAX_PAGES) throw new Error('El PDF tiene demasiadas páginas para un pedido.');

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      groupTextItems(
        content.items
          .filter((item) => 'str' in item && 'transform' in item)
          .map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5] })),
      ),
    );
  }

  const allText = flattenPages(pages).map((row) => row.text).join('\n');
  let parsed = null;
  if (/Número de pedido:/i.test(allText) && /ID\s+Producto/i.test(allText)) parsed = parseJuntosPdf(pages);
  else if (/TOTAL ENTREGA/i.test(allText) && /CVE\s+DESCRIPCION/i.test(allText)) parsed = parseDeliveryNote(pages);
  else if (/Pedidos en curso|Detalle del pedido/i.test(allText)) parsed = parseWebPrint(pages);

  if (!parsed) throw new Error('No reconozco este diseño de PDF. Revisa que sea un pedido de Juntos+ o una nota de entrega.');
  if (!parsed.items.length) throw new Error('No se pudo leer ningún producto del PDF.');

  // Avoid duplicates created by repeated headers or accidental parser overlap.
  const seen = new Set();
  parsed.items = parsed.items.filter((item) => {
    const key = `${item.productId}:${item.name}:${item.quantity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return parsed;
}
