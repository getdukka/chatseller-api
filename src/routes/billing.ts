// src/routes/billing.ts - VERSION SUPABASE PURE
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Stripe from 'stripe';
import { supabaseServiceClient, supabaseAuthClient } from '../lib/supabase';

// ✅ VERSION STRIPE CORRIGÉE
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-07-30.basil'
});

// ✅ CONFIGURATION DES PLANS
const STRIPE_PLANS = {
  free: {
    name: 'Free Trial',
    price: 0,
    stripePriceId: null,
    features: ['7 jours gratuit', '1 Vendeur IA', '1000 messages/mois'],
    limits: { conversations: 1000, agents: 1, documents: 50 }
  },
  starter: {
    name: 'Starter', 
    price: 1400, // 14€ en centimes
    stripePriceId: process.env.STRIPE_PRICE_ID_STARTER!,
    features: ['1 Vendeur IA spécialisé', '1000 messages/mois', '50 documents max'],
    limits: { conversations: 1000, agents: 1, documents: 50 }
  },
  pro: {
    name: 'Pro',
    price: 2900, // 29€ en centimes  
    stripePriceId: process.env.STRIPE_PRICE_ID_PRO!,
    features: ['3 Vendeurs IA', 'Conversations illimitées', 'Base illimitée'],
    limits: { conversations: -1, agents: 3, documents: -1 }
  }
};

