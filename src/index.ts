// src/index.ts 
import Fastify from 'fastify'
import cors from '@fastify/cors'

// ✅ IMPORTER TOUTES LES ROUTES
import billingRoutes from './routes/billing'
import agentsRoutes from './routes/agents' 

// ✅ FONCTION PRINCIPALE ASYNC
const start = async () => {
  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    }
  })

  try {
    // ✅ CORS
    await fastify.register(cors, {
      origin: [
        'http://localhost:3000',
        'https://dashboard.chatseller.app',
        'https://chatseller.app'
      ],
      credentials: true
    })

    // ✅ ENREGISTRER LES ROUTES BILLING (EXISTANTES)
    await fastify.register(billingRoutes, { prefix: '/api' })
    
    // ✅ ENREGISTRER LES ROUTES AGENTS (NOUVELLES)
    await fastify.register(agentsRoutes, { prefix: '/api/agents' })

    // ✅ ROUTE DE SANTÉ
    fastify.get('/health', async (request, reply) => {
      return { 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        routes: ['/', '/health', '/api/*', '/api/agents/*']
      }
    })

    // ✅ ROUTE RACINE
    fastify.get('/', async (request, reply) => {
      return { 
        message: 'ChatSeller API',
        version: '1.0.0',
        endpoints: [
          'GET /health',
          'GET|POST /api/billing/*',
          'GET|POST|PUT|DELETE /api/agents/*'
        ]
      }
    })

    // ✅ DÉMARRER LE SERVEUR
    const port = parseInt(process.env.PORT || '3001')
    await fastify.listen({ port, host: '0.0.0.0' })
    
    console.log(`🚀 ChatSeller API démarré sur le port ${port}`)
    console.log(`📋 Routes disponibles:`)
    console.log(`   - GET  /health`)
    console.log(`   - GET  /api/plans`)
    console.log(`   - POST /api/create-checkout-session`)
    console.log(`   - GET  /api/subscription-status`)
    console.log(`   - GET  /api/agents`)
    console.log(`   - POST /api/agents`)
    console.log(`   - PUT  /api/agents/:id`)
    console.log(`   - DELETE /api/agents/:id`)
    
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

// ✅ DÉMARRER L'APPLICATION
start()