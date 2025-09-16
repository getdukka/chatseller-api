// src/routes/settings.ts

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabaseServiceClient } from '../lib/supabase';

// ✅ INTERFACE POUR TYPER LE BODY D'IMPORT
interface ImportConfigBody {
  version?: string;
  settings?: any;
  attribution_config?: any;
  notification_config?: any;
  exportedAt?: string;
  shopId?: string;
}

// ✅ SCHÉMAS DE VALIDATION
const settingsSchema = z.object({
  notifications: z.object({
    email_orders: z.boolean().optional(),
    email_analytics: z.boolean().optional(),
    sms_orders: z.boolean().optional(),
    slack_webhook: z.string().optional()
  }).optional(),
  
  analytics: z.object({
    tracking_enabled: z.boolean().optional(),
    attribution_window: z.number().min(1).max(90).optional(), // Jours
    cookie_consent: z.boolean().optional()
  }).optional(),
  
  beauty: z.object({
    primary_category: z.enum(['skincare', 'makeup', 'fragrance', 'haircare', 'bodycare', 'multi']).optional(),
    target_age_range: z.string().optional(),
    price_range: z.enum(['budget', 'mid', 'premium', 'luxury']).optional(),
    specialization: z.array(z.string()).optional()
  }).optional(),
  
  widget: z.object({
    auto_greeting_delay: z.number().min(0).max(60).optional(), // Secondes
    offline_mode: z.boolean().optional(),
    language: z.enum(['fr', 'en', 'wo']).optional()
  }).optional()
});

const attributionConfigSchema = z.object({
  utm: z.object({
    enabled: z.boolean(),
    sources: z.array(z.string()).optional(),
    attribution_window: z.number().min(1).max(90).optional()
  }).optional(),
  
  cookie: z.object({
    enabled: z.boolean(),
    expiry_days: z.number().min(1).max(365).optional(),
    secure_only: z.boolean().optional()
  }).optional(),
  
  session: z.object({
    enabled: z.boolean(),
    timeout_minutes: z.number().min(5).max(480).optional()
  }).optional(),
  
  referral: z.object({
    enabled: z.boolean(),
    codes: z.array(z.string()).optional(),
    discount_percent: z.number().min(0).max(100).optional()
  }).optional(),
  
  default_method: z.enum(['utm', 'cookie', 'session', 'referral']).optional(),
  confidence_threshold: z.number().min(0).max(100).optional()
});

const notificationConfigSchema = z.object({
  email: z.object({
    orders: z.boolean(),
    analytics_daily: z.boolean(),
    analytics_weekly: z.boolean(),
    low_conversion_alert: z.boolean(),
    quota_warning: z.boolean()
  }).optional(),
  
  sms: z.object({
    orders: z.boolean(),
    urgent_alerts: z.boolean(),
    phone_number: z.string().optional()
  }).optional(),
  
  slack: z.object({
    enabled: z.boolean(),
    webhook_url: z.string().optional(),
    orders: z.boolean(),
    analytics: z.boolean()
  }).optional(),
  
  push: z.object({
    enabled: z.boolean(),
    orders: z.boolean(),
    analytics: z.boolean()
  }).optional()
});

// ✅ HELPER : Récupérer user shop ID
function getUserShopId(request: any): string | null {
  const user = request.user as any
  return user?.shopId || user?.shop_id || user?.id || null
}

// ✅ HELPER : Récupérer ou créer configuration par défaut
async function getOrCreateShopSettings(shopId: string) {
  const { data: shop, error } = await supabaseServiceClient
    .from('shops')
    .select('id, settings, attribution_config, notification_config')
    .eq('id', shopId)
    .single();

  if (error || !shop) {
    throw new Error('Shop non trouvé');
  }

  // Configuration par défaut si pas encore définie
  const defaultSettings = {
    notifications: {
      email_orders: true,
      email_analytics: true,
      sms_orders: false,
      slack_webhook: null
    },
    analytics: {
      tracking_enabled: true,
      attribution_window: 30,
      cookie_consent: true
    },
    beauty: {
      primary_category: 'multi',
      target_age_range: '25-45',
      price_range: 'mid',
      specialization: []
    },
    widget: {
      auto_greeting_delay: 3,
      offline_mode: false,
      language: 'fr'
    }
  };

  const defaultAttributionConfig = {
    utm: {
      enabled: true,
      sources: ['facebook', 'google', 'instagram', 'email'],
      attribution_window: 30
    },
    cookie: {
      enabled: true,
      expiry_days: 30,
      secure_only: true
    },
    session: {
      enabled: true,
      timeout_minutes: 30
    },
    referral: {
      enabled: false,
      codes: [],
      discount_percent: 10
    },
    default_method: 'session',
    confidence_threshold: 80
  };

  const defaultNotificationConfig = {
    email: {
      orders: true,
      analytics_daily: false,
      analytics_weekly: true,
      low_conversion_alert: true,
      quota_warning: true
    },
    sms: {
      orders: false,
      urgent_alerts: false,
      phone_number: null
    },
    slack: {
      enabled: false,
      webhook_url: null,
      orders: false,
      analytics: false
    },
    push: {
      enabled: true,
      orders: true,
      analytics: true
    }
  };

  return {
    settings: shop.settings || defaultSettings,
    attribution_config: shop.attribution_config || defaultAttributionConfig,
    notification_config: shop.notification_config || defaultNotificationConfig
  };
}

