// src/routes/billing.ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Stripe from 'stripe';
import { supabaseServiceClient, supabaseAuthClient } from '../lib/supabase';

// ✅ STRIPE CORRIGÉ
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-07-30.basil'
});

// ✅ NOUVEAUX PLANS BEAUTÉ ALIGNÉS AVEC FRONTEND
const BEAUTY_PLANS = {
  starter: {
    name: 'Starter',
    price: 4900, // 49€ en centimes
    stripePriceId: process.env.STRIPE_PRICE_ID_STARTER!,
    features: [
      'Agents IA illimités (+10€/agent)',
      '1 000 réponses IA/mois',
      '50 documents base de connaissances',
      '500 pages web indexables',
      'Widget adaptatif beauté',
      'Analytics de base',
      'Support email'
    ],
    limits: { 
      aiResponses: 1000, 
      knowledgeDocuments: 50, 
      indexablePages: 500, 
      agents: -1 // Illimité mais payant
    },
    trialDays: 14,
    additionalAgentCost: 10 // 10€ par agent supplémentaire
  },
  growth: {
    name: 'Growth',
    price: 14900, // 149€ en centimes  
    stripePriceId: process.env.STRIPE_PRICE_ID_PRO!,
    features: [
      'Tout du plan Starter inclus',
      'Agents IA illimités (+10€/agent)',
      '10 000 réponses IA/mois',
      '200 documents base de connaissances',
      '2 000 pages web indexables',
      'Analytics avancées & ROI',
      'A/B testing agents',
      'Intégrations CRM',
      'Support prioritaire'
    ],
    limits: { 
      aiResponses: 10000, 
      knowledgeDocuments: 200, 
      indexablePages: 2000, 
      agents: -1 // Illimité mais payant
    },
    trialDays: 14,
    additionalAgentCost: 10 // 10€ par agent supplémentaire
  },
  performance: {
    name: 'Performance',
    price: 0, // Sur mesure
    stripePriceId: null, // Pas de Stripe pour ce plan
    features: [
      'Tout du plan Growth inclus',
      'Réponses IA illimitées',
      'Documents illimités',
      'Pages indexables illimitées',
      'Agents IA inclus (0€ supplémentaire)',
      'White-label complet',
      'API avancée',
      'Support dédié 24/7',
      'Onboarding personnalisé'
    ],
    limits: { 
      aiResponses: -1, // Illimité
      knowledgeDocuments: -1, // Illimité
      indexablePages: -1, // Illimité
      agents: -1 // Illimité et gratuit
    },
    trialDays: 14,
    additionalAgentCost: 0 // Agents inclus
  }
};

