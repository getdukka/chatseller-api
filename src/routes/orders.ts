// src/routes/orders.ts

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabaseServiceClient } from '../lib/supabase';
import { Resend } from 'resend';

// ✅ INITIALISATION RESEND
const resend = new Resend(process.env.RESEND_API_KEY);

// ✅ HELPER : Envoyer notifications email commande
async function sendOrderEmails(order: any, shopEmail: string, shopName: string) {
  const orderNumber = order.id.slice(-8).toUpperCase();
  const products = Array.isArray(order.product_items) ? order.product_items : [order.product_items];
  const productLines = products.map((p: any) =>
    `<tr><td style="padding:8px;border-bottom:1px solid #f3f4f6">${p.name || p.productName}</td>
     <td style="padding:8px;border-bottom:1px solid #f3f4f6;text-align:center">${p.quantity || 1}</td>
     <td style="padding:8px;border-bottom:1px solid #f3f4f6;text-align:right">${((p.price || p.productPrice || 0) * (p.quantity || 1)).toLocaleString('fr-FR')} FCFA</td></tr>`
  ).join('');

  const promises: Promise<any>[] = [];

  // Email au marchand
  promises.push(
    resend.emails.send({
      from: 'ChatSeller <noreply@chatseller.app>',
      to: shopEmail,
      subject: `🛍️ Nouvelle commande #${orderNumber} — ${order.customer_name}`,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Inter,sans-serif;background:#f9fafb;margin:0;padding:20px">
<div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#8B5CF6,#6D28D9);padding:28px 32px">
    <h1 style="color:white;margin:0;font-size:22px">🛍️ Nouvelle commande !</h1>
    <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px">Commande #${orderNumber} reçue via ChatSeller</p>
  </div>
  <div style="padding:28px 32px">
    <h2 style="font-size:16px;color:#374151;margin:0 0 16px">Informations client</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151">
      <tr><td style="padding:6px 0;color:#6b7280;width:140px">Nom</td><td style="padding:6px 0;font-weight:600">${order.customer_name}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Téléphone</td><td style="padding:6px 0;font-weight:600">${order.customer_phone}</td></tr>
      ${order.customer_address ? `<tr><td style="padding:6px 0;color:#6b7280">Adresse</td><td style="padding:6px 0">${order.customer_address}</td></tr>` : ''}
      <tr><td style="padding:6px 0;color:#6b7280">Paiement</td><td style="padding:6px 0">${order.payment_method}</td></tr>
    </table>
    <h2 style="font-size:16px;color:#374151;margin:24px 0 12px">Produits commandés</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr style="background:#f9fafb">
        <th style="padding:8px;text-align:left;color:#6b7280;font-weight:500">Produit</th>
        <th style="padding:8px;text-align:center;color:#6b7280;font-weight:500">Qté</th>
        <th style="padding:8px;text-align:right;color:#6b7280;font-weight:500">Montant</th>
      </tr></thead>
      <tbody>${productLines}</tbody>
    </table>
    <div style="margin-top:16px;padding:16px;background:#f0fdf4;border-radius:8px;text-align:right">
      <span style="font-size:18px;font-weight:700;color:#059669">Total : ${order.total_amount?.toLocaleString('fr-FR')} FCFA</span>
    </div>
    <div style="margin-top:24px">
      <a href="https://dashboard.chatseller.app/orders" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#8B5CF6,#6D28D9);color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">Voir dans le Dashboard →</a>
    </div>
  </div>
  <div style="padding:16px 32px;background:#f9fafb;text-align:center;font-size:12px;color:#9ca3af">
    ChatSeller — Votre Vendeuse IA 24/7
  </div>
</div></body></html>`
    }).catch(err => console.error('⚠️ Email marchand non envoyé:', err.message))
  );

  // Email de confirmation au client (si email fourni)
  if (order.customer_email) {
    promises.push(
      resend.emails.send({
        from: `${shopName} via ChatSeller <noreply@chatseller.app>`,
        to: order.customer_email,
        subject: `✅ Commande confirmée #${orderNumber} — ${shopName}`,
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Inter,sans-serif;background:#f9fafb;margin:0;padding:20px">
<div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#10b981,#059669);padding:28px 32px">
    <h1 style="color:white;margin:0;font-size:22px">✅ Commande confirmée !</h1>
    <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px">Merci pour votre commande, ${order.customer_name?.split(' ')[0]} !</p>
  </div>
  <div style="padding:28px 32px">
    <p style="color:#374151;font-size:15px;line-height:1.6">Votre commande <strong>#${orderNumber}</strong> a bien été enregistrée. L'équipe de ${shopName} vous contactera au <strong>${order.customer_phone}</strong> pour confirmer les détails de livraison.</p>
    <div style="margin:20px 0;padding:16px;background:#f9fafb;border-radius:8px">
      <p style="margin:0;font-size:14px;color:#6b7280">Montant total</p>
      <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#059669">${order.total_amount?.toLocaleString('fr-FR')} FCFA</p>
    </div>
  </div>
  <div style="padding:16px 32px;background:#f9fafb;text-align:center;font-size:12px;color:#9ca3af">
    Commande passée via ChatSeller • Vendeuse IA 24/7
  </div>
</div></body></html>`
      }).catch(err => console.error('⚠️ Email client non envoyé:', err.message))
    );
  }

  await Promise.allSettled(promises);
  console.log(`📧 Notifications email envoyées pour commande #${orderNumber}`);
}

// ✅ SCHÉMAS DE VALIDATION
const orderStepSchema = z.object({
  conversationId: z.string(),
  step: z.enum(['product', 'quantity', 'name', 'phone', 'address', 'payment', 'confirmation']),
  data: z.record(z.any())
});

const completeOrderSchema = z.object({
  conversationId: z.string(),
  orderData: z.object({
    products: z.array(z.object({
      id: z.string().optional(),
      name: z.string(),
      price: z.number(),
      quantity: z.number(),
      category: z.string().optional(),
      ai_recommended: z.boolean().optional()
    })),
    customer: z.object({
      name: z.string(),
      phone: z.string(),
      email: z.string().optional(),
      address: z.string().optional(),
      profile: z.object({
        beauty_category: z.string().optional(),
        skin_type: z.string().optional(),
        age_range: z.string().optional(),
        preferences: z.array(z.string()).optional()
      }).optional()
    }),
    paymentMethod: z.string(),
    totalAmount: z.number(),
    upsellAmount: z.number().optional(),
    notes: z.string().optional(),
    // ✅ NOUVEAUX CHAMPS ANALYTICS
    attribution: z.object({
      method: z.enum(['utm', 'cookie', 'session', 'referral']).optional(),
      confidence_score: z.number().min(0).max(100).optional(),
      tracking_data: z.record(z.any()).optional()
    }).optional()
  })
});

// ✅ INTERFACE POUR LE WORKFLOW DE COMMANDE
interface OrderWorkflow {
  conversationId: string;
  currentStep: string;
  collectedData: {
    products?: Array<{
      id?: string;
      name: string;
      price: number;
      quantity: number;
      category?: string;
      ai_recommended?: boolean;
    }>;
    customer?: {
      name?: string;
      phone?: string;
      email?: string;
      address?: string;
      profile?: {
        beauty_category?: string;
        skin_type?: string;
        age_range?: string;
        preferences?: string[];
      };
    };
    paymentMethod?: string;
    totalAmount?: number;
    upsellAmount?: number;
    notes?: string;
  };
  startedAt: Date;
  updatedAt: Date;
}

// ✅ STORAGE EN MÉMOIRE POUR LES WORKFLOWS (Redis en production)
const orderWorkflows = new Map<string, OrderWorkflow>();

// ✅ HELPER : Générer les messages pour chaque étape
function getStepMessage(step: string, data?: any, agentName: string = "Rose"): string {
  switch (step) {
    case 'product':
      return `Parfait ! Je vais vous aider à finaliser votre commande. Pouvez-vous me confirmer le produit qui vous intéresse et la quantité souhaitée ?`;
    
    case 'quantity':
      return `Excellente choix ! Combien d'exemplaires souhaitez-vous commander ?`;
    
    case 'name':
      return `Parfait ! Pour finaliser votre commande, j'ai besoin de quelques informations. Pouvez-vous me donner votre nom complet ?`;
    
    case 'phone':
      return `Merci ${data?.customer?.name || ''}! Quel est votre numéro de téléphone pour que nous puissions vous contacter si nécessaire ?`;
    
    case 'address':
      return `Parfait ! À quelle adresse souhaitez-vous recevoir votre commande ?`;
    
    case 'payment':
      return `Merci ! Quel mode de paiement préférez-vous ?\n\n💳 Paiement à la livraison\n💰 Virement bancaire\n📱 Mobile Money\n🏪 Retrait en magasin`;
    
    case 'confirmation':
      if (data?.summary) {
        return `📋 **Récapitulatif de votre commande :**\n\n${data.summary}\n\nTout est correct ? Confirmez-vous cette commande ?`;
      }
      return `Parfait ! Je prépare le récapitulatif de votre commande...`;
    
    default:
      return `Je vais vous aider à finaliser votre commande. Quel produit vous intéresse ?`;
  }
}

// ✅ HELPER : Analyser l'intention de commande dans un message
function detectOrderIntent(message: string): boolean {
  const orderKeywords = [
    'acheter', 'commander', 'commande', 'achète', 'veux', 'prendre',
    'réserver', 'finaliser', 'valider', 'confirmer', 'ok pour', 'd\'accord'
  ];
  
  const msg = message.toLowerCase();
  return orderKeywords.some(keyword => msg.includes(keyword));
}

// ✅ HELPER : Extraire des informations depuis un message
function extractOrderData(message: string, step: string): any {
  const msg = message.toLowerCase().trim();
  
  switch (step) {
    case 'product':
      const quantityMatch = msg.match(/(\d+)\s*(exemplaires?|pièces?|unités?)?/);
      return {
        quantity: quantityMatch ? parseInt(quantityMatch[1]) : 1,
        productMentioned: true
      };
    
    case 'quantity':
      const qtyMatch = msg.match(/(\d+)/);
      return {
        quantity: qtyMatch ? parseInt(qtyMatch[1]) : null
      };
    
    case 'name':
      const nameWords = message.split(' ').filter(word => 
        word.length > 2 && 
        !['bonjour', 'salut', 'oui', 'merci', 'suis', 'appelle'].includes(word.toLowerCase())
      );
      return {
        name: nameWords.join(' ').trim()
      };
    
    case 'phone':
      const phoneMatch = msg.match(/(\+?[0-9\s\-\(\)]{8,})/);
      return {
        phone: phoneMatch ? phoneMatch[1].replace(/\s/g, '') : null
      };
    
    case 'payment':
      if (msg.includes('livraison') || msg.includes('cash')) return { paymentMethod: 'Paiement à la livraison' };
      if (msg.includes('virement') || msg.includes('banque')) return { paymentMethod: 'Virement bancaire' };
      if (msg.includes('mobile') || msg.includes('money')) return { paymentMethod: 'Mobile Money' };
      if (msg.includes('retrait') || msg.includes('magasin')) return { paymentMethod: 'Retrait en magasin' };
      return { paymentMethod: null };
    
    default:
      return {};
  }
}

// ✅ HELPER : Générer le récapitulatif de commande
function generateOrderSummary(workflow: OrderWorkflow): string {
  const { products, customer, paymentMethod, totalAmount } = workflow.collectedData;
  
  let summary = `🛍️ **Produits :**\n`;
  products?.forEach(product => {
    summary += `• ${product.name} x${product.quantity} - ${(product.price * product.quantity).toLocaleString()} FCFA\n`;
  });
  
  summary += `\n👤 **Client :** ${customer?.name}`;
  summary += `\n📞 **Téléphone :** ${customer?.phone}`;
  
  if (customer?.address) {
    summary += `\n📍 **Adresse :** ${customer.address}`;
  }
  
  summary += `\n💳 **Paiement :** ${paymentMethod}`;
  summary += `\n\n💰 **Total : ${totalAmount?.toLocaleString()} FCFA**`;
  
  return summary;
}

// ✅ HELPER : Récupérer user shop ID
function getUserShopId(request: any): string | null {
  const user = request.user as any
  return user?.shopId || user?.shop_id || user?.id || null
}

// ✅ HELPER : Calculer attribution automatique
function calculateAttribution(conversationId: string, trackingData?: any): {
  method: 'utm' | 'cookie' | 'session' | 'referral';
  confidence_score: number;
  tracking_data: any;
} {
  // Logique d'attribution simplifiée
  // En production, analyser UTM, cookies, referrers, etc.
  
  if (trackingData?.utm_source) {
    return {
      method: 'utm',
      confidence_score: 95,
      tracking_data: trackingData
    };
  }
  
  if (trackingData?.referral_code) {
    return {
      method: 'referral',
      confidence_score: 98,
      tracking_data: trackingData
    };
  }
  
  // Par défaut : session ID
  return {
    method: 'session',
    confidence_score: 85,
    tracking_data: { session_id: conversationId }
  };
}

export default async function ordersRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE : Démarrer une nouvelle commande (COMPATIBLE ANALYTICS)
  fastify.post<{ 
    Body: { 
      conversationId: string;
      productInfo?: any;
      message?: string;
      trackingData?: any;
    } 
  }>('/start-order', async (request, reply) => {
    try {
      const { conversationId, productInfo, message, trackingData } = request.body;
      
      fastify.log.info(`🛒 Démarrage commande pour conversation: ${conversationId}`);
      
      // Créer un nouveau workflow de commande
      const workflow: OrderWorkflow = {
        conversationId,
        currentStep: 'product',
        collectedData: {
          products: productInfo ? [{
            id: productInfo.id,
            name: productInfo.name,
            price: productInfo.price || 0,
            quantity: 1,
            category: productInfo.category || 'Beauté',
            ai_recommended: true
          }] : []
        },
        startedAt: new Date(),
        updatedAt: new Date()
      };
      
      // Analyser le message pour extraire des infos initiales
      if (message) {
        const extracted = extractOrderData(message, 'product');
        if (extracted.quantity && workflow.collectedData.products?.[0]) {
          workflow.collectedData.products[0].quantity = extracted.quantity;
        }
      }
      
      // Sauvegarder le workflow
      orderWorkflows.set(conversationId, workflow);
      
      // Déterminer la prochaine étape
      let nextStep = 'name';
      if (!workflow.collectedData.products?.length || !workflow.collectedData.products[0].name) {
        nextStep = 'product';
      }
      
      const responseMessage = getStepMessage(nextStep, workflow.collectedData);
      
      return {
        success: true,
        data: {
          workflowId: conversationId,
          currentStep: nextStep,
          message: responseMessage,
          collectedData: workflow.collectedData
        }
      };
      
    } catch (error: any) {
      fastify.log.error(`❌ Start order error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du démarrage de la commande'
      });
    }
  });

  // ✅ ROUTE : Traiter une étape de commande (INCHANGÉE)
  fastify.post<{ Body: typeof orderStepSchema._type }>('/process-step', async (request, reply) => {
    try {
      const { conversationId, step, data } = orderStepSchema.parse(request.body);
      
      fastify.log.info(`📝 Traitement étape ${step} pour conversation: ${conversationId}`);
      
      const workflow = orderWorkflows.get(conversationId);
      if (!workflow) {
        return reply.status(404).send({
          success: false,
          error: 'Workflow de commande non trouvé'
        });
      }
      
      // Mettre à jour les données collectées
      switch (step) {
        case 'name':
          if (!workflow.collectedData.customer) workflow.collectedData.customer = {};
          workflow.collectedData.customer.name = data.name;
          break;
          
        case 'phone':
          if (!workflow.collectedData.customer) workflow.collectedData.customer = {};
          workflow.collectedData.customer.phone = data.phone;
          break;
          
        case 'address':
          if (!workflow.collectedData.customer) workflow.collectedData.customer = {};
          workflow.collectedData.customer.address = data.address;
          break;
          
        case 'payment':
          workflow.collectedData.paymentMethod = data.paymentMethod;
          break;
          
        case 'quantity':
          if (workflow.collectedData.products?.[0]) {
            workflow.collectedData.products[0].quantity = data.quantity;
          }
          break;
      }
      
      // Calculer le total
      const total = workflow.collectedData.products?.reduce((sum, product) => 
        sum + (product.price * product.quantity), 0) || 0;
      workflow.collectedData.totalAmount = total;
      
      // Déterminer la prochaine étape
      const stepOrder = ['product', 'name', 'phone', 'address', 'payment', 'confirmation'];
      const currentIndex = stepOrder.indexOf(step);
      let nextStep = stepOrder[currentIndex + 1];
      
      if (nextStep === 'address' && data.paymentMethod === 'Retrait en magasin') {
        nextStep = 'payment';
      }
      
      workflow.currentStep = nextStep || 'confirmation';
      workflow.updatedAt = new Date();
      
      // Générer la réponse
      let responseMessage = '';
      let responseData: any = workflow.collectedData;
      
      if (nextStep === 'confirmation') {
        const summary = generateOrderSummary(workflow);
        responseMessage = getStepMessage('confirmation', { summary });
        responseData = { ...workflow.collectedData, summary };
      } else if (nextStep) {
        responseMessage = getStepMessage(nextStep, workflow.collectedData);
      }
      
      orderWorkflows.set(conversationId, workflow);
      
      return {
        success: true,
        data: {
          currentStep: workflow.currentStep,
          message: responseMessage,
          collectedData: responseData,
          isComplete: !nextStep || nextStep === 'confirmation'
        }
      };
      
    } catch (error: any) {
      fastify.log.error(`❌ Process step error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du traitement de l\'étape'
      });
    }
  });

  // ✅ ROUTE : Finaliser et sauvegarder la commande (VERSION ANALYTICS COMPLÈTE)
  fastify.post<{ Body: typeof completeOrderSchema._type }>('/complete', async (request, reply) => {
    try {
      const { conversationId, orderData } = completeOrderSchema.parse(request.body);
      
      fastify.log.info(`✅ Finalisation commande pour conversation: ${conversationId}`);
      
      // ✅ RÉCUPÉRER INFORMATIONS DE LA CONVERSATION
      const { data: conversation, error: convError } = await supabaseServiceClient
        .from('conversations')
        .select('shop_id, agent_id, visitor_id, product_name, created_at')
        .eq('id', conversationId)
        .single();

      if (convError || !conversation) {
        fastify.log.error(`❌ Conversation non trouvée: ${convError?.message}`);
        return reply.status(404).send({
          success: false,
          error: 'Conversation non trouvée'
        });
      }
      
      // ✅ CALCULER ATTRIBUTION AUTOMATIQUE
      const attribution = calculateAttribution(conversationId, orderData.attribution?.tracking_data);
      
      // ✅ CALCULER MÉTRIQUES ANALYTICS
      const conversationDuration = calculateConversationDuration(conversation.created_at, new Date().toISOString());
      
      // ✅ CRÉER LA COMMANDE AVEC DONNÉES ANALYTICS COMPLÈTES
      const orderInsertData = {
        // Données de base
        conversation_id: conversationId,
        shop_id: conversation.shop_id,
        customer_name: orderData.customer.name,
        customer_phone: orderData.customer.phone,
        customer_email: orderData.customer.email || null,
        customer_address: orderData.customer.address || null,
        
        // ✅ NOUVEAU : Profil client beauté
        customer_profile: orderData.customer.profile || null,
        
        // Produits
        product_items: orderData.products,
        total_amount: orderData.totalAmount,
        upsell_amount: orderData.upsellAmount || null,
        currency: 'XOF',
        payment_method: orderData.paymentMethod,
        notes: orderData.notes || null,
        status: 'pending',
        
        // ✅ NOUVELLES DONNÉES ANALYTICS
        attribution_method: attribution.method,
        confidence_score: orderData.attribution?.confidence_score || attribution.confidence_score,
        tracking_data: attribution.tracking_data,
        ai_attributed_revenue: orderData.totalAmount, // 100% attribué à l'IA pour les commandes via workflow
        organic_revenue: 0,
        
        // ✅ MÉTRIQUES DE CONVERSATION
        conversation_duration: conversationDuration,
        messages_count: 8, // TODO: Calculer vraiment depuis la conversation
        satisfaction_score: null, // TODO: Collecter si disponible
        personalized_recommendations: true, // Toujours true pour workflow IA
        
        // ✅ ROI et coûts
        roi: null, // Sera calculé côté analytics
        attributed_cost: Math.round(orderData.totalAmount * 0.15), // 15% du CA comme coût par défaut
        
        // Timestamps
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      const { data: order, error: orderError } = await supabaseServiceClient
        .from('orders')
        .insert(orderInsertData)
        .select()
        .single();
      
      if (orderError) {
        fastify.log.error(`❌ Erreur création commande: ${orderError.message}`);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la création de la commande'
        });
      }
      
      // ✅ METTRE À JOUR LA CONVERSATION
      const { error: updateError } = await supabaseServiceClient
        .from('conversations')
        .update({ 
          conversion_completed: true,
          completed_at: new Date().toISOString()
        })
        .eq('id', conversationId);
      
      if (updateError) {
        fastify.log.warn(`⚠️ Erreur mise à jour conversation: ${updateError.message}`);
      }
      
      // ✅ NETTOYER LE WORKFLOW TEMPORAIRE
      orderWorkflows.delete(conversationId);

      // ✅ ENVOYER NOTIFICATIONS EMAIL
      try {
        const { data: shop } = await supabaseServiceClient
          .from('shops')
          .select('email, name, notification_config')
          .eq('id', conversation.shop_id)
          .single();

        if (shop?.email) {
          const emailOrdersEnabled = shop.notification_config?.email?.orders !== false;
          if (emailOrdersEnabled) {
            await sendOrderEmails(order, shop.email, shop.name || 'ChatSeller');
          }
        }
      } catch (emailErr: any) {
        console.error('⚠️ Erreur envoi email commande (non bloquant):', emailErr.message);
      }

      const orderNumber = order.id.slice(-8);
      const confirmationMessage = `🎉 **Commande confirmée !**\n\nVotre commande n°${orderNumber} a été enregistrée avec succès.\n\nNous vous contacterons au ${orderData.customer.phone} pour confirmer les détails.\n\nMerci pour votre confiance ! 😊`;
      
      return {
        success: true,
        data: {
          orderId: order.id,
          message: confirmationMessage,
          orderNumber: orderNumber,
          attribution: attribution,
          analytics: {
            ai_attributed_revenue: orderData.totalAmount,
            conversation_duration: conversationDuration,
            confidence_score: attribution.confidence_score
          }
        }
      };
      
    } catch (error: any) {
      fastify.log.error(`❌ Complete order error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la finalisation de la commande'
      });
    }
  });

  // ✅ ROUTE : Analyser intention commande (INCHANGÉE)
  fastify.post<{ 
    Body: { 
      message: string;
      conversationId: string;
      productInfo?: any;
    } 
  }>('/analyze-intent', async (request, reply) => {
    try {
      const { message, conversationId, productInfo } = request.body;
      
      const hasOrderIntent = detectOrderIntent(message);
      const workflow = orderWorkflows.get(conversationId);
      
      if (hasOrderIntent && !workflow) {
        return {
          success: true,
          data: {
            hasOrderIntent: true,
            action: 'start_order',
            suggestion: 'Parfait ! Je vais vous aider à finaliser votre commande.'
          }
        };
      } else if (workflow) {
        const extracted = extractOrderData(message, workflow.currentStep);
        return {
          success: true,
          data: {
            hasOrderIntent: true,
            action: 'continue_order',
            currentStep: workflow.currentStep,
            extractedData: extracted
          }
        };
      }
      
      return {
        success: true,
        data: {
          hasOrderIntent: false,
          action: 'normal_conversation'
        }
      };
      
    } catch (error: any) {
      fastify.log.error(`❌ Analyze intent error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'analyse de l\'intention'
      });
    }
  });

  // ✅ ROUTE : Workflow status (INCHANGÉE)
  fastify.get<{ 
    Params: { conversationId: string } 
  }>('/workflow/:conversationId', async (request, reply) => {
    try {
      const { conversationId } = request.params;
      
      const workflow = orderWorkflows.get(conversationId);
      
      if (!workflow) {
        return reply.status(404).send({
          success: false,
          error: 'Workflow non trouvé'
        });
      }
      
      return {
        success: true,
        data: workflow
      };
      
    } catch (error: any) {
      fastify.log.error(`❌ Get workflow error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération du workflow'
      });
    }
  });

  // ✅ ROUTE : Lister commandes (VERSION ANALYTICS ENRICHIE)
  fastify.get<{ 
    Querystring: { 
      page?: number;
      limit?: number;
      status?: string;
      attribution_method?: string;
      date_from?: string;
      date_to?: string;
    } 
  }>('/list', async (request, reply) => {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        attribution_method,
        date_from,
        date_to
      } = request.query;

      const shopId = getUserShopId(request);

      fastify.log.info(`📦 [Orders] Récupération commandes pour shop: ${shopId}`);

      if (!shopId) {
        fastify.log.warn('⚠️ [Orders] Shop ID manquant dans la requête');
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }

      // ✅ CONSTRUIRE REQUÊTE AVEC FILTRES ANALYTICS
      let query = supabaseServiceClient
        .from('orders')
        .select(`
          *,
          conversations (
            id,
            visitor_id,
            product_name,
            agent_id,
            created_at,
            completed_at
          )
        `, { count: 'exact' })
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false });

      // Filtres
      if (status) {
        query = query.eq('status', status);
      }
      
      if (attribution_method) {
        query = query.eq('attribution_method', attribution_method);
      }
      
      if (date_from) {
        query = query.gte('created_at', date_from);
      }
      
      if (date_to) {
        query = query.lte('created_at', date_to);
      }

      // Pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data: orders, error, count } = await query;

      if (error) {
        fastify.log.error(`❌ [Orders] Erreur Supabase: ${error.message} - Details: ${error.details || 'N/A'} - Code: ${error.code || 'N/A'}`);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la récupération des commandes',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }

      fastify.log.info(`✅ [Orders] ${orders?.length || 0} commandes récupérées (total: ${count || 0})`);

      // ✅ ENRICHIR AVEC MÉTRIQUES ANALYTICS
      const enrichedOrders = (orders || []).map(order => ({
        ...order,
        // Calculer métriques manquantes si nécessaire
        roi: order.roi || (order.total_amount && order.attributed_cost 
          ? Math.round((order.total_amount / order.attributed_cost) * 10) / 10 
          : null),
        conversion_rate: order.conversations ? 100 : 0, // Simplifié
        personalized_recommendations: order.personalized_recommendations ?? true
      }));

      return {
        success: true,
        data: {
          orders: enrichedOrders,
          pagination: {
            page,
            limit,
            total: count || 0,
            pages: Math.ceil((count || 0) / limit)
          },
          analytics: {
            total_revenue: enrichedOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0),
            avg_order_value: enrichedOrders.length > 0 
              ? Math.round(enrichedOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0) / enrichedOrders.length)
              : 0,
            ai_attribution_rate: enrichedOrders.length > 0
              ? Math.round((enrichedOrders.filter(o => o.ai_attributed_revenue > 0).length / enrichedOrders.length) * 100)
              : 0
          }
        }
      };

    } catch (error: any) {
      fastify.log.error(`❌ List orders error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des commandes'
      });
    }
  });

  // ✅ ROUTE : Détails commande (VERSION ANALYTICS ENRICHIE)
  fastify.get<{ 
    Params: { orderId: string } 
  }>('/details/:orderId', async (request, reply) => {
    try {
      const { orderId } = request.params;
      const shopId = getUserShopId(request);

      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }

      // ✅ RÉCUPÉRER AVEC DONNÉES ANALYTICS COMPLÈTES
      const { data: order, error } = await supabaseServiceClient
        .from('orders')
        .select(`
          *,
          conversations (
            id,
            visitor_id,
            product_name,
            agent_id,
            message_count,
            created_at,
            completed_at
          )
        `)
        .eq('id', orderId)
        .eq('shop_id', shopId)
        .single();

      if (error || !order) {
        return reply.status(404).send({
          success: false,
          error: 'Commande non trouvée'
        });
      }

      // ✅ ENRICHIR AVEC ANALYSES
      const enrichedOrder = {
        ...order,
        analytics: {
          attribution_confidence: order.confidence_score || 85,
          conversion_journey: {
            started_at: order.conversations?.created_at,
            completed_at: order.conversations?.completed_at,
            duration: order.conversation_duration,
            touchpoints: order.messages_count || 0
          },
          performance: {
            roi: order.roi || (order.total_amount && order.attributed_cost 
              ? Math.round((order.total_amount / order.attributed_cost) * 10) / 10 
              : null),
            ai_contribution: order.ai_attributed_revenue || order.total_amount,
            organic_contribution: order.organic_revenue || 0
          }
        }
      };

      return {
        success: true,
        data: { order: enrichedOrder }
      };

    } catch (error: any) {
      fastify.log.error(`❌ Get order details error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des détails de la commande'
      });
    }
  });

  // ✅ ROUTE : Update status (INCHANGÉE)
  fastify.patch<{ 
    Params: { orderId: string };
    Body: { status: string; notes?: string }
  }>('/status/:orderId', async (request, reply) => {
    try {
      const { orderId } = request.params;
      const { status, notes } = request.body;
      const shopId = getUserShopId(request);

      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }

      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
      };

      if (notes) {
        updateData.notes = notes;
      }

      const { data: order, error } = await supabaseServiceClient
        .from('orders')
        .update(updateData)
        .eq('id', orderId)
        .eq('shop_id', shopId)
        .select()
        .single();

      if (error) {
        fastify.log.error(`❌ Erreur mise à jour commande: ${error.message}`);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la mise à jour de la commande'
        });
      }

      if (!order) {
        return reply.status(404).send({
          success: false,
          error: 'Commande non trouvée'
        });
      }

      return {
        success: true,
        data: { order }
      };

    } catch (error: any) {
      fastify.log.error(`❌ Update order status error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la mise à jour du statut'
      });
    }
  });
}

// ✅ HELPER : Calculer durée entre deux dates
function calculateConversationDuration(start: string, end: string): string {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  const diffMinutes = Math.round((endTime - startTime) / (1000 * 60));
  
  if (diffMinutes < 60) {
    return `${diffMinutes}min`;
  }
  
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  
  return minutes > 0 ? `${hours}h${minutes}min` : `${hours}h`;
}