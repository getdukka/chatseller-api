// src/routes/shopify.ts
// Shopify auto-install : injecte le widget ChatSeller via Script Tags API
// Pas besoin de modifier theme.liquid manuellement.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabaseServiceClient } from '../lib/supabase';

const WIDGET_CDN_URL = process.env.WIDGET_CDN_URL || 'https://widget.chatseller.app/embed.js';

// ✅ Schéma de validation
const installWidgetSchema = z.object({
  shopifyAdminUrl: z.string().min(1), // ex: mystore.myshopify.com (ou https://...)
  accessToken: z.string().min(1),    // Shopify Admin API access token
  shopId: z.string().uuid()
});

const uninstallWidgetSchema = z.object({
  shopifyAdminUrl: z.string().min(1),
  accessToken: z.string().min(1)
});

// ✅ Normalise l'URL Shopify → hostname uniquement
function normalizeShopifyUrl(url: string): string {
  const cleaned = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  // Si l'utilisateur a mis le chemin complet, on garde juste le host
  return cleaned.split('/')[0];
}

// ✅ Récupère les script tags ChatSeller déjà installés
async function getExistingScriptTags(shopHost: string, token: string): Promise<any[]> {
  const response = await fetch(
    `https://${shopHost}/admin/api/2024-01/script_tags.json?src=${encodeURIComponent(WIDGET_CDN_URL)}`,
    {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${body}`);
  }

  const data = await response.json() as { script_tags: any[] };
  return data.script_tags || [];
}

export default async function shopifyRoutes(fastify: FastifyInstance) {

  // ─────────────────────────────────────────────────────────────
  // POST /shopify/install-widget
  // Installe le widget via Shopify Script Tags API
  // ─────────────────────────────────────────────────────────────
  fastify.post('/install-widget', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validated = installWidgetSchema.parse(request.body);
      const shopHost = normalizeShopifyUrl(validated.shopifyAdminUrl);

      console.log(`🛍️ [SHOPIFY INSTALL] Boutique: ${shopHost}, shopId: ${validated.shopId}`);

      // 1. Vérifier si déjà installé
      const existing = await getExistingScriptTags(shopHost, validated.accessToken);
      if (existing.length > 0) {
        console.log(`✅ [SHOPIFY INSTALL] Widget déjà installé (script_tag id: ${existing[0].id})`);
        return reply.send({
          success: true,
          alreadyInstalled: true,
          message: `Le widget est déjà installé sur ${shopHost}.`,
          scriptTagId: existing[0].id
        });
      }

      // 2. Créer le script tag
      const createResponse = await fetch(
        `https://${shopHost}/admin/api/2024-01/script_tags.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': validated.accessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            script_tag: {
              event: 'onload',
              src: WIDGET_CDN_URL
            }
          })
        }
      );

      if (!createResponse.ok) {
        const errorBody = await createResponse.text();
        console.error(`❌ [SHOPIFY INSTALL] Erreur API Shopify ${createResponse.status}:`, errorBody);

        // Erreur 401/403 = token invalide ou permissions manquantes
        if (createResponse.status === 401 || createResponse.status === 403) {
          return reply.status(400).send({
            success: false,
            error: 'Token Shopify invalide ou permissions insuffisantes. Assurez-vous que le token a la permission "write_script_tags".'
          });
        }

        return reply.status(502).send({
          success: false,
          error: `Shopify a retourné une erreur (${createResponse.status}). Vérifiez l'URL et le token.`
        });
      }

      const created = await createResponse.json() as { script_tag: any };
      console.log(`✅ [SHOPIFY INSTALL] Script tag créé (id: ${created.script_tag?.id})`);

      // 3. Sauvegarder le script_tag_id dans le shop pour pouvoir désinstaller plus tard
      await supabaseServiceClient
        .from('shops')
        .update({
          shopify_script_tag_id: String(created.script_tag?.id),
          shopify_admin_url: shopHost,
          updated_at: new Date().toISOString()
        })
        .eq('id', validated.shopId);

      return reply.send({
        success: true,
        alreadyInstalled: false,
        message: `Widget installé avec succès sur ${shopHost} ! Il apparaîtra sur toutes vos pages boutique.`,
        scriptTagId: created.script_tag?.id
      });

    } catch (error: any) {
      console.error('❌ [SHOPIFY INSTALL] Erreur:', error);

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Paramètres invalides : ' + error.errors.map(e => e.message).join(', ')
        });
      }

      // Erreur réseau vers Shopify (store URL incorrect)
      if (error.cause?.code === 'ENOTFOUND' || error.message?.includes('fetch')) {
        return reply.status(400).send({
          success: false,
          error: `Impossible de contacter la boutique "${error.message?.includes('shopHost') ? '' : 'vérifiez l\'URL'}". Assurez-vous que l'URL est au format : monshop.myshopify.com`
        });
      }

      return reply.status(500).send({
        success: false,
        error: error.message || 'Erreur lors de l\'installation du widget'
      });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // POST /shopify/uninstall-widget
  // Supprime le widget via Shopify Script Tags API
  // ─────────────────────────────────────────────────────────────
  fastify.post('/uninstall-widget', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validated = uninstallWidgetSchema.parse(request.body);
      const shopHost = normalizeShopifyUrl(validated.shopifyAdminUrl);

      console.log(`🗑️ [SHOPIFY UNINSTALL] Boutique: ${shopHost}`);

      const existing = await getExistingScriptTags(shopHost, validated.accessToken);
      if (existing.length === 0) {
        return reply.send({
          success: true,
          message: 'Aucun widget ChatSeller trouvé à désinstaller.'
        });
      }

      // Supprimer tous les script tags ChatSeller trouvés
      await Promise.all(existing.map(tag =>
        fetch(`https://${shopHost}/admin/api/2024-01/script_tags/${tag.id}.json`, {
          method: 'DELETE',
          headers: { 'X-Shopify-Access-Token': validated.accessToken }
        })
      ));

      console.log(`✅ [SHOPIFY UNINSTALL] ${existing.length} script tag(s) supprimé(s)`);

      return reply.send({
        success: true,
        message: `Widget désinstallé de ${shopHost}.`
      });

    } catch (error: any) {
      console.error('❌ [SHOPIFY UNINSTALL] Erreur:', error);
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erreur lors de la désinstallation'
      });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // POST /shopify/check-install
  // Vérifie si le widget est déjà installé
  // ─────────────────────────────────────────────────────────────
  fastify.post('/check-install', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = z.object({
        shopifyAdminUrl: z.string().min(1),
        accessToken: z.string().min(1)
      }).parse(request.body);

      const shopHost = normalizeShopifyUrl(body.shopifyAdminUrl);
      const existing = await getExistingScriptTags(shopHost, body.accessToken);

      return reply.send({
        success: true,
        isInstalled: existing.length > 0,
        scriptTagId: existing[0]?.id || null
      });

    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message
      });
    }
  });
}
