// src/routes/billing.ts 
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import prisma from '../lib/prisma'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ✅ VERSION STRIPE CORRIGÉE
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-06-30.basil'
});

// ✅ CONFIGURATION DES PLANS CORRIGÉE
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

async function verifySupabaseAuth(request: any) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Token manquant');
  }

  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    throw new Error('Token invalide');
  }
  
  return user;
}

async function getOrCreateShop(user: any, fastify: FastifyInstance) {
  fastify.log.info(`🔍 Recherche du shop pour l'utilisateur: ${user.id} (${user.email})`);
  
  try {
    await prisma.$connect();
    
    let shop = await prisma.shop.findUnique({
      where: { id: user.id }
    });

    if (shop) {
      fastify.log.info(`✅ Shop trouvé par ID: ${shop.id}`);
      return shop;
    }

    shop = await prisma.shop.findUnique({
      where: { email: user.email }
    });

    if (shop) {
      fastify.log.info(`✅ Shop trouvé par email: ${shop.id}`);
      return shop;
    }

    fastify.log.info(`🏗️ Création automatique du shop pour: ${user.email}`);
    
    const newShop = await prisma.shop.create({
      data: {
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
        }
      }
    });

    fastify.log.info(`✅ Shop créé avec succès: ${newShop.id}`);
    return newShop;

  } catch (error: any) {
    fastify.log.error('❌ ERREUR GLOBALE dans getOrCreateShop:', error);
    throw new Error(`Impossible de créer ou récupérer le shop: ${error.message}`);
  } finally {
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      fastify.log.warn('⚠️ Erreur lors de la déconnexion Prisma:', disconnectError);
    }
  }
}

