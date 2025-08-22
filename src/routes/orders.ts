// src/routes/orders.ts - VERSION SUPABASE PURE CORRIGÉE ✅

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabaseServiceClient } from '../lib/supabase'; // ✅ UNIQUEMENT SUPABASE

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
      quantity: z.number()
    })),
    customer: z.object({
      name: z.string(),
      phone: z.string(),
      email: z.string().optional(),
      address: z.string().optional()
    }),
    paymentMethod: z.string(),
    totalAmount: z.number(),
    notes: z.string().optional()
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
    }>;
    customer?: {
      name?: string;
      phone?: string;
      email?: string;
      address?: string;
    };
    paymentMethod?: string;
    totalAmount?: number;
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
      // Extraire quantité si mentionnée
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
      // Extraire le nom (éviter les mots courants)
      const nameWords = message.split(' ').filter(word => 
        word.length > 2 && 
        !['bonjour', 'salut', 'oui', 'merci', 'suis', 'appelle'].includes(word.toLowerCase())
      );
      return {
        name: nameWords.join(' ').trim()
      };
    
    case 'phone':
      // Extraire numéro de téléphone
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

export default async function ordersRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE : Démarrer une nouvelle commande
  fastify.post<{ 
    Body: { 
      conversationId: string;
      productInfo?: any;
      message?: string;
    } 
  }>('/start-order', async (request, reply) => {
    try {
      const { conversationId, productInfo, message } = request.body;
      
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
            quantity: 1
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

  // ✅ ROUTE : Traiter une étape de commande
  fastify.post<{ Body: typeof orderStepSchema._type }>('/process-step', async (request, reply) => {
    try {
      const { conversationId, step, data } = orderStepSchema.parse(request.body);
      
      fastify.log.info(`📝 Traitement étape ${step} pour conversation: ${conversationId}`);
      
      // Récupérer le workflow existant
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
      
      // Skip address si pas nécessaire (retrait magasin)
      if (nextStep === 'address' && data.paymentMethod === 'Retrait en magasin') {
        nextStep = 'payment';
      }
      
      workflow.currentStep = nextStep || 'confirmation';
      workflow.updatedAt = new Date();
      
      // Générer la réponse
      let responseMessage = '';
      let responseData: any = workflow.collectedData;
      
      if (nextStep === 'confirmation') {
        // Générer le récapitulatif
        const summary = generateOrderSummary(workflow);
        responseMessage = getStepMessage('confirmation', { summary });
        responseData = { ...workflow.collectedData, summary };
      } else if (nextStep) {
        responseMessage = getStepMessage(nextStep, workflow.collectedData);
      }
      
      // Sauvegarder le workflow mis à jour
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

  // ✅ ROUTE : Finaliser et sauvegarder la commande (VERSION SUPABASE CORRIGÉE)
  fastify.post<{ Body: typeof completeOrderSchema._type }>('/complete', async (request, reply) => {
    try {
      const { conversationId, orderData } = completeOrderSchema.parse(request.body);
      
      fastify.log.info(`✅ Finalisation commande pour conversation: ${conversationId}`);
      
      // ✅ RÉCUPÉRER INFORMATIONS DE LA CONVERSATION AVEC SUPABASE - COLONNES CORRIGÉES
      const { data: conversation, error: convError } = await supabaseServiceClient
        .from('conversations')
        .select('shop_id, agent_id')  // ✅ CORRIGÉ : shop_id, agent_id
        .eq('id', conversationId)
        .single();

      if (convError || !conversation) {
        fastify.log.error(`❌ Conversation non trouvée: ${convError?.message || 'Conversation inexistante'}`);
        return reply.status(404).send({
          success: false,
          error: 'Conversation non trouvée'
        });
      }
      
      // ✅ CRÉER LA COMMANDE AVEC SUPABASE - TOUTES COLONNES CORRIGÉES
      const { data: order, error: orderError } = await supabaseServiceClient
        .from('orders')
        .insert({
          conversation_id: conversationId,           // ✅ CORRIGÉ : conversation_id
          shop_id: conversation.shop_id,             // ✅ CORRIGÉ : shop_id
          customer_name: orderData.customer.name,    // ✅ CORRIGÉ : customer_name
          customer_phone: orderData.customer.phone,  // ✅ CORRIGÉ : customer_phone
          customer_email: orderData.customer.email || null,    // ✅ CORRIGÉ : customer_email
          customer_address: orderData.customer.address || null, // ✅ CORRIGÉ : customer_address
          product_items: orderData.products,         // ✅ CORRIGÉ : product_items
          total_amount: orderData.totalAmount,       // ✅ CORRIGÉ : total_amount
          currency: 'XOF',
          payment_method: orderData.paymentMethod,   // ✅ CORRIGÉ : payment_method
          notes: orderData.notes || null,
          status: 'pending',
          created_at: new Date().toISOString(),      // ✅ CORRIGÉ : created_at
          updated_at: new Date().toISOString()       // ✅ CORRIGÉ : updated_at
        })
        .select()
        .single();
      
      if (orderError) {
        fastify.log.error(`❌ Erreur création commande: ${orderError.message}`);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la création de la commande'
        });
      }
      
      // ✅ METTRE À JOUR LA CONVERSATION AVEC SUPABASE - COLONNES CORRIGÉES
      const { error: updateError } = await supabaseServiceClient
        .from('conversations')
        .update({ 
          conversion_completed: true,               // ✅ CORRIGÉ : conversion_completed
          completed_at: new Date().toISOString()    // ✅ CORRIGÉ : completed_at
        })
        .eq('id', conversationId);
      
      if (updateError) {
        fastify.log.warn(`⚠️ Erreur mise à jour conversation: ${updateError.message}`);
        // Ne pas bloquer pour cette erreur
      }
      
      // ✅ NETTOYER LE WORKFLOW TEMPORAIRE
      orderWorkflows.delete(conversationId);
      
      const orderNumber = order.id.slice(-8);
      const confirmationMessage = `🎉 **Commande confirmée !**\n\nVotre commande n°${orderNumber} a été enregistrée avec succès.\n\nNous vous contacterons au ${orderData.customer.phone} pour confirmer les détails.\n\nMerci pour votre confiance ! 😊`;
      
      return {
        success: true,
        data: {
          orderId: order.id,
          message: confirmationMessage,
          orderNumber: orderNumber
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

  // ✅ ROUTE : Analyser un message pour détecter une intention de commande
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
        // Nouveau workflow de commande
        return {
          success: true,
          data: {
            hasOrderIntent: true,
            action: 'start_order',
            suggestion: 'Parfait ! Je vais vous aider à finaliser votre commande.'
          }
        };
      } else if (workflow) {
        // Workflow en cours
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

  // ✅ ROUTE : Obtenir le statut d'un workflow de commande
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

  // ✅ ROUTE : Lister les commandes d'une boutique (VERSION SUPABASE CORRIGÉE)
  fastify.get<{ 
    Querystring: { 
      page?: number;
      limit?: number;
      status?: string;
    } 
  }>('/list', async (request, reply) => {
    try {
      const { page = 1, limit = 20, status } = request.query;
      const shopId = getUserShopId(request);  // ✅ UTILISE HELPER

      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }

      // ✅ CONSTRUIRE LA REQUÊTE SUPABASE - COLONNES CORRIGÉES
      let query = supabaseServiceClient
        .from('orders')
        .select('*')
        .eq('shop_id', shopId)                     // ✅ CORRIGÉ : shop_id
        .order('created_at', { ascending: false }); // ✅ CORRIGÉ : created_at

      // Filtrer par statut si spécifié
      if (status) {
        query = query.eq('status', status);
      }

      // Pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data: orders, error, count } = await query;

      if (error) {
        fastify.log.error(`❌ Erreur récupération commandes: ${error.message}`);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la récupération des commandes'
        });
      }

      return {
        success: true,
        data: {
          orders: orders || [],
          pagination: {
            page,
            limit,
            total: count || 0,
            pages: Math.ceil((count || 0) / limit)
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

  // ✅ ROUTE : Obtenir les détails d'une commande (VERSION SUPABASE CORRIGÉE)
  fastify.get<{ 
    Params: { orderId: string } 
  }>('/details/:orderId', async (request, reply) => {
    try {
      const { orderId } = request.params;
      const shopId = getUserShopId(request);  // ✅ UTILISE HELPER

      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }

      // ✅ RÉCUPÉRER LA COMMANDE AVEC SUPABASE - COLONNES CORRIGÉES
      const { data: order, error } = await supabaseServiceClient
        .from('orders')
        .select(`
          *,
          conversations (
            id,
            visitor_id,
            product_name,
            created_at
          )
        `)
        .eq('id', orderId)
        .eq('shop_id', shopId)  // ✅ CORRIGÉ : shop_id
        .single();

      if (error || !order) {
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
      fastify.log.error(`❌ Get order details error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des détails de la commande'
      });
    }
  });

  // ✅ ROUTE : Mettre à jour le statut d'une commande (VERSION SUPABASE CORRIGÉE)
  fastify.patch<{ 
    Params: { orderId: string };
    Body: { status: string; notes?: string }
  }>('/status/:orderId', async (request, reply) => {
    try {
      const { orderId } = request.params;
      const { status, notes } = request.body;
      const shopId = getUserShopId(request);  // ✅ UTILISE HELPER

      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }

      // ✅ METTRE À JOUR LE STATUT AVEC SUPABASE - COLONNES CORRIGÉES
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()  // ✅ CORRIGÉ : updated_at
      };

      if (notes) {
        updateData.notes = notes;
      }

      const { data: order, error } = await supabaseServiceClient
        .from('orders')
        .update(updateData)
        .eq('id', orderId)
        .eq('shop_id', shopId)  // ✅ CORRIGÉ : shop_id
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