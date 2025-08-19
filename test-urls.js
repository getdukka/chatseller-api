// test-urls.js - Test des URLs Railway
const { PrismaClient } = require('@prisma/client')

const urls = [
  // URL 1: Simple avec SSL
  "postgresql://postgres:8GKXjOVEcVFwIll3@db.hdprfqmufuydpgwvhxvd.supabase.co:5432/postgres?sslmode=require&prepared_statements=false",
  
  // URL 2: Encore plus simple
  "postgresql://postgres:8GKXjOVEcVFwIll3@db.hdprfqmufuydpgwvhxvd.supabase.co:5432/postgres?sslmode=require",
  
  // URL 3: Minimal
  "postgresql://postgres:8GKXjOVEcVFwIll3@db.hdprfqmufuydpgwvhxvd.supabase.co:5432/postgres",
  
  // URL 4: Avec pgbouncer simple
  "postgresql://postgres:8GKXjOVEcVFwIll3@db.hdprfqmufuydpgwvhxvd.supabase.co:5432/postgres?pgbouncer=true&prepared_statements=false"
]

async function testUrl(url, index) {
  console.log(`\n🧪 Test ${index + 1}/${urls.length}:`)
  console.log(`📍 URL: ${url.substring(0, 90)}...`)
  
  const prisma = new PrismaClient({
    log: [],
    datasources: { db: { url } }
  })

  try {
    await prisma.$connect()
    console.log('✅ Connexion réussie')

    const result = await prisma.$queryRawUnsafe('SELECT 1 as test, NOW() as time')
    console.log('✅ Requête réussie')

    const shopCount = await prisma.shop.count()
    console.log(`✅ Accès table shops: ${shopCount} shops`)

    console.log('🎉 URL FONCTIONNELLE !')
    console.log(`🔗 Utilisez cette URL dans Railway:`)
    console.log(url)
    
    return { success: true, url }
  } catch (error) {
    console.log('❌ Erreur:', error.message.substring(0, 100))
    return { success: false, url, error: error.message }
  } finally {
    await prisma.$disconnect()
  }
}

async function testAllUrls() {
  console.log('🚀 Test de toutes les URLs Railway...')
  
  for (let i = 0; i < urls.length; i++) {
    const result = await testUrl(urls[i], i)
    if (result.success) {
      console.log(`\n🏆 PREMIÈRE URL FONCTIONNELLE TROUVÉE !`)
      console.log(`\n📋 À copier dans Railway Variables:`)
      console.log(`DATABASE_URL="${result.url}"`)
      break
    }
  }
  
  console.log('\n🔄 Test terminé.')
}

testAllUrls().catch(console.error)