export default async function billingRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE DE DIAGNOSTIC COMPLÈTE
  fastify.get('/diagnostic', async (request, reply) => {
    try {
      fastify.log.info('🧪 === DIAGNOSTIC BILLING COMPLET ===');
      
      const envCheck = {
        DATABASE_URL: !!process.env.DATABASE_URL,
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
        STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_'),
        STRIPE_PRICE_ID_STARTER: !!process.env.STRIPE_PRICE_ID_STARTER && process.env.STRIPE_PRICE_ID_STARTER.startsWith('price_'),
        STRIPE_PRICE_ID_PRO: !!process.env.STRIPE_PRICE_ID_PRO && process.env.STRIPE_PRICE_ID_PRO.startsWith('price_'),
        STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET
      };
      
      let prismaTest: { success: boolean; error: string | null } = { success: false, error: null };
      try {
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1 as test`;
        prismaTest.success = true;
        await prisma.$disconnect();
      } catch (error: any) {
        prismaTest.error = error.message;
      }
      
      let supabaseTest: { success: boolean; error: string | null } = { success: false, error: null };
      try {
        const { data, error } = await supabase.auth.admin.listUsers();
        supabaseTest.success = !error;
        if (error) supabaseTest.error = error.message;
      } catch (error: any) {
        supabaseTest.error = error.message;
      }
      
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
          prisma: prismaTest,
          supabase: supabaseTest,
          stripe: stripeTest,
          timestamp: new Date().toISOString(),
          plansConfig: STRIPE_PLANS
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
    } catch (error) {
      fastify.log.error('Get plans error:', error);
      return reply.status(500).send({ error: 'Erreur lors de la récupération des plans' });
    }
  });

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
        fastify.log.error('❌ Erreur customer Stripe:', customerError);
        throw new Error(`Erreur customer: ${customerError.message}`);
      }

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
        fastify.log.error('❌ ERREUR CRÉATION SESSION:', sessionError);
        
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
      fastify.log.error('❌ ERREUR GLOBALE CHECKOUT:', error);
      
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
        const creationDate = new Date(shop.createdAt || Date.now());
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
            ? new Date(new Date(shop.createdAt || Date.now()).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
            : null,
          nextBillingDate: shop.subscription_plan !== 'free' 
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            : null,
          shopId: shop.id,
          shopName: shop.name
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Get subscription status error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({ 
        error: 'Erreur lors de la récupération du statut',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ WEBHOOK STRIPE CRITIQUE - VERSION ULTRA ROBUSTE
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
      fastify.log.error(`❌ [${requestId}] ERREUR GLOBALE webhook:`, error);
      return reply.status(500).send({ 
        error: 'Erreur serveur',
        requestId,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  fastify.get('/debug-shop/:userId', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string }
      
      await prisma.$connect()
      const shop = await prisma.shop.findUnique({
        where: { id: userId }
      })
      await prisma.$disconnect()
      
      if (!shop) {
        return reply.status(404).send({ error: 'Shop not found' })
      }
      
      return {
        success: true,
        shop: {
          id: shop.id,
          email: shop.email,
          plan: shop.subscription_plan,
          isActive: shop.is_active,
          createdAt: shop.createdAt,
          updatedAt: shop.updatedAt
        }
      }
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  })

  // ✅ FONCTIONS WEBHOOK ULTRA ROBUSTES
  
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
      fastify.log.error(`❌ [${requestId}] Metadata critiques manquantes:`, { 
        userId, 
        plan, 
        allMetadata: session.metadata 
      });
      return;
    }

    const connectionId = `conn_${Date.now()}`;
    
    try {
      fastify.log.info(`🔌 [${requestId}] Connexion Prisma: ${connectionId}`);
      await prisma.$connect();
      
      // ✅ VÉRIFICATION EXISTENCE SHOP
      fastify.log.info(`🔍 [${requestId}] Recherche shop: ${userId}`);
      const existingShop = await prisma.shop.findUnique({
        where: { id: userId }
      });

      if (!existingShop) {
        fastify.log.error(`❌ [${requestId}] Shop introuvable: ${userId}`);
        
        // ✅ TENTATIVE DE RECHERCHE PAR EMAIL
        if (shopEmail) {
          fastify.log.info(`🔍 [${requestId}] Recherche par email: ${shopEmail}`);
          const shopByEmail = await prisma.shop.findUnique({
            where: { email: shopEmail }
          });
          
          if (shopByEmail) {
            fastify.log.info(`✅ [${requestId}] Shop trouvé par email: ${shopByEmail.id}`);
            // Mettre à jour l'ID si nécessaire
            if (shopByEmail.id !== userId) {
              fastify.log.warn(`⚠️ [${requestId}] ID mismatch: DB=${shopByEmail.id}, Stripe=${userId}`);
            }
          }
        }
        
        return;
      }

      fastify.log.info(`🏪 [${requestId}] Shop trouvé:`, {
        id: existingShop.id,
        name: existingShop.name,
        email: existingShop.email,
        currentPlan: existingShop.subscription_plan,
        isActive: existingShop.is_active
      });

      // ✅ VÉRIFICATION PLAN ACTUEL
      if (existingShop.subscription_plan === plan) {
        fastify.log.warn(`⚠️ [${requestId}] Shop déjà sur le plan: ${plan}`);
      }

      // ✅ MISE À JOUR ATOMIQUE DU SHOP
      fastify.log.info(`🔄 [${requestId}] Mise à jour du shop vers plan: ${plan}`);
      
      const updateResult = await prisma.shop.update({
        where: { id: userId },
        data: {
          subscription_plan: plan as string,
          is_active: true,
          updatedAt: new Date()
        }
      });

      fastify.log.info(`✅ [${requestId}] Shop mis à jour avec succès:`);
      fastify.log.info(`   └─ ID: ${updateResult.id}`);
      fastify.log.info(`   └─ Plan: ${existingShop.subscription_plan} → ${updateResult.subscription_plan}`);
      fastify.log.info(`   └─ Actif: ${existingShop.is_active} → ${updateResult.is_active}`);
      fastify.log.info(`   └─ Mis à jour: ${updateResult.updatedAt}`);

      // ✅ CRÉATION LOG DE TRANSACTION
      try {
        const logData = {
          shopId: userId,
          eventType: 'checkout_completed',
          eventData: {
            sessionId: session.id,
            planFrom: existingShop.subscription_plan,
            planTo: plan,
            amount: session.amount_total,
            currency: session.currency,
            customerEmail: shopEmail,
            timestamp: new Date().toISOString()
          }
        };
        
        // Ne pas bloquer si la table analytics n'existe pas
        await prisma.analyticsEvent.create({
          data: {
            shopId: userId,
            eventType: 'payment_success',
            eventData: logData.eventData
          }
        }).catch((analyticsError) => {
          fastify.log.warn(`⚠️ [${requestId}] Impossible de créer l'événement analytics:`, analyticsError.message);
        });
        
        fastify.log.info(`📊 [${requestId}] Événement analytics créé`);
      } catch (analyticsError: any) {
        fastify.log.warn(`⚠️ [${requestId}] Erreur création analytics (non bloquante):`, analyticsError.message);
      }

      // ✅ NOTIFICATION DE SUCCÈS (Optionnel)
      try {
        fastify.log.info(`🎉 [${requestId}] Paiement confirmé pour ${shopEmail} - Plan: ${plan}`);
        
        // TODO: Ici vous pouvez ajouter :
        // - Envoi d'email de confirmation
        // - Notification Slack/Discord
        // - Webhook vers d'autres services
        // - Activation de fonctionnalités spécifiques au plan
        
      } catch (notificationError: any) {
        fastify.log.warn(`⚠️ [${requestId}] Erreur notification (non bloquante):`, notificationError.message);
      }

    } catch (error: any) {
      fastify.log.error(`❌ [${requestId}] ERREUR MISE À JOUR SHOP:`, {
        message: error.message,
        code: error.code,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    } finally {
      try {
        await prisma.$disconnect();
        fastify.log.info(`🔌 [${requestId}] Déconnexion Prisma: ${connectionId}`);
      } catch (disconnectError: any) {
        fastify.log.warn(`⚠️ [${requestId}] Erreur déconnexion Prisma:`, disconnectError.message);
      }
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
      await prisma.$connect();
      await prisma.shop.update({
        where: { id: userId },
        data: {
          subscription_plan: 'free',
          is_active: false,
          updatedAt: new Date()
        }
      });
      await prisma.$disconnect();

      fastify.log.info(`✅ [${requestId}] Subscription canceled for user ${userId}`);
    } catch (error: any) {
      fastify.log.error(`❌ [${requestId}] Error canceling shop subscription:`, error);
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
      
      await prisma.$connect();
      await prisma.shop.update({
        where: { id: userId },
        data: {
          is_active: isActive,
          updatedAt: new Date()
        }
      });
      await prisma.$disconnect();

      fastify.log.info(`✅ [${requestId}] Subscription updated for user ${userId}, status: ${subscription.status}`);
    } catch (error: any) {
      fastify.log.error(`❌ [${requestId}] Error updating shop subscription:`, error);
    }
  }

  async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice, fastify: FastifyInstance, requestId: string) {
    fastify.log.info(`💰 [${requestId}] Invoice payment succeeded: ${invoice.id}`);
    
    // TODO: Logique pour les paiements de facture récurrents
    // - Enregistrer la facture
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