// ✅ SCHÉMAS VALIDATION CORRIGÉS
const createSubscriptionSchema = z.object({
  plan: z.enum(['starter', 'growth']), // Performance se fait par contact
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

const createPortalSchema = z.object({
  returnUrl: z.string().url()
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

// ✅ CRÉER OU RÉCUPÉRER SHOP BEAUTÉ
async function getOrCreateBeautyShop(user: any, fastify: FastifyInstance) {
  fastify.log.info(`🔍 Recherche shop beauté pour: ${user.id} (${user.email})`);
  
  try {
    // Recherche par ID
    const { data: shopById, error: errorById } = await supabaseServiceClient
      .from('shops')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!errorById && shopById) {
      fastify.log.info(`✅ Shop beauté trouvé par ID: ${shopById.id}`);
      return shopById;
    }

    // Recherche par email
    const { data: shopByEmail, error: errorByEmail } = await supabaseServiceClient
      .from('shops')
      .select('*')
      .eq('email', user.email)
      .single();

    if (!errorByEmail && shopByEmail) {
      fastify.log.info(`✅ Shop beauté trouvé par email: ${shopByEmail.id}`);
      return shopByEmail;
    }

    // ✅ CRÉATION AUTOMATIQUE SHOP BEAUTÉ
    fastify.log.info(`🏗️ Création shop beauté pour: ${user.email}`);
    
    const newShopData = {
      id: user.id,
      name: user.user_metadata?.company || user.user_metadata?.full_name || user.email.split('@')[0] + ' Beauté',
      email: user.email,
      subscription_plan: 'starter', // ✅ NOUVEAU PLAN PAR DÉFAUT
      beauty_category: user.user_metadata?.beauty_category || 'multi',
      is_active: true,
      // ✅ CONFIGURATION BEAUTÉ PAR DÉFAUT
      widget_config: {
        theme: "beauty_modern",
        language: "fr", 
        position: "above-cta",
        buttonText: "Parler à votre conseillère beauté",
        primaryColor: "#E91E63"
      },
      agent_config: {
        name: "Rose",
        title: "Conseillère Beauté IA",
        type: "beauty_expert",
        avatar: "https://ui-avatars.com/api/?name=Rose&background=E91E63&color=fff",
        welcomeMessage: "Bonjour ! Je suis Rose, votre conseillère beauté. Comment puis-je vous aider ?",
        fallbackMessage: "Je transmets votre question à notre équipe beauté.",
        collectBeautyProfile: true,
        upsellEnabled: true
      },
      // ✅ QUOTAS BEAUTÉ PAR DÉFAUT
      quotas_usage: {
        aiResponses: 0,
        knowledgeDocuments: 0,
        indexablePages: 0,
        agents: 1 // 1 agent par défaut
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
      throw new Error(`Erreur création shop beauté: ${createError.message}`);
    }

    fastify.log.info(`✅ Shop beauté créé: ${newShop.id}`);
    return newShop;

  } catch (error: any) {
    fastify.log.error('❌ ERREUR dans getOrCreateBeautyShop:', error.message);
    throw new Error(`Impossible de créer shop beauté: ${error.message}`);
  }
}

// ✅ CALCULER COÛT TOTAL AVEC AGENTS
function calculateTotalCost(plan: keyof typeof BEAUTY_PLANS, agentCount: number = 1): {
  baseCost: number;
  agentCost: number;
  totalCost: number;
  description: string;
} {
  const planData = BEAUTY_PLANS[plan];
  const baseCost = planData.price / 100; // Convertir centimes en euros
  
  // Performance : agents inclus
  if (plan === 'performance') {
    return {
      baseCost: 0,
      agentCost: 0,
      totalCost: 0,
      description: 'Sur mesure'
    };
  }
  
  // Starter & Growth : 10€ par agent supplémentaire
  const agentCost = Math.max(0, agentCount - 1) * planData.additionalAgentCost;
  const totalCost = baseCost + agentCost;
  
  return {
    baseCost,
    agentCost,
    totalCost,
    description: `${totalCost}€/mois`
  };
}

export default async function beautyBillingRoutes(fastify: FastifyInstance) {
  
  // ✅ DIAGNOSTIC BEAUTÉ
  fastify.get('/diagnostic', async (request, reply) => {
    try {
      fastify.log.info('🧪 === DIAGNOSTIC BILLING BEAUTÉ ===');
      
      const envCheck = {
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
        STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_'),
        STRIPE_PRICE_ID_STARTER: !!process.env.STRIPE_PRICE_ID_STARTER && process.env.STRIPE_PRICE_ID_STARTER.startsWith('price_'),
        STRIPE_PRICE_ID_PRO: !!process.env.STRIPE_PRICE_ID_PRO && process.env.STRIPE_PRICE_ID_PRO.startsWith('price_'),
        STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET
      };
      
      // Test Supabase
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
      
      // Test Stripe avec nouveaux Price IDs
      let stripeTest: { success: boolean; error: string | null; priceValidation?: any } = { success: false, error: null };
      try {
        // Test starter price
        if (process.env.STRIPE_PRICE_ID_STARTER) {
          try {
            const starterPrice = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID_STARTER);
            stripeTest.priceValidation = {
              ...stripeTest.priceValidation,
              starter: {
                id: starterPrice.id,
                amount: starterPrice.unit_amount,
                currency: starterPrice.currency,
                active: starterPrice.active
              }
            };
          } catch (priceError: any) {
            stripeTest.priceValidation = {
              ...stripeTest.priceValidation,
              starter: { error: priceError.message }
            };
          }
        }

        // Test growth price
        if (process.env.STRIPE_PRICE_ID_PRO) {
          try {
            const growthPrice = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID_PRO);
            stripeTest.priceValidation = {
              ...stripeTest.priceValidation,
              growth: {
                id: growthPrice.id,
                amount: growthPrice.unit_amount,
                currency: growthPrice.currency,
                active: growthPrice.active
              }
            };
          } catch (priceError: any) {
            stripeTest.priceValidation = {
              ...stripeTest.priceValidation,
              growth: { error: priceError.message }
            };
          }
        }
        
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
          plansConfig: BEAUTY_PLANS,
          database: 'Supabase (Beauté)',
          version: '2.0 - Spécialisé Beauté'
        }
      };
      
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        diagnostic: { success: false, error: 'Diagnostic beauté échoué' }
      };
    }
  });
  
  // ✅ PLANS BEAUTÉ
  fastify.get('/plans', async (request, reply) => {
    try {
      const plans = Object.entries(BEAUTY_PLANS).map(([key, plan]) => ({
        id: key,
        name: plan.name,
        price: plan.price,
        priceFormatted: plan.price === 0 ? 'Sur mesure' : `${plan.price / 100}€`,
        features: plan.features,
        limits: plan.limits,
        trialDays: plan.trialDays,
        additionalAgentCost: plan.additionalAgentCost
      }));

      return { success: true, plans };
    } catch (error: any) {
      fastify.log.error('Get beauty plans error:', error.message);
      return reply.status(500).send({ error: 'Erreur lors de la récupération des plans beauté' });
    }
  });

  // ✅ CRÉATION SESSION CHECKOUT BEAUTÉ
  fastify.post('/create-checkout-session', async (request, reply) => {
    try {
      fastify.log.info('🚀 === CHECKOUT SESSION BEAUTÉ ===');

      // ✅ LOG DU BODY REÇU POUR DEBUG
      fastify.log.info(`📥 Body reçu: ${JSON.stringify(request.body)}`);

      // ✅ VÉRIFICATION VARIABLES STRIPE
      if (!process.env.STRIPE_SECRET_KEY) {
        fastify.log.error('❌ STRIPE_SECRET_KEY non configuré');
        return reply.status(500).send({
          success: false,
          error: 'Configuration Stripe manquante (SECRET_KEY)'
        });
      }

      const body = createSubscriptionSchema.parse(request.body);
      fastify.log.info(`📝 Plan beauté demandé: ${body.plan}`);

      // ✅ VÉRIFIER QUE LE PRICE ID EXISTE
      const priceIdEnvVar = body.plan === 'starter' ? 'STRIPE_PRICE_ID_STARTER' : 'STRIPE_PRICE_ID_PRO';
      const priceId = process.env[priceIdEnvVar];
      fastify.log.info(`📝 Price ID env var: ${priceIdEnvVar} = ${priceId ? priceId.substring(0, 20) + '...' : 'NON DÉFINI'}`);

      if (!priceId) {
        fastify.log.error(`❌ ${priceIdEnvVar} non configuré dans les variables d'environnement`);
        return reply.status(500).send({
          success: false,
          error: `Configuration Stripe manquante: ${priceIdEnvVar} non défini`
        });
      }

      const user = await verifySupabaseAuth(request);
      fastify.log.info(`👤 Utilisateur beauté: ${user.id} (${user.email})`);

      const shop = await getOrCreateBeautyShop(user, fastify);

      // ✅ VÉRIFICATIONS PLAN BEAUTÉ
      if (shop.subscription_plan === body.plan) {
        return reply.status(400).send({
          success: false,
          error: 'Vous avez déjà ce plan beauté',
          currentPlan: shop.subscription_plan
        });
      }

      const plan = BEAUTY_PLANS[body.plan];
      if (!plan.stripePriceId) {
        fastify.log.error(`❌ stripePriceId manquant pour plan ${body.plan}`);
        return reply.status(400).send({
          success: false,
          error: 'Ce plan beauté nécessite un contact commercial',
          contactEmail: 'sales@chatseller.app'
        });
      }

      fastify.log.info(`📋 Plan beauté: ${plan.name} - ${plan.price/100}€ - ${plan.stripePriceId}`);

      // ✅ VALIDATION STRIPE PRICE ID
      try {
        const priceValidation = await stripe.prices.retrieve(plan.stripePriceId);
        if (!priceValidation.active) {
          throw new Error(`Price ID beauté inactif: ${plan.stripePriceId}`);
        }
        fastify.log.info(`✅ Price ID beauté valide: ${priceValidation.id}`);
      } catch (priceError: any) {
        fastify.log.error('❌ Price ID beauté invalide:', priceError.message);
        return reply.status(500).send({ 
          error: 'Configuration Stripe beauté invalide',
          details: priceError.message
        });
      }

      // ✅ CUSTOMER STRIPE
      let customer;
      try {
        const existingCustomers = await stripe.customers.list({
          email: shop.email,
          limit: 1
        });

        if (existingCustomers.data.length > 0) {
          customer = existingCustomers.data[0];
          fastify.log.info(`✅ Customer beauté existant: ${customer.id}`);
        } else {
          customer = await stripe.customers.create({
            email: shop.email,
            name: shop.name,
            metadata: {
              userId: shop.id,
              shopName: shop.name,
              beautyCategory: shop.beauty_category || 'multi',
              platform: 'chatseller_beauty'
            }
          });
          fastify.log.info(`✅ Customer beauté créé: ${customer.id}`);
        }
      } catch (customerError: any) {
        fastify.log.error('❌ Erreur customer beauté:', customerError.message);
        throw new Error(`Customer beauté: ${customerError.message}`);
      }

      // ✅ SESSION CHECKOUT BEAUTÉ
      try {
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
            shopEmail: shop.email,
            beautyCategory: shop.beauty_category || 'multi',
            platform: 'chatseller_beauty'
          },
          subscription_data: {
            metadata: {
              userId: shop.id,
              plan: body.plan,
              shopEmail: shop.email,
              beautyCategory: shop.beauty_category || 'multi',
              platform: 'chatseller_beauty'
            },
            trial_period_days: plan.trialDays
          }
        });

        fastify.log.info(`✅ Session beauté créée: ${session.id}`);
        
        return { 
          success: true, 
          checkoutUrl: session.url,
          sessionId: session.id,
          plan: body.plan,
          message: 'Session de paiement beauté créée'
        };

      } catch (sessionError: any) {
        fastify.log.error('❌ Session beauté échouée:', sessionError.message);
        throw new Error(`Session beauté: ${sessionError.message}`);
      }

    } catch (error: any) {
      fastify.log.error('❌ ERREUR CHECKOUT BEAUTÉ:', error.message);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          error: 'Données invalides',
          details: error.errors
        });
      }
      
      if (error.message.includes('Token')) {
        return reply.status(401).send({ error: 'Authentification requise' });
      }
      
      return reply.status(500).send({
        error: 'Erreur création session beauté',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Erreur serveur'
      });
    }
  });

  // ✅ CUSTOMER PORTAL
  fastify.post('/customer-portal', async (request, reply) => {
    try {
      fastify.log.info('🏛️ === CUSTOMER PORTAL BEAUTÉ ===');
      
      const body = createPortalSchema.parse(request.body);
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateBeautyShop(user, fastify);

      // Recherche customer Stripe
      const existingCustomers = await stripe.customers.list({
        email: shop.email,
        limit: 1
      });

      if (existingCustomers.data.length === 0) {
        return reply.status(400).send({ 
          error: 'Aucun abonnement beauté actif. Souscrivez d\'abord à un plan.' 
        });
      }

      const customer = existingCustomers.data[0];

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: body.returnUrl,
      });

      fastify.log.info(`✅ Portal beauté créé: ${portalSession.id}`);

      return { 
        success: true, 
        portalUrl: portalSession.url,
        sessionId: portalSession.id,
        message: 'Portail client beauté créé'
      };

    } catch (error: any) {
      fastify.log.error('❌ ERREUR PORTAL BEAUTÉ:', error.message);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({ error: 'Données invalides' });
      }
      
      if (error.message.includes('Token')) {
        return reply.status(401).send({ error: 'Authentification requise' });
      }
      
      return reply.status(500).send({ error: 'Erreur portail beauté' });
    }
  });

  // ✅ STATUT ABONNEMENT BEAUTÉ - RÉPONSE ALIGNÉE FRONTEND
  fastify.get('/subscription-status', async (request, reply) => {
    try {
      fastify.log.info('🔍 Statut abonnement beauté');
      
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateBeautyShop(user, fastify);

      // ✅ CALCUL TRIAL DAYS LEFT
      let trialDaysLeft = 0;
      let trialEndDate = null;
      
      if (shop.subscription_plan === 'starter') {
        const creationDate = new Date(shop.created_at || Date.now());
        const daysSinceCreation = Math.floor((Date.now() - creationDate.getTime()) / (1000 * 60 * 60 * 24));
        const trialDuration = BEAUTY_PLANS.starter.trialDays;
        trialDaysLeft = Math.max(0, trialDuration - daysSinceCreation);
        trialEndDate = new Date(creationDate.getTime() + trialDuration * 24 * 60 * 60 * 1000).toISOString();
      }

      // ✅ CALCUL COÛT AGENTS
      const agentCount = shop.quotas_usage?.agents || 1;
      const costCalculation = calculateTotalCost(shop.subscription_plan as keyof typeof BEAUTY_PLANS, agentCount);

      // ✅ RÉPONSE ALIGNÉE AVEC FRONTEND
      return {
        success: true,
        subscription: {
          plan: shop.subscription_plan, // 'starter', 'growth', ou 'performance'
          isActive: shop.is_active && (shop.subscription_plan !== 'starter' || trialDaysLeft > 0),
          trialDaysLeft: trialDaysLeft,
          trialEndDate: trialEndDate,
          nextBillingDate: shop.subscription_plan !== 'starter' 
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            : null,
          shopId: shop.id,
          shopName: shop.name,
          beautyCategory: shop.beauty_category,
          // ✅ DONNÉES AGENTS
          agentCount: agentCount,
          agentCost: costCalculation.agentCost,
          totalMonthlyCost: costCalculation.totalCost
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Erreur statut beauté:', error.message);
      
      if (error.message.includes('Token')) {
        return reply.status(401).send({ error: 'Authentification requise' });
      }
      
      return reply.status(500).send({ 
        error: 'Erreur statut abonnement beauté',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ WEBHOOK BEAUTÉ - TRAITEMENT NOUVEAUX PLANS
  fastify.post('/webhook', async (request, reply) => {
    const requestId = `beauty_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    try {
      fastify.log.info(`📧 [${requestId}] === WEBHOOK BEAUTÉ ===`);
      
      const signature = request.headers['stripe-signature'] as string;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

      if (!signature || !webhookSecret) {
        return reply.status(400).send({ error: 'Webhook configuration manquante' });
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          request.body as string,
          signature,
          webhookSecret
        );
        fastify.log.info(`✅ [${requestId}] Webhook beauté validé: ${event.type}`);
      } catch (err: any) {
        fastify.log.error(`❌ [${requestId}] Signature invalide:`, err.message);
        return reply.status(400).send({ error: 'Signature invalide' });
      }

      // ✅ TRAITEMENT ÉVÉNEMENTS BEAUTÉ
      switch (event.type) {
        case 'checkout.session.completed':
          await handleBeautyCheckoutCompleted(event.data.object as Stripe.Checkout.Session, fastify, requestId);
          break;

        case 'customer.subscription.deleted':
          await handleBeautySubscriptionCanceled(event.data.object as Stripe.Subscription, fastify, requestId);
          break;

        case 'customer.subscription.updated':
          await handleBeautySubscriptionUpdated(event.data.object as Stripe.Subscription, fastify, requestId);
          break;

        case 'invoice.payment_succeeded':
          await handleBeautyInvoicePaymentSucceeded(event.data.object as Stripe.Invoice, fastify, requestId);
          break;

        case 'invoice.payment_failed':
          await handleBeautyInvoicePaymentFailed(event.data.object as Stripe.Invoice, fastify, requestId);
          break;

        default:
          fastify.log.info(`ℹ️ [${requestId}] Événement beauté non traité: ${event.type}`);
      }

      return { received: true, eventId: event.id, requestId, platform: 'chatseller_beauty' };

    } catch (error: any) {
      fastify.log.error(`❌ [${requestId}] ERREUR WEBHOOK BEAUTÉ:`, error.message);
      return reply.status(500).send({ error: 'Erreur webhook beauté', requestId });
    }
  });

  // ✅ FONCTIONS WEBHOOK BEAUTÉ

  async function handleBeautyCheckoutCompleted(session: Stripe.Checkout.Session, fastify: FastifyInstance, requestId: string) {
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan;
    const beautyCategory = session.metadata?.beautyCategory;

    fastify.log.info(`🎉 [${requestId}] Checkout beauté complété: ${userId} → ${plan} (${beautyCategory})`);

    if (!userId || !plan) {
      fastify.log.error(`❌ [${requestId}] Metadata beauté manquantes`);
      return;
    }

    try {
      // Vérification shop beauté
      const { data: shop, error: findError } = await supabaseServiceClient
        .from('shops')
        .select('*')
        .eq('id', userId)
        .single();

      if (findError || !shop) {
        fastify.log.error(`❌ [${requestId}] Shop beauté introuvable: ${userId}`);
        return;
      }

      // ✅ MISE À JOUR PLAN BEAUTÉ
      const { data: updatedShop, error: updateError } = await supabaseServiceClient
        .from('shops')
        .update({
          subscription_plan: plan,
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Erreur mise à jour plan beauté: ${updateError.message}`);
      }

      fastify.log.info(`✅ [${requestId}] Plan beauté mis à jour: ${shop.subscription_plan} → ${updatedShop.subscription_plan}`);

      // ✅ LOG ANALYTICS BEAUTÉ
      try {
        await supabaseServiceClient
          .from('analytics_events')
          .insert({
            shop_id: userId,
            event_type: 'beauty_subscription_success',
            event_data: {
              sessionId: session.id,
              planFrom: shop.subscription_plan,
              planTo: plan,
              amount: session.amount_total,
              beautyCategory: beautyCategory,
              platform: 'chatseller_beauty',
              timestamp: new Date().toISOString()
            },
            created_at: new Date().toISOString()
          });
        
        fastify.log.info(`📊 [${requestId}] Analytics beauté créées`);
      } catch (analyticsError: any) {
        fastify.log.warn(`⚠️ [${requestId}] Analytics beauté échouées: ${analyticsError.message}`);
      }

    } catch (error: any) {
      fastify.log.error(`❌ [${requestId}] Erreur checkout beauté: ${error.message}`);
    }
  }

  async function handleBeautySubscriptionCanceled(subscription: Stripe.Subscription, fastify: FastifyInstance, requestId: string) {
    const userId = subscription.metadata?.userId;

    if (!userId) return;

    try {
      await supabaseServiceClient
        .from('shops')
        .update({
          subscription_plan: 'starter', // Retour au plan de base
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      fastify.log.info(`✅ [${requestId}] Abonnement beauté annulé: ${userId}`);
    } catch (error: any) {
      fastify.log.error(`❌ [${requestId}] Erreur annulation beauté: ${error.message}`);
    }
  }

  async function handleBeautySubscriptionUpdated(subscription: Stripe.Subscription, fastify: FastifyInstance, requestId: string) {
    const userId = subscription.metadata?.userId;

    if (!userId) return;

    try {
      const isActive = subscription.status === 'active' || subscription.status === 'trialing';
      
      await supabaseServiceClient
        .from('shops')
        .update({
          is_active: isActive,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      fastify.log.info(`✅ [${requestId}] Abonnement beauté mis à jour: ${userId} → ${subscription.status}`);
    } catch (error: any) {
      fastify.log.error(`❌ [${requestId}] Erreur MàJ beauté: ${error.message}`);
    }
  }

  async function handleBeautyInvoicePaymentSucceeded(invoice: Stripe.Invoice, fastify: FastifyInstance, requestId: string) {
    fastify.log.info(`💰 [${requestId}] Paiement beauté réussi: ${invoice.id}`);
    // TODO: Logique spécifique paiements beauté
  }

  async function handleBeautyInvoicePaymentFailed(invoice: Stripe.Invoice, fastify: FastifyInstance, requestId: string) {
    fastify.log.info(`💸 [${requestId}] Paiement beauté échoué: ${invoice.id}`);
    // TODO: Logique spécifique échecs paiements beauté
  }

  // ✅ ROUTE CALCUL COÛT AGENTS
  fastify.post('/calculate-cost', async (request, reply) => {
    try {
      const { plan, agentCount } = request.body as { plan: keyof typeof BEAUTY_PLANS; agentCount: number };
      
      if (!BEAUTY_PLANS[plan]) {
        return reply.status(400).send({ error: 'Plan beauté invalide' });
      }

      const cost = calculateTotalCost(plan, agentCount);
      
      return {
        success: true,
        calculation: {
          plan: plan,
          agentCount: agentCount,
          baseCost: cost.baseCost,
          agentCost: cost.agentCost,
          totalCost: cost.totalCost,
          description: cost.description,
          planDetails: BEAUTY_PLANS[plan]
        }
      };
    } catch (error: any) {
      return reply.status(500).send({ error: 'Erreur calcul coût beauté' });
    }
  });
}