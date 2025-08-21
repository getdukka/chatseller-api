// test-urls.js - Script de test des endpoints ChatSeller
const BASE_URL = 'https://chatseller-api-production.up.railway.app'

const endpoints = [
  {
    name: 'Health Check',
    url: `${BASE_URL}/health`,
    method: 'GET',
    expected: 200
  },
  {
    name: 'Root',
    url: `${BASE_URL}/`,
    method: 'GET',
    expected: 200
  },
  {
    name: 'Health with Supabase',
    url: `${BASE_URL}/health/supabase`,
    method: 'GET',
    expected: 200
  },
  {
    name: 'Public Config (Test)',
    url: `${BASE_URL}/api/v1/public/shops/public/test-shop/config`,
    method: 'GET',
    expected: 200
  },
  {
    name: 'Public Chat (Test)',
    url: `${BASE_URL}/api/v1/public/chat`,
    method: 'POST',
    expected: 200,
    body: {
      shopId: 'test-shop',
      message: 'Bonjour',
      isFirstMessage: true,
      productInfo: {
        name: 'Test Product',
        price: 5000
      }
    }
  }
]

async function testEndpoint(endpoint) {
  try {
    console.log(`\n🧪 Testing: ${endpoint.name}`)
    console.log(`📡 ${endpoint.method} ${endpoint.url}`)
    
    const options = {
      method: endpoint.method,
      headers: {
        'Content-Type': 'application/json',
      }
    }
    
    if (endpoint.body) {
      options.body = JSON.stringify(endpoint.body)
    }
    
    const startTime = Date.now()
    const response = await fetch(endpoint.url, options)
    const duration = Date.now() - startTime
    
    const statusIcon = response.status === endpoint.expected ? '✅' : '❌'
    console.log(`${statusIcon} Status: ${response.status} (expected: ${endpoint.expected})`)
    console.log(`⏱️  Duration: ${duration}ms`)
    
    if (response.ok) {
      const data = await response.json()
      console.log(`📄 Response: ${JSON.stringify(data, null, 2).slice(0, 200)}...`)
    } else {
      const text = await response.text()
      console.log(`❌ Error: ${text.slice(0, 200)}...`)
    }
    
    return response.status === endpoint.expected
    
  } catch (error) {
    console.log(`💥 Error: ${error.message}`)
    return false
  }
}

async function runTests() {
  console.log('🚀 === CHATSELLER API ENDPOINT TESTS ===')
  console.log(`🎯 Base URL: ${BASE_URL}`)
  console.log(`📅 Date: ${new Date().toISOString()}`)
  
  let passed = 0
  let failed = 0
  
  for (const endpoint of endpoints) {
    const success = await testEndpoint(endpoint)
    if (success) {
      passed++
    } else {
      failed++
    }
    
    // Pause entre les tests
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  console.log('\n📊 === RÉSULTATS ===')
  console.log(`✅ Tests réussis: ${passed}`)
  console.log(`❌ Tests échoués: ${failed}`)
  console.log(`📈 Taux de réussite: ${Math.round((passed / (passed + failed)) * 100)}%`)
  
  if (failed === 0) {
    console.log('\n🎉 Tous les tests sont passés ! API prête pour production.')
  } else {
    console.log('\n⚠️  Certains tests ont échoué. Vérifiez les logs ci-dessus.')
  }
}

// Exécuter les tests
runTests().catch(console.error)