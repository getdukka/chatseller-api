// quick-test.js - Test rapide de l'URL simplifiée
const { PrismaClient } = require('@prisma/client')

const testUrl = "postgresql://postgres:8GKXjOVEcVFwIll3@db.hdprfqmufuydpgwvhxvd.supabase.co:5432/postgres?sslmode=require&prepared_statements=false"

async function quickTest() {
  console.log('🧪 Test rapide de l\'URL simplifiée...')
  
  const prisma = new PrismaClient({
    log: ['error'],
    datasources: { db: { url: testUrl } }
  })

  try {
    await prisma.$connect()
    console.log('✅ Connexion OK')

    const result = await prisma.$queryRawUnsafe('SELECT 1 as test')
    console.log('✅ Requête OK:', result)

    const count = await prisma.shop.count()
    console.log('✅ Table access OK, shops:', count)

    console.log('🎉 URL FONCTIONNELLE ! Utilisez-la dans Railway.')
    return true
  } catch (error) {
    console.error('❌ Erreur:', error.message)
    return false
  } finally {
    await prisma.$disconnect()
  }
}

quickTest()