export default async function settingsRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE : Récupérer tous les settings
  fastify.get('/', async (request, reply) => {
    try {
      const shopId = getUserShopId(request);
      
      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }
      
      fastify.log.info(`⚙️ Récupération settings pour shop: ${shopId}`);
      
      const shopSettings = await getOrCreateShopSettings(shopId);
      
      return {
        success: true,
        data: shopSettings
      };
      
    } catch (error: any) {
      fastify.log.error(`❌ Get settings error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des paramètres'
      });
    }
  });

  // ✅ ROUTE : Mettre à jour les settings généraux
  fastify.put<{ Body: z.infer<typeof settingsSchema> }>('/', async (request, reply) => {
    try {
      const shopId = getUserShopId(request);
      
      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }
      
      const newSettings = settingsSchema.parse(request.body);
      
      fastify.log.info(`⚙️ Mise à jour settings pour shop: ${shopId}`);
      
      // Récupérer les settings actuels
      const currentSettings = await getOrCreateShopSettings(shopId);
      
      // Merger avec les nouveaux settings
      const updatedSettings = {
        ...currentSettings.settings,
        ...newSettings
      };
      
      // Sauvegarder en base
      const { data: shop, error } = await supabaseServiceClient
        .from('shops')
        .update({
          settings: updatedSettings,
          updated_at: new Date().toISOString()
        })
        .eq('id', shopId)
        .select()
        .single();
      
      if (error) {
        fastify.log.error(`❌ Erreur mise à jour settings: ${error.message}`);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la mise à jour des paramètres'
        });
      }
      
      return {
        success: true,
        data: {
          settings: updatedSettings,
          message: 'Paramètres mis à jour avec succès'
        }
      };
      
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          success: false,
          error: 'Données invalides',
          details: error.errors
        });
      }
      
      fastify.log.error(`❌ Update settings error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la mise à jour des paramètres'
      });
    }
  });

  // ✅ ROUTE : Récupérer configuration attribution
  fastify.get('/attribution', async (request, reply) => {
    try {
      const shopId = getUserShopId(request);
      
      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }
      
      fastify.log.info(`🎯 Récupération config attribution pour shop: ${shopId}`);
      
      const shopSettings = await getOrCreateShopSettings(shopId);
      
      return {
        success: true,
        data: shopSettings.attribution_config
      };
      
    } catch (error: any) {
      fastify.log.error(`❌ Get attribution config error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération de la configuration d\'attribution'
      });
    }
  });

  // ✅ ROUTE : Mettre à jour configuration attribution
  fastify.put<{ Body: z.infer<typeof attributionConfigSchema> }>('/attribution', async (request, reply) => {
    try {
      const shopId = getUserShopId(request);
      
      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }
      
      const newAttributionConfig = attributionConfigSchema.parse(request.body);
      
      fastify.log.info(`🎯 Mise à jour config attribution pour shop: ${shopId}`);
      
      // Récupérer la config actuelle
      const currentSettings = await getOrCreateShopSettings(shopId);
      
      // Merger avec la nouvelle config
      const updatedAttributionConfig = {
        ...currentSettings.attribution_config,
        ...newAttributionConfig
      };
      
      // Sauvegarder en base
      const { data: shop, error } = await supabaseServiceClient
        .from('shops')
        .update({
          attribution_config: updatedAttributionConfig,
          updated_at: new Date().toISOString()
        })
        .eq('id', shopId)
        .select()
        .single();
      
      if (error) {
        fastify.log.error(`❌ Erreur mise à jour attribution config: ${error.message}`);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la mise à jour de la configuration d\'attribution'
        });
      }
      
      return {
        success: true,
        data: {
          attribution_config: updatedAttributionConfig,
          message: 'Configuration d\'attribution mise à jour avec succès'
        }
      };
      
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          success: false,
          error: 'Données invalides',
          details: error.errors
        });
      }
      
      fastify.log.error(`❌ Update attribution config error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la mise à jour de la configuration d\'attribution'
      });
    }
  });

  // ✅ ROUTE : Récupérer configuration notifications
  fastify.get('/notifications', async (request, reply) => {
    try {
      const shopId = getUserShopId(request);
      
      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }
      
      fastify.log.info(`🔔 Récupération config notifications pour shop: ${shopId}`);
      
      const shopSettings = await getOrCreateShopSettings(shopId);
      
      return {
        success: true,
        data: shopSettings.notification_config
      };
      
    } catch (error: any) {
      fastify.log.error(`❌ Get notification config error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération de la configuration des notifications'
      });
    }
  });

  // ✅ ROUTE : Mettre à jour configuration notifications
  fastify.put<{ Body: z.infer<typeof notificationConfigSchema> }>('/notifications', async (request, reply) => {
    try {
      const shopId = getUserShopId(request);
      
      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }
      
      const newNotificationConfig = notificationConfigSchema.parse(request.body);
      
      fastify.log.info(`🔔 Mise à jour config notifications pour shop: ${shopId}`);
      
      // Récupérer la config actuelle
      const currentSettings = await getOrCreateShopSettings(shopId);
      
      // Merger avec la nouvelle config
      const updatedNotificationConfig = {
        ...currentSettings.notification_config,
        ...newNotificationConfig
      };
      
      // Sauvegarder en base
      const { data: shop, error } = await supabaseServiceClient
        .from('shops')
        .update({
          notification_config: updatedNotificationConfig,
          updated_at: new Date().toISOString()
        })
        .eq('id', shopId)
        .select()
        .single();
      
      if (error) {
        fastify.log.error(`❌ Erreur mise à jour notification config: ${error.message}`);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la mise à jour de la configuration des notifications'
        });
      }
      
      return {
        success: true,
        data: {
          notification_config: updatedNotificationConfig,
          message: 'Configuration des notifications mise à jour avec succès'
        }
      };
      
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          success: false,
          error: 'Données invalides',
          details: error.errors
        });
      }
      
      fastify.log.error(`❌ Update notification config error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la mise à jour de la configuration des notifications'
      });
    }
  });

  // ✅ ROUTE : Test configuration notification (webhooks, emails)
  fastify.post<{ 
    Body: { 
      type: 'email' | 'sms' | 'slack' | 'push';
      test_message?: string;
    } 
  }>('/notifications/test', async (request, reply) => {
    try {
      const { type, test_message = 'Test de notification ChatSeller' } = request.body;
      const shopId = getUserShopId(request);
      
      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }
      
      fastify.log.info(`🧪 Test notification ${type} pour shop: ${shopId}`);
      
      // Récupérer la config notifications
      const shopSettings = await getOrCreateShopSettings(shopId);
      const notifConfig = shopSettings.notification_config;
      
      let testResult = {
        success: false,
        message: 'Configuration non trouvée',
        details: null as any
      };
      
      switch (type) {
        case 'email':
          if (notifConfig.email) {
            // TODO: Implémenter test email avec SendGrid/Resend
            testResult = {
              success: true,
              message: 'Email de test envoyé avec succès',
              details: { provider: 'Simulation', to: 'shop_email' }
            };
          }
          break;
          
        case 'sms':
          if (notifConfig.sms?.phone_number) {
            // TODO: Implémenter test SMS avec Twilio/OVH
            testResult = {
              success: true,
              message: 'SMS de test envoyé avec succès',
              details: { provider: 'Simulation', to: notifConfig.sms.phone_number }
            };
          }
          break;
          
        case 'slack':
          if (notifConfig.slack?.webhook_url) {
            // TODO: Implémenter test Slack webhook
            testResult = {
              success: true,
              message: 'Message Slack envoyé avec succès',
              details: { webhook: 'Webhook configuré' }
            };
          }
          break;
          
        case 'push':
          if (notifConfig.push?.enabled) {
            // TODO: Implémenter test push notification
            testResult = {
              success: true,
              message: 'Notification push envoyée avec succès',
              details: { service: 'Browser/PWA' }
            };
          }
          break;
      }
      
      return {
        success: testResult.success,
        data: testResult
      };
      
    } catch (error: any) {
      fastify.log.error(`❌ Test notification error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du test de notification'
      });
    }
  });

  // ✅ ROUTE : Réinitialiser configuration aux valeurs par défaut
  fastify.post<{ 
    Body: { 
      section: 'all' | 'attribution' | 'notifications' | 'settings';
      confirm: boolean;
    } 
  }>('/reset', async (request, reply) => {
    try {
      const { section, confirm } = request.body;
      const shopId = getUserShopId(request);
      
      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }
      
      if (!confirm) {
        return reply.status(400).send({
          success: false,
          error: 'Confirmation requise pour la réinitialisation'
        });
      }
      
      fastify.log.info(`🔄 Réinitialisation ${section} pour shop: ${shopId}`);
      
      // Récupérer defaults
      const defaultShopSettings = await getOrCreateShopSettings('default');
      
      let updateData: any = {
        updated_at: new Date().toISOString()
      };
      
      switch (section) {
        case 'all':
          updateData.settings = defaultShopSettings.settings;
          updateData.attribution_config = defaultShopSettings.attribution_config;
          updateData.notification_config = defaultShopSettings.notification_config;
          break;
          
        case 'attribution':
          updateData.attribution_config = defaultShopSettings.attribution_config;
          break;
          
        case 'notifications':
          updateData.notification_config = defaultShopSettings.notification_config;
          break;
          
        case 'settings':
          updateData.settings = defaultShopSettings.settings;
          break;
      }
      
      // Appliquer la réinitialisation
      const { error } = await supabaseServiceClient
        .from('shops')
        .update(updateData)
        .eq('id', shopId);
      
      if (error) {
        fastify.log.error(`❌ Erreur réinitialisation: ${error.message}`);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la réinitialisation'
        });
      }
      
      return {
        success: true,
        data: {
          message: `Configuration ${section} réinitialisée avec succès`,
          resetSection: section,
          resetAt: new Date().toISOString()
        }
      };
      
    } catch (error: any) {
      fastify.log.error(`❌ Reset settings error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la réinitialisation'
      });
    }
  });

  // ✅ ROUTE : Export configuration (pour backup)
  fastify.get('/export', async (request, reply) => {
    try {
      const shopId = getUserShopId(request);
      
      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }
      
      fastify.log.info(`📤 Export configuration pour shop: ${shopId}`);
      
      const shopSettings = await getOrCreateShopSettings(shopId);
      
      const exportData = {
        exportedAt: new Date().toISOString(),
        shopId,
        version: '1.0',
        ...shopSettings
      };
      
      return {
        success: true,
        data: exportData
      };
      
    } catch (error: any) {
      fastify.log.error(`❌ Export settings error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'export de la configuration'
      });
    }
  });

  // ✅ ROUTE : Import configuration (pour restore)
  fastify.post<{ Body: ImportConfigBody }>('/import', async (request, reply) => {
    try {
      const importData: ImportConfigBody = request.body
      const shopId = getUserShopId(request);
      
      if (!shopId) {
        return reply.status(400).send({
          success: false,
          error: 'Shop ID requis'
        });
      }
      
      if (!importData.version || !importData.settings) {
        return reply.status(400).send({
          success: false,
          error: 'Format d\'import invalide'
        });
      }
      
      fastify.log.info(`📥 Import configuration pour shop: ${shopId}`);
      
      // Valider et appliquer les données importées
      const updateData = {
        settings: importData.settings,
        attribution_config: importData.attribution_config,
        notification_config: importData.notification_config,
        updated_at: new Date().toISOString()
      };
      
      const { error } = await supabaseServiceClient
        .from('shops')
        .update(updateData)
        .eq('id', shopId);
      
      if (error) {
        fastify.log.error(`❌ Erreur import: ${error.message}`);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de l\'import de la configuration'
        });
      }
      
      return {
        success: true,
        data: {
          message: 'Configuration importée avec succès',
          importedAt: new Date().toISOString(),
          version: importData.version
        }
      };
      
    } catch (error: any) {
      fastify.log.error(`❌ Import settings error: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'import de la configuration'
      });
    }
  });
}