const createSubscriptionSchema = z.object({
  plan: z.enum(['starter', 'pro']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

// ✅ AUTHENTIFICATION SUPABASE
async function verifySupabaseAuth(request: any) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Token manquant');
  }

  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabaseAuthClient.auth.getUser(token);
  
  if (error || !user) {
    throw new Error('Token invalide');
  }
  
  return user;
}

// ✅ CRÉER OU RÉCUPÉRER SHOP AVEC SUPABASE UNIQUEMENT
async function getOrCreateShop(user: any, fastify: FastifyInstance) {
  fastify.log.info(`🔍 Recherche du shop pour l'utilisateur: ${user.id} (${user.email})`);
  
  try {
    // ✅ RECHERCHE PAR ID
    const { data: shopById, error: errorById } = await supabaseServiceClient
      .from('shops')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!errorById && shopById) {
      fastify.log.info(`✅ Shop trouvé par ID: ${shopById.id}`);
      return shopById;
    }

    // ✅ RECHERCHE PAR EMAIL
    const { data: shopByEmail, error: errorByEmail } = await supabaseServiceClient
      .from('shops')
      .select('*')
      .eq('email', user.email)
      .single();

    if (!errorByEmail && shopByEmail) {
      fastify.log.info(`✅ Shop trouvé par email: ${shopByEmail.id}`);
      return shopByEmail;
    }

    // ✅ CRÉATION AUTOMATIQUE DU SHOP
    fastify.log.info(`🏗️ Création automatique du shop pour: ${user.email}`);
    
    const newShopData = {
      id: user.id,
      name: user.user_metadata?.full_name || user.email.split('@')[0] || 'Boutique',
      email: user.email,
      subscription_plan: 'free',
      is_active: true,
      widget_config: {
        theme: "modern",
        language: "fr", 
        position: "bottom-right",
        buttonText: "Parler au vendeur",
        primaryColor: "#3B82F6"
      },
      agent_config: {
        name: "Assistant ChatSeller",
        avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
        upsellEnabled: false,
        welcomeMessage: "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
        fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
        collectPaymentMethod: true
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: newShop, error: createError } = await supabaseServiceClient
      .from('shops')
      .insert(newShopData)
      .select()
      .single();

    if (createError) {
      throw new Error(`Erreur création shop: ${createError.message}`);
    }

    fastify.log.info(`✅ Shop créé avec succès: ${newShop.id}`);
    return newShop;

  } catch (error: any) {
    fastify.log.error('❌ ERREUR GLOBALE dans getOrCreateShop:', error.message || String(error));
    throw new Error(`Impossible de créer ou récupérer le shop: ${error.message}`);
  }
}

export default async function billingRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE DE DIAGNOSTIC SUPABASE
  fastify.get('/diagnostic', async (request, reply) => {
    try {
      fastify.log.info('🧪 === DIAGNOSTIC BILLING SUPABASE ===');
      
      const envCheck = {
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
        SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
        STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_'),
        STRIPE_PRICE_ID_STARTER: !!process.env.STRIPE_PRICE_ID_STARTER && process.env.STRIPE_PRICE_ID_STARTER.startsWith('price_'),
        STRIPE_PRICE_ID_PRO: !!process.env.STRIPE_PRICE_ID_PRO && process.env.STRIPE_PRICE_ID_PRO.startsWith('price_'),
        STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET
      };
      
      // ✅ TEST SUPABASE
      let supabaseTest: { success: boolean; error: string | null; shopsCount?: number } = { success: false, error: null };
      try {
        const { data: shops, error, count } = await supabaseServiceClient
          .from('shops')
          .select('id', { count: 'exact', head: true });
        
        if (error) {
          supabaseTest.error = error.message;
        } else {
          supabaseTest.success = true;
          supabaseTest.shopsCount = count || 0;
        }
      } catch (error: any) {
        supabaseTest.error = error.message;
      }
      
      // ✅ TEST STRIPE
      let stripeTest: { success: boolean; error: string | null; priceValidation?: any } = { success: false, error: null };
      try {
        const prices = await stripe.prices.list({ limit: 1 });
        
        const priceValidations: any = {};
        
        if (process.env.STRIPE_PRICE_ID_STARTER) {
          try {
            const starterPrice = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID_STARTER);
            priceValidations.starter = {
              id: starterPrice.id,
              amount: starterPrice.unit_amount,
              currency: starterPrice.currency,
              active: starterPrice.active
            };
          } catch (priceError: any) {
            priceValidations.starter = { error: priceError.message };
          }
        }

        if (process.env.STRIPE_PRICE_ID_PRO) {
          try {
            const proPrice = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID_PRO);
            priceValidations.pro = {
              id: proPrice.id,
              amount: proPrice.unit_amount,
              currency: proPrice.currency,
              active: proPrice.active
            };
          } catch (priceError: any) {
            priceValidations.pro = { error: priceError.message };
          }
        }
        
        stripeTest.priceValidation = priceValidations;
        stripeTest.success = true;
      } catch (error: any) {
        stripeTest.error = error.message;
      }
      
      return {
        success: true,
        diagnostic: {
          environment: envCheck,
          supabase: supabaseTest,
          stripe: stripeTest,
          timestamp: new Date().toISOString(),
          plansConfig: STRIPE_PLANS,
          database: 'Supabase (Pure)'
        }
      };
      
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        diagnostic: { success: false, error: 'Diagnostic général échoue' }
      };
    }
  });
  
  // ✅ ROUTE PLANS
  fastify.get('/plans', async (request, reply) => {
    try {
      const plans = Object.entries(STRIPE_PLANS).map(([key, plan]) => ({
        id: key,
        name: plan.name,
        price: plan.price,
        priceFormatted: plan.price === 0 ? 'Gratuit' : `${plan.price / 100}€`,
        features: plan.features,
        limits: plan.limits
      }));

      return { success: true, plans };
    } catch (error: any) {
      fastify.log.error('Get plans error:', error.message || String(error));
      return reply.status(500).send({ error: 'Erreur lors de la récupération des plans' });
    }
  });

  // ✅ ROUTE CRÉATION SESSION CHECKOUT
  fastify.post('/create-checkout-session', async (request, reply) => {
    try {
      fastify.log.info('🚀 === DÉBUT CRÉATION SESSION CHECKOUT ===');
      
      const body = createSubscriptionSchema.parse(request.body);
      fastify.log.info(`📝 Données validées: plan=${body.plan}`);
      
      const user = await verifySupabaseAuth(request);
      fastify.log.info(`👤 Utilisateur authentifié: ${user.id} (${user.email})`);
      
      const shop = await getOrCreateShop(user, fastify);
      if (!shop) {
        throw new Error('Impossible de créer ou récupérer le shop');
      }

      if (shop.subscription_plan === body.plan || 
          (shop.subscription_plan === 'pro' && body.plan === 'starter')) {
        fastify.log.warn(`⚠️ Utilisateur déjà abonné: ${shop.subscription_plan}`);
        return reply.status(400).send({ 
          error: 'Vous avez déjà un abonnement actif ou supérieur',
          currentPlan: shop.subscription_plan 
        });
      }

      const plan = STRIPE_PLANS[body.plan as keyof typeof STRIPE_PLANS];
      if (!plan.stripePriceId) {
        fastify.log.error(`❌ Plan non disponible: ${body.plan}`);
        return reply.status(400).send({ error: 'Plan non disponible pour l\'achat' });
      }

      fastify.log.info(`📋 Plan sélectionné: ${plan.name} - Prix: ${plan.price/100}€ - Price ID: ${plan.stripePriceId}`);

      // ✅ VALIDATION STRIPE PRICE ID
      try {
        fastify.log.info(`🧪 Validation Price ID: ${plan.stripePriceId}`);
        const priceValidation = await stripe.prices.retrieve(plan.stripePriceId);
        
        if (!priceValidation.active) {
          throw new Error(`Price ID inactif: ${plan.stripePriceId}`);
        }
        
        fastify.log.info(`✅ Price ID valide: ${priceValidation.id} - ${priceValidation.unit_amount}${priceValidation.currency}`);
      } catch (priceError: any) {
        fastify.log.error('❌ Erreur validation Price ID:', priceError.message);
        return reply.status(500).send({ 
          error: 'Prix Stripe invalide',
          details: priceError.message,
          priceId: plan.stripePriceId
        });
      }

      // ✅ GESTION CUSTOMER STRIPE
      let customer;
      try {
        fastify.log.info(`🔍 Recherche customer Stripe: ${shop.email}`);
        
        const existingCustomers = await stripe.customers.list({
          email: shop.email,
          limit: 1
        });

        if (existingCustomers.data.length > 0) {
          customer = existingCustomers.data[0];
          fastify.log.info(`✅ Customer existant: ${customer.id}`);
        } else {
          fastify.log.info(`🏗️ Création nouveau customer`);
          customer = await stripe.customers.create({
            email: shop.email,
            name: shop.name,
            metadata: {
              userId: shop.id,
              shopName: shop.name
            }
          });
          fastify.log.info(`✅ Customer créé: ${customer.id}`);
        }
      } catch (customerError: any) {
        fastify.log.error('❌ Erreur customer Stripe:', customerError.message || String(customerError));
        throw new Error(`Erreur customer: ${customerError.message}`);
      }

      // ✅ CRÉATION SESSION CHECKOUT
      try {
        fastify.log.info('🏗️ Création session checkout...');

        const session = await stripe.checkout.sessions.create({
          customer: customer.id,
          payment_method_types: ['card'],
          line_items: [
            {
              price: plan.stripePriceId,
              quantity: 1,
            },
          ],
          mode: 'subscription',
          success_url: body.successUrl,
          cancel_url: body.cancelUrl,
          metadata: {
            userId: shop.id,
            plan: body.plan,
            shopEmail: shop.email
          },
          subscription_data: {
            metadata: {
              userId: shop.id,
              plan: body.plan,
              shopEmail: shop.email
            }
          }
        });

        fastify.log.info(`✅ Session créée avec succès: ${session.id}`);
        fastify.log.info(`🔗 URL checkout: ${session.url}`);

        return { 
          success: true, 
          checkoutUrl: session.url,
          sessionId: session.id,
          message: 'Session de paiement créée avec succès'
        };

      } catch (sessionError: any) {
        fastify.log.error('❌ ERREUR CRÉATION SESSION:', sessionError.message || String(sessionError));
        
        if (sessionError.type === 'StripeInvalidRequestError') {
          return reply.status(400).send({
            error: 'Requête Stripe invalide',
            details: sessionError.message,
            stripeCode: sessionError.code
          });
        }
        
        throw new Error(`Session checkout: ${sessionError.message}`);
      }

    } catch (error: any) {
      fastify.log.error('❌ ERREUR GLOBALE CHECKOUT:', error.message || String(error));
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          error: 'Données de requête invalides',
          details: error.errors
        });
      }
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: 'Authentification requise' });
      }
      
      return reply.status(500).send({
        error: 'Erreur lors de la création de la session de paiement',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Erreur interne du serveur',
        timestamp: new Date().toISOString()
      });
    }
  });

  const createPortalSchema = z.object({
  returnUrl: z.string().url()
});

