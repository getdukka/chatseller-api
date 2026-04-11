// src/routes/shopify.ts
// Phase 11 — App Shopify officielle
//
// Flow OAuth complet :
//   1. GET  /shopify/oauth/start?shop=xxx.myshopify.com&shopId=<uuid>
//      → redirige vers Shopify pour autorisation
//   2. GET  /shopify/oauth/callback?code=xxx&shop=xxx&state=xxx&hmac=xxx
//      → échange le code contre un access_token permanent
//      → installe le widget via Script Tags API
//      → redirige vers le dashboard avec ?shopify=connected
//
// Anciens endpoints (install manuel via token) conservés pour compatibilité.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { supabaseServiceClient } from '../lib/supabase';

// ─── Configuration ────────────────────────────────────────────────────────────
const SHOPIFY_CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID     || '';
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || '';
const WIDGET_CDN_URL        = process.env.WIDGET_CDN_URL        || 'https://widget.chatseller.app/embed.js';
const DASHBOARD_URL         = process.env.DASHBOARD_URL         || 'https://dashboard.chatseller.app';
const API_BASE_URL          = process.env.APP_URL               || 'https://chatseller-api-production.up.railway.app';

// Scopes demandés à Shopify
const SHOPIFY_SCOPES = 'write_script_tags,read_script_tags,read_products,write_orders';

// Store en mémoire des nonces OAuth (state parameter)
// Durée de vie : 10 minutes — suffisant pour le flow OAuth
const oauthNonces = new Map<string, { shopId: string; createdAt: number }>();

// Nettoyage des nonces expirés toutes les 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [nonce, data] of oauthNonces.entries()) {
    if (now - data.createdAt > 10 * 60 * 1000) oauthNonces.delete(nonce);
  }
}, 5 * 60 * 1000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeShopHost(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
}

// Valide que le shop est bien un domaine myshopify.com ou un domaine custom valide
function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop);
}

