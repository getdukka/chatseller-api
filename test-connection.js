// test-connection.js - Test avec l'URL Railway
require('dotenv').config()

const { PrismaClient } = require('@prisma/client')

const railwayUrl = "postgresql://postgres:8GKXjOVEcVFwIll3@db.hdprfqmufuydpgwvhxvd.supabase.co:5432/postgres?prepared_statements=false&pgbouncer=true&connection_limit=5&pool_timeout=0"

async function testRailwayUrl() {
  console.log('🧪 Test avec l\'URL Railway modifiée...')
  
  const prisma = new PrismaClient({
    log: ['error', 'warn', 'info'],
    datasources: {
      db: {
        url: railwayUrl
      }
    }
  })

  try {
    console.log('📡 Connexion en cours...')
    await prisma.$connect()
    console.log('✅ Connexion réussie!')

    console.log('📡 Test requête simple...')
    const result = await prisma.$queryRawUnsafe('SELECT 1 as test, NOW() as current_time')
    console.log('✅ Requête réussie:', result)

    console.log('📡 Test accès table shops...')
    const count = await prisma.shop.count()
    console.log('✅ Nombre de shops:', count)

    console.log('🎉 Tous les tests passés!')

  } catch (error) {
    console.error('❌ Erreur:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

testRailwayUrl()