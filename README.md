# Recepción Coca-Cola

Aplicación web móvil-first para importar pedidos de Coca-Cola/Juntos+ desde PDF, revisar el contenido antes de guardarlo, contar mercancía durante la recepción y conservar los pedidos finalizados en historial.

## Flujo

1. **Subir PDF.** La lectura se hace en el navegador con PDF.js.
2. **Vista previa antes de guardar.** Muestra número de pedido, fecha, formato detectado, productos, cantidades y advertencias. Se pueden corregir, eliminar o agregar renglones.
3. **Guardar y recibir.** El pedido se guarda en Supabase mediante el backend de Render.
4. **Conteo.** Los botones `+` y `-` actualizan las unidades recibidas. Hay búsqueda y filtros por categoría, tamaño y estado.
5. **Resumen.** Muestra faltantes y sobrantes.
6. **Vista final.** Antes de cerrar se muestran todos los productos, esperado, recibido y diferencia.
7. **Finalizar.** El pedido pasa al historial y queda en solo lectura.

## Corrección de PDFs de varias páginas

La versión recuperada de ChatGPT Site reiniciaba el estado del parser en cada página en el formato **Impresión Juntos+**. Esta versión aplana las filas de todas las páginas en un único flujo y mantiene el producto actual entre saltos de página. Así, casos como un ID al final de una página y su nombre/cantidad al principio de la siguiente pueden reconstruirse.

Se mantienen tres detectores compatibles con la app recuperada:

- Juntos+ PDF (`Número de pedido` + `ID Producto`)
- Impresión Juntos+ (`Pedidos en curso` / `Detalle del pedido`)
- Nota de entrega (`CVE DESCRIPCION` + `TOTAL ENTREGA`)

## Estructura

```text
recepcion-coca-cola/
├─ frontend/           React + Vite + PDF.js -> Vercel
├─ backend/            Node.js + Express -> Render
├─ supabase/schema.sql PostgreSQL + Storage
├─ render.yaml
└─ README.md
```

## 1. Preparar Supabase

1. Crea/usa un proyecto de Supabase.
2. Abre **SQL Editor**.
3. Ejecuta completo `supabase/schema.sql`.
4. En **Project Settings > API** copia:
   - Project URL
   - `service_role` key (solo para Render; nunca para el frontend).

El SQL también crea el bucket privado `product-images`.

## 2. Probar en tu PC

### Backend

```bash
cd backend
cp .env.example .env
# completa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

### Frontend

En otra terminal:

```bash
cd frontend
npm install
npm run dev
```

En desarrollo no hace falta llenar `VITE_API_URL`: Vite manda `/api` a `http://localhost:3001`.

## 3. Subir backend a Render

Puedes conectar el repositorio y usar `render.yaml`, o crear un Web Service con:

- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`

Variables de entorno:

```text
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY
FRONTEND_URL=https://TU-FRONTEND.vercel.app
```

Cuando Render genere la URL (por ejemplo `https://recepcion-coca-api.onrender.com`), guárdala para Vercel.

## 4. Subir frontend a Vercel

Importa el mismo repositorio y usa:

- Root directory: `frontend`
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`

Variable de entorno:

```text
VITE_API_URL=https://recepcion-coca-api.onrender.com
```

Después vuelve a Render y confirma que `FRONTEND_URL` sea la URL definitiva de Vercel.

## Seguridad

- La `service_role` key vive únicamente en Render.
- El navegador nunca recibe credenciales de Supabase.
- RLS está activado en las tablas.
- PDFs: máximo 12 MB y 25 páginas.
- Fotos: JPG/PNG/WebP, máximo 2 MB.
- Pedidos finalizados no pueden modificar sus conteos mediante la API.

## Nota sobre Render gratis

Si usas un servicio gratuito que entra en reposo, la primera solicitud después de un periodo de inactividad puede tardar más. La app muestra el estado de carga mientras responde.