// ✅ ROUTE CUSTOMER PORTAL STRIPE
fastify.post('/customer-portal', async (request, reply) => {
  try {
    fastify.log.info('🏛️ === CRÉATION CUSTOMER PORTAL ===');
    
    const body = createPortalSchema.parse(request.body);
    fastify.log.info(`🔗 Return URL: ${body.returnUrl}`);
    
    const user = await verifySupabaseAuth(request);
    fastify.log.info(`👤 Utilisateur authentifié: ${user.id} (${user.email})`);
    
    const shop = await getOrCreateShop(user, fastify);
    if (!shop) {
      throw new Error('Impossible de créer ou récupérer le shop');
    }

    // ✅ RECHERCHE OU CRÉATION CUSTOMER STRIPE
    let customer;
    try {
      const existingCustomers = await stripe.customers.list({
        email: shop.email,
        limit: 1
      });

      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
        fastify.log.info(`✅ Customer existant trouvé: ${customer.id}`);
      } else {
        // Si pas de customer Stripe, on ne peut pas créer de portal
        return reply.status(400).send({ 
          error: 'Aucun abonnement actif trouvé. Souscrivez d\'abord à un plan pour gérer votre abonnement.' 
        });
      }
    } catch (customerError: any) {
      fastify.log.error('❌ Erreur customer Stripe:', customerError.message);
      return reply.status(400).send({ 
        error: 'Customer Stripe non trouvé. Souscrivez d\'abord à un plan.' 
      });
    }

    // ✅ CRÉATION SESSION CUSTOMER PORTAL
    try {
      fastify.log.info('🏛️ Création session customer portal...');

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: body.returnUrl,
      });

      fastify.log.info(`✅ Portal session créée: ${portalSession.id}`);
      fastify.log.info(`🔗 URL portal: ${portalSession.url}`);

      return { 
        success: true, 
        portalUrl: portalSession.url,
        sessionId: portalSession.id,
        message: 'Portail client créé avec succès'
      };

    } catch (portalError: any) {
      fastify.log.error('❌ ERREUR CRÉATION PORTAL:', portalError.message);
      
      if (portalError.type === 'StripeInvalidRequestError') {
        return reply.status(400).send({
          error: 'Requête Stripe invalide',
          details: portalError.message,
          stripeCode: portalError.code
        });
      }
      
      throw new Error(`Portal session: ${portalError.message}`);
    }

  } catch (error: any) {
    fastify.log.error('❌ ERREUR GLOBALE CUSTOMER PORTAL:', error.message);
    
    if (error.name === 'ZodError') {
      return reply.status(400).send({
        error: 'Données de requête invalides',
        details: error.errors
      });
    }
    
    if (error.message === 'Token manquant' || error.message === 'Token invalide') {
      return reply.status(401).send({ error: 'Authentification requise' });
    }
    
    return reply.status(500).send({
      error: 'Erreur lors de la création du portail client',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Erreur interne du serveur'
    });
  }
});

  // ✅ ROUTE STATUT ABONNEMENT SUPABASE
  fastify.get('/subscription-status', async (request, reply) => {
    try {
      fastify.log.info('🔍 Récupération statut abonnement');
      
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      let trialDaysLeft = 0;
      if (shop.subscription_plan === 'free') {
        const creationDate = new Date(shop.created_at || Date.now());
        const daysSinceCreation = Math.floor((Date.now() - creationDate.getTime()) / (1000 * 60 * 60 * 24));
        trialDaysLeft = Math.max(0, 7 - daysSinceCreation);
      }

      return {
        success: true,
        subscription: {
          plan: shop.subscription_plan,
          status: shop.is_active ? 'active' : 'inactive',
          isActive: shop.is_active,
          trialDaysLeft: trialDaysLeft,
          trialEndDate: shop.subscription_plan === 'free' 
            ? new Date(new Date(shop.created_at || Date.now()).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
            : null,
          nextBillingDate: shop.subscription_plan !== 'free' 
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            : null,
          shopId: shop.id,
          shopName: shop.name
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Get subscription status error:', error.message || String(error));
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({ 
        error: 'Erreur lors de la récupération du statut',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ WEBHOOK STRIPE SUPABASE
  fastify.post('/webhook', async (request, reply) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    try {
      fastify.log.info(`📧 [${requestId}] === WEBHOOK STRIPE REÇU ===`);
      
      const signature = request.headers['stripe-signature'] as string;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

      if (!signature) {
        fastify.log.error(`❌ [${requestId}] Signature Stripe manquante`);
        return reply.status(400).send({ error: 'Signature manquante' });
      }

      if (!webhookSecret) {
        fastify.log.error(`❌ [${requestId}] STRIPE_WEBHOOK_SECRET non configuré`);
        return reply.status(500).send({ error: 'Webhook secret non configuré' });
      }

      let event: Stripe.Event;

      try {
        fastify.log.info(`🔐 [${requestId}] Vérification signature webhook...`);
        event = stripe.webhooks.constructEvent(
          request.body as string,
          signature,
          webhookSecret
        );
        fastify.log.info(`✅ [${requestId}] Signature validée: ${event.type} - ID: ${event.id}`);
      } catch (err: any) {
        fastify.log.error(`❌ [${requestId}] Erreur signature:`, err.message);
        return reply.status(400).send({ error: 'Signature invalide' });
      }

      // ✅ TRAITEMENT SELON LE TYPE D'ÉVÉNEMENT
      switch (event.type) {
        case 'checkout.session.completed':
          fastify.log.info(`💳 [${requestId}] Traitement checkout.session.completed`);
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, fastify, requestId);
          break;

        case 'customer.subscription.deleted':
          fastify.log.info(`🚫 [${requestId}] Traitement customer.subscription.deleted`);
          await handleSubscriptionCanceled(event.data.object as Stripe.Subscription, fastify, requestId);
          break;

        case 'customer.subscription.updated':
          fastify.log.info(`🔄 [${requestId}] Traitement customer.subscription.updated`);
          await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, fastify, requestId);
          break;

        case 'invoice.payment_succeeded':
          fastify.log.info(`💰 [${requestId}] Traitement invoice.payment_succeeded`);
          await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice, fastify, requestId);
          break;

        case 'invoice.payment_failed':
          fastify.log.info(`💸 [${requestId}] Traitement invoice.payment_failed`);
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, fastify, requestId);
          break;

        default:
          fastify.log.info(`ℹ️ [${requestId}] Événement non traité: ${event.type}`);
      }

      fastify.log.info(`✅ [${requestId}] Webhook traité avec succès`);
      return { received: true, eventId: event.id, requestId };

    } catch (error: any) {
      fastify.log.error(`❌ [${requestId}] ERREUR GLOBALE webhook:`, error.message || String(error));
      return reply.status(500).send({ 
        error: 'Erreur serveur',
        requestId,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE DEBUG SHOP SUPABASE
  fastify.get('/debug-shop/:userId', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string }
      
      const { data: shop, error } = await supabaseServiceClient
        .from('shops')
        .select('id, email, subscription_plan, is_active, created_at, updated_at')
        .eq('id', userId)
        .single();
      
      if (error || !shop) {
        return reply.status(404).send({ error: 'Shop not found', details: error?.message });
      }
      
      return {
        success: true,
        shop: {
          id: shop.id,
          email: shop.email,
          plan: shop.subscription_plan,
          isActive: shop.is_active,
          createdAt: shop.created_at,
          updatedAt: shop.updated_at
        }
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // ✅ FONCTIONS WEBHOOK SUPABASE UNIQUEMENT
  
  async function handleCheckoutCompleted(session: Stripe.Checkout.Session, fastify: FastifyInstance, requestId: string) {
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan;
    const shopEmail = session.metadata?.shopEmail;

    fastify.log.info(`🎉 [${requestId}] === CHECKOUT COMPLETED ===`);
    fastify.log.info(`👤 [${requestId}] UserId: ${userId}`);
    fastify.log.info(`📋 [${requestId}] Plan: ${plan}`);
    fastify.log.info(`📧 [${requestId}] Email: ${shopEmail}`);
    fastify.log.info(`💰 [${requestId}] Montant: ${session.amount_total}`);
    fastify.log.info(`📧 [${requestId}] Session ID: ${session.id}`);

    if (!userId || !plan) {
      const metadataString = JSON.stringify({ userId, plan, allMetadata: session.metadata });
      fastify.log.error(`❌ [${requestId}] Metadata critiques manquantes: ${metadataString}`);
      return;
    }
    
    try {
      // ✅ VÉRIFICATION EXISTENCE SHOP AVEC SUPABASE
      fastify.log.info(`🔍 [${requestId}] Recherche shop: ${userId}`);
      const { data: existingShop, error: findError } = await supabaseServiceClient
        .from('shops')
        .select('*')
        .eq('id', userId)
        .single();

      if (findError || !existingShop) {
        fastify.log.error(`❌ [${requestId}] Shop introuvable: ${userId}`);
        
        // ✅ TENTATIVE DE RECHERCHE PAR EMAIL
        if (shopEmail) {
          fastify.log.info(`🔍 [${requestId}] Recherche par email: ${shopEmail}`);
          const { data: shopByEmail, error: emailError } = await supabaseServiceClient
            .from('shops')
            .select('*')
            .eq('email', shopEmail)
            .single();
          
          if (!emailError && shopByEmail) {
            fastify.log.info(`✅ [${requestId}] Shop trouvé par email: ${shopByEmail.id}`);
            // Mettre à jour l'ID si nécessaire
            if (shopByEmail.id !== userId) {
              fastify.log.warn(`⚠️ [${requestId}] ID mismatch: DB=${shopByEmail.id}, Stripe=${userId}`);
            }
          }
        }
        
        return;
      }

      const shopInfoString = JSON.stringify({
        id: existingShop.id,
        name: existingShop.name,
        email: existingShop.email,
        currentPlan: existingShop.subscription_plan,
        isActive: existingShop.is_active
      });
      fastify.log.info(`🏪 [${requestId}] Shop trouvé: ${shopInfoString}`);

      // ✅ VÉRIFICATION PLAN ACTUEL
      if (existingShop.subscription_plan === plan) {
        fastify.log.warn(`⚠️ [${requestId}] Shop déjà sur le plan: ${plan}`);
      }

      // ✅ MISE À JOUR SHOP AVEC SUPABASE
      fastify.log.info(`🔄 [${requestId}] Mise à jour du shop vers plan: ${plan}`);
      
      const { data: updateResult, error: updateError } = await supabaseServiceClient
        .from('shops')
        .update({
          subscription_plan: plan as string,
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Erreur mise à jour shop: ${updateError.message}`);
      }

      fastify.log.info(`✅ [${requestId}] Shop mis à jour avec succès:`);
      fastify.log.info(`   └─ ID: ${updateResult.id}`);
      fastify.log.info(`   └─ Plan: ${existingShop.subscription_plan} → ${updateResult.subscription_plan}`);
      fastify.log.info(`   └─ Actif: ${existingShop.is_active} → ${updateResult.is_active}`);
      fastify.log.info(`   └─ Mis à jour: ${updateResult.updated_at}`);

      // ✅ CRÉATION LOG DE TRANSACTION (optionnel)
      try {
        const eventData = {
          sessionId: session.id,
          planFrom: existingShop.subscription_plan,
          planTo: plan,
          amount: session.amount_total,
          currency: session.currency,
          customerEmail: shopEmail,
          timestamp: new Date().toISOString()
        };
        
        // Tentative de création d'événement analytics (ne pas bloquer si la table n'existe pas)
        const { error: analyticsError } = await supabaseServiceClient
          .from('analytics_events')
          .insert({
            shop_id: userId,
            event_type: 'payment_success',
            event_data: eventData,
            created_at: new Date().toISOString()
          });
        
        if (analyticsError) {
          fastify.log.warn(`⚠️ [${requestId}] Impossible de créer l'événement analytics: ${analyticsError.message}`);
        } else {
          fastify.log.info(`📊 [${requestId}] Événement analytics créé`);
        }
      } catch (analyticsError: any) {
        fastify.log.warn(`⚠️ [${requestId}] Erreur création analytics (non bloquante): ${analyticsError.message}`);
      }

      // ✅ NOTIFICATION DE SUCCÈS
      fastify.log.info(`🎉 [${requestId}] Paiement confirmé pour ${shopEmail} - Plan: ${plan}`);

    } catch (error: any) {
      const errorInfoString = JSON.stringify({
        message: error.message,
        code: error.code,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
      fastify.log.error(`❌ [${requestId}] ERREUR MISE À JOUR SHOP: ${errorInfoString}`);
    }
  }

  async function handleSubscriptionCanceled(subscription: Stripe.Subscription, fastify: FastifyInstance, requestId: string) {
    const userId = subscription.metadata?.userId;

    fastify.log.info(`🚫 [${requestId}] Subscription canceled: userId=${userId}`);

    if (!userId) {
      fastify.log.error(`❌ [${requestId}] Missing userId in subscription metadata`);
      return;
    }

    try {
      const { error } = await supabaseServiceClient
        .from('shops')
        .update({
          subscription_plan: 'free',
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        throw new Error(error.message);
      }

      fastify.log.info(`✅ [${requestId}] Subscription canceled for user ${userId}`);
    } catch (error: any) {
      fastify.log.error(`❌ [${requestId}] Error canceling shop subscription: ${error.message}`);
    }
  }

  async function handleSubscriptionUpdated(subscription: Stripe.Subscription, fastify: FastifyInstance, requestId: string) {
    const userId = subscription.metadata?.userId;

    fastify.log.info(`🔄 [${requestId}] Subscription updated: userId=${userId}, status=${subscription.status}`);

    if (!userId) {
      fastify.log.error(`❌ [${requestId}] Missing userId in subscription metadata`);
      return;
    }

    try {
      const isActive = subscription.status === 'active';
      
      const { error } = await supabaseServiceClient
        .from('shops')
        .update({
          is_active: isActive,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        throw new Error(error.message);
      }

      fastify.log.info(`✅ [${requestId}] Subscription updated for user ${userId}, status: ${subscription.status}`);
    } catch (error: any) {
      fastify.log.error(`❌ [${requestId}] Error updating shop subscription: ${error.message}`);
    }
  }

  async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice, fastify: FastifyInstance, requestId: string) {
    fastify.log.info(`💰 [${requestId}] Invoice payment succeeded: ${invoice.id}`);
    
    // TODO: Logique pour les paiements de facture récurrents
    // - Enregistrer la facture dans Supabase
    // - Confirmer le renouvellement
    // - Envoyer notification
  }

  async function handleInvoicePaymentFailed(invoice: Stripe.Invoice, fastify: FastifyInstance, requestId: string) {
    fastify.log.info(`💸 [${requestId}] Invoice payment failed: ${invoice.id}`);
    
    // TODO: Logique pour les échecs de paiement
    // - Notifier l'utilisateur
    // - Suspendre le service si nécessaire
    // - Planifier nouvelles tentatives
  }
}