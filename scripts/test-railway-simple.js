// scripts/test-railway-simple.js
const { PrismaClient } = require('@prisma/client')

// URLs à tester
const urls = [
  "postgresql://postgres:8GKXjOVEcVFwIll3@db.hdprfqmufuydpgwvhxvd.supabase.co:5432/postgres?sslmode=require&prepared_statements=false",
  "postgresql://postgres:8GKXjOVEcVFwIll3@db.hdprfqmufuydpgwvhxvd.supabase.co:5432/postgres?prepared_statements=false&pgbouncer=true",
  "postgresql://postgres:8GKXjOVEcVFwIll3@db.hdprfqmufuydpgwvhxvd.supabase.co:5432/postgres?sslmode=require"
]

async function testUrl(url, index) {
  console.log(`\n🧪 Test ${index + 1}/3: ${url.substring(0, 80)}...`)
  
  const prisma = new PrismaClient({
    log: ['error'],
    datasources: { db: { url } }
  })

  try {
    await prisma.$connect()
    console.log('✅ Connexion réussie')

    const result = await prisma.$queryRawUnsafe('SELECT 1 as test, NOW() as time')
    console.log('✅ Requête réussie:', result[0])

    const shopCount = await prisma.shop.count()
    console.log('✅ Accès table shops:', shopCount, 'shops')

    return { success: true, url }
  } catch (error) {
    console.error('❌ Erreur:', error.message)
    return { success: false, url, error: error.message }
  } finally {
    await prisma.$disconnect()
  }
}

async function testAllUrls() {
  console.log('🚀 Test de toutes les URLs Railway...\n')
  
  for (let i = 0; i < urls.length; i++) {
    const result = await testUrl(urls[i], i)
    if (result.success) {
      console.log(`\n🎉 URL FONCTIONNELLE TROUVÉE!\n${result.url}\n`)
      break
    }
  }
}

testAllUrls().catch(console.error)