// Vérifie la signature HMAC envoyée par Shopify sur le callback
function verifyShopifyHmac(query: Record<string, string>): boolean {
  if (!SHOPIFY_CLIENT_SECRET) return false;

  const { hmac, ...rest } = query;
  if (!hmac) return false;

  // Construire la chaîne à signer : paramètres triés alphabétiquement, joints par &
  const message = Object.keys(rest)
    .sort()
    .map(k => `${k}=${rest[k]}`)
    .join('&');

  const expected = createHmac('sha256', SHOPIFY_CLIENT_SECRET)
    .update(message)
    .digest('hex');

  try {
    return timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// Installe le widget via Script Tags API
async function installScriptTag(shopHost: string, accessToken: string): Promise<number | null> {
  // Vérifier si déjà installé
  const listRes = await fetch(
    `https://${shopHost}/admin/api/2024-01/script_tags.json?src=${encodeURIComponent(WIDGET_CDN_URL)}`,
    { headers: { 'X-Shopify-Access-Token': accessToken } }
  );
  if (listRes.ok) {
    const listData = await listRes.json() as { script_tags: any[] };
    if (listData.script_tags?.length > 0) {
      console.log(`✅ [SHOPIFY] Widget déjà présent (id: ${listData.script_tags[0].id})`);
      return listData.script_tags[0].id;
    }
  }

  // Créer le script tag
  const createRes = await fetch(
    `https://${shopHost}/admin/api/2024-01/script_tags.json`,
    {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ script_tag: { event: 'onload', src: WIDGET_CDN_URL } })
    }
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Script tag creation failed (${createRes.status}): ${err}`);
  }

  const created = await createRes.json() as { script_tag: any };
  console.log(`✅ [SHOPIFY] Script tag créé (id: ${created.script_tag?.id})`);
  return created.script_tag?.id || null;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export default async function shopifyRoutes(fastify: FastifyInstance) {

  // ───────────────────────────────────────────────────────────────
  // GET /shopify/oauth/start
  // Démarre le flow OAuth — redirige vers la page d'autorisation Shopify
  // Params query : shop (ex: monstore.myshopify.com), shopId (UUID ChatSeller)
  // ───────────────────────────────────────────────────────────────
  fastify.get('/oauth/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const { shop, shopId } = request.query as Record<string, string>;

    if (!shop || !shopId) {
      return reply.status(400).send({ error: 'Paramètres shop et shopId requis' });
    }

    const shopHost = normalizeShopHost(shop);

    if (!isValidShopDomain(shopHost)) {
      return reply.status(400).send({ error: 'Domaine Shopify invalide. Format attendu : monstore.myshopify.com' });
    }

    if (!SHOPIFY_CLIENT_ID) {
      return reply.status(500).send({ error: 'SHOPIFY_CLIENT_ID non configuré' });
    }

    // Générer un nonce aléatoire (state) pour protéger contre CSRF
    const nonce = randomBytes(16).toString('hex');
    oauthNonces.set(nonce, { shopId, createdAt: Date.now() });

    const redirectUri = `${API_BASE_URL}/api/v1/shopify/oauth/callback`;
    const authUrl = `https://${shopHost}/admin/oauth/authorize?` + new URLSearchParams({
      client_id:    SHOPIFY_CLIENT_ID,
      scope:        SHOPIFY_SCOPES,
      redirect_uri: redirectUri,
      state:        nonce
    }).toString();

    console.log(`🔐 [SHOPIFY OAUTH] Démarrage pour shop: ${shopHost}, shopId: ${shopId}`);
    return reply.redirect(authUrl);
  });

  // ───────────────────────────────────────────────────────────────
  // GET /shopify/oauth/callback
  // Callback Shopify après autorisation de la marque
  // ───────────────────────────────────────────────────────────────
  fastify.get('/oauth/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const { code, shop, state, hmac } = query;

    console.log(`🔐 [SHOPIFY CALLBACK] shop: ${shop}, state: ${state}`);

    // 1. Vérifier HMAC (signature Shopify)
    if (!verifyShopifyHmac(query)) {
      console.error('❌ [SHOPIFY CALLBACK] HMAC invalide');
      return reply.redirect(`${DASHBOARD_URL}/agent-ia?shopify=error&reason=hmac`);
    }

    // 2. Vérifier le nonce (state) — protection CSRF
    const nonceData = oauthNonces.get(state);
    if (!nonceData) {
      console.error('❌ [SHOPIFY CALLBACK] Nonce invalide ou expiré');
      return reply.redirect(`${DASHBOARD_URL}/agent-ia?shopify=error&reason=state`);
    }
    oauthNonces.delete(state); // Nonce à usage unique

    const { shopId } = nonceData;
    const shopHost = normalizeShopHost(shop);

    // 3. Échanger le code contre un access_token permanent
    let accessToken: string;
    try {
      const tokenRes = await fetch(`https://${shopHost}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:     SHOPIFY_CLIENT_ID,
          client_secret: SHOPIFY_CLIENT_SECRET,
          code
        })
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        throw new Error(`Token exchange failed (${tokenRes.status}): ${err}`);
      }

      const tokenData = await tokenRes.json() as { access_token: string };
      accessToken = tokenData.access_token;
      console.log(`✅ [SHOPIFY CALLBACK] Access token obtenu pour ${shopHost}`);
    } catch (error: any) {
      console.error('❌ [SHOPIFY CALLBACK] Erreur token exchange:', error.message);
      return reply.redirect(`${DASHBOARD_URL}/agent-ia?shopify=error&reason=token`);
    }

    // 4. Installer le widget automatiquement
    let scriptTagId: number | null = null;
    try {
      scriptTagId = await installScriptTag(shopHost, accessToken);
    } catch (error: any) {
      console.error('⚠️ [SHOPIFY CALLBACK] Erreur installation widget:', error.message);
      // On continue — l'access token est précieux même si le script tag échoue
    }

    // 5. Sauvegarder le token et les infos Shopify dans la table shops
    try {
      await supabaseServiceClient
        .from('shops')
        .update({
          shopify_access_token:  accessToken,
          shopify_admin_url:     shopHost,
          shopify_script_tag_id: scriptTagId ? String(scriptTagId) : null,
          shopify_connected_at:  new Date().toISOString(),
          updated_at:            new Date().toISOString()
        })
        .eq('id', shopId);

      console.log(`✅ [SHOPIFY CALLBACK] Données sauvegardées pour shopId: ${shopId}`);
    } catch (error: any) {
      console.error('❌ [SHOPIFY CALLBACK] Erreur sauvegarde DB:', error.message);
    }

    // 6. Rediriger vers le dashboard avec succès
    const successUrl = `${DASHBOARD_URL}/agent-ia?shopify=connected&shop=${encodeURIComponent(shopHost)}`;
    return reply.redirect(successUrl);
  });

  // ───────────────────────────────────────────────────────────────
  // GET /shopify/connection-status
  // Vérifie si la boutique ChatSeller est connectée à Shopify via OAuth
  // ───────────────────────────────────────────────────────────────
  fastify.get('/connection-status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { shopId } = request.query as Record<string, string>;
    if (!shopId) return reply.status(400).send({ error: 'shopId requis' });

    const { data: shop } = await supabaseServiceClient
      .from('shops')
      .select('shopify_admin_url, shopify_connected_at, shopify_script_tag_id, shopify_access_token')
      .eq('id', shopId)
      .single();

    return reply.send({
      success: true,
      isConnected: !!(shop?.shopify_access_token || shop?.shopify_connected_at),
      shopHost:    shop?.shopify_admin_url || null,
      connectedAt: shop?.shopify_connected_at || null,
      widgetInstalled: !!shop?.shopify_script_tag_id
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /shopify/install-widget  (conservé — installation manuelle via token)
  // ───────────────────────────────────────────────────────────────
  fastify.post('/install-widget', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validated = z.object({
        shopifyAdminUrl: z.string().min(1),
        accessToken:     z.string().min(1),
        shopId:          z.string().uuid()
      }).parse(request.body);

      const shopHost = normalizeShopHost(validated.shopifyAdminUrl);
      console.log(`🛍️ [SHOPIFY INSTALL] Boutique: ${shopHost}`);

      const scriptTagId = await installScriptTag(shopHost, validated.accessToken);

      await supabaseServiceClient
        .from('shops')
        .update({
          shopify_script_tag_id: scriptTagId ? String(scriptTagId) : null,
          shopify_admin_url:     shopHost,
          updated_at:            new Date().toISOString()
        })
        .eq('id', validated.shopId);

      return reply.send({
        success: true,
        message: `Widget installé avec succès sur ${shopHost} !`,
        scriptTagId
      });

    } catch (error: any) {
      console.error('❌ [SHOPIFY INSTALL] Erreur:', error);
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ success: false, error: 'Paramètres invalides' });
      }
      if (error.status === 401 || error.status === 403 || error.message?.includes('401') || error.message?.includes('403')) {
        return reply.status(400).send({ success: false, error: 'Token invalide ou permission write_script_tags manquante.' });
      }
      return reply.status(500).send({ success: false, error: error.message || 'Erreur installation' });
    }
  });

  // ───────────────────────────────────────────────────────────────
  // POST /shopify/uninstall-widget
  // ───────────────────────────────────────────────────────────────
  fastify.post('/uninstall-widget', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { shopifyAdminUrl, accessToken } = z.object({
        shopifyAdminUrl: z.string().min(1),
        accessToken:     z.string().min(1)
      }).parse(request.body);

      const shopHost = normalizeShopHost(shopifyAdminUrl);

      const listRes = await fetch(
        `https://${shopHost}/admin/api/2024-01/script_tags.json?src=${encodeURIComponent(WIDGET_CDN_URL)}`,
        { headers: { 'X-Shopify-Access-Token': accessToken } }
      );
      const listData = await listRes.json() as { script_tags: any[] };
      const tags = listData.script_tags || [];

      if (tags.length === 0) {
        return reply.send({ success: true, message: 'Aucun widget à désinstaller.' });
      }

      await Promise.all(tags.map(tag =>
        fetch(`https://${shopHost}/admin/api/2024-01/script_tags/${tag.id}.json`, {
          method: 'DELETE',
          headers: { 'X-Shopify-Access-Token': accessToken }
        })
      ));

      return reply.send({ success: true, message: `Widget désinstallé de ${shopHost}.` });

    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ───────────────────────────────────────────────────────────────
  // POST /shopify/check-install
  // ───────────────────────────────────────────────────────────────
  fastify.post('/check-install', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { shopifyAdminUrl, accessToken } = z.object({
        shopifyAdminUrl: z.string().min(1),
        accessToken:     z.string().min(1)
      }).parse(request.body);

      const shopHost = normalizeShopHost(shopifyAdminUrl);
      const res = await fetch(
        `https://${shopHost}/admin/api/2024-01/script_tags.json?src=${encodeURIComponent(WIDGET_CDN_URL)}`,
        { headers: { 'X-Shopify-Access-Token': accessToken } }
      );
      const data = await res.json() as { script_tags: any[] };
      const tags = data.script_tags || [];

      return reply.send({
        success: true,
        isInstalled: tags.length > 0,
        scriptTagId: tags[0]?.id || null
      });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ───────────────────────────────────────────────────────────────
  // POST /shopify/app/uninstalled  (webhook Shopify)
  // Déclenché quand la marque désinstalle l'app depuis son admin Shopify
  // ───────────────────────────────────────────────────────────────
  fastify.post('/app/uninstalled', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Vérifier la signature HMAC du webhook
      const hmacHeader = request.headers['x-shopify-hmac-sha256'] as string;
      const rawBody = JSON.stringify(request.body);

      if (SHOPIFY_CLIENT_SECRET && hmacHeader) {
        const expected = createHmac('sha256', SHOPIFY_CLIENT_SECRET)
          .update(rawBody)
          .digest('base64');
        if (expected !== hmacHeader) {
          return reply.status(401).send({ error: 'HMAC invalide' });
        }
      }

      const { domain } = request.body as { domain: string };
      console.log(`🗑️ [SHOPIFY WEBHOOK] App désinstallée pour: ${domain}`);

      // Nettoyer les données Shopify dans la table shops
      await supabaseServiceClient
        .from('shops')
        .update({
          shopify_access_token:  null,
          shopify_script_tag_id: null,
          shopify_connected_at:  null,
          updated_at:            new Date().toISOString()
        })
        .eq('shopify_admin_url', domain);

      return reply.status(200).send({ ok: true });

    } catch (error: any) {
      console.error('❌ [SHOPIFY WEBHOOK] Erreur:', error);
      return reply.status(500).send({ error: error.message });
    }
  });
}
