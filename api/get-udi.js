/**
 * api/get-udi.js — Serverless function: proxy seguro a Banxico SIE API
 *
 * Seguridad implementada:
 *  - CORS restringido al dominio de producción + localhost para dev
 *  - Solo se permite GET (OPTIONS para preflight)
 *  - Timeout de 8 s al fetch externo
 *  - Errores limpios: sin stack traces ni URLs internas en producción
 *  - Cache-Control para que Vercel CDN cachee la respuesta 6 horas
 *
 * Caché CDN (s-maxage=21600):
 *  La primera llamada del día consulta Banxico. Las siguientes 6 h
 *  Vercel responde desde su edge sin volver a llamar a Banxico.
 *  stale-while-revalidate=86400 sirve el dato anterior mientras revalida.
 */

const ALLOWED_ORIGINS = [
  'https://calculadoraudis.com',
  'https://www.calculadoraudis.com',
  'https://calculadora-udis.vercel.app',
];

function getAllowedOrigin(reqOrigin) {
  if (!reqOrigin) return ALLOWED_ORIGINS[0]; // peticiones server-side / curl
  if (process.env.NODE_ENV !== 'production') return reqOrigin; // dev: permisivo
  return ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : null;
}

export default async function handler(req, res) {
  const origin = getAllowedOrigin(req.headers.origin);

  // CORS
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Solo GET
  if (req.method !== 'GET') {
    res.status(405).json({ success: false, error: 'Method Not Allowed' });
    return;
  }

  // Si no hay token → devolver valor de respaldo (modo offline)
  const token = process.env.BANXICO_TOKEN;
  if (!token) {
    return res.status(200)
      .setHeader('Cache-Control', 'no-store')
      .json({
        success: true,
        data: 8.123456,
        date: new Date().toISOString().split('T')[0],
        source: 'mock',
      });
  }

  try {
    const today      = new Date();
    const tenDaysAgo = new Date(today);
    tenDaysAgo.setDate(today.getDate() - 10);
    const fmt = d => d.toISOString().split('T')[0];

    const url = `https://www.banxico.org.mx/SieAPIRest/service/v1/series/SP68257/datos/${fmt(tenDaysAgo)}/${fmt(today)}`;

    // Timeout de 8 segundos para no dejar la función colgada
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 8000);

    let response;
    try {
      response = await fetch(url, {
        headers: {
          'Bmx-Token': token,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      // Logueamos internamente (visible en Vercel logs) pero no al cliente
      console.error(`[get-udi] Banxico HTTP ${response.status}`);
      return res.status(200).json({
        success: false,
        error: `Banxico devolvió HTTP ${response.status}`,
      });
    }

    const data   = await response.json();
    const series = data?.bmx?.series?.[0];
    const datos  = series?.datos;

    if (!datos || datos.length === 0) {
      console.error('[get-udi] Serie vacía en el rango solicitado');
      return res.status(200).json({
        success: false,
        error: 'No hay datos disponibles en Banxico para el rango solicitado.',
      });
    }

    const ultimo = datos[datos.length - 1];
    const valor  = parseFloat(ultimo.dato);

    if (isNaN(valor) || valor <= 0) {
      return res.status(200).json({ success: false, error: 'Valor recibido inválido.' });
    }

    // Caché CDN de Vercel: 6 horas en edge, hasta 24 h stale-while-revalidate
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');

    return res.status(200).json({
      success: true,
      data:    valor,
      date:    ultimo.fecha,
      source:  'banxico',
    });

  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    console.error(`[get-udi] ${isTimeout ? 'Timeout' : err.message}`);
    return res.status(200).json({
      success: false,
      error: isTimeout
        ? 'La consulta a Banxico tardó demasiado. Intenta de nuevo.'
        : 'Error al consultar Banxico.',
    });
